import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// save_pdf, screenshot da página inteira, clipboard (escrever livre; ler só com permissão).
// A área de transferência da pessoa é guardada antes e devolvida depois; os arquivos salvos são apagados.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('save_pdf, full-page screenshot and clipboard with permission', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Receipt 42</title><h1>Receipt 42</h1><div style="height:3000px;background:linear-gradient(#fff,#ccc)">Total $12.50</div><p>End</p>`); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-save-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'save_pdf' },
    { type: 'screenshot', full: true },
    { type: 'clipboard', write: 'Receipt 42 — total $12.50' },
    { type: 'clipboard', read: true },
    { type: 'done', reason: 'Saved the receipt.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  const saved: string[] = [];
  const before: string = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('save this receipt as a PDF and a screenshot');
    await page.getByTestId('agent-command-input').press('Enter');
    const allow = page.getByRole('button', { name: /Allow for this task/ });
    let last = '';
    for (let i = 0; i < 240 && !/STEP 5: clipboard\(read\)\nRESULT/.test(last); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (await allow.isVisible().catch(() => false)) await allow.click();
      const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
      last = ps[ps.length - 1] || '';
      await sleep(500);
    }
    const result = (n: number) => { const m = new RegExp(`STEP ${n}: [^\\n]*\\nRESULT: ([^\\n]*)`).exec(last); return m ? JSON.parse(m[1]) : null; };
    const pdf = result(2)?.info?.path, png = result(3)?.info?.path;
    if (pdf) saved.push(pdf); if (png) saved.push(png);
    expect(path.basename(pdf)).toMatch(/^Receipt 42.*\.pdf$/);
    expect(fs.readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF');
    const buf = fs.readFileSync(png);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(20)).toBeGreaterThan(3000);   // altura do PNG: a página inteira, não só a tela
    expect(last).toMatch(/CLIPBOARD \(what the user copied\): Receipt 42 — total \$12\.50/);
  } finally {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), before).catch(() => {});
    await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of saved) { try { fs.unlinkSync(f); } catch {} }
  }
});
