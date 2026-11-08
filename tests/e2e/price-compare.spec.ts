import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Preço em várias lojas: o Bah visita CADA loja (lojas sintéticas em *.localhost), busca só o produto,
// o modelo lê o preço na página da loja e o Bah confere. Loja A: preço na busca. Loja B: busca sem preço →
// abre a página do produto. Loja C: checagem de robô → o Bah passa pra pessoa (Watch/Takeover); ninguém libera
// no tempo (E2E_TAKEOVER_TIMEOUT_MS) → "couldn't read — human check", sem chamar o modelo nem tocar a checagem. Loja D: o
// modelo "lê" um preço que não está na página → não conta. A matéria de ofertas nunca é aberta.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function storesServer() {
  const hits: string[] = [];
  const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body><header><form><input name="q" aria-label="Search"></form></header><main>${body}</main></body></html>`;
  const server = http.createServer((q, res) => {
    const host = String(q.headers.host || '').split(':')[0];
    const u = new URL(q.url || '/', 'http://x');
    hits.push(`${host}${u.pathname}${u.search}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (host === 'shopa.localhost') {
      res.end(page('Shop A: AirPods Pro', `<h1>Results for "${u.searchParams.get('q')}"</h1>
        <div class="tile"><a href="/p/case">Silicone Case for AirPods Pro 2</a><span>$12.99</span></div>
        <div class="tile"><a href="/p/airpods">Apple AirPods Pro 2 Wireless Earbuds (USB-C)</a><span>$199.99</span><span>In stock · Free shipping</span></div>`));
    } else if (host === 'shopb.localhost') {
      if (u.pathname === '/p/42') res.end(page('Apple AirPods Pro 2 - Shop B', `<h1>Apple AirPods Pro 2 with MagSafe Case</h1><div class="price">$189.00</div><div>Pickup today</div><button>Add to cart</button>`));
      else res.end(page('Shop B search', `<h1>Search</h1><ul><li><a href="/p/42">Apple AirPods Pro 2 with MagSafe Case</a> — see price in cart</li></ul>`));
    } else if (host === 'shopc.localhost') {
      res.end(page('Robot or human?', `<h1>Robot or human?</h1><p>Activate and hold the button to confirm that you're human. Press &amp; Hold</p>`));
    } else if (host === 'shopd.localhost') {
      res.end(page('Shop D', `<h1>Results for AirPods Pro</h1><p>Showing 1 result, sorted by relevance.</p><div><span>Apple AirPods Pro 2</span> <span>$229.00</span></div>`));
    } else if (host === 'deals.localhost') {
      res.end(page('AirPods deals compared', `<article><h1>AirPods deals: Amazon vs Walmart</h1><p>Amazon $149, Walmart $159</p></article>`));
    } else { res.statusCode = 404; res.end('not found'); }
  });
  return { server, hits };
}

test('price compare: visits each store, reads its price there, records blocked stores honestly', async () => {
  test.setTimeout(180_000);
  const s = storesServer();
  await new Promise<void>(r => s.server.listen(0, '127.0.0.1', r));
  const port = (s.server.address() as AddressInfo).port;
  const mk = (id: string, label: string) => ({ id, label, names: [id], domain: `${id}.localhost`, search: `http://${id}.localhost:${port}/search?q={query}` });
  const stores = [mk('shopa', 'Shop A'), mk('shopb', 'Shop B'), mk('shopc', 'Shop C'), mk('shopd', 'Shop D')];
  const chats = [
    JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 Wireless Earbuds (USB-C)', price: '$199.99', availability: 'In stock · Free shipping' }),
    JSON.stringify({ found: false, title: '', price: '', availability: '' }),
    JSON.stringify({ found: true, title: 'Apple AirPods Pro 2 with MagSafe Case', price: '$189.00', availability: 'Pickup today' }),
    JSON.stringify({ found: true, title: 'Apple AirPods Pro 2', price: '$149.99', availability: '' }),   // inventado
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-price-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify([{ type: 'navigate', url: `http://deals.localhost:${port}/` }]), E2E_MOCK_CHAT_SCRIPT: JSON.stringify(chats), E2E_PRICE_STORES: JSON.stringify(stores), E2E_TAKEOVER_TIMEOUT_MS: '4000', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('compare prices for AirPods Pro on Amazon and other stores');
    await page.getByTestId('agent-command-input').press('Enter');
    let feed = '';
    for (let i = 0; i < 240; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      feed = await page.locator('body').innerText().catch(() => '');
      if (/Checked "AirPods Pro" at 4 stores/.test(feed)) break;
      await sleep(500);
    }
    // Uma linha por loja no feed, na ordem.
    for (const [i, l] of ['Shop A', 'Shop B', 'Shop C', 'Shop D'].entries()) expect(feed).toContain(`🛒 Checking ${l}… (${i + 1}/4)`);
    expect(feed).toContain('✅ Shop A: $199.99 — Apple AirPods Pro 2 Wireless Earbuds (USB-C)');
    expect(feed).toContain('🛒 Shop B: no price in the results — opening the product page…');
    expect(feed).toContain('✅ Shop B: $189.00');
    expect(feed).toContain("🙋 Shop C: wants a person to confirm — will hand it to you");
    expect(feed).toContain("⚠️ Shop C: couldn't read — human check");
    expect(feed).toContain("⚠️ Shop D: couldn't read — price $149.99 not confirmed on the page");
    expect(feed).toMatch(/Checked "AirPods Pro" at 4 stores: read 2 \(Shop B \$189\.00, Shop A \$199\.99\); blocked 1 \(Shop C — human check\); no price found 1/);
    expect(feed).toContain('Cheapest: Shop B — $189.00');
    // Cada loja recebeu só o produto na busca; a matéria de ofertas nunca foi aberta; o modelo-agente nunca foi chamado.
    for (const h of ['shopa', 'shopb', 'shopc', 'shopd']) expect(s.hits).toContain(`${h}.localhost/search?q=AirPods%20Pro`);
    expect(s.hits).toContain('shopb.localhost/p/42');
    expect(s.hits.some(h => h.startsWith('deals.localhost'))).toBe(false);
    expect(s.hits.some(h => /other|stores|amazon/i.test(h))).toBe(false);
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(prompts.length).toBe(0);
    // O modelo leu 4 páginas (C bloqueada não foi lida): trechos da página da loja, com o print.
    const read: Array<{ message: string; image: boolean }> = await app.evaluate(() => (global as any).__e2eChats || []);
    expect(read.length).toBe(4);
    expect(read[0].message).toContain('Shop A (http://shopa.localhost');
    expect(read[0].message).toContain('Apple AirPods Pro 2 Wireless Earbuds (USB-C)');
    expect(read[2].message).toContain('shopb.localhost:' + port + '/p/42');
    expect(read.every(r => !/shopc/.test(r.message))).toBe(true);
    // A tabela: todas as lojas tentadas, com link.
    let html = '';
    for (let i = 0; i < 20 && !html; i++) {
      html = await app.evaluate(async ({ webContents }) => {
        for (const wc of webContents.getAllWebContents()) {
          if (!/^(file:|data:)/.test(wc.getURL())) continue;
          try { const h = await wc.executeJavaScript('document.body.innerText'); if (/Prices: AirPods Pro/.test(h)) return h; } catch {}
        }
        return '';
      });
      if (!html) await sleep(500);
    }
    expect(html).toMatch(/Shop B[\s\S]*Shop A[\s\S]*Shop C[\s\S]*Shop D/);
    expect(html).toContain("couldn't read — human check");
    expect(html).toContain('2 of 4 stores read');
  } finally { await app.close(); s.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
