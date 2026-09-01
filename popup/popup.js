import {
  MESSAGE_TYPES,
  OPERATION_TYPES,
  PATTERN_TYPES,
  REQUEST_SCOPE_LABELS,
  RULE_MATCH_STATUSES,
  RuleValidationError,
  createEmptyConfig,
  createRule,
  evaluateConfig,
  evaluateRuleMatch,
  normalizeConfig,
  normalizeRule,
  validateRule,
} from "../lib/rules.js";

const EXPECT_NO_RULE = "__none__";
const TOAST_DURATION_MS = 2400;
const DEFAULT_TEST_URL = "https://example.com/products?debug=0&utm_source=newsletter";

const elements = {
  activationCopy: document.querySelector("#activationCopy"),
  activationPanel: document.querySelector(".activation-panel"),
  addInlineTestButton: document.querySelector("#addInlineTestButton"),
  addOperationButton: document.querySelector("#addOperationButton"),
  addRuleButton: document.querySelector("#addRuleButton"),
  advancedPanel: document.querySelector("#advancedPanel"),
  appFooter: document.querySelector("#appFooter"),
  brandStatus: document.querySelector("#brandStatus"),
  caseSensitive: document.querySelector("#caseSensitive"),
  cancelEditorButton: document.querySelector("#cancelEditorButton"),
  changeList: document.querySelector("#changeList"),
  closeEditorButton: document.querySelector("#closeEditorButton"),
  copyResultButton: document.querySelector("#copyResultButton"),
  editorErrors: document.querySelector("#editorErrors"),
  editorEyebrow: document.querySelector("#editorEyebrow"),
  editorView: document.querySelector("#editorView"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  emptyState: document.querySelector("#emptyState"),
  excludePatterns: document.querySelector("#excludePatterns"),
  globalActive: document.querySelector("#globalActive"),
  includePatterns: document.querySelector("#includePatterns"),
  inlineTestList: document.querySelector("#inlineTestList"),
  inlineTestSummary: document.querySelector("#inlineTestSummary"),
  operationList: document.querySelector("#operationList"),
  patternHelp: document.querySelector("#patternHelp"),
  patternType: document.querySelector("#patternType"),
  primaryTabs: document.querySelector("#primaryTabs"),
  requestScope: document.querySelector("#requestScope"),
  resultBadge: document.querySelector("#resultBadge"),
  resultSubtitle: document.querySelector("#resultSubtitle"),
  resultTitle: document.querySelector("#resultTitle"),
  resultUrl: document.querySelector("#resultUrl"),
  ruleForm: document.querySelector("#ruleForm"),
  ruleList: document.querySelector("#ruleList"),
  ruleName: document.querySelector("#ruleName"),
  rulesView: document.querySelector("#rulesView"),
  saveIndicator: document.querySelector("#saveIndicator"),
  saveLabel: document.querySelector("#saveLabel"),
  tabRuleCount: document.querySelector("#tabRuleCount"),
  testExpectation: document.querySelector("#testExpectation"),
  testRequestType: document.querySelector("#testRequestType"),
  testResult: document.querySelector("#testResult"),
  testUrl: document.querySelector("#testUrl"),
  testUrlError: document.querySelector("#testUrlError"),
  testerForm: document.querySelector("#testerForm"),
  testerPlaceholder: document.querySelector("#testerPlaceholder"),
  testerView: document.querySelector("#testerView"),
  toast: document.querySelector("#toast"),
  traceCount: document.querySelector("#traceCount"),
  traceList: document.querySelector("#traceList"),
  useCurrentPageButton: document.querySelector("#useCurrentPageButton"),
  useCurrentTabButton: document.querySelector("#useCurrentTabButton"),
};

let config = createEmptyConfig();
let editingRule = null;
let inlineTestRowSequence = 0;
let saving = false;
let toastTimer = null;

initialize();

async function initialize() {
  bindEvents();
  elements.testUrl.value = DEFAULT_TEST_URL;
  setSaveState("saving", "Loading");

  try {
    const state = await sendMessage({ type: MESSAGE_TYPES.GET_STATE });
    config = normalizeConfig(state.config);
    renderAll();
    setSaveState("saved", "Saved");
  } catch (error) {
    setSaveState("error", "Error");
    elements.brandStatus.textContent = "Could not load browser rules";
    showToast(error.message, true);
  }
}

function bindEvents() {
  elements.primaryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) {
      setView(button.dataset.view);
    }
  });

  elements.addRuleButton.addEventListener("click", () => openEditor());
  elements.emptyAddButton.addEventListener("click", () => openEditor());
  elements.closeEditorButton.addEventListener("click", closeEditor);
  elements.cancelEditorButton.addEventListener("click", closeEditor);
  elements.addInlineTestButton.addEventListener("click", () => addInlineTestUrl());
  elements.addOperationButton.addEventListener("click", addOperation);
  elements.ruleForm.addEventListener("submit", saveEditor);
  elements.operationList.addEventListener("click", handleOperationClick);
  elements.operationList.addEventListener("change", handleOperationChange);
  elements.patternType.addEventListener("change", updatePatternMode);
  elements.includePatterns.addEventListener("input", refreshInlineTests);
  elements.excludePatterns.addEventListener("input", refreshInlineTests);
  elements.caseSensitive.addEventListener("change", refreshInlineTests);
  elements.inlineTestList.addEventListener("click", handleInlineTestClick);
  elements.inlineTestList.addEventListener("input", handleInlineTestInput);
  elements.inlineTestList.addEventListener("keydown", handleInlineTestKeydown);
  elements.ruleList.addEventListener("click", handleRuleListClick);
  elements.ruleList.addEventListener("change", handleRuleListChange);
  elements.globalActive.addEventListener("change", toggleGlobalActive);
  elements.testerForm.addEventListener("submit", runTest);
  elements.useCurrentPageButton.addEventListener("click", useCurrentPageForInlineTest);
  elements.useCurrentTabButton.addEventListener("click", useCurrentTab);
  elements.copyResultButton.addEventListener("click", copyResultUrl);
  elements.testUrl.addEventListener("input", clearTestError);
  elements.testExpectation.addEventListener("change", rerunVisibleTest);
  elements.testRequestType.addEventListener("change", rerunVisibleTest);
}

