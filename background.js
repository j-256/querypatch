import {
  MESSAGE_TYPES,
  RuleValidationError,
  STORAGE_KEY,
  buildDynamicRules,
  createEmptyConfig,
  normalizeConfig,
  validateConfig,
} from "./lib/rules.js";

let synchronizationQueue = Promise.resolve();

function enqueue(task) {
  const result = synchronizationQueue.then(task, task);
  synchronizationQueue = result.catch(() => {});
  return result;
}

async function readStoredConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY] || createEmptyConfig());
}

async function replaceDynamicRules(config) {
  const nextRules = buildDynamicRules(config);
  await validateGeneratedRegexes(nextRules);

  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: currentRules.map((rule) => rule.id),
    addRules: nextRules,
  });

  await updateBadge(config);
  return nextRules.length;
}

async function validateGeneratedRegexes(rules) {
  const regexes = new Map();
  rules.forEach((rule) => {
    const caseSensitive = rule.condition.isUrlFilterCaseSensitive === true;
    regexes.set(
      `${caseSensitive}:${rule.condition.regexFilter}`,
      { regex: rule.condition.regexFilter, caseSensitive },
    );
    if (rule.condition.excludedRegexFilter) {
      regexes.set(
        `${caseSensitive}:${rule.condition.excludedRegexFilter}`,
        { regex: rule.condition.excludedRegexFilter, caseSensitive },
      );
    }
  });

  for (const { regex, caseSensitive } of regexes.values()) {
    const result = await chrome.declarativeNetRequest.isRegexSupported({
      regex,
      isCaseSensitive: caseSensitive,
    });

    if (!result.isSupported) {
      throw new RuleValidationError([
        {
          path: "rules",
          message: `Chrome rejected "${shorten(regex)}": ${result.reason || "unsupported regex"}`,
        },
      ]);
    }
  }
}

function shorten(value) {
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

async function updateBadge(config) {
  if (!config.active) {
    await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
    await chrome.action.setBadgeText({ text: "OFF" });
    await chrome.action.setTitle({ title: "QueryPatch is paused" });
    return;
  }

  const enabledCount = config.rules.filter((rule) => rule.enabled).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
  await chrome.action.setBadgeText({
    text: enabledCount ? (enabledCount > 99 ? "99+" : String(enabledCount)) : "",
  });
  await chrome.action.setTitle({
    title: enabledCount
      ? `QueryPatch: ${enabledCount} active ${enabledCount === 1 ? "rule" : "rules"}`
      : "QueryPatch: no active rules",
  });
}

async function saveConfig(value) {
  const config = normalizeConfig(value);
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }

  const previousConfig = await readStoredConfig();
  const generatedRuleCount = await replaceDynamicRules(config);

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
  } catch (error) {
    await replaceDynamicRules(previousConfig);
    throw error;
  }

  return { config, generatedRuleCount };
}

async function synchronizeStoredConfig() {
  const config = await readStoredConfig();
  const generatedRuleCount = await replaceDynamicRules(config);
  return { config, generatedRuleCount };
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message");
  }

  if (message.type === MESSAGE_TYPES.GET_STATE) {
    return synchronizeStoredConfig();
  }

  if (message.type === MESSAGE_TYPES.SAVE_CONFIG) {
    return saveConfig(message.config);
  }

  throw new Error(`Unknown message type: ${String(message.type)}`);
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || "Unexpected extension error",
    issues: Array.isArray(error?.issues) ? error.issues : [],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  enqueue(() => handleMessage(message)).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: serializeError(error) }),
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(synchronizeStoredConfig);
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(synchronizeStoredConfig);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    void enqueue(() =>
      replaceDynamicRules(normalizeConfig(changes[STORAGE_KEY].newValue)),
    );
  }
});
