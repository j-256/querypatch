export const CONFIG_VERSION = 1;
export const STORAGE_KEY = "queryPatchConfig";
export const MAX_GENERATED_RULES = 1000;

export const MESSAGE_TYPES = Object.freeze({
  GET_STATE: "GET_STATE",
  SAVE_CONFIG: "SAVE_CONFIG",
});

export const OPERATION_TYPES = Object.freeze({
  SET: "set",
  OVERRIDE: "override",
  REMOVE: "remove",
});

export const PATTERN_TYPES = Object.freeze({
  WILDCARD: "wildcard",
  REGEX: "regex",
});

export const REQUEST_SCOPES = Object.freeze({
  ALL: "all",
  DOCUMENTS: "documents",
  FETCH: "fetch",
});

export const REQUEST_SCOPE_LABELS = Object.freeze({
  [REQUEST_SCOPES.ALL]: "All requests",
  [REQUEST_SCOPES.DOCUMENTS]: "Page navigations",
  [REQUEST_SCOPES.FETCH]: "Fetch / XHR",
});

const ALL_RESOURCE_TYPES = Object.freeze([
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
]);

const RESOURCE_TYPES_BY_SCOPE = Object.freeze({
  [REQUEST_SCOPES.ALL]: ALL_RESOURCE_TYPES,
  [REQUEST_SCOPES.DOCUMENTS]: Object.freeze(["main_frame", "sub_frame"]),
  [REQUEST_SCOPES.FETCH]: Object.freeze(["xmlhttprequest"]),
});

const PATTERN_MAX_LENGTH = 500;
const RULE_NAME_MAX_LENGTH = 80;
const PARAMETER_NAME_MAX_LENGTH = 256;
const PARAMETER_VALUE_MAX_LENGTH = 2048;
const MAX_PATTERNS_PER_RULE = 50;
const MAX_OPERATIONS_PER_RULE = 50;
const HTTP_SCHEMES = new Set(["http:", "https:"]);
const REGEX_SPECIAL_CHARACTERS = new Set([
  "\\",
  "^",
  "$",
  ".",
  "+",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
]);

export class RuleValidationError extends Error {
  constructor(issues) {
    super(issues[0]?.message || "The rule configuration is invalid");
    this.name = "RuleValidationError";
    this.issues = issues;
  }
}

export function createEmptyConfig() {
  return {
    version: CONFIG_VERSION,
    active: true,
    rules: [],
  };
}

export function createRule(id) {
  return {
    id,
    name: "New rule",
    enabled: true,
    patternType: PATTERN_TYPES.WILDCARD,
    caseSensitive: false,
    includes: ["*://example.com/*"],
    excludes: [],
    scope: REQUEST_SCOPES.ALL,
    operations: [
      {
        type: OPERATION_TYPES.SET,
        key: "debug",
        value: "1",
      },
    ],
  };
}

export function normalizeConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const sourceRules = Array.isArray(source.rules) ? source.rules : [];
  const seenIds = new Set();

  const rules = sourceRules.map((rule, index) => {
    const normalized = normalizeRule(rule, index);
    let id = normalized.id;

    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }

    seenIds.add(id);
    return { ...normalized, id };
  });

  return {
    version: CONFIG_VERSION,
    active: source.active !== false,
    rules,
  };
}

export function normalizeRule(value, index = 0) {
  const source = value && typeof value === "object" ? value : {};
  const id = cleanString(source.id) || `rule-${index + 1}`;
  const operations = Array.isArray(source.operations)
    ? source.operations.map(normalizeOperation)
    : [];

  return {
    id,
    name: cleanString(source.name),
    enabled: source.enabled !== false,
    patternType: Object.values(PATTERN_TYPES).includes(source.patternType)
      ? source.patternType
      : PATTERN_TYPES.WILDCARD,
    caseSensitive: source.caseSensitive === true,
    includes: normalizeStringList(source.includes),
    excludes: normalizeStringList(source.excludes),
    scope: Object.values(REQUEST_SCOPES).includes(source.scope)
      ? source.scope
      : REQUEST_SCOPES.ALL,
    operations,
  };
}