function renderAll() {
  renderStatus();
  renderRuleList();
  renderTesterExpectations();
}

function renderStatus() {
  const enabledCount = config.rules.filter((rule) => rule.enabled).length;
  const ruleNoun = enabledCount === 1 ? "rule" : "rules";

  elements.globalActive.checked = config.active;
  elements.activationPanel.classList.toggle("is-paused", !config.active);
  elements.activationCopy.textContent = config.active
    ? enabledCount
      ? `${enabledCount} enabled ${ruleNoun}`
      : "No enabled rules"
    : "All rules are temporarily paused";
  elements.brandStatus.textContent = config.active
    ? enabledCount
      ? `${enabledCount} active ${ruleNoun}`
      : "Ready for your first rule"
    : "Request rewriting paused";
  elements.tabRuleCount.textContent = String(config.rules.length);
}

function renderRuleList() {
  elements.ruleList.replaceChildren();
  elements.emptyState.hidden = config.rules.length > 0;
  elements.ruleList.hidden = config.rules.length === 0;

  config.rules.forEach((rule, index) => {
    elements.ruleList.append(createRuleCard(rule, index));
  });
}

function createRuleCard(rule, index) {
  const card = createElement("article", "rule-card");
  card.classList.toggle("is-disabled", !rule.enabled);
  card.dataset.ruleId = rule.id;

  const header = createElement("div", "rule-card-header");
  const toggle = createSwitch(rule.enabled, `Enable ${rule.name}`, true);
  toggle.input.dataset.action = "toggle";
  toggle.input.dataset.ruleId = rule.id;
  header.append(toggle.label);

  const copy = createElement("div", "rule-card-copy");
  copy.append(createElement("div", "rule-card-title", rule.name));
  const patternText = rule.includes.length > 1
    ? `${rule.includes[0]} +${rule.includes.length - 1}`
    : rule.includes[0];
  copy.append(createElement("div", "rule-card-pattern", patternText));
  header.append(copy);

  const controls = createElement("div", "rule-card-controls");
  controls.append(
    createIconButton("↑", "Move rule up", "move-up", rule.id, index === 0),
    createIconButton(
      "↓",
      "Move rule down",
      "move-down",
      rule.id,
      index === config.rules.length - 1,
    ),
    createIconButton("⧉", "Duplicate rule", "duplicate", rule.id),
    createIconButton("✎", "Edit rule", "edit", rule.id),
    createIconButton("×", "Delete rule", "delete", rule.id, false, true),
  );
  header.append(controls);
  card.append(header);

  const meta = createElement("div", "rule-meta");
  if (rule.patternType === PATTERN_TYPES.REGEX) {
    meta.append(
      createElement(
        "span",
        "scope-chip",
        rule.caseSensitive ? "Regex · Aa" : "Regex",
      ),
    );
  }
  meta.append(createElement("span", "scope-chip", REQUEST_SCOPE_LABELS[rule.scope]));

  const visibleOperations = rule.operations.slice(0, 1);
  visibleOperations.forEach((operation) => {
    meta.append(createElement("span", "rule-chip", formatOperation(operation)));
  });

  if (rule.operations.length > visibleOperations.length) {
    meta.append(
      createElement(
        "span",
        "more-chip",
        `+${rule.operations.length - visibleOperations.length}`,
      ),
    );
  }

  card.append(meta);
  return card;
}

