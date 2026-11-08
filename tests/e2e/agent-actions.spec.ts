import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Ações do agente além do clique (select_option, check, find, hover, dblclick, back) e as travas
// (login que a tarefa não pediu, site cuidadoso). IA de mentira (E2E_MOCK_SCRIPT) numa página local.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><title>Driver downloads</title>
<h1>Driver downloads</h1>
<label for="os">Operating system</label>
<select id="os"><option>Windows 11</option><option>macOS 26.x</option><option>Ubuntu 24.04</option></select>
<p><label><input type="checkbox" id="eula"> I accept the license agreement</label></p>
<p><button id="hov" onmouseenter="window.__hovered = true">Hover menu</button>
<button id="dbl" ondblclick="window.__dbl = (window.__dbl || 0) + 1">Double item</button>
<button id="signin" onclick="window.__signin = true">Sign in</button></p>
<a href="/second">Next page</a>
<div style="height: 4000px"></div>
<button id="far">Far away button</button>`;

async function launch(script: unknown[], careful: string[] = []) {
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(q.url === '/second' ? '<title>Second</title><h1>Second page</h1>' : PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-actions-'));
  const steps = script.map((a: any) => (a.url ? { ...a, url: T + a.url } : a));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(steps), NODE_ENV: 'test' } });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate((c) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('carefulSites', JSON.stringify(c)); }, careful);
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  const close = async () => { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, page, T, close };
}

async function run(app: ElectronApplication, page: Page, command: string, until: RegExp) {
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  await page.getByTestId('agent-command-input').fill(command);
  await page.getByTestId('agent-command-input').press('Enter');
  let all = '';
  for (let i = 0; i < 240 && !until.test(all); i++) {
    if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
    all = (await app.evaluate(() => (global as any).__e2ePrompts || [])).join('\n');
    await sleep(500);
  }
  return all;
}

const inPage = (app: ElectronApplication, js: string) => app.evaluate(({ webContents }, code) => {
  const w = webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!;
  return w.executeJavaScript(code);
}, js);

test('agent actions: select_option, find, sign-in guard, back', async () => {
  test.setTimeout(240_000);
  const { app, page, close } = await launch([
    { type: 'navigate', url: 'page' },
    { type: 'select_option', ref: '__REF:Operating system__', option: 'macOS' },
    { type: 'click_ref', ref: '__REF:Sign in__' },
    { type: 'find', text: 'Far away button' },
    { type: 'navigate', url: 'second' },
    { type: 'back' },
    { type: 'done', reason: 'All the steps ran.', success: true },
  ]);
  try {
    const all = await run(app, page, 'pick macOS on the driver page and accept the license', /STEP \d+: back\(\)\nRESULT/);
    expect(all).toMatch(/SELECTED "macOS 26\.x" in drop-down @\d+/);
    expect(all).toMatch(/FIND "Far away button": 1 match\(es\)\. Scrolled to <button> "Far away button"/);
    expect(all).toMatch(/NOT SIGNING IN: "Sign in" starts a sign-in\/sign-up/);
    await expect.poll(() => inPage(app, 'location.pathname')).toBe('/page');   // back() voltou da /second
  } finally { await close(); }
});

test('agent actions: state survives on the page (check, hover, dblclick) and the sign-in click is refused', async () => {
  test.setTimeout(240_000);
  const { app, page, close } = await launch([
    { type: 'navigate', url: 'page' },
    { type: 'check', ref: '__REF:I accept the license__' },
    { type: 'check', ref: '__REF:I accept the license__' },
    { type: 'hover', ref: '__REF:Hover menu__' },
    { type: 'dblclick', ref: '__REF:Double item__' },
    { type: 'click_ref', ref: '__REF:Sign in__' },
    { type: 'wait', ms: 500 },
  ]);
  try {
    const all = await run(app, page, 'accept the license on the driver page', /E2E script finished|NOT SIGNING IN[\s\S]*<<<PAGE>>>[\s\S]*<<<PAGE>>>/);
    await expect.poll(() => inPage(app, 'document.getElementById("eula").checked')).toBe(true);   // o 2º check não desmarca
    expect(await inPage(app, '!!window.__hovered')).toBe(true);
    expect(await inPage(app, 'window.__dbl || 0')).toBe(1);
    expect(await inPage(app, '!!window.__signin')).toBe(false);
    expect(all).toMatch(/NOT SIGNING IN/);
  } finally { await close(); }
});

test('careful site: one page load, then reading only; the second refused action ends the task', async () => {
  test.setTimeout(180_000);
  const { app, page, close } = await launch([
    { type: 'navigate', url: 'page' },
    { type: 'click_ref', ref: '__REF:Next page__' },
    { type: 'scroll', direction: 'down' },
    { type: 'done', reason: 'should not get here', success: true },
  ], ['127.0.0.1']);
  try {
    const all = await run(app, page, 'look at the driver page', /CAREFUL SITE/);
    expect(all).toMatch(/CAREFUL SITE \(127\.0\.0\.1\): "click_ref" is not done automatically on this site\./);
    await expect(page.getByText(/127\.0\.0\.1 is in careful mode/).first()).toBeVisible({ timeout: 60_000 });
    expect(await inPage(app, 'location.pathname')).toBe('/page');   // o clique em "Next page" não aconteceu
  } finally { await close(); }
});
