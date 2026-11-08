import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Watch/Takeover: a loja mostra um "Press & hold" (mock local, HTML puro). O Bah passa a página pra PESSOA e
// nunca toca a checagem; o TESTE (fazendo a pessoa) mexe na página e clica o botão de fixture "solved" com input
// de verdade (sendInputEvent); a página vira a do produto e o Bah volta sozinho e lê o preço. Tempo esgotado →
// "couldn't read — human check". Tarefa agendada → não espera. No laço geral do agente, depois que a espera
// acaba, um clique do agente na checagem é recusado pelo guard.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function storesServer() {
  const st = { solved: false, hits: [] as string[], touched: [] as string[] };
  const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body><header><form><input name="q" aria-label="Search"></form></header><main>${body}</main></body></html>`;
  // A checagem: um "Press & hold" por cima. Qualquer evento DENTRO da caixa (mousedown/keydown/wheel/clique) e
  // qualquer rolagem do documento viram uma batida em /touched — o agente nunca pode gerar uma.
  const challenge = (title: string) => page(title, `<h1>Apple AirPods Pro 2</h1><p>${'Product details. '.repeat(30)}</p>
    <div id="px-captcha" style="position:fixed;top:80px;left:80px;width:320px;height:180px;background:#fff;border:1px solid #333;padding:10px">
      <p>Quick verification</p><p>Press &amp; hold to confirm you're a human (and not a bot).</p>
      <button id="hold" style="width:200px;height:40px">Press &amp; Hold</button>
    </div>
    <button id="solved" style="position:fixed;top:300px;left:80px;width:160px;height:40px" onclick="fetch('/__solve').then(function(){ location.reload(); })">fixture: solved</button>
    <script>
      ['mousedown','mouseup','click','keydown','wheel','pointerdown','touchstart'].forEach(function(t){
        document.getElementById('px-captcha').addEventListener(t, function(){ fetch('/touched?e=' + t); }, true);
      });
      var sy = 0; addEventListener('scroll', function(){ if (scrollY !== sy) { sy = scrollY; fetch('/touched?e=scroll'); } });
    </script>`);
  const server = http.createServer((q, res) => {
    const host = String(q.headers.host || '').split(':')[0];
    const u = new URL(q.url || '/', 'http://x');
    st.hits.push(`${host}${u.pathname}${u.search}`);
    if (u.pathname === '/__solve') { st.solved = true; res.end('ok'); return; }
    if (u.pathname === '/touched') { st.touched.push(String(u.searchParams.get('e'))); res.end('ok'); return; }
    if (u.pathname === '/favicon.ico') { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (host === 'shopa.localhost') {
      res.end(page('Shop A: AirPods Pro', `<h1>Results for "${u.searchParams.get('q')}"</h1><div class="tile"><a href="/p/airpods">Apple AirPods Pro 2 Wireless Earbuds (USB-C)</a><span>$199.99</span><span>In stock</span></div>`));
    } else if (host === 'shopc.localhost' || host === 'www.checkstore.com') {
      if (!st.solved) res.end(challenge('Shop C'));
      else res.end(page('Apple AirPods Pro 2 - Shop C', `<h1>Apple AirPods Pro 2 with MagSafe Case</h1><div class="price">$179.00</div><div>Ships tomorrow</div>`));
    } else { res.statusCode = 404; res.end('not found'); }
  });
  return { server, st };
}

async function launch(env: Record<string, string>, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; tmp: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-takeover-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...base } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain', ...extraArgs], env: { ...base, E2E_MOCK_AI: '1', NODE_ENV: 'test', ...env } as any });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  return { app, page, tmp };
}

const mkStores = (port: number, ids: string[]) => ids.map(id => ({ id, label: id === 'shopa' ? 'Shop A' : 'Shop C', names: [id], domain: `${id}.localhost`, search: `http://${id}.localhost:${port}/search?q={query}` }));
const chats = (app: ElectronApplication) => app.evaluate(() => ((global as any).__e2eChats || []) as Array<{ message: string }>);
const feedText = (page: Page) => page.locator('body').innerText().catch(() => '');

