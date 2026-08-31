# QueryPatch

QueryPatch is a compact Manifest V3 extension for Chrome 120 or newer that adds, removes, and overrides query string parameters on matching requests. Rules run in Chrome's declarative request engine, so they continue working when the extension popup and background worker are closed.

## Features

- Ordered rules with predictable first-match-wins priority
- Multiple wildcard or raw regular-expression patterns with optional exclusions per rule
- Case-insensitive or case-sensitive matching
- `Set` actions that add missing parameters or replace existing values
- `Override only` actions that leave missing parameters untouched
- `Remove` actions that delete every value for a parameter name
- Scopes for all requests, page navigations, or Fetch/XHR traffic
- Per-rule toggles, global pause, duplication, deletion, and priority controls
- A no-network tester with expected-winner validation, transformed URL preview, parameter changes, and a complete rule trace
- Local-only storage with no analytics, remote code, or request history

## Install from source

1. Open `chrome://extensions` in Chrome.
2. Turn on Developer mode.
3. Select Load unpacked.
4. Choose this repository directory.
5. Pin QueryPatch from the Extensions menu for quick access.

Chrome displays access to HTTP and HTTPS sites because request URL rewriting requires host access. QueryPatch only stores the rules you create and does not record requests.

## Create a rule

Open the popup, select Add rule, and choose Wildcard or Regular expression syntax. In wildcard mode, `*` matches any sequence of characters, while `*://` matches either HTTP or HTTPS.

```text
*://api.example.com/v1/*
https://staging.example.com/*
```

Add parameter actions, choose an optional request scope or exclusion, and save. When more than one enabled rule matches, the rule nearest the top of the list wins. Use the arrow controls on a rule card to change that priority.

Regular-expression mode accepts one raw Chrome RE2 expression per line without slash delimiters. For example:

```text
^https://(?:api|staging)\.example\.com/v[0-9]+/
```

Chrome's RE2 engine supports groups, alternation, character classes, repetitions, anchors, and the other standard RE2 constructs. It intentionally does not support backreferences or lookaround. Chrome validates expressions before QueryPatch saves a rule, and Advanced matching contains a case-sensitive option that applies to matches and exclusions.

## Test behavior

Open the Tester tab, paste a URL or select Use current tab, choose the request type, and run the test. You can optionally choose an expected winner to turn the result into a pass/fail check. Testing is a local simulation and never opens or sends the URL.

The result shows the final URL and an ordered trace for every rule. A trace entry can identify the winner, a later matching rule, an exclusion, a disabled rule, a request-type mismatch, a paused match, or a pattern miss.

## Development

The extension has no runtime dependencies or build step. It requires Node.js 22 or newer for repository checks and tests.

```sh
npm run verify
```

The pure rule engine lives in `lib/rules.js`. `background.js` validates and atomically installs generated `chrome.declarativeNetRequest` rules, while the popup imports the same rule engine for matching and URL previews.

## Browser behavior

QueryPatch uses `redirect.transform.queryTransform` from Chrome's [`declarativeNetRequest` API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest). Dynamic redirect rules and RE2 conditions are subject to Chrome's platform limits, including compiled-expression size. QueryPatch asks Chrome to validate every generated expression and keeps its generated rule allowance within the browser's documented regular-expression rule quota.

Declarative request rules apply to traffic that reaches Chrome's network stack. Responses produced directly by a page service worker or its `CacheStorage` may not be rewritten, although network requests issued by that service worker remain eligible.

## License

QueryPatch is licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).
