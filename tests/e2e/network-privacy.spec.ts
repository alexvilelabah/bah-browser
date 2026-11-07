import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ⋮ → Rede: WebRTC sem vazamento de IP (candidatos ICE de uma página local), avisos de vazamento
// (proxy/DNS só IPv4 num computador com IPv6 — interfaces simuladas por E2E_NET_IFACES), conserto de um
// clique, e WebRTC só IPv4 (field trial no boot → reiniciar). Nada sai da máquina.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (c: boolean, m: string) => expect(c, m).toBe(true);

const GATHER = `<html><head><title>ICE</title></head><body>ice<script>
window.gather = () => new Promise(async (res) => {
  const pc = new RTCPeerConnection({ iceServers: [] }); const c = [];
  pc.createDataChannel('x');
  pc.onicecandidate = (e) => { if (e.candidate) c.push(e.candidate.candidate); else { pc.close(); res(c); } };
  await pc.setLocalDescription(await pc.createOffer());
  setTimeout(() => res(c), 5000);
});</script></body></html>`;
const site = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(GATHER); });

async function launch(tmp: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _n, HTTPS_PROXY: _a, HTTP_PROXY: _b, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test', E2E_NET_IFACES: 'v4,v6' } });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
async function openPanel(page: Page) {
  await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Network & proxy' }).click();
  await page.locator('.net-rtc-section').waitFor({ timeout: 5000 });
}
const closePanel = (page: Page) => page.locator('.proxy-settings .tour-x').click();
const policies = (app: ElectronApplication): Promise<string[]> => app.evaluate(({ webContents }) =>
  webContents.getAllWebContents().filter(w => w.getType() === 'webview').map(w => w.getWebRTCIPHandlingPolicy()));
const gather = (app: ElectronApplication): Promise<string[]> => app.evaluate(async ({ webContents }) => {
  const w = webContents.getAllWebContents().filter(w => w.getType() === 'webview' && w.getTitle() === 'ICE').pop();
  return w ? w.executeJavaScript('gather()') : ['NO-ICE-TAB'];
});
// A candidate "leaks" when it carries a raw interface address (mDNS *.local names are fine).
const rawIps = (c: string[]) => c.map(s => s.split(' ')[4]).filter(a => a && !/\.local$/.test(a));

test('network privacy: WebRTC protects IPs, leak warnings + fixes, IPv4-only WebRTC after restart', async () => {
  test.setTimeout(150_000);
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
  const SITE = `http://127.0.0.1:${(site.address() as net.AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-net-'));
  let { app, page } = await launch(tmp);
  try {
    // 1. default, no proxy: public interface only → no host candidates with real IPs
    const url = page.locator('.url-input'); await url.click(); await url.fill(SITE); await url.press('Enter');
    let c: string[] = ['NO-ICE-TAB'];
    for (let i = 0; i < 20 && c[0] === 'NO-ICE-TAB'; i++) { await sleep(500); c = await gather(app); }
    ok(c[0] !== 'NO-ICE-TAB', 'ICE test tab loaded');
    let pol = await policies(app);
    ok(pol.length > 0 && pol.every(p => p === 'default_public_interface_only'), 'default policy on every tab: ' + pol.join(','));
    ok(rawIps(c).length === 0, 'no interface IPs exposed by default: ' + JSON.stringify(rawIps(c)));
    // 2. nothing configured → no warnings
    await openPanel(page);
    ok(await page.locator('.net-warning').count() === 0, 'no warnings with nothing configured');
    const ipOpts = await page.locator('.net-ip option').evaluateAll(os => os.map(o => `${(o as HTMLOptionElement).value}:${(o as HTMLOptionElement).disabled}`));
    ok(ipOpts.join(',') === 'auto:false,v4:true,v6:true', ipOpts.join(',') + ' — IPv4-only / IPv6-only shown but disabled (unsupported in Electron 44)');
    // 3. override to "Best call quality"
    await page.locator('.net-webrtc').selectOption('default'); await page.locator('.net-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    pol = await policies(app); ok(pol.every(p => p === 'default'), 'override applied live: ' + pol.join(','));
    // 4. IPv4-literal proxy on a (simulated) dual-stack machine → family + WebRTC-bypass warnings
    await page.locator('.proxy-mode').selectOption('manual');
    await page.locator('.proxy-server').fill('192.0.2.10:8080'); await page.locator('.proxy-bypass').fill('<-loopback>');
    await page.locator('.proxy-save').click(); await page.locator('.proxy-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    await page.locator('.net-warning[data-warning="family-proxy"]').waitFor({ timeout: 5000 });
    ok(/only over IPv4.*global IPv6/.test(await page.locator('.net-warning[data-warning="family-proxy"]').innerText()), 'family warning text names IPv4 / IPv6');
    ok(await page.locator('.net-warning[data-warning="webrtc-bypass"]').count() === 1, 'WebRTC-bypass warning with a proxy + override');
    // 5. secure DNS on an IPv4 literal (no strict) → DNS family warning + "behind proxy" info
    await page.locator('.dns-mode').selectOption('custom'); await page.locator('.dns-custom').fill('https://192.0.2.53/dns-query');
    await page.locator('.dns-save').click(); await page.locator('.dns-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    await page.locator('.net-warning[data-warning="family-dns"]').waitFor({ timeout: 5000 });
    ok(await page.locator('.net-warning[data-warning="dns-behind-proxy"]').count() === 1, 'secure DNS behind a proxy: info');
    if (process.env.E2E_SHOT_DIR) {
      await page.locator('.net-warnings').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.E2E_SHOT_DIR, 'network-warnings-window.png') });
      await page.locator('.proxy-settings').screenshot({ path: path.join(process.env.E2E_SHOT_DIR, 'network-warnings-panel.png') });
    }
    // 6. one-click fix: Protect WebRTC → proxy-only UDP, no candidates at all
    await page.locator('.net-warning[data-warning="webrtc-bypass"] .net-fix').click();
    await expect(page.locator('.net-warning[data-warning="webrtc-bypass"]')).toHaveCount(0, { timeout: 5000 });
    ok(await page.locator('.net-webrtc').inputValue() === 'protect', 'select back on Protect');
    pol = await policies(app); ok(pol.every(p => p === 'disable_non_proxied_udp'), 'with a proxy: only UDP through the proxy: ' + pol.join(','));
    c = await gather(app); ok(c.filter(s => / udp /i.test(s)).length === 0 && rawIps(c).length === 0, 'no UDP / no IPs outside the proxy: ' + JSON.stringify(c));
    // 7. clean up proxy + DNS → warnings gone
    await page.locator('.proxy-mode').selectOption('direct'); await page.locator('.proxy-save').click(); await sleep(300);
    await page.locator('.dns-mode').selectOption('system'); await page.locator('.dns-save').click();
    await expect(page.locator('.net-warning')).toHaveCount(0, { timeout: 5000 });
    // 8. IPv4-only WebRTC → "after restart", field trial on next boot
    await page.locator('.net-webrtc-v4').check(); await page.locator('.net-restart').waitFor({ timeout: 5000 });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'network.json'), 'utf8'))).toEqual({ webrtc: 'protect', webrtcIpv4Only: true });
    await closePanel(page);
    await app.close(); ({ app, page } = await launch(tmp));
    const trials = await app.evaluate(({ app }) => app.commandLine.getSwitchValue('force-fieldtrials'));
    ok(trials.includes('WebRTC-IPv6Default/Disabled/'), 'field trial applied at boot: ' + trials);
    await openPanel(page);
    ok(await page.locator('.net-webrtc-v4').isChecked() && await page.locator('.net-restart').count() === 0, 'persisted, no restart note after restart');
  } finally {
    await app.close().catch(() => {}); site.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