function createSwitch(checked, labelText, small = false) {
  const label = createElement("label", `switch-control${small ? " is-small" : ""}`);
  const accessibleLabel = createElement("span", "sr-only", labelText);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const track = createElement("span", "switch-track");
  track.setAttribute("aria-hidden", "true");
  track.append(createElement("span", "switch-thumb"));
  label.append(accessibleLabel, input, track);
  return { label, input };
}

function createIconButton(
  text,
  label,
  action,
  ruleId,
  disabled = false,
  danger = false,
) {
  const button = createElement("button", `icon-button${danger ? " is-danger" : ""}`, text);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.action = action;
  button.dataset.ruleId = ruleId;
  button.disabled = disabled;
  return button;
}

function formatOperation(operation) {
  if (operation.type === OPERATION_TYPES.REMOVE) {
    return `Remove ${operation.key}`;
  }

  const verb = operation.type === OPERATION_TYPES.OVERRIDE ? "Override" : "Set";
  const value = operation.value.length > 18
    ? `${operation.value.slice(0, 17)}...`
    : operation.value;
  return `${verb} ${operation.key}=${value}`;
}

async function handleRuleListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || saving) {
    return;
  }

  const { action, ruleId } = button.dataset;
  const index = config.rules.findIndex((rule) => rule.id === ruleId);
  if (index < 0) {
    return;
  }

  if (action === "edit") {
    openEditor(ruleId);
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(`Delete "${config.rules[index].name}"?`);
    if (!confirmed) {
      return;
    }

    const next = clone(config);
    next.rules.splice(index, 1);
    await persistConfig(next, "Rule deleted");
    return;
  }

  if (action === "duplicate") {
    const next = clone(config);
    const duplicate = clone(next.rules[index]);
    duplicate.id = makeId();
    duplicate.name = `${duplicate.name} copy`.slice(0, 80);
    next.rules.splice(index + 1, 0, duplicate);
    await persistConfig(next, "Rule duplicated");
    return;
  }

  const targetIndex = action === "move-up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= config.rules.length) {
    return;
  }

  const next = clone(config);
  [next.rules[index], next.rules[targetIndex]] = [
    next.rules[targetIndex],
    next.rules[index],
  ];
  await persistConfig(next, "Rule priority updated");
}

