import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Botão de downloads com o anel de progresso (igual ao Chrome): parcial enquanto baixa, "pronto" no fim.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('download button shows a filling progress ring, then the done state', async () => {
  test.setTimeout(120_000);
  const SIZE = 2 * 1024 * 1024, CHUNK = 64 * 1024;
  const server = http.createServer((q, res) => {
    if (q.url !== '/file.bin') { res.setHeader('Content-Type', 'text/html'); res.end('<title>dl</title><a href="/file.bin">file</a>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(SIZE), 'Content-Disposition': 'attachment; filename="ring-test.bin"' });
    let sent = 0;
    const tick = () => { if (sent >= SIZE) { res.end(); return; } res.write(Buffer.alloc(CHUNK, 1)); sent += CHUNK; setTimeout(tick, 220); };
    tick();   // ~7 s no total: dá tempo de ver o anel parcial
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ring-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ring-dl-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dlDir);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const ring = page.getByTestId('dl-ring');
    await expect(ring).toHaveAttribute('data-ring', 'idle');
    const bar = page.locator('.address-bar input').first();
    await bar.click(); await bar.fill(T); await bar.press('Enter');
    // Enquanto baixa: anel parcial (0 < fração < 1).
    await expect(ring).toHaveAttribute('data-ring', 'progress', { timeout: 15_000 });
    let seenPartial = false;
    for (let i = 0; i < 40 && !seenPartial; i++) {
      const f = Number(await ring.getAttribute('data-fraction'));
      if (f > 0 && f < 1) seenPartial = true; else await sleep(200);
    }
    expect(seenPartial).toBe(true);
    // Terminou: estado "pronto" e depois volta à seta.
    await expect(ring).toHaveAttribute('data-ring', 'done', { timeout: 30_000 });
    await expect(ring).toHaveAttribute('data-ring', 'idle', { timeout: 5_000 });
    expect(fs.existsSync(path.join(dlDir, 'ring-test.bin'))).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true }); }
});
