import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Ação `download` do agente (worker thread, volta assim que COMEÇA) e a fila pelo agente:
// list_downloads mostra a linha ao vivo, cancel_download pelo nome do arquivo apaga o parcial.
// IA de mentira (E2E_MOCK_SCRIPT) e um servidor local lento.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('agent download runs in the background; list_downloads shows it and cancel_download removes the partial file', async () => {
  test.setTimeout(150_000);
  const SIZE = 4 * 1024 * 1024, CHUNK = 32 * 1024;
  const server = http.createServer((q, res) => {
    if (q.url !== '/big.bin') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Files</title><h1>Files</h1>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(SIZE) });
    let sent = 0;
    const tick = () => { if (sent >= SIZE || res.destroyed) { res.end(); return; } res.write(Buffer.alloc(CHUNK, 1)); sent += CHUNK; setTimeout(tick, 250); };
    tick();   // ~32 s: o cancelamento chega bem antes do fim
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-agdl-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-agdl-dl-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'download', url: T + 'big.bin' },
    { type: 'list_downloads' },
    { type: 'cancel_download', id: 'big.bin' },
    { type: 'done', reason: 'Cancelled big.bin.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dlDir);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    // Sem a palavra "download": a tarefa não acaba quando o arquivo começa (isso é outro teste).
    await page.getByTestId('agent-command-input').fill('fetch big.bin from this page, show me the queue, then cancel it');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 120; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (await page.getByText('Cancelled big.bin.').first().isVisible().catch(() => false)) break;
      await sleep(500);
    }
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    const all = ps.join('\n');
    // A ação voltou no início, com o caminho final, e o arquivo seguiu baixando.
    expect(all).toMatch(/DOWNLOAD STARTED in the background: .*big\.bin \(4\.0 MB\)/);
    // A fila do painel, com quem começou.
    expect(all).toMatch(/DOWNLOADS LIST \(1 active, 1 total[^\n]*\n\s+\[agdl_\d+\] big\.bin — DOWNLOADING[^\n]*\(started by agent\)/);
    expect(all).toMatch(/DOWNLOAD CANCEL: big\.bin \[agdl_\d+\]/);
    // O parcial some com o cancelamento.
    await expect.poll(() => fs.readdirSync(dlDir).filter(f => f.startsWith('big')).length, { timeout: 10_000 }).toBe(0);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true }); }
});