function normalizeOperation(value) {
  const source = value && typeof value === "object" ? value : {};
  const type = Object.values(OPERATION_TYPES).includes(source.type)
    ? source.type
    : OPERATION_TYPES.SET;

  return {
    type,
    key: cleanString(source.key),
    value: type === OPERATION_TYPES.REMOVE ? "" : String(source.value ?? ""),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(cleanString).filter(Boolean))];
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateConfig(value) {
  const config = normalizeConfig(value);
  const issues = [];
  const ids = new Set();
  let generatedRuleCount = 0;

  config.rules.forEach((rule, index) => {
    const ruleIssues = validateRule(rule, index);
    issues.push(...ruleIssues);

    if (ids.has(rule.id)) {
      issues.push(issue(`rules.${index}.id`, "Every rule must have a unique ID"));
    }

    ids.add(rule.id);
    if (rule.enabled) {
      generatedRuleCount += rule.includes.length;
    }
  });

  if (generatedRuleCount > MAX_GENERATED_RULES) {
    issues.push(
      issue(
        "rules",
        `Enabled patterns generate ${generatedRuleCount} browser rules; the limit is ${MAX_GENERATED_RULES}`,
      ),
    );
  }

  return issues;
}

export function validateRule(value, index = 0) {
  const rule = normalizeRule(value, index);
  const prefix = `rules.${index}`;
  const issues = [];

  if (!rule.id) {
    issues.push(issue(`${prefix}.id`, "Rule ID is required"));
  }

  if (!rule.name) {
    issues.push(issue(`${prefix}.name`, "Rule name is required"));
  } else if (rule.name.length > RULE_NAME_MAX_LENGTH) {
    issues.push(
      issue(
        `${prefix}.name`,
        `Rule name must be ${RULE_NAME_MAX_LENGTH} characters or fewer`,
      ),
    );
  }

  if (rule.includes.length === 0) {
    issues.push(issue(`${prefix}.includes`, "Add at least one URL pattern"));
  } else if (rule.includes.length > MAX_PATTERNS_PER_RULE) {
    issues.push(
      issue(
        `${prefix}.includes`,
        `Use no more than ${MAX_PATTERNS_PER_RULE} match patterns per rule`,
      ),
    );
  }

  rule.includes.forEach((pattern, patternIndex) => {
    const message = validatePattern(pattern, rule.patternType);
    if (message) {
      issues.push(issue(`${prefix}.includes.${patternIndex}`, message));
    }
  });

  if (rule.excludes.length > MAX_PATTERNS_PER_RULE) {
    issues.push(
      issue(
        `${prefix}.excludes`,
        `Use no more than ${MAX_PATTERNS_PER_RULE} exclusion patterns per rule`,
      ),
    );
  }

  rule.excludes.forEach((pattern, patternIndex) => {
    const message = validatePattern(pattern, rule.patternType);
    if (message) {
      issues.push(issue(`${prefix}.excludes.${patternIndex}`, message));
    }
  });

  if (!Object.values(REQUEST_SCOPES).includes(rule.scope)) {
    issues.push(issue(`${prefix}.scope`, "Choose a valid request scope"));
  }

  if (rule.operations.length === 0) {
    issues.push(issue(`${prefix}.operations`, "Add at least one parameter action"));
  } else if (rule.operations.length > MAX_OPERATIONS_PER_RULE) {
    issues.push(
      issue(
        `${prefix}.operations`,
        `Use no more than ${MAX_OPERATIONS_PER_RULE} parameter actions per rule`,
      ),
    );
  }

  const keys = new Set();
  rule.operations.forEach((operation, operationIndex) => {
    const operationPrefix = `${prefix}.operations.${operationIndex}`;

    if (!Object.values(OPERATION_TYPES).includes(operation.type)) {
      issues.push(issue(`${operationPrefix}.type`, "Choose a valid action"));
    }

    if (!operation.key) {
      issues.push(issue(`${operationPrefix}.key`, "Parameter name is required"));
    } else if (operation.key.length > PARAMETER_NAME_MAX_LENGTH) {
      issues.push(
        issue(
          `${operationPrefix}.key`,
          `Parameter name must be ${PARAMETER_NAME_MAX_LENGTH} characters or fewer`,
        ),
      );
    } else if (keys.has(operation.key)) {
      issues.push(
        issue(
          `${operationPrefix}.key`,
          `Parameter "${operation.key}" already has an action in this rule`,
        ),
      );
    }

    keys.add(operation.key);

    if (
      operation.type !== OPERATION_TYPES.REMOVE &&
      operation.value.length > PARAMETER_VALUE_MAX_LENGTH
    ) {
      issues.push(
        issue(
          `${operationPrefix}.value`,
          `Parameter value must be ${PARAMETER_VALUE_MAX_LENGTH} characters or fewer`,
        ),
      );
    }
  });

  return issues;
}

