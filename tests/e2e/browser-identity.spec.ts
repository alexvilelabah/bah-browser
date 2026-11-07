import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Identidade que os sites veem: o User-Agent do header, os client hints (sec-ch-ua) e o que o JS da
// página lê (navigator.userAgent / userAgentData / languages) têm que dizer a MESMA coisa — tudo vem do
// CDP setUserAgentOverride (main.ts, chrome-identity.ts), sem remendo de script. Página local só.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CH_PLATFORM = process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : 'Windows';

test('header and JavaScript report the same Chrome identity, in Chrome header order', async () => {
  test.setTimeout(90_000);
  const seenHeaders: string[][] = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/') seenHeaders.push(req.rawHeaders);
    res.setHeader('Content-Type', 'text/html'); res.end('<title>id</title><h1>identity</h1>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-id-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const a = page.locator('.url-input'); await a.click(); await a.fill(T); await a.press('Enter');
    for (let i = 0; i < 40 && !seenHeaders.length; i++) await sleep(250);
    await sleep(1000);
    const js = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL() === url)!
      .executeJavaScript(`(async () => ({
        ua: navigator.userAgent, platform: navigator.platform, webdriver: navigator.webdriver, languages: navigator.languages,
        brands: navigator.userAgentData.brands.map(b => '"' + b.brand + '";v="' + b.version + '"').join(', '),
        chPlatform: navigator.userAgentData.platform,
        high: await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'fullVersionList', 'uaFullVersion']),
      }))()`), T);
    expect(seenHeaders.length).toBeGreaterThan(0);
    const raw = seenHeaders[seenHeaders.length - 1];
    const names = raw.filter((_, i) => i % 2 === 0).map(n => n.toLowerCase());
    const header = (n: string) => raw[names.indexOf(n) * 2 + 1];
    // JS = header
    expect(js.ua).toBe(header('user-agent'));
    expect(js.ua).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(js.brands).toBe(header('sec-ch-ua'));
    expect(js.brands).toMatch(/^"Not:A-Brand";v="8", "Chromium";v="(\d+)", "Google Chrome";v="\1"$/);
    expect(js.ua).toContain(`Chrome/${js.brands.match(/"Google Chrome";v="(\d+)"/)![1]}.0.0.0`);
    expect(header('sec-ch-ua-platform')).toBe(`"${CH_PLATFORM}"`);
    expect(js.chPlatform).toBe(CH_PLATFORM);
    expect(js.high.uaFullVersion).toMatch(/^\d+\.0\.0\.0$/);
    expect(js.languages[0]).toBe(header('accept-language').split(',')[0]);
    // navigator.webdriver is left to the engine: a boolean, never the undefined the old patch produced.
    // (Playwright launches set it to true; a normal launch reports false.)
    expect(typeof js.webdriver).toBe('boolean');
    // Chrome order: sec-ch-ua* before user-agent, accept-language after it.
    expect(names.indexOf('sec-ch-ua')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('sec-ch-ua')).toBeLessThan(names.indexOf('user-agent'));
    expect(names.indexOf('user-agent')).toBeLessThan(names.indexOf('accept-language'));
  } finally {
    await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