async function handleRuleListChange(event) {
  const input = event.target.closest('input[data-action="toggle"]');
  if (!input || saving) {
    return;
  }

  const next = clone(config);
  const rule = next.rules.find((candidate) => candidate.id === input.dataset.ruleId);
  if (!rule) {
    return;
  }

  rule.enabled = input.checked;
  await persistConfig(next, rule.enabled ? "Rule enabled" : "Rule disabled");
}

async function toggleGlobalActive() {
  if (saving) {
    return;
  }

  const next = clone(config);
  next.active = elements.globalActive.checked;
  await persistConfig(next, next.active ? "Request rewriting enabled" : "All rules paused");
}

function openEditor(ruleId = null) {
  const source = ruleId
    ? config.rules.find((rule) => rule.id === ruleId)
    : createRule(makeId());

  if (!source) {
    showToast("That rule no longer exists", true);
    return;
  }

  editingRule = clone(source);
  elements.editorEyebrow.textContent = ruleId ? "Edit rule" : "New rule";
  elements.ruleName.value = editingRule.name;
  elements.patternType.value = editingRule.patternType;
  elements.includePatterns.value = editingRule.includes.join("\n");
  elements.excludePatterns.value = editingRule.excludes.join("\n");
  elements.requestScope.value = editingRule.scope;
  elements.caseSensitive.checked = editingRule.caseSensitive;
  elements.advancedPanel.open =
    editingRule.excludes.length > 0 ||
    editingRule.scope !== "all" ||
    editingRule.caseSensitive;
  updatePatternMode();
  clearEditorErrors();
  renderOperationRows(editingRule.operations);
  resetInlineTests();
  setView("editor");
  elements.ruleName.focus();
  elements.ruleName.select();
}

function closeEditor() {
  editingRule = null;
  elements.inlineTestList.replaceChildren();
  clearEditorErrors();
  setView("rules");
}

function collectEditorRule() {
  const operationRows = [...elements.operationList.querySelectorAll(".operation-row")];
  return normalizeRule({
    ...editingRule,
    name: elements.ruleName.value,
    patternType: elements.patternType.value,
    caseSensitive: elements.caseSensitive.checked,
    includes: readLines(elements.includePatterns.value),
    excludes: readLines(elements.excludePatterns.value),
    scope: elements.requestScope.value,
    operations: operationRows.map((row) => ({
      type: row.querySelector(".operation-type").value,
      key: row.querySelector(".operation-key").value,
      value: row.querySelector(".operation-value").value,
    })),
  });
}

function updatePatternMode() {
  const isRegex = elements.patternType.value === PATTERN_TYPES.REGEX;
  elements.includePatterns.placeholder = isRegex
    ? "^https://api\\.example\\.com/v[0-9]+/"
    : "*://api.example.com/v1/*";
  elements.excludePatterns.placeholder = isRegex
    ? "/(?:health|status)(?:[/?]|$)"
    : "*://api.example.com/v1/health*";

  elements.patternHelp.replaceChildren();
  if (isRegex) {
    elements.patternHelp.append(
      "One raw Chrome RE2 expression per line. Do not add slash delimiters; lookaround and backreferences are not supported.",
    );
  } else {
    elements.patternHelp.append("One full pattern per line. Use ");
    const star = createElement("code", "", "*");
    const scheme = createElement("code", "", "*://");
    elements.patternHelp.append(star, " as a wildcard and ", scheme, " for HTTP or HTTPS.");
  }

  refreshInlineTests();
}

function resetInlineTests() {
  elements.inlineTestList.replaceChildren();
  addInlineTestUrl("", false);
}

function addInlineTestUrl(value = "", focus = true) {
  const row = createInlineTestRow(value);
  elements.inlineTestList.append(row);
  updateInlineTestControls();
  refreshInlineTests();

  if (focus) {
    row.querySelector(".inline-test-input").focus();
  }
}

