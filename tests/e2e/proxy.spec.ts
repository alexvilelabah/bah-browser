import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Proxy corporativo (Blue Coat e afins): um proxy LOCAL que exige Basic auth (407).
// Prova: painel salva o modo manual, a caixa de login aparece, a página, o fetch do próprio Bah
// e o download do agente passam pelo proxy; modo direto volta a ignorá-lo. Nada sai da máquina.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const USER = 'e2e-user', PASS = 'e2e-' + crypto.randomBytes(6).toString('hex');   // made up here, test-only
const want = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const seen: Array<{ url: string; authed: boolean }> = [];   // {url, authed}
const target = http.createServer((req, res) => {
  if (req.url === '/file.bin') { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="file.bin"'); return res.end(Buffer.alloc(200000, 7)); }
  res.setHeader('Content-Type', 'text/html'); res.end('<html><head><title>Through proxy</title></head><body><h1>Through proxy</h1></body></html>');
});
const proxy = http.createServer((req, res) => {
  const authed = req.headers['proxy-authorization'] === want;
  seen.push({ url: String(req.url), authed });
  if (!authed) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Corp Proxy"' }); return res.end('auth'); }
  const u = new URL(String(req.url));
  const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
});
proxy.on('connect', (req, sock: net.Socket) => { const authed = req.headers['proxy-authorization'] === want; seen.push({ url: 'CONNECT ' + req.url, authed });
  if (!authed) return sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Corp Proxy"\r\n\r\n');
  const [h, p] = String(req.url).split(':'); const up = net.connect(+p, h, () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); up.pipe(sock); sock.pipe(up); }); up.on('error', () => sock.end()); });
const ok = (c: boolean, m: string) => expect(c, m).toBe(true);

test('corporate proxy: settings, 407 sign-in, page + Bah fetch + download through the proxy', async () => {
  test.setTimeout(90_000);
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r)); await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(target.address() as net.AddressInfo).port}`, P = `127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-proxy-'));
  const { ELECTRON_RUN_AS_NODE: _n, HTTPS_PROXY: _a, HTTP_PROXY: _b, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    // 1. settings panel
    await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Network & proxy' }).click();
    await page.locator('.proxy-mode').selectOption('manual');
    await page.locator('.proxy-server').fill(P); await page.locator('.proxy-bypass').fill('<-loopback>');
    await page.locator('.proxy-save').click(); await page.locator('.proxy-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    ok(fs.existsSync(path.join(tmp, 'proxy.json')), 'proxy.json written: ' + fs.readFileSync(path.join(tmp, 'proxy.json'), 'utf8').replace(/\s+/g, ' '));
    await page.locator('.proxy-card .tour-x').click();
    // 2. page through the proxy → sign-in box
    const url = page.locator('.url-input'); await url.click(); await url.fill(T + '/'); await url.press('Enter');
    await page.locator('.proxy-auth').waitFor({ timeout: 15000 });
    const txt = await page.locator('.proxy-auth .proxy-note').innerText(); ok(/Corp Proxy/.test(txt) && txt.includes(P.split(':')[1]), 'sign-in box shows host + realm: ' + txt);
    await page.locator('.proxy-user').fill(USER); await page.locator('.proxy-pass').fill(PASS);
    await page.locator('.proxy-check input').uncheck();   // no keychain prompt in the test
    await page.locator('.proxy-signin').click();
    let title = '';
    for (let i = 0; i < 20 && title !== 'Through proxy'; i++) { await sleep(500); title = await app.evaluate(({ webContents }) => { const w = webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop(); return w ? w.getTitle() : ''; }); }
    ok(title === 'Through proxy', 'page loaded through the proxy (title: ' + title + ')');
    ok(seen.some(s => s.url.startsWith(T) && s.authed), 'proxy saw the authenticated page request');
    const rtcOn: string[] = await app.evaluate((({ webContents }: any) => webContents.getAllWebContents().filter((w: any) => w.getType() === 'webview').map((w: any) => w.getWebRTCIPHandlingPolicy())));
    ok(rtcOn.length > 0 && rtcOn.every(p => p === 'disable_non_proxied_udp'), 'WebRTC cannot bypass the proxy: ' + rtcOn.join(','));
    ok(!fs.existsSync(path.join(tmp, 'proxy-auth.json')), 'password NOT saved when Remember is off');
    // 3. Bah's own requests (main-process fetch → browser session)
    const n0 = seen.length;
    const body = await app.evaluate(async (_e: any, u: string) => (await fetch(u + '/api')).text(), T);
    ok(/Through proxy/.test(body) && seen.slice(n0).some(s => s.url === T + '/api' && s.authed), 'main-process fetch went through the proxy');
    // 4. agent download through the proxy
    const n1 = seen.length;
    const r = await page.evaluate((u) => (window as any).electronAPI.downloadUrl(u), T + '/file.bin');
    await sleep(3000);
    ok(r?.success && seen.slice(n1).some(s => s.url === T + '/file.bin' && s.authed), 'download went through the proxy: ' + JSON.stringify(r?.info || r).slice(0, 160));
    // 5. Test connection button reports the route
    await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Network & proxy' }).click();
    ok(await page.locator('.proxy-server').inputValue() === P, 'panel reloads the saved server');
    await page.locator('.proxy-card .tour-x').click();
    const tr: any = await app.evaluate(async ({ session }: any, u: string) => ({ via: await session.fromPartition('persist:browser').resolveProxy(u) }), T);
    ok(/PROXY 127\.0\.0\.1/.test(tr.via), 'resolveProxy: ' + tr.via);
    // 6. switch back to direct
    await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Network & proxy' }).click();
    await page.locator('.proxy-mode').selectOption('direct'); await page.locator('.proxy-save').click(); await sleep(500);
    const n2 = seen.length; await app.evaluate(async (_e: any, u: string) => (await fetch(u + '/direct')).text(), T);
    ok(seen.length === n2, 'direct mode bypasses the proxy');
    const rtcOff: string[] = await app.evaluate((({ webContents }: any) => webContents.getAllWebContents().filter((w: any) => w.getType() === 'webview').map((w: any) => w.getWebRTCIPHandlingPolicy())));
    ok(rtcOff.every(p => p === 'default'), 'WebRTC back to default without a proxy: ' + rtcOff.join(','));
  } finally {
    for (const f of [path.join(os.homedir(), 'Downloads', 'file.bin')]) { try { if (fs.statSync(f).size === 200000) fs.unlinkSync(f); } catch {} }
    await app.close(); target.close(); proxy.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
