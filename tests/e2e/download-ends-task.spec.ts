import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// O agente acaba a tarefa quando o download COMEÇA ("⬇️ Downloading …"), sem ficar "trabalhando" até o
// fim; o arquivo continua baixando e o botão de downloads mostra o progresso.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a download task finishes as soon as the download starts; the file keeps downloading', async () => {
  test.setTimeout(150_000);
  const SIZE = 3 * 1024 * 1024, CHUNK = 64 * 1024;
  const server = http.createServer((q, res) => {
    if (q.url !== '/setup.dmg') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Get the app</title><h1>App</h1><a href="/setup.dmg">Download for Mac</a>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(SIZE), 'Content-Disposition': 'attachment; filename="setup.dmg"' });
    let sent = 0;
    const tick = () => { if (sent >= SIZE) { res.end(); return; } res.write(Buffer.alloc(CHUNK, 1)); sent += CHUNK; setTimeout(tick, 250); };
    tick();   // ~12 s: a tarefa tem que acabar bem antes disso
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dlend-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dlend-dl-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'click_text', text: 'Download for Mac' },
    { type: 'wait', ms: 60000 },          // nunca deve rodar: a tarefa acaba quando o download começa
    { type: 'done', reason: 'SCRIPT REACHED THE END', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dlDir);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('download the app for my mac from this page');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 60; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (await page.getByText(/Downloading setup\.dmg/).first().isVisible().catch(() => false)) break;
      await sleep(500);
    }
    await expect(page.getByText(/⬇️ Downloading setup\.dmg/).first()).toBeVisible();
    // A tarefa acabou ANTES do arquivo terminar: o anel ainda está em progresso e o script não chegou ao fim.
    await expect(page.getByTestId('dl-ring')).toHaveAttribute('data-ring', 'progress');
    await expect(page.getByText('SCRIPT REACHED THE END')).toHaveCount(0);
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(ps.length).toBeLessThanOrEqual(3);   // nenhum passo de "wait" depois do download
    // …e o arquivo termina sozinho.
    await expect(page.getByTestId('dl-ring')).toHaveAttribute('data-ring', 'done', { timeout: 40_000 });
    expect(fs.statSync(path.join(dlDir, 'setup.dmg')).size).toBe(SIZE);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true }); }
});

test('a chained request ("…and then open it") keeps the agent engaged: Bah waits for the download, then the next step', async () => {
  test.setTimeout(150_000);
  const SIZE = 2 * 1024 * 1024, CHUNK = 64 * 1024;
  const server = http.createServer((q, res) => {
    if (q.url !== '/setup.dmg') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Get the app</title><a href="/setup.dmg">Download for Mac</a>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(SIZE), 'Content-Disposition': 'attachment; filename="setup.dmg"' });
    let sent = 0;
    const tick = () => { if (sent >= SIZE) { res.end(); return; } res.write(Buffer.alloc(CHUNK, 1)); sent += CHUNK; setTimeout(tick, 200); };
    tick();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dlchain-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dlchain-dl-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'click_text', text: 'Download for Mac' },
    { type: 'done', reason: 'Opened it.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dlDir);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('download the app for my mac from this page and then open it');
    await page.getByTestId('agent-command-input').press('Enter');
    let sawWaiting = false;
    for (let i = 0; i < 160; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (!sawWaiting && await page.getByText(/⏳ Waiting for downloads: setup\.dmg/).first().isVisible().catch(() => false)) sawWaiting = true;
      if (await page.getByText('Opened it.').first().isVisible().catch(() => false)) break;
      await sleep(250);
    }
    expect(sawWaiting).toBe(true);
    await expect(page.getByText(/⬇️ Downloading setup\.dmg/)).toHaveCount(0);   // not ended early
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    // The step after the click only ran once the file was complete.
    expect(ps[2]).toMatch(/DOWNLOAD COMPLETED: setup\.dmg/);
    expect(fs.statSync(path.join(dlDir, 'setup.dmg')).size).toBe(SIZE);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true }); }
});
