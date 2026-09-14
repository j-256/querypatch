import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyConfig, createRule, STORAGE_KEY } from '../lib/rules.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'docs/screenshots/cover.png');
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node scripts/capture-cover.mjs\n\nCapture the actual extension popup with a synthetic query rule in an isolated\nChromium profile. The URL tester does not navigate to the example URL.\nWrites docs/screenshots/cover.png. Requires Node 22+, npm ci, and\nnpx playwright install chromium. No environment variables.\nExit status: 0 success, 1 capture failure, 2 usage error, 3 missing dependency.');
  process.exit(0);
}
if (args.length) {
  console.error('capture-cover: unexpected argument; see --help');
  process.exit(2);
}
const { chromium } = await import('playwright').catch((error) => {
  console.error(`capture-cover: run npm ci first: ${error.message}`);
  process.exit(3);
});
const profile = await mkdtemp(join(tmpdir(), 'querypatch-cover-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    viewport: { width: 440, height: 620 }, deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(30_000);
  await context.route(/^https?:/, (route) => route.abort());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const config = createEmptyConfig();
  config.rules.push({ ...createRule('cover-debug'), name: 'Enable storefront debugging' });
  await worker.evaluate(async ({ key, config }) => chrome.storage.local.set({ [key]: config }), { key: STORAGE_KEY, config });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await page.locator('#ruleList').getByText('Enable storefront debugging', { exact: true }).waitFor();
  await page.locator('[data-view="tester"]').click();
  await page.locator('#testUrl').fill('https://example.com/products?debug=0&utm_source=newsletter');
  await page.locator('#testerForm button[type="submit"]').click();
  await page.locator('#testResult').waitFor();
  assert.equal(await page.locator('#resultUrl').textContent(), 'https://example.com/products?debug=1&utm_source=newsletter');
  assert.deepEqual(errors, []);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(439, 619);
  await mkdir(join(root, 'docs/screenshots'), { recursive: true });
  const staged = join(root, 'docs/screenshots/cover.tmp.png');
  await writeFile(staged, await page.screenshot({ animations: 'disabled' }));
  await rename(staged, output);
  console.log(`Captured and verified the extension URL tester: ${output}`);
} catch (error) {
  console.error(`capture-cover: ${error.stack ?? error}`);
  process.exitCode = /Executable doesn't exist/.test(error.message) ? 3 : 1;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(join(root, 'docs/screenshots/cover.tmp.png'), { force: true });
}
