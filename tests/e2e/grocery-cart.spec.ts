import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Carrinho de mercado numa loja sintética mínima (as cópias reais ficam fora do repo): o agente vê os
// cartões de produto com as refs de Add/+/−, a lista do pedido contra o carrinho, a página do carrinho,
// e o "Continue to checkout" passa pelo freio — a pessoa recusa e nada chega ao checkout.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ITEMS = [
  { id: 'b6', name: 'Plain Bagels, 6 Count', price: 3.98, oos: false },
  { id: 'e6', name: 'Everything Bagels, 6 Count', price: 4.29, oos: true },
];
function storeServer() {
  const cart = new Map<string, number>();
  let checkoutHits = 0;
  const CLIENT = `document.addEventListener('click', function(e){ var b = e.target.closest('[data-op]'); if (!b) return;
    fetch('/__cart?op=' + b.dataset.op + '&id=' + b.dataset.id, { method: 'POST' }).then(function(){ location.reload(); }); });`;
  const page = (title: string, body: string) => `<!doctype html><title>${title}</title><header><a href="/cart" aria-label="Cart ${[...cart.values()].reduce((a, b) => a + b, 0)} items">Cart</a>
<form action="/search"><input name="q" aria-label="Search the store"></form></header>${body}<script>${CLIENT}</script>`;
  const action = (it: typeof ITEMS[number]) => it.oos ? '<div>Out of stock</div>'
    : cart.get(it.id) ? `<button data-op="dec" data-id="${it.id}" aria-label="Decrease quantity ${it.name}"></button><span>${cart.get(it.id)} in cart</span><button data-op="inc" data-id="${it.id}" aria-label="Increase quantity ${it.name}"></button>`
    : `<button data-op="add" data-id="${it.id}" aria-label="Add to cart - ${it.name}">Add</button>`;
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/__cart') {
      const id = u.searchParams.get('id') || '', op = u.searchParams.get('op');
      const n = (cart.get(id) || 0) + (op === 'dec' ? -1 : 1);
      if (n > 0) cart.set(id, n); else cart.delete(id);
      res.end('ok'); return;
    }
    if (u.pathname === '/checkout') { checkoutHits++; res.end(page('Checkout', '<h1>Checkout</h1><button>Place order</button>')); return; }
    if (u.pathname === '/cart') {
      const lines = ITEMS.filter(it => cart.get(it.id)).map(it => `<div class="line"><a href="/p/${it.id}">${it.name}</a> <span>$${(it.price * (cart.get(it.id) || 0)).toFixed(2)}</span> ${action(it)}</div>`).join('');
      const n = [...cart.values()].reduce((a, b) => a + b, 0);
      const sub = ITEMS.reduce((s, it) => s + it.price * (cart.get(it.id) || 0), 0);
      res.end(page('Your cart', `<h1>Cart</h1>${lines}<p>Subtotal (${n} items): $${sub.toFixed(2)}</p><button onclick="location.href='/checkout'">Continue to checkout</button>`));
      return;
    }
    res.end(page(`${u.searchParams.get('q') || 'Store'} - Store`, `<h1>Results</h1><ul>${ITEMS.map(it => `<li class="tile"><a href="/p/${it.id}">${it.name}</a><div>$${it.price.toFixed(2)} (66.3 ¢/ea)</div>${action(it)}</li>`).join('')}</ul>`));
  });
  return { server, cart, checkoutHits: () => checkoutHits };
}