function createInlineTestRow(value) {
  inlineTestRowSequence += 1;
  const rowId = `inline-test-${inlineTestRowSequence}`;
  const row = createElement("div", "inline-test-row is-empty");
  row.setAttribute("role", "listitem");

  const dot = createElement("span", "inline-test-dot");
  dot.setAttribute("aria-hidden", "true");

  const input = createElement("input", "inline-test-input code-field");
  input.type = "url";
  input.value = value;
  input.placeholder = "https://example.com/path";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;

  const status = createElement("span", "inline-test-status", "Enter URL");
  status.id = `${rowId}-status`;
  const detail = createElement(
    "span",
    "inline-test-detail",
    "Enter a complete HTTP or HTTPS URL",
  );
  detail.id = `${rowId}-detail`;
  input.setAttribute("aria-describedby", `${status.id} ${detail.id}`);

  const remove = createIconButton("×", "Remove test URL", "remove-inline-test", "");
  remove.classList.add("inline-test-remove");

  row.append(dot, input, status, remove, detail);
  return row;
}

function handleInlineTestClick(event) {
  const button = event.target.closest('[data-action="remove-inline-test"]');
  if (!button || elements.inlineTestList.childElementCount <= 1) {
    return;
  }

  button.closest(".inline-test-row").remove();
  updateInlineTestControls();
  refreshInlineTests();
}

function handleInlineTestInput(event) {
  if (event.target.matches(".inline-test-input")) {
    refreshInlineTests();
  }
}

function handleInlineTestKeydown(event) {
  if (event.key !== "Enter" || !event.target.matches(".inline-test-input")) {
    return;
  }

  event.preventDefault();
  addInlineTestUrl();
}

function updateInlineTestControls() {
  const rows = [...elements.inlineTestList.querySelectorAll(".inline-test-row")];
  rows.forEach((row, index) => {
    const position = index + 1;
    row.querySelector(".inline-test-input").setAttribute("aria-label", `Test URL ${position}`);
    const remove = row.querySelector(".inline-test-remove");
    remove.setAttribute("aria-label", `Remove test URL ${position}`);
    remove.title = `Remove test URL ${position}`;
    remove.disabled = rows.length === 1;
  });
}

function refreshInlineTests() {
  if (!editingRule) {
    return;
  }

  const draftRule = {
    ...editingRule,
    patternType: elements.patternType.value,
    caseSensitive: elements.caseSensitive.checked,
    includes: readLines(elements.includePatterns.value),
    excludes: readLines(elements.excludePatterns.value),
  };
  const rows = [...elements.inlineTestList.querySelectorAll(".inline-test-row")];
  let matchCount = 0;
  let testedCount = 0;

  rows.forEach((row) => {
    const input = row.querySelector(".inline-test-input");
    const result = evaluateRuleMatch(draftRule, input.value);
    const isEmpty = result.status === RULE_MATCH_STATUSES.EMPTY;
    const isInvalidUrl = result.status === RULE_MATCH_STATUSES.INVALID_URL;
    const stateClass = result.matches ? "is-match" : isEmpty ? "is-empty" : "is-miss";

    row.className = `inline-test-row ${stateClass}`;
    row.dataset.status = result.status;
    row.querySelector(".inline-test-status").textContent = result.matches
      ? "Matches"
      : isEmpty
        ? "Enter URL"
        : "No match";
    const detail = row.querySelector(".inline-test-detail");
    detail.textContent = result.detail;
    detail.title = result.detail;

    if (isInvalidUrl) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }

    if (!isEmpty) {
      testedCount += 1;
    }
    if (result.matches) {
      matchCount += 1;
    }
  });

  elements.inlineTestSummary.textContent = testedCount
    ? `${matchCount} of ${testedCount} matching`
    : "Enter URLs to check this draft";
}