function issue(path, message) {
  return { path, message };
}

export function validatePattern(value, patternType = PATTERN_TYPES.WILDCARD) {
  const pattern = cleanString(value);

  if (!pattern) {
    return "URL pattern cannot be empty";
  }

  if (pattern.length > PATTERN_MAX_LENGTH) {
    return `URL pattern must be ${PATTERN_MAX_LENGTH} characters or fewer`;
  }

  if (/[^\x00-\x7f]/.test(pattern)) {
    return "Chrome URL conditions must use ASCII; encode non-ASCII URL characters first";
  }

  if (patternType === PATTERN_TYPES.REGEX) {
    try {
      new RegExp(pattern);
    } catch (error) {
      return `Invalid regular expression: ${error.message}`;
    }

    return "";
  }

  if (/\s/.test(pattern)) {
    return "URL patterns cannot contain whitespace";
  }

  if (pattern.includes("#")) {
    return "URL patterns cannot include fragments because fragments are not sent in requests";
  }

  if (!/^(?:\*|https?):\/\//i.test(pattern)) {
    return "Start the pattern with http://, https://, or *://";
  }

  const separatorIndex = pattern.indexOf("://");
  const afterScheme = pattern.slice(separatorIndex + 3);
  const host = afterScheme.split(/[/?]/, 1)[0];

  if (!host) {
    return "URL pattern must include a host";
  }

  return "";
}

