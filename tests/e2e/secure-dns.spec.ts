import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// DNS seguro (DoH): o painel ⋮ → Rede e proxy salva a escolha, o main aplica no configureHostResolver
// (lido pelo gancho de teste __e2eSecureDns, só com NODE_ENV=test + E2E_MOCK_AI=1), a escolha sobrevive
// ao reinício, e voltar pro Sistema restaura o padrão do Chromium. Não depende de DoH de verdade na rede.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (c: boolean, m: string) => expect(c, m).toBe(true);

async function launch(tmp: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _n, HTTPS_PROXY: _a, HTTP_PROXY: _b, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' } });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
const hook = (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__e2eSecureDns);
async function openPanel(page: Page) {
  await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Network & proxy' }).click();
  await page.locator('.dns-section').waitFor({ timeout: 5000 });
}

test('secure DNS: preset applied app-wide, persists across restart, back to System', async () => {
  test.setTimeout(120_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dns-'));
  const file = path.join(tmp, 'secure-dns.json');
  let { app, page } = await launch(tmp);
  try {
    // 1. default: System — Bah never touches the resolver
    let h = await hook(app);
    ok(h && h.applied === null && h.calls === 0 && h.setting.mode === 'system', 'default leaves the resolver alone: ' + JSON.stringify(h));
    await openPanel(page);
    ok(await page.locator('.dns-mode').inputValue() === 'system', 'panel shows System');
    // 2. bad custom URL → error, nothing applied
    await page.locator('.dns-mode').selectOption('custom');
    await page.locator('.dns-custom').fill('http://pihole.lan/dns-query');
    await page.locator('.dns-save').click();
    await page.locator('.dns-status', { hasText: 'https' }).waitFor({ timeout: 5000 });
    h = await hook(app); ok(h.applied === null && !fs.existsSync(file), 'http:// rejected, nothing applied: ' + JSON.stringify(h));
    // 3. pick the Quad9 preset, strict on
    await page.locator('.dns-mode').selectOption('preset');
    ok(await page.locator('.dns-preset[data-preset="adguard"] input').isChecked(), 'AdGuard is the first preset, preselected');
    ok(/Ad blocking: yes/.test(await page.locator('.dns-preset[data-preset="adguard"]').innerText()), 'AdGuard row says ad blocking: yes');
    await page.locator('.dns-preset[data-preset="quad9"]').click();
    await page.locator('.dns-strict').check();
    await page.locator('.dns-save').click(); await page.locator('.dns-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    h = await hook(app);
    expect(h.applied).toEqual({ secureDnsMode: 'secure', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ mode: 'preset', preset: 'quad9', strict: true });
    // 4. restart → applied at startup, panel reloads it
    await app.close(); ({ app, page } = await launch(tmp));
    h = await hook(app);
    ok(h.calls === 1 && h.setting.preset === 'quad9', 'applied on startup after restart: ' + JSON.stringify(h));
    expect(h.applied).toEqual({ secureDnsMode: 'secure', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
    await openPanel(page);
    ok(await page.locator('.dns-mode').inputValue() === 'preset' && await page.locator('.dns-preset[data-preset="quad9"] input').isChecked() && await page.locator('.dns-strict').isChecked(), 'panel shows the saved preset + strict');
    // 5. NextDNS with a pasted URL → normalised ID
    await page.locator('.dns-mode').selectOption('nextdns');
    await page.locator('.dns-nextdns').fill('https://dns.nextdns.io/ABC123');
    await page.locator('.dns-strict').uncheck();
    await page.locator('.dns-save').click(); await page.locator('.dns-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    expect((await hook(app)).applied).toEqual({ secureDnsMode: 'automatic', secureDnsServers: ['https://dns.nextdns.io/abc123'] });
    ok(await page.locator('.dns-nextdns').inputValue() === 'abc123', 'panel shows the normalised ID');
    // 6. back to System → Chromium defaults re-applied
    await page.locator('.dns-mode').selectOption('system');
    await page.locator('.dns-save').click(); await page.locator('.dns-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    expect((await hook(app)).applied).toEqual({ secureDnsMode: 'automatic', secureDnsServers: [] });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ mode: 'system' });
    // 7. restart on System → resolver untouched again
    await app.close(); ({ app, page } = await launch(tmp));
    h = await hook(app); ok(h.applied === null && h.calls === 0 && h.setting.mode === 'system', 'System after restart leaves the resolver alone: ' + JSON.stringify(h));
  } finally {
    await app.close().catch(() => {}); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