/** O teste FAZENDO A PESSOA: input de verdade (sendInputEvent) na aba da loja, no ponto do elemento. */
async function userClick(app: ElectronApplication, urlPart: string, selector: string | null): Promise<boolean> {
  return app.evaluate(async ({ webContents }, a) => {
    // The newest tab on that site: the one Bah handed over (the task tab may show the same check behind it).
    const wc = webContents.getAllWebContents().filter(w => w.getURL().includes(a.urlPart)).sort((x, y) => x.id - y.id).pop();
    if (!wc) return false;
    const pt = a.selector
      ? await wc.executeJavaScript(`(function(){ var r = document.querySelector(${JSON.stringify(a.selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
      : { x: 600, y: 40 };   // um ponto vazio da página (fora da checagem)
    wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y } as any);
    wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 } as any);
    wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 } as any);
    return true;
  }, { urlPart, selector });
}

async function startCompare(page: Page) {
  await page.getByTestId('agent-command-input').fill('compare prices for AirPods Pro on Amazon and other stores');
  await page.getByTestId('agent-command-input').press('Enter');
}
async function waitFor(page: Page, re: RegExp, tries = 240): Promise<string> {
  let feed = '';
  for (let i = 0; i < tries; i++) {
    if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
    feed = await feedText(page);
    if (re.test(feed)) break;
    await sleep(500);
  }
  return feed;
}

test('price compare: a "Press & hold" store is handed to the person, the agent never touches it, and resumes by itself when it clears', async () => {
  test.setTimeout(240_000);
  const s = storesServer();
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const replies = [
    JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 Wireless Earbuds (USB-C)', price: '$199.99', availability: 'In stock' }),
    JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 with MagSafe Case', price: '$179.00', availability: 'Ships tomorrow' }),
  ];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: '[]', E2E_MOCK_CHAT_SCRIPT: JSON.stringify(replies), E2E_PRICE_STORES: JSON.stringify(mkStores(port, ['shopa', 'shopc'])), E2E_TAKEOVER_TIMEOUT_MS: '90000' });
  try {
    await startCompare(page);
    const card = page.getByTestId('takeover-card').last();
    await waitFor(page, /wants to confirm a person is here/);
    await expect(card).toHaveAttribute('data-phase', 'handoff', { timeout: 30_000 });
    await expect(card).toContainText('Shop C wants to confirm a person is here — please do it on the page. Bah continues by itself when it\'s done.');
    await expect(card.getByTestId('takeover-handback')).toBeVisible();
    await expect(card.getByTestId('takeover-skip')).toBeVisible();
    // The store's tab was brought to the front: the visible webview shows the check.
    const visibleUrl = await page.evaluate(() => { const w: any = Array.from(document.querySelectorAll('webview')).find((x: any) => x.offsetParent !== null); return w ? w.getURL() : ''; });
    expect(visibleUrl).toContain('shopc.localhost');
    // Paused: during the check the agent reads nothing there and touches nothing.
    const before = (await chats(app)).length;
    expect(before).toBe(1);   // Shop A only
    await sleep(5000);
    expect((await chats(app)).length).toBe(before);
    expect(s.st.touched).toEqual([]);
    // The person starts using the page → TAKEOVER ("You're driving").
    expect(await userClick(app, 'shopc.localhost', null)).toBe(true);
    await expect(card).toHaveAttribute('data-phase', 'takeover', { timeout: 10_000 });
    await expect(card).toContainText("You're driving");
    // The person clears it (the fixture's "solved" button) → the page becomes the product page → Bah resumes alone.
    expect(await userClick(app, 'shopc.localhost', '#solved')).toBe(true);
    const feed = await waitFor(page, /Checked "AirPods Pro" at 2 stores/);
    await expect(card).toHaveAttribute('data-outcome', 'cleared');
    expect(feed).toContain('✅ Shop C: $179.00');
    expect(feed).toContain('✅ Shop A: $199.99');
    expect(feed).toMatch(/Checked "AirPods Pro" at 2 stores: read 2 \(Shop C \$179\.00, Shop A \$199\.99\)/);
    const read = await chats(app);
    expect(read.length).toBe(2);
    expect(read[1].message).toContain('Apple AirPods Pro 2 with MagSafe Case');
    expect(read.every(r => !/Press & hold|Quick verification/i.test(r.message))).toBe(true);   // the check itself was never sent to the model
    expect(s.st.touched).toEqual([]);   // the agent never pressed, clicked, typed or scrolled on the check
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('price compare: nobody clears the check in time → "couldn\'t read — human check"', async () => {
  test.setTimeout(180_000);
  const s = storesServer();
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const replies = [JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 Wireless Earbuds (USB-C)', price: '$199.99', availability: 'In stock' })];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: '[]', E2E_MOCK_CHAT_SCRIPT: JSON.stringify(replies), E2E_PRICE_STORES: JSON.stringify(mkStores(port, ['shopa', 'shopc'])), E2E_TAKEOVER_TIMEOUT_MS: '6000' });
  try {
    await startCompare(page);
    await waitFor(page, /wants to confirm a person is here/);
    const t0 = Date.now();
    const feed = await waitFor(page, /Checked "AirPods Pro" at 2 stores/);
    expect(Date.now() - t0).toBeGreaterThan(3000);   // it did wait for the person
    await expect(page.getByTestId('takeover-card').last()).toHaveAttribute('data-outcome', 'timeout');
    expect(feed).toContain("⚠️ Shop C: couldn't read — human check");
    expect(feed).toMatch(/blocked 1 \(Shop C — human check\)/);
    expect((await chats(app)).length).toBe(1);
    expect(s.st.touched).toEqual([]);
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('price compare, scheduled (unattended) run: never waits for a person', async () => {
  test.setTimeout(180_000);
  const s = storesServer();
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const replies = [JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 Wireless Earbuds (USB-C)', price: '$199.99', availability: 'In stock' })];
  const MONDAY_0759 = new Date(2026, 10, 2, 7, 59, 0).getTime();
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: '[]', E2E_MOCK_CHAT_SCRIPT: JSON.stringify(replies), E2E_PRICE_STORES: JSON.stringify(mkStores(port, ['shopa', 'shopc'])), E2E_TAKEOVER_TIMEOUT_MS: '120000', E2E_SCHED_NOW: String(MONDAY_0759) });
  try {
    await page.waitForFunction(() => !!(window as any).__bahSched);
    await page.getByTestId('agent-command-input').fill('every weekday at 8am compare prices for AirPods Pro on Amazon and other stores');
    await page.getByTestId('agent-command-input').press('Enter');
    await expect(page.getByText(/Scheduled: “compare prices for AirPods Pro/).first()).toBeVisible();
    const t0 = Date.now();
    await page.evaluate((t) => (window as any).__bahSched.setNow(t), new Date(2026, 10, 2, 8, 0, 5).getTime());
    const feed = await waitFor(page, /Checked "AirPods Pro" at 2 stores/);
    expect(Date.now() - t0).toBeLessThan(90_000);   // well under the 120 s hand-off timeout: it never waited
    expect(feed).toContain("⚠️ Shop C: couldn't read — human check");
    const card = page.getByTestId('takeover-card').last();
    await expect(card).toHaveAttribute('data-outcome', 'unattended');
    await expect(card.getByTestId('takeover-handback')).toHaveCount(0);
    // No tab was opened for the person: Shop C was loaded once (its search), never again.
    expect(s.st.hits.filter(h => h.startsWith('shopc.localhost/search')).length).toBe(1);
    expect(s.st.touched).toEqual([]);
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('agent loop: hands the check to the person, resumes by itself when cleared; after a skip, clicking the check is refused', async () => {
  test.setTimeout(240_000);
  const s = storesServer();
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const T = `http://www.checkstore.com:${port}/`;
  const script = [
    { type: 'navigate', url: `${T}item` },            // → the check: Bah hands it off; the test-as-user clears it
    { type: 'done', reason: 'Read the product page: $179.00.', success: true },
    { type: 'navigate', url: `${T}item2` },           // 2nd task: the check again; the person skips
    { type: 'click_text', text: 'Press & Hold' },     // the agent tries to operate it → refused by the guard
    { type: 'done', reason: 'Could not read it — human check.', success: false },
  ];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_TAKEOVER_TIMEOUT_MS: '90000' }, ['--host-resolver-rules=MAP www.checkstore.com 127.0.0.1']);
  const prompts = () => app.evaluate(() => ((global as any).__e2ePrompts || []) as string[]);
  try {
    await page.getByTestId('agent-command-input').fill(`open ${T}item and tell me the price`);
    await page.getByTestId('agent-command-input').press('Enter');
    const card = page.getByTestId('takeover-card').last();
    await waitFor(page, /wants to confirm a person is here/);
    await expect(card).toHaveAttribute('data-phase', 'handoff', { timeout: 30_000 });
    const n = (await prompts()).length;
    await sleep(4000);
    expect((await prompts()).length).toBe(n);   // paused: no model step while the person has the page
    expect(await userClick(app, 'checkstore.com', '#solved')).toBe(true);
    await waitFor(page, /Read the product page: \$179\.00/);
    await expect(card).toHaveAttribute('data-outcome', 'cleared');
    let ps = await prompts();
    expect(ps.some(p => /HANDBACK: the person cleared the human check on checkstore\.com/.test(p))).toBe(true);
    expect(s.st.touched).toEqual([]);

    // 2nd task: the check again; the person presses [Skip this site]; the agent's click on it is refused.
    s.st.solved = false;
    for (let i = 0; i < 60 && !(await page.getByTestId('agent-command-input').isEnabled().catch(() => false)); i++) await sleep(500);
    await sleep(1500);
    await page.getByTestId('agent-command-input').fill(`open ${T}item2 and tell me the price`);
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 120 && !(await page.getByTestId('takeover-skip').isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await page.getByTestId('takeover-skip').click();
    await waitFor(page, /Could not read it — human check/);
    await expect(page.getByTestId('takeover-card').last()).toHaveAttribute('data-outcome', 'skipped');
    ps = await prompts();
    expect(ps.some(p => /HUMAN CHECK NOT CLEARED on checkstore\.com \(the person chose to skip this site\)/.test(p))).toBe(true);
    expect(ps.some(p => /REFUSED: "click_text" refused: checkstore\.com is showing a human check/.test(p))).toBe(true);
    expect(s.st.touched).toEqual([]);
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
