/**
 * shadow:capture (T3.29) - render an authored shadow in the REAL Phaser
 * ShadowLabScene (actual atlas, actual placeAuthoredShadow, actual grass, actual
 * scale) and save review screenshots + the numeric anchor delta. No Python/PIL/
 * Jimp compositing is used for approval - these are true Phaser frames.
 *
 * Usage: node tools/shadow-capture.mjs <building>
 * Output: tools/shadow-debug/<building>/{normal,variant,base-zoom,checkerboard,
 *         anchor-overlay}.png + capture.json
 *
 * Requires a chromium for playwright-core. It reuses a dev server already running
 * on :5177, otherwise it starts one and stops it when done. If playwright-core or
 * a browser is missing it prints install instructions and exits 2 (soft).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { listBuildings, readManifest, manifestPath } from './shadow-lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:5177/littleacres/';

const building = process.argv[2];
if (!building || building.startsWith('--')) {
  console.error(
    `usage: node tools/shadow-capture.mjs <building>   (known: ${listBuildings(repoRoot).join(', ') || 'none'})`,
  );
  process.exit(1);
}
const manifest = readManifest(manifestPath(repoRoot, building));

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(
    'shadow:capture needs playwright-core. Install it (dev only):\n  npm i -D playwright-core\nand a chromium:\n  npx playwright install chromium   (or set CHROME_PATH to a chrome/chromium binary)',
  );
  process.exit(2);
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* not installed via playwright */
  }
  const guesses = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return guesses.find((g) => existsSync(g)) ?? null;
}
const execPath = findChrome();
if (!execPath) {
  console.error(
    'shadow:capture found no chromium. Run `npx playwright install chromium` or set CHROME_PATH.',
  );
  process.exit(2);
}

async function serverUp() {
  try {
    const r = await fetch(BASE, { method: 'GET' });
    return r.ok;
  } catch {
    return false;
  }
}

let devProc = null;
async function ensureServer() {
  if (await serverUp()) {
    console.log('reusing dev server already on :5177');
    return false;
  }
  console.log('starting dev server (vite)...');
  // Spawn the vite binary directly (not `npm run dev`) so a single child process
  // can be killed cleanly without a process-group kill.
  const viteBin = join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vite.cmd' : 'vite',
  );
  devProc = spawn(viteBin, [], { cwd: repoRoot, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) return true;
  }
  throw new Error('dev server did not come up on :5177');
}
function stopServer(started) {
  if (started && devProc) {
    try {
      devProc.kill('SIGTERM');
    } catch {
      /* best effort */
    }
  }
}

const outDir = join(repoRoot, 'tools', 'shadow-debug', building);
mkdirSync(outDir, { recursive: true });

const startedServer = await ensureServer();
const browser = await chromium.launch({
  executablePath: execPath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--ignore-gpu-blocklist'],
});
const results = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1500 },
    deviceScaleFactor: 1,
  });
  const CLIP = { x: 290, y: 470, width: 620, height: 620 };
  const shot = async (query, file, clip) => {
    await page.goto(`${BASE}?shadowlab=${building}${query}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__shadowLab !== undefined, null, { timeout: 60000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, file), ...(clip ? { clip } : {}) });
    return page.evaluate(() => window.__shadowLab);
  };
  results.normal = await shot('', 'normal.png');
  results.baseZoom = await shot('', 'base-zoom.png', CLIP);
  results.checkerboard = await shot('&bg=checker', 'checkerboard.png');
  results.anchorOverlay = await shot('&overlay=1', 'anchor-overlay.png');
  const variant = manifest.variants?.[0];
  if (variant) results.variant = await shot(`&variant=${variant}`, 'variant.png');
} finally {
  await browser.close();
  stopServer(startedServer);
}

writeFileSync(join(outDir, 'capture.json'), JSON.stringify(results, null, 2));
const d = results.normal?.anchorDelta ?? { x: NaN, y: NaN };
const ok = Math.abs(d.x) < 0.01 && Math.abs(d.y) < 0.01;
console.log(`\ncaptured ${building} -> ${outDir}`);
console.log(`  anchorDelta (normal): (${d.x}, ${d.y})  ${ok ? 'OK (<0.01)' : 'FAIL'}`);
if (results.variant) {
  const dv = results.variant.anchorDelta;
  console.log(`  anchorDelta (${manifest.variants[0]}): (${dv.x}, ${dv.y})`);
}
console.log(
  '  NOTE: numeric anchorDelta ~0 is necessary but NOT sufficient - eyeball base-zoom.png to confirm the shadow reads as grounded.',
);
if (!ok) process.exit(1);