test('grocery cart: products and cart reach the agent with refs; checkout asks and stays undone', async () => {
  test.setTimeout(180_000);
  const store = storeServer();
  await new Promise<void>(r => store.server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(store.server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-grocery-'));
  const script = [
    { type: 'navigate', url: T + 'search?q=bagels' },
    { type: 'click_role', role: 'button', name: 'Add to cart - Plain Bagels, 6 Count' },
    { type: 'click_role', role: 'button', name: 'Increase quantity Plain Bagels, 6 Count' },
    { type: 'navigate', url: T + 'cart' },
    { type: 'click_role', role: 'button', name: 'Continue to checkout' },
    { type: 'click_role', role: 'button', name: 'Continue to checkout' },
    { type: 'done', reason: 'Cart ready:\n| item | product | qty | price |\n| bagels (a dozen) | Plain Bagels, 6 Count | 2 | $7.96 |\nEverything Bagels were out of stock.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('add a dozen bagels to my cart on this store');
    await page.getByTestId('agent-command-input').press('Enter');
    // 1º checkout: a pessoa recusa (nada acontece, e a tarefa NÃO acaba com um segundo pedido da recuperação);
    // 2º: aprova. O cartão do freio tem os dois botões enquanto espera a resposta.
    const answers: Array<'no' | 'yes'> = ['no', 'yes'];
    let idle = 0;
    // Recusado o checkout, a tarefa acaba no carrinho (ou segue até o done do roteiro): espera o agente parar.
    for (let i = 0; i < 240 && idle < 3; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const pause = page.getByText(/Safety pause — this involves payment\. I will click "Continue to checkout"/).last();
      if (answers.length && await page.locator('.feed-confirm-card .confirm-no').last().isVisible().catch(() => false) && await pause.isVisible().catch(() => false)) {
        expect(store.checkoutHits()).toBe(0);
        await expect(page.locator('.feed-confirm-card .confirm-yes').last()).toBeVisible();
        expect(await page.locator('.feed-confirm-card .confirm-yes').count()).toBe(1);   // um só cartão ativo
        await page.locator(answers[0] === 'no' ? '.confirm-no' : '.confirm-yes').last().click();
        answers.shift();
      }
      idle = !answers.length && !(await page.getByTestId('agent-stop').isVisible().catch(() => false)) ? idle + 1 : 0;
      await sleep(500);
    }
    expect(answers).toEqual([]);
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    // Search results: each product with its Add ref; out of stock marked; the request's list; the skill.
    expect(ps[1]).toContain('GROCERY PRODUCTS ON THIS PAGE (2 found)');
    expect(ps[1]).toMatch(/1\. Plain Bagels, 6 Count — \$3\.98 \(66\.3 ¢\/ea\) · ADD \[\d+\]/);
    expect(ps[1]).toMatch(/2\. Everything Bagels, 6 Count — \$4\.29 \(66\.3 ¢\/ea\) · OUT OF STOCK/);
    expect(ps[1]).toMatch(/SHOPPING LIST \(from the request; 1 left\):\n {2}- bagels \(12 wanted — a dozen/);
    expect(ps[1]).toContain('### grocery-cart');
    expect(ps[1]).not.toContain('### shopping-compare');
    // After Add and +: the stepper and the count.
    expect(ps[3]).toMatch(/1\. Plain Bagels, 6 Count — \$3\.98[^\n]*IN CART ×2 · \+ \[\d+\] · − \[\d+\]/);
    expect(ps[3]).toMatch(/- bagels \(12 wanted[^\n]*✓ in cart: Plain Bagels, 6 Count ×2/);
    // Cart page: the line, the subtotal, and the stop before checkout.
    expect(ps[4]).toContain('CART PAGE: 1 product, 2 items, subtotal $7.96.');
    expect(ps[4]).toMatch(/Do NOT click "Continue to checkout" \[\d+\]/);
    expect(ps.length).toBeGreaterThanOrEqual(5);
    // Depois do "não" o roteiro seguiu (passo 6 = o 2º checkout) sem "Sensitive action detected".
    expect(ps.length).toBeGreaterThanOrEqual(6);
    expect(ps[5]).toMatch(/STEP 5: click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/);
    expect(ps[5]).not.toContain('Sensitive action detected');
    expect(store.cart.get('b6')).toBe(2);
    await sleep(1000);
    expect(store.checkoutHits()).toBe(1);   // só o aprovado
  } finally { await app.close(); store.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
