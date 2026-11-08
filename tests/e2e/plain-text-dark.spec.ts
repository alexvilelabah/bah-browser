import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Arquivo de texto puro com CSP "default-src 'none'; sandbox" (Hugging Face, GitHub raw) no tema
// escuro: o texto ficava branco num fundo branco. Agora fundo e texto seguem o MESMO esquema.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('plain-text file under a sandbox CSP stays readable in dark and light scheme', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((_q, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end('# README\n' + 'some long line of text '.repeat(40) + '\nend');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/README.md`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-txt-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const bar = page.locator('.address-bar input').first();
    await bar.click(); await bar.fill(T); await bar.press('Enter');
    await sleep(3000);
    // Page scripts are blocked by the CSP, so read the colours through the DevTools protocol.
    const colours = async (scheme: 'dark' | 'light') => app.evaluate(async ({ webContents }, { scheme, url }) => {
      const wc = webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL() === url);
      if (!wc) return null;
      try { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); } catch {}
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await new Promise(r => setTimeout(r, 300));
      await wc.debugger.sendCommand('DOM.enable'); await wc.debugger.sendCommand('CSS.enable');
      const doc: any = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1 });
      const get = async (sel: string, prop: string) => {
        const q: any = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
        const cs: any = await wc.debugger.sendCommand('CSS.getComputedStyleForNode', { nodeId: q.nodeId });
        return cs.computedStyle.find((x: any) => x.name === prop)?.value;
      };
      return { bg: await get('html', 'background-color'), fg: await get('pre', 'color') };
    }, { scheme, url: T });
    const dark = await colours('dark');
    expect(dark).not.toBeNull();
    expect(dark!.bg).not.toBe(dark!.fg);
    expect(dark!.fg).toBe('rgb(255, 255, 255)');
    expect(dark!.bg).not.toBe('rgb(255, 255, 255)');
    expect(dark!.bg).not.toBe('rgba(0, 0, 0, 0)');
    const light = await colours('light');
    expect(light!.fg).toBe('rgb(0, 0, 0)');
    expect(light!.bg).toBe('rgb(255, 255, 255)');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