async function useCurrentPageForInlineTest() {
  try {
    const url = await getCurrentTabUrl();
    const inputs = [...elements.inlineTestList.querySelectorAll(".inline-test-input")];
    let input = inputs.find((candidate) => !candidate.value.trim());

    if (!input) {
      addInlineTestUrl(url, false);
      input = elements.inlineTestList.lastElementChild.querySelector(".inline-test-input");
    } else {
      input.value = url;
      refreshInlineTests();
    }

    input.focus();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderOperationRows(operations) {
  elements.operationList.replaceChildren();
  operations.forEach((operation, index) => {
    elements.operationList.append(createOperationRow(operation, index, operations.length));
  });
}

function createOperationRow(operation, index, totalOperations) {
  const row = createElement("div", "operation-row");
  row.dataset.operationIndex = String(index);
  row.classList.toggle("is-remove", operation.type === OPERATION_TYPES.REMOVE);

  const type = createElement("select", "select-field operation-type");
  type.setAttribute("aria-label", `Action ${index + 1} type`);
  [
    [OPERATION_TYPES.SET, "Set"],
    [OPERATION_TYPES.OVERRIDE, "Override only"],
    [OPERATION_TYPES.REMOVE, "Remove"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  });
  type.value = operation.type;

  const key = createElement("input", "text-field operation-key");
  key.type = "text";
  key.value = operation.key;
  key.placeholder = "name";
  key.autocomplete = "off";
  key.setAttribute("aria-label", `Action ${index + 1} parameter name`);

  const value = createElement("input", "text-field operation-value");
  value.type = "text";
  value.value = operation.value;
  value.placeholder = operation.type === OPERATION_TYPES.REMOVE ? "Not used" : "value";
  value.autocomplete = "off";
  value.disabled = operation.type === OPERATION_TYPES.REMOVE;
  value.setAttribute("aria-label", `Action ${index + 1} parameter value`);

  const remove = createIconButton("×", `Remove action ${index + 1}`, "remove-operation", "");
  remove.dataset.operationIndex = String(index);
  remove.disabled = totalOperations <= 1;

  row.append(type, key, value, remove);
  return row;
}

function operationsLength() {
  return elements.operationList.childElementCount || editingRule?.operations.length || 0;
}

function addOperation() {
  if (!editingRule) {
    return;
  }

  editingRule = collectEditorRule();
  editingRule.operations.push({
    type: OPERATION_TYPES.SET,
    key: "",
    value: "",
  });
  renderOperationRows(editingRule.operations);
  elements.operationList.lastElementChild?.querySelector(".operation-key")?.focus();
}

function handleOperationClick(event) {
  const button = event.target.closest('[data-action="remove-operation"]');
  if (!button || operationsLength() <= 1) {
    return;
  }

  editingRule = collectEditorRule();
  editingRule.operations.splice(Number(button.dataset.operationIndex), 1);
  renderOperationRows(editingRule.operations);
}

function handleOperationChange(event) {
  const select = event.target.closest(".operation-type");
  if (!select) {
    return;
  }

  const row = select.closest(".operation-row");
  const valueInput = row.querySelector(".operation-value");
  const isRemove = select.value === OPERATION_TYPES.REMOVE;
  row.classList.toggle("is-remove", isRemove);
  valueInput.disabled = isRemove;
  valueInput.placeholder = isRemove ? "Not used" : "value";
  if (isRemove) {
    valueInput.value = "";
  }
}

async function saveEditor(event) {
  event.preventDefault();
  if (!editingRule || saving) {
    return;
  }

  const nextRule = collectEditorRule();
  const existingIndex = config.rules.findIndex((rule) => rule.id === nextRule.id);
  const ruleIndex = existingIndex >= 0 ? existingIndex : config.rules.length;
  const issues = validateRule(nextRule, ruleIndex);

  if (issues.length > 0) {
    showEditorErrors(issues);
    return;
  }

  const next = clone(config);
  if (existingIndex >= 0) {
    next.rules[existingIndex] = nextRule;
  } else {
    next.rules.push(nextRule);
  }

  const saved = await persistConfig(next, existingIndex >= 0 ? "Rule updated" : "Rule created");
  if (saved) {
    closeEditor();
  }
}

function showEditorErrors(issues) {
  elements.editorErrors.replaceChildren();
  const list = document.createElement("ul");
  issues.forEach((validationIssue) => {
    list.append(createElement("li", "", validationIssue.message));
  });
  elements.editorErrors.append(list);
  elements.editorErrors.hidden = false;

  const paths = issues.map((validationIssue) => validationIssue.path);
  elements.ruleName.setAttribute(
    "aria-invalid",
    String(paths.some((path) => path.endsWith(".name"))),
  );
  elements.includePatterns.setAttribute(
    "aria-invalid",
    String(paths.some((path) => path.includes(".includes"))),
  );
  elements.editorErrors.scrollIntoView({ block: "nearest" });
}

function clearEditorErrors() {
  elements.editorErrors.hidden = true;
  elements.editorErrors.replaceChildren();
  elements.ruleName.removeAttribute("aria-invalid");
  elements.includePatterns.removeAttribute("aria-invalid");
}

function renderTesterExpectations() {
  const previousValue = elements.testExpectation.value;
  elements.testExpectation.replaceChildren();

  const showOnly = document.createElement("option");
  showOnly.value = "";
  showOnly.textContent = "Just show result";
  elements.testExpectation.append(showOnly);

  const noRule = document.createElement("option");
  noRule.value = EXPECT_NO_RULE;
  noRule.textContent = "No rule";
  elements.testExpectation.append(noRule);

  config.rules
    .filter((rule) => rule.enabled)
    .forEach((rule) => {
      const option = document.createElement("option");
      option.value = rule.id;
      option.textContent = rule.name;
      elements.testExpectation.append(option);
    });

  const canRestore = [...elements.testExpectation.options].some(
    (option) => option.value === previousValue,
  );
  elements.testExpectation.value = canRestore ? previousValue : "";
}

function runTest(event) {
  event?.preventDefault();
  clearTestError();

  try {
    const evaluation = evaluateConfig(
      config,
      elements.testUrl.value,
      elements.testRequestType.value,
    );
    renderTestResult(evaluation);
  } catch (error) {
    const message = error instanceof RuleValidationError
      ? error.issues[0]?.message || error.message
      : error.message;
    elements.testUrl.setAttribute("aria-invalid", "true");
    elements.testUrlError.textContent = message;
    elements.testResult.hidden = true;
    elements.testerPlaceholder.hidden = false;
  }
}

function renderTestResult(evaluation) {
  const expected = elements.testExpectation.value;
  const hasExpectation = Boolean(expected);
  const passed = expected === EXPECT_NO_RULE
    ? !evaluation.winner
    : expected
      ? evaluation.winner?.id === expected
      : null;

  elements.testerPlaceholder.hidden = true;
  elements.testResult.hidden = false;
  elements.resultBadge.className = "result-badge";

  if (hasExpectation) {
    elements.resultBadge.textContent = passed ? "Pass" : "Fail";
    elements.resultBadge.classList.add(passed ? "is-pass" : "is-fail");
  } else {
    elements.resultBadge.textContent = evaluation.winner ? "Matched" : "No match";
  }

  if (evaluation.winner) {
    elements.resultTitle.textContent = evaluation.winner.name;
    elements.resultSubtitle.textContent = `Rule ${evaluation.winner.index + 1} wins with ${evaluation.winner.includePattern}`;
  } else {
    elements.resultTitle.textContent = config.active ? "No active rule matched" : "QueryPatch is paused";
    elements.resultSubtitle.textContent = config.active
      ? "The request URL would be left unchanged"
      : "Matching rules are shown in the trace but cannot run";
  }

  elements.resultUrl.textContent = evaluation.outputUrl;
  renderChanges(evaluation.changes);
  renderTrace(evaluation.trace);
}

function renderChanges(changes) {
  elements.changeList.replaceChildren();
  changes.forEach((change) => {
    const row = createElement("div", `change-row${change.applied ? "" : " is-noop"}`);
    const action = change.type === OPERATION_TYPES.REMOVE
      ? "Remove"
      : change.type === OPERATION_TYPES.OVERRIDE
        ? "Override"
        : "Set";
    row.append(createElement("span", "change-action", action));

    let description;
    if (!change.applied) {
      description = `${change.key}: no change`;
    } else if (change.type === OPERATION_TYPES.REMOVE) {
      description = `${change.key}: removed ${change.before.join(", ")}`;
    } else {
      const before = change.before.length ? change.before.join(", ") : "missing";
      description = `${change.key}: ${before} to ${change.after.join(", ")}`;
    }
    row.append(createElement("span", "change-description", description));
    elements.changeList.append(row);
  });
}

function renderTrace(trace) {
  elements.traceList.replaceChildren();
  elements.traceCount.textContent = String(trace.length);

  if (trace.length === 0) {
    const empty = createElement("div", "trace-row");
    empty.append(createElement("span", "trace-name", "No saved rules"));
    empty.append(createElement("span", "trace-status", "Empty"));
    empty.append(createElement("span", "trace-detail", "Create a rule to start matching URLs"));
    elements.traceList.append(empty);
    return;
  }

  trace.forEach((entry) => {
    const row = createElement("div", "trace-row");
    row.append(createElement("span", "trace-name", entry.ruleName));
    row.append(
      createElement(
        "span",
        `trace-status status-${entry.status}`,
        traceStatusLabel(entry.status),
      ),
    );
    row.append(createElement("span", "trace-detail", entry.detail));
    elements.traceList.append(row);
  });
}

function traceStatusLabel(status) {
  const labels = {
    disabled: "Disabled",
    excluded: "Excluded",
    miss: "No match",
    paused: "Paused",
    scope: "Wrong type",
    shadowed: "Later match",
    winner: "Winner",
  };
  return labels[status] || status;
}

async function useCurrentTab() {
  try {
    const url = await getCurrentTabUrl();
    elements.testUrl.value = url;
    clearTestError();
    runTest();
  } catch (error) {
    elements.testUrlError.textContent = error.message;
  }
}

async function getCurrentTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("The current tab is not an HTTP or HTTPS page");
  }
  return url;
}

