# Repository instructions

## Read first

Read `README.md`, `manifest.json`, and `lib/rules.js` before changing matching, persistence, permissions, or request transformations. QueryPatch has three views of one configuration: the popup and tester, the value in `chrome.storage.local`, and the dynamic rules installed in Chrome. A change is correct only when all three retain the same semantics.

Keep the README's rule behavior, Chrome limitations, privacy claims, and development instructions aligned with the implementation.

## Rule semantics

- Keep `lib/rules.js` pure and shared by the popup, background worker, and Node tests. Do not create separate matching or transformation implementations for UI preview and installed rules.
- Preserve ordered first-match-wins priority. Earlier logical rules receive higher Chrome priorities; every include pattern in one logical rule produces the same action and priority. Disabled rules are omitted, and global pause installs no dynamic rules.
- A rule matches only when an include accepts the request URL, no exclusion accepts it, and the request resource type belongs to the selected scope. Apply case sensitivity identically to includes and exclusions.
- Keep wildcard patterns anchored to the complete request URL, escape regular-expression metacharacters, and interpret `*://` as HTTP or HTTPS. Reject fragments, whitespace, non-ASCII wildcard input, missing hosts, and unsupported schemes as documented.
- Raw regular expressions are Chrome RE2 expressions. JavaScript parsing and the local tester provide preliminary feedback, but Chrome's `isRegexSupported` result is the save-time authority. Never treat successful `RegExp` construction alone as proof that a rule can be installed.
- Request matching ignores URL fragments because fragments do not reach the network stack. Local previews preserve the original fragment in the displayed transformed URL.
- Preserve action meanings exactly: Set adds a missing parameter or replaces all existing values, Override only changes an already-present parameter, and Remove deletes every value for that name. Reject multiple actions for the same parameter within one rule.
- Keep normalization, field limits, unique rule IDs, and the generated-rule allowance enforced before rule generation. Each enabled include consumes one generated Chrome rule.
- Keep request-scope resource types, tester trace statuses, generated DNR conditions, exclusions, case sensitivity, and query transforms in sync. Add paired evaluator and `buildDynamicRules` tests whenever one of these mappings changes.

## Chrome rule installation and persistence

- Serialize synchronization through the background worker's queue. Popup saves, startup repair, installation repair, popup initialization, and storage change events must not interleave rule replacement.
- Normalize and validate a candidate configuration, then ask Chrome to validate every distinct generated include and exclusion expression before replacing live rules.
- Replace the extension's complete dynamic rule set in one `updateDynamicRules` call. Do not leave a mixture of old and new generated rules or rely on incremental IDs surviving configuration changes.
- Install the candidate rules before writing the candidate configuration to storage. If the storage write fails, restore the previously stored configuration's dynamic rules before surfacing the error.
- Preserve re-synchronization from durable storage on installation, browser startup, popup state loading, and external storage changes. Stored configuration is the recovery source after service-worker suspension or browser restart.
- Keep the popup's optimistic update reversible. A rejected save must restore the previous in-memory view, leave the editor or list usable, and show Chrome's structured validation issue without persisting the candidate.
- Keep badge state derived from the successfully applied configuration so pause and enabled-rule counts do not claim a state different from the live rules.

## Privacy, permissions, and interface safety

- Store only normalized rule configuration and the global active flag. Draft inline test URLs, tester URLs, transformed previews, active-tab URLs, and request history must not be added to storage.
- Keep the tester and inline checks local simulations. They must not open, fetch, preflight, or transmit a tested URL. Import the active page URL only after the user invokes that action, accept only HTTP or HTTPS pages, and copy a result only after the explicit clipboard action.
- Preserve the local-only product boundary: no analytics, telemetry, accounts, remote code, remote assets, runtime dependencies, or request logging.
- Keep the manifest permission surface limited to active-tab URL import, declarative request transformation with HTTP and HTTPS host access, and local storage. Any permission or host expansion requires a matching product justification, README update, repository check, and browser verification.
- Treat rule names, patterns, parameter names and values, URLs, traces, Chrome errors, and status details as untrusted text. Build UI with DOM nodes and `textContent`; do not use `innerHTML` or executable markup.

## Project structure and verification

- Preserve the no-build, no-runtime-dependency architecture. Chrome loads the ES modules and local assets directly from the repository, and `lib/rules.js` must remain usable in Node without browser globals.
- Keep manifest-referenced files local and present, the service worker and popup scripts external, icon files valid, and the minimum Chrome version aligned with every API used.
- Use `npm ci` in a fresh checkout or worktree and run `npm run verify` for repository changes.
- Add focused Node tests for normalization, validation, wildcard conversion, raw-regex pass-through, first-match ordering, exclusions, scopes, operations, traces, and generated DNR shape as applicable.
- Node tests cannot validate Chrome RE2 acceptance or live DNR replacement. For changes to raw regexes, background synchronization, permissions, or request transforms, load the unpacked extension in a supported Chrome version and verify candidate rejection, successful save, pause, restart synchronization, and an actual controlled request rewrite.
