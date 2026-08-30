import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GENERATED_RULES,
  OPERATION_TYPES,
  PATTERN_TYPES,
  REQUEST_SCOPES,
  RuleValidationError,
  applyOperations,
  buildDynamicRules,
  createEmptyConfig,
  createRule,
  evaluateConfig,
  normalizeConfig,
  patternMatches,
  patternToRegex,
  validateConfig,
  validatePattern,
  wildcardToRegex,
} from "../lib/rules.js";

function configuredRule(overrides = {}) {
  return {
    ...createRule(overrides.id || "rule-a"),
    name: "Example rule",
    includes: ["*://example.com/*"],
    operations: [
      { type: OPERATION_TYPES.SET, key: "debug", value: "1" },
    ],
    ...overrides,
  };
}

function configuredConfig(rules, overrides = {}) {
  return {
    ...createEmptyConfig(),
    rules,
    ...overrides,
  };
}

test("normalizeConfig repairs missing fields and deduplicates patterns", () => {
  const config = normalizeConfig({
    active: false,
    rules: [
      {
        id: "first",
        name: "  Trimmed  ",
        includes: [" https://example.com/* ", "https://example.com/*"],
        operations: [{ type: "remove", key: " token ", value: "ignored" }],
      },
    ],
  });

  assert.equal(config.active, false);
  assert.equal(config.version, 1);
  assert.deepEqual(config.rules[0], {
    id: "first",
    name: "Trimmed",
    enabled: true,
    patternType: PATTERN_TYPES.WILDCARD,
    caseSensitive: false,
    includes: ["https://example.com/*"],
    excludes: [],
    scope: REQUEST_SCOPES.ALL,
    operations: [{ type: OPERATION_TYPES.REMOVE, key: "token", value: "" }],
  });
});

test("validatePattern accepts the documented wildcard grammar", () => {
  assert.equal(validatePattern("*://*.example.com/*"), "");
  assert.equal(validatePattern("https://example.com/path?mode=*"), "");
  assert.match(validatePattern("example.com/*"), /Start the pattern/);
  assert.match(validatePattern("https:///path"), /include a host/);
  assert.match(validatePattern("https://example.com/#section"), /fragments/);
  assert.match(validatePattern("https://example.com/a b"), /whitespace/);
  assert.match(validatePattern("https://example.com/café"), /ASCII/);
});

test("regex patterns accept raw expressions and reject invalid syntax", () => {
  const source = "^https://(?:api|www)\\.example\\.com/v[0-9]+/users(?:\\?.*)?$";
  assert.equal(validatePattern(source, PATTERN_TYPES.REGEX), "");
  assert.equal(patternToRegex(source, PATTERN_TYPES.REGEX), source);
  assert.match(
    validatePattern("([unclosed", PATTERN_TYPES.REGEX),
    /Invalid regular expression/,
  );
  assert.equal(
    patternMatches(
      "https://API.example.com/v2/users?active=1",
      source,
      PATTERN_TYPES.REGEX,
    ),
    true,
  );
  assert.equal(
    patternMatches(
      "https://API.example.com/v2/users?active=1",
      source,
      PATTERN_TYPES.REGEX,
      true,
    ),
    false,
  );
});

test("wildcardToRegex produces an anchored RE2-compatible expression", () => {
  assert.equal(
    wildcardToRegex("*://api.example.com/v1/*?debug=*"),
    "^https?://api\\.example\\.com/v1/.*\\?debug=.*$",
  );
  assert.equal(patternMatches("HTTPS://API.EXAMPLE.COM/v1/users?debug=1", "*://api.example.com/v1/*"), true);
  assert.equal(patternMatches("https://notexample.com/", "*://example.com/*"), false);
  assert.throws(() => wildcardToRegex("file://example.com/*"), RuleValidationError);
});

test("applyOperations sets, overrides, and removes query parameters", () => {
  const result = applyOperations("https://example.com/path?a=old&a=older&remove=yes#top", [
    { type: OPERATION_TYPES.SET, key: "a", value: "new value" },
    { type: OPERATION_TYPES.OVERRIDE, key: "missing", value: "unused" },
    { type: OPERATION_TYPES.REMOVE, key: "remove", value: "" },
    { type: OPERATION_TYPES.SET, key: "added", value: "x&y" },
  ]);

  assert.equal(
    result.url,
    "https://example.com/path?a=new+value&added=x%26y#top",
  );
  assert.deepEqual(
    result.changes.map((change) => change.applied),
    [true, false, true, true],
  );
  assert.deepEqual(result.changes[0].before, ["old", "older"]);
  assert.deepEqual(result.changes[1].after, []);
});

test("evaluateConfig selects the first enabled matching rule", () => {
  const config = configuredConfig([
    configuredRule({
      id: "first",
      name: "First",
      operations: [{ type: OPERATION_TYPES.SET, key: "winner", value: "first" }],
    }),
    configuredRule({
      id: "second",
      name: "Second",
      operations: [{ type: OPERATION_TYPES.SET, key: "winner", value: "second" }],
    }),
  ]);

  const result = evaluateConfig(config, "https://example.com/path?keep=yes");

  assert.equal(result.winner.id, "first");
  assert.equal(result.outputUrl, "https://example.com/path?keep=yes&winner=first");
  assert.deepEqual(
    result.trace.map((entry) => entry.status),
    ["winner", "shadowed"],
  );
});

