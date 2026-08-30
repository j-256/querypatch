import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert.equal(manifest.manifest_version, 3, "manifest.json must use Manifest V3");
assert.equal(manifest.background?.type, "module", "The service worker must be an ES module");
assert.ok(
  manifest.permissions?.includes("declarativeNetRequestWithHostAccess"),
  "The declarativeNetRequestWithHostAccess permission is required",
);
assert.ok(
  manifest.host_permissions?.includes("http://*/*") &&
    manifest.host_permissions?.includes("https://*/*"),
  "HTTP and HTTPS host access must be explicit",
);

const referencedFiles = new Set([
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon || {}),
  ...Object.values(manifest.icons || {}),
]);

for (const relativePath of referencedFiles) {
  const contents = await readFile(path.join(root, relativePath));
  assert.ok(contents.length > 0, `Manifest file is empty: ${relativePath}`);
}

const popupHtml = await readFile(path.join(root, manifest.action.default_popup), "utf8");
assert.doesNotMatch(popupHtml, /<script(?![^>]+src=)/i, "Popup scripts must be local files");
assert.doesNotMatch(
  popupHtml,
  /\b(?:src|href)=["']https?:\/\//i,
  "Popup markup must not load remote resources",
);

const javascriptFiles = await collectFiles(root, (file) => file.endsWith(".js") || file.endsWith(".mjs"));
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${file}`);
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const relativePath of Object.values(manifest.icons || {})) {
  const icon = await readFile(path.join(root, relativePath));
  assert.equal(
    icon.subarray(0, pngSignature.length).compare(pngSignature),
    0,
    `Manifest icon is not a PNG: ${relativePath}`,
  );
}

console.log(`Checked manifest references and JavaScript syntax (${javascriptFiles.length} files)`);

async function collectFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, predicate)));
    } else if (predicate(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}