export function wildcardToRegex(value) {
  const pattern = cleanString(value);
  const validationMessage = validatePattern(pattern, PATTERN_TYPES.WILDCARD);

  if (validationMessage) {
    throw new RuleValidationError([issue("pattern", validationMessage)]);
  }

  const usesAnyHttpScheme = pattern.startsWith("*://");
  const remainder = usesAnyHttpScheme ? pattern.slice(4) : pattern;
  let source = usesAnyHttpScheme ? "https?://" : "";

  for (const character of remainder) {
    if (character === "*") {
      source += ".*";
    } else if (REGEX_SPECIAL_CHARACTERS.has(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }

  return `^${source}$`;
}

export function patternToRegex(pattern, patternType = PATTERN_TYPES.WILDCARD) {
  if (patternType === PATTERN_TYPES.REGEX) {
    const validationMessage = validatePattern(pattern, patternType);
    if (validationMessage) {
      throw new RuleValidationError([issue("pattern", validationMessage)]);
    }
    return pattern;
  }

  return wildcardToRegex(pattern);
}

export function patternMatches(
  url,
  pattern,
  patternType = PATTERN_TYPES.WILDCARD,
  caseSensitive = false,
) {
  return new RegExp(
    patternToRegex(pattern, patternType),
    caseSensitive ? "" : "i",
  ).test(url);
}

export function parseTestUrl(value) {
  let url;

  try {
    url = new URL(cleanString(value));
  } catch {
    throw new RuleValidationError([
      issue("url", "Enter a complete URL beginning with http:// or https://"),
    ]);
  }

  if (!HTTP_SCHEMES.has(url.protocol)) {
    throw new RuleValidationError([
      issue("url", "Only HTTP and HTTPS request URLs can be tested"),
    ]);
  }

  return url;
}

export function evaluateConfig(value, urlValue, requestType = "main_frame") {
  const config = normalizeConfig(value);
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }

  const url = parseTestUrl(urlValue);
  const inputUrl = url.toString();
  const requestUrlObject = new URL(inputUrl);
  requestUrlObject.hash = "";
  const requestUrl = requestUrlObject.toString();
  const trace = [];
  let winner = null;

  config.rules.forEach((rule, index) => {
    const includePattern = rule.includes.find((pattern) =>
      patternMatches(requestUrl, pattern, rule.patternType, rule.caseSensitive),
    );
    const excludePattern = rule.excludes.find((pattern) =>
      patternMatches(requestUrl, pattern, rule.patternType, rule.caseSensitive),
    );
    const scopeMatches = ruleMatchesRequestType(rule, requestType);
    const patternMatchesRule = Boolean(includePattern) && !excludePattern;
    let status = "miss";
    let detail = "No match pattern accepted this URL";

    if (includePattern && excludePattern) {
      status = "excluded";
      detail = `Excluded by ${excludePattern}`;
    } else if (includePattern && !scopeMatches) {
      status = "scope";
      detail = `${REQUEST_SCOPE_LABELS[rule.scope]} does not include this request type`;
    } else if (patternMatchesRule && !rule.enabled) {
      status = "disabled";
      detail = `Pattern matched ${includePattern}, but the rule is disabled`;
    } else if (patternMatchesRule && !config.active) {
      status = "paused";
      detail = `Pattern matched ${includePattern}, but QueryPatch is paused`;
    } else if (patternMatchesRule && scopeMatches && !winner) {
      status = "winner";
      detail = `Matched ${includePattern}`;
      winner = { rule, index, includePattern };
    } else if (patternMatchesRule && scopeMatches) {
      status = "shadowed";
      detail = `Matched ${includePattern}, but an earlier rule wins`;
    }

    trace.push({
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: rule.enabled,
      status,
      detail,
    });
  });

  if (!winner) {
    return {
      inputUrl,
      outputUrl: inputUrl,
      winner: null,
      changes: [],
      trace,
    };
  }

  const transformed = applyOperations(inputUrl, winner.rule.operations);
  return {
    inputUrl,
    outputUrl: transformed.url,
    winner: {
      id: winner.rule.id,
      name: winner.rule.name,
      index: winner.index,
      includePattern: winner.includePattern,
    },
    changes: transformed.changes,
    trace,
  };
}

export function applyOperations(urlValue, operations) {
  const url = parseTestUrl(urlValue);
  const changes = [];

  operations.forEach((operation) => {
    const before = url.searchParams.getAll(operation.key);
    let applied = false;

    if (operation.type === OPERATION_TYPES.REMOVE) {
      applied = before.length > 0;
      url.searchParams.delete(operation.key);
    } else if (operation.type === OPERATION_TYPES.OVERRIDE) {
      applied = before.length > 0;
      if (applied) {
        url.searchParams.set(operation.key, operation.value);
      }
    } else {
      const alreadySet = before.length === 1 && before[0] === operation.value;
      applied = !alreadySet;
      url.searchParams.set(operation.key, operation.value);
    }

    changes.push({
      type: operation.type,
      key: operation.key,
      value: operation.value,
      before,
      after: url.searchParams.getAll(operation.key),
      applied,
    });
  });

  return { url: url.toString(), changes };
}

export function buildDynamicRules(value) {
  const config = normalizeConfig(value);
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }

  if (!config.active) {
    return [];
  }

  const dynamicRules = [];
  let dynamicRuleId = 1;

  config.rules.forEach((rule, index) => {
    if (!rule.enabled) {
      return;
    }

    const queryTransform = buildQueryTransform(rule.operations);
    const excludedRegexFilter = rule.excludes.length
      ? rule.excludes
          .map((pattern) => patternToRegex(pattern, rule.patternType))
          .join("|")
      : undefined;
    const resourceTypes = RESOURCE_TYPES_BY_SCOPE[rule.scope];
    const priority = config.rules.length - index;

    rule.includes.forEach((pattern) => {
      const condition = {
        regexFilter: patternToRegex(pattern, rule.patternType),
        isUrlFilterCaseSensitive: rule.caseSensitive,
      };

      if (excludedRegexFilter) {
        condition.excludedRegexFilter = excludedRegexFilter;
      }

      condition.resourceTypes = [...resourceTypes];

      dynamicRules.push({
        id: dynamicRuleId,
        priority,
        action: {
          type: "redirect",
          redirect: {
            transform: {
              queryTransform,
            },
          },
        },
        condition,
      });

      dynamicRuleId += 1;
    });
  });

  return dynamicRules;
}

function buildQueryTransform(operations) {
  const addOrReplaceParams = [];
  const removeParams = [];

  operations.forEach((operation) => {
    if (operation.type === OPERATION_TYPES.REMOVE) {
      removeParams.push(operation.key);
      return;
    }

    const parameter = {
      key: operation.key,
      value: operation.value,
    };

    if (operation.type === OPERATION_TYPES.OVERRIDE) {
      parameter.replaceOnly = true;
    }

    addOrReplaceParams.push(parameter);
  });

  const queryTransform = {};
  if (addOrReplaceParams.length) {
    queryTransform.addOrReplaceParams = addOrReplaceParams;
  }
  if (removeParams.length) {
    queryTransform.removeParams = removeParams;
  }

  return queryTransform;
}

function ruleMatchesRequestType(rule, requestType) {
  const resourceTypes = RESOURCE_TYPES_BY_SCOPE[rule.scope];
  return !resourceTypes || resourceTypes.includes(requestType);
}