async function copyResultUrl() {
  try {
    await navigator.clipboard.writeText(elements.resultUrl.textContent);
    showToast("Result URL copied");
  } catch {
    showToast("Could not copy the result URL", true);
  }
}

function clearTestError() {
  elements.testUrl.removeAttribute("aria-invalid");
  elements.testUrlError.textContent = "";
}

function rerunVisibleTest() {
  if (!elements.testResult.hidden) {
    runTest();
  }
}

async function persistConfig(nextValue, successMessage) {
  if (saving) {
    return false;
  }

  const previous = config;
  const next = normalizeConfig(nextValue);
  saving = true;
  config = next;
  renderAll();
  setSaveState("saving", "Saving");
  document.body.classList.add("is-saving");

  try {
    const state = await sendMessage({
      type: MESSAGE_TYPES.SAVE_CONFIG,
      config: next,
    });
    config = normalizeConfig(state.config);
    renderAll();
    setSaveState("saved", "Saved");
    showToast(successMessage);
    return true;
  } catch (error) {
    config = previous;
    renderAll();
    setSaveState("error", "Not saved");
    showToast(error.message, true);
    return false;
  } finally {
    saving = false;
    document.body.classList.remove("is-saving");
  }
}

function setView(view) {
  const isEditor = view === "editor";
  elements.rulesView.hidden = view !== "rules";
  elements.testerView.hidden = view !== "tester";
  elements.editorView.hidden = !isEditor;
  elements.primaryTabs.hidden = isEditor;
  elements.appFooter.hidden = isEditor;

  elements.primaryTabs.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (view === "tester") {
    renderTesterExpectations();
  }
}

function setSaveState(state, label) {
  elements.saveIndicator.classList.toggle("is-saving", state === "saving");
  elements.saveIndicator.classList.toggle("is-error", state === "error");
  elements.saveLabel.textContent = label;
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, TOAST_DURATION_MS);
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        const error = new Error(response?.error?.message || "The extension did not respond");
        error.name = response?.error?.name || "Error";
        error.issues = response?.error?.issues || [];
        reject(error);
        return;
      }

      resolve(response.result);
    });
  });
}

function readLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== "") {
    element.textContent = text;
  }
  return element;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
