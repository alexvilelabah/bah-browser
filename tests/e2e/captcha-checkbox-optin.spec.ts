import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Opt-in "Agent may click captcha checkboxes" (menu ☑️, localStorage agentCaptchaCheckbox, OFF by default).
// Local fixture: a simple "I'm not a robot" checkbox gate (no live captcha service). Every click on the
// checkbox is counted by the server (/cb-click).
//  - OFF: Bah hands the page to the person (Watch/Takeover) and never clicks the checkbox.
//  - ON, the click passes: the checkbox gets exactly ONE click (tryCaptchaCheckbox) and the task goes on — no hand-off.
//  - ON, still blocked after the click: exactly ONE click, then the usual hand-off; the person clears it.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gateServer(mode: 'pass' | 'stay') {
  const st = { solved: false, clicks: 0, hits: [] as string[] };
  const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
  // The gate: a checkbox "I'm not a robot" + a widget frame (src matches the upstream CAPTCHA_FRAME_RE: "turnstile").
  // mode 'pass': the click fills the response token and removes the widget (what a real provider does when it passes).
  // mode 'stay': the click is counted but nothing changes (provider wants more → the person).
  const gate = () => page('Shop C', `<h1>Verify you are human</h1><p>Shop C needs to confirm you are not a robot before showing this page.</p>
    <label style="display:inline-flex;align-items:center;gap:8px;padding:12px;border:1px solid #333">
      <input type="checkbox" id="cb" aria-label="I'm not a robot" style="width:28px;height:28px"> I'm not a robot
    </label>
    <iframe id="widget" src="/turnstile/widget" style="display:block;width:300px;height:65px;border:1px solid #ccc"></iframe>
    <input type="hidden" name="cf-turnstile-response" id="tok" value="">
    <button id="solved" style="position:fixed;top:300px;left:80px;width:160px;height:40px" onclick="fetch('/__solve').then(function(){ location.reload(); })">fixture: solved</button>
    <script>
      document.getElementById('cb').addEventListener('click', function(){
        fetch('/cb-click');
        ${mode === 'pass' ? `document.getElementById('tok').value = 'x'.repeat(40); document.getElementById('widget').remove(); fetch('/__solve').then(function(){ setTimeout(function(){ location.reload(); }, 300); });` : ''}
      });
    </script>`);
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    st.hits.push(u.pathname);
    if (u.pathname === '/__solve') { st.solved = true; res.end('ok'); return; }
    if (u.pathname === '/cb-click') { st.clicks++; res.end('ok'); return; }
    if (u.pathname === '/favicon.ico') { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname.startsWith('/turnstile')) { res.end('<!doctype html><html><body style="margin:0;font:12px sans-serif">widget</body></html>'); return; }
    if (!st.solved) res.end(gate());
    else res.end(page('Apple AirPods Pro 2 - Shop C', `<h1>Apple AirPods Pro 2 with MagSafe Case</h1><div class="price">$179.00</div><div>Ships tomorrow. ${'Product details. '.repeat(10)}</div>`));
  });
  return { server, st };
}

async function launch(env: Record<string, string>, switchOn: boolean, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; tmp: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-captcha-optin-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...base } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain', ...extraArgs], env: { ...base, E2E_MOCK_AI: '1', NODE_ENV: 'test', ...env } as any });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate((on) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); if (on) localStorage.setItem('agentCaptchaCheckbox', '1'); else localStorage.removeItem('agentCaptchaCheckbox'); }, switchOn);
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  return { app, page, tmp };
}

async function userClick(app: ElectronApplication, urlPart: string, selector: string): Promise<boolean> {
  return app.evaluate(async ({ webContents }, a) => {
    const wc = webContents.getAllWebContents().filter(w => w.getURL().includes(a.urlPart)).sort((x, y) => x.id - y.id).pop();
    if (!wc) return false;
    const pt = await wc.executeJavaScript(`(function(){ var r = document.querySelector(${JSON.stringify(a.selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y } as any);
    wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 } as any);
    wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 } as any);
    return true;
  }, { urlPart, selector });
}
async function waitFor(page: Page, re: RegExp, tries = 240): Promise<string> {
  let feed = '';
  for (let i = 0; i < tries; i++) {
    if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
    feed = await page.locator('body').innerText().catch(() => '');
    if (re.test(feed)) break;
    await sleep(500);
  }
  return feed;
}

async function run(mode: 'pass' | 'stay', switchOn: boolean, body: (ctx: { app: ElectronApplication; page: Page; st: { solved: boolean; clicks: number }; prompts: () => Promise<string[]> }) => Promise<void>) {
  const s = gateServer(mode);
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const T = `http://www.checkstore.com:${port}/`;
  const script = [
    { type: 'navigate', url: `${T}item` },
    { type: 'done', reason: 'Read the product page: $179.00.', success: true },
  ];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_TAKEOVER_TIMEOUT_MS: '90000' }, switchOn, ['--host-resolver-rules=MAP www.checkstore.com 127.0.0.1']);
  const prompts = () => app.evaluate(() => ((global as any).__e2ePrompts || []) as string[]);
  try {
    await page.getByTestId('agent-command-input').fill(`open ${T}item and tell me the price`);
    await page.getByTestId('agent-command-input').press('Enter');
    await body({ app, page, st: s.st, prompts });
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('captcha checkbox switch OFF (default): hand-off, the checkbox is never clicked', async () => {
  test.setTimeout(240_000);
  await run('pass', false, async ({ app, page, st }) => {
    const card = page.getByTestId('takeover-card').last();
    await waitFor(page, /wants to confirm a person is here/);
    await expect(card).toHaveAttribute('data-phase', 'handoff', { timeout: 30_000 });
    await sleep(6000);   // longer than tryCaptchaCheckbox's wait: nothing clicks it
    expect(st.clicks).toBe(0);
    expect(await userClick(app, 'checkstore.com', '#solved')).toBe(true);
    await waitFor(page, /Read the product page: \$179\.00/);
    await expect(card).toHaveAttribute('data-outcome', 'cleared');
    expect(st.clicks).toBe(0);
  });
});

test('captcha checkbox switch ON, click passes: exactly one click, no hand-off, task continues', async () => {
  test.setTimeout(240_000);
  await run('pass', true, async ({ page, st, prompts }) => {
    await waitFor(page, /Read the product page: \$179\.00/);
    expect(st.clicks).toBe(1);
    await expect(page.getByTestId('takeover-card')).toHaveCount(0);
    expect((await prompts()).some(p => /CAPTCHA CHECKBOX: clicked the "I am not a robot"\/verify checkbox and the verification PASSED/.test(p))).toBe(true);
  });
});

test('captcha checkbox switch ON, still blocked: exactly one click, then the usual hand-off', async () => {
  test.setTimeout(240_000);
  await run('stay', true, async ({ app, page, st }) => {
    const card = page.getByTestId('takeover-card').last();
    const feed = await waitFor(page, /wants to confirm a person is here/);
    expect(feed).toContain('Verification checkbox did not pass on its own — asking you.');
    await expect(card).toHaveAttribute('data-phase', 'handoff', { timeout: 30_000 });
    expect(st.clicks).toBe(1);
    await sleep(5000);
    expect(st.clicks).toBe(1);   // once per URL: not retried while handed off
    expect(await userClick(app, 'checkstore.com', '#solved')).toBe(true);
    await waitFor(page, /Read the product page: \$179\.00/);
    await expect(card).toHaveAttribute('data-outcome', 'cleared');
    expect(st.clicks).toBe(1);
  });
});