test("evaluateConfig reports exclusions, disabled rules, scope misses, and pauses", () => {
  const config = configuredConfig([
    configuredRule({
      id: "excluded",
      name: "Excluded",
      excludes: ["*://example.com/private/*"],
    }),
    configuredRule({ id: "disabled", name: "Disabled", enabled: false }),
    configuredRule({
      id: "fetch",
      name: "Fetch only",
      scope: REQUEST_SCOPES.FETCH,
    }),
  ]);

  const result = evaluateConfig(config, "https://example.com/private/item", "main_frame");
  assert.equal(result.winner, null);
  assert.deepEqual(
    result.trace.map((entry) => entry.status),
    ["excluded", "disabled", "scope"],
  );

  const paused = evaluateConfig(
    { ...config, active: false, rules: [configuredRule()] },
    "https://example.com/path",
  );
  assert.equal(paused.winner, null);
  assert.equal(paused.trace[0].status, "paused");
});

test("evaluateConfig ignores fragments while matching and preserves them in output", () => {
  const result = evaluateConfig(
    configuredConfig([configuredRule()]),
    "https://example.com/path?debug=0#section",
  );

  assert.equal(result.winner.id, "rule-a");
  assert.equal(result.outputUrl, "https://example.com/path?debug=1#section");
});

test("buildDynamicRules maps order, exclusions, scopes, and operations to DNR", () => {
  const config = configuredConfig([
    configuredRule({
      id: "first",
      includes: ["*://example.com/*", "https://api.example.net/*"],
      excludes: ["*://example.com/health*", "*://example.com/static/*"],
      scope: REQUEST_SCOPES.FETCH,
      operations: [
        { type: OPERATION_TYPES.SET, key: "set", value: "1" },
        { type: OPERATION_TYPES.OVERRIDE, key: "replace", value: "2" },
        { type: OPERATION_TYPES.REMOVE, key: "remove", value: "" },
      ],
    }),
    configuredRule({ id: "disabled", enabled: false }),
    configuredRule({ id: "last", name: "Last" }),
  ]);

  const rules = buildDynamicRules(config);
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map((rule) => rule.priority), [3, 3, 1]);
  assert.deepEqual(rules.map((rule) => rule.id), [1, 2, 3]);
  assert.deepEqual(rules[0].condition.resourceTypes, ["xmlhttprequest"]);
  assert.equal(
    rules[0].condition.excludedRegexFilter,
    "^https?://example\\.com/health.*$|^https?://example\\.com/static/.*$",
  );
  assert.deepEqual(
    rules[0].action.redirect.transform.queryTransform,
    {
      addOrReplaceParams: [
        { key: "set", value: "1" },
        { key: "replace", value: "2", replaceOnly: true },
      ],
      removeParams: ["remove"],
    },
  );
  assert.ok(rules[2].condition.resourceTypes.includes("main_frame"));
  assert.ok(rules[2].condition.resourceTypes.includes("xmlhttprequest"));
  assert.ok(rules[2].condition.resourceTypes.includes("other"));
});

test("buildDynamicRules returns no rules while globally paused", () => {
  const config = configuredConfig([configuredRule()], { active: false });
  assert.deepEqual(buildDynamicRules(config), []);
});

test("buildDynamicRules passes raw regex and case sensitivity to Chrome", () => {
  const regex = "^https://api\\.example\\.com/v[0-9]+/";
  const config = configuredConfig([
    configuredRule({
      patternType: PATTERN_TYPES.REGEX,
      caseSensitive: true,
      includes: [regex],
      excludes: ["/health(?:[/?]|$)"],
    }),
  ]);

  const [rule] = buildDynamicRules(config);
  assert.equal(rule.condition.regexFilter, regex);
  assert.equal(rule.condition.excludedRegexFilter, "/health(?:[/?]|$)");
  assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
});

test("validation rejects duplicate parameter actions", () => {
  const config = configuredConfig([
    configuredRule({
      operations: [
        { type: OPERATION_TYPES.SET, key: "mode", value: "a" },
        { type: OPERATION_TYPES.REMOVE, key: "mode", value: "" },
      ],
    }),
  ]);

  const issues = validateConfig(config);
  assert.ok(issues.some((issue) => /already has an action/.test(issue.message)));
  assert.throws(() => buildDynamicRules(config), RuleValidationError);
});

test("validation enforces the generated regex rule limit", () => {
  const includes = Array.from(
    { length: MAX_GENERATED_RULES + 1 },
    (_, index) => `https://example.com/${index}`,
  );
  const config = configuredConfig([configuredRule({ includes })]);
  const issues = validateConfig(config);

  assert.ok(issues.some((issue) => /browser rules/.test(issue.message)));
});
