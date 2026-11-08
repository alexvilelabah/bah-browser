import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

// O calço das APIs (extension-shim-preload, preload de SERVICE WORKER) tem que entrar no
// background das extensões MESMO rodando com --no-sandbox. O Electron só roda preload de
// service worker no renderer "sandbox" dele; o processo das extensões não tem webPreferences,
// então só fica nesse modo pelo --enable-sandbox que o main.ts põe. Sem isso, com
// --no-sandbox (o Playwright põe sozinho no Linux; aqui vai explícito pra valer em todo SO),
// o worker nascia sem __bahChromeShim e morria no chrome.omnibox do começo.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extensão MV3 local, com chave (id fixo), em <userData>/Extensions/<id>/1.0.0_0. */
function stageExtension(userData: string) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const id = crypto.createHash('sha256').update(der).digest().subarray(0, 16).toString('hex')
    .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  const manifest = {
    manifest_version: 3, name: 'ShimProbe (test)', version: '1.0.0', key: der.toString('base64'),
    background: { service_worker: 'bg.js' },
    host_permissions: ['http://127.0.0.1/*'],
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['cs.js'], run_at: 'document_idle' }],
    action: { default_title: 'ShimProbe' },
  };
  // Como o Dólar Hoje: chrome.omnibox logo na 1ª linha. Sem o calço, TypeError e o worker
  // morre antes de ouvir o onMessage.
  const bg = `
    chrome.omnibox.onInputEntered.addListener(() => {});
    chrome.runtime.onMessage.addListener((m, _s, reply) => {
      if (m !== 'probe') return;
      reply({ shim: globalThis.__bahChromeShim === true, omnibox: typeof chrome.omnibox, action: typeof chrome.action.setBadgeText });
    });`;
  const cs = `
    chrome.runtime.sendMessage('probe').catch(e => ({ error: String(e) }))
      .then(r => document.documentElement.setAttribute('data-shim-probe', JSON.stringify(r || null)));`;
  const dir = path.join(userData, 'Extensions', id, '1.0.0_0');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'bg.js'), bg);
  fs.writeFileSync(path.join(dir, 'cs.js'), cs);
  return id;
}

const loaded = (app: ElectronApplication, id: string) => app.evaluate(({ session }, x) => !!session.fromPartition('persist:browser').extensions.getExtension(x as string), id);
const tabEval = (app: ElectronApplication, js: string) => app.evaluate(({ webContents }, code) => {
  const w = webContents.getAllWebContents().filter(x => x.getType() === 'webview').pop();
  return w ? w.executeJavaScript(code as string) : null;
}, js);

test('extension background worker gets the API shim even with --no-sandbox', async () => {
  test.setTimeout(90_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>probe</title><p>probe</p>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-swshim-'));
  const extId = stageExtension(tmp);
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: ELECTRON, args: ['--no-sandbox', ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    for (let i = 0; i < 40 && !(await loaded(app, extId)); i++) await sleep(250);
    expect(await loaded(app, extId)).toBe(true);
    for (let i = 0; i < 40 && !(await app.evaluate(({ webContents }) => webContents.getAllWebContents().some(x => x.getType() === 'webview'))); i++) await sleep(250);
    await app.evaluate(({ webContents }, u) => {
      webContents.getAllWebContents().filter(x => x.getType() === 'webview').pop()!.loadURL(u as string);
    }, url);
    let probe: any = null;
    for (let i = 0; i < 60 && !probe; i++) {
      probe = JSON.parse(String(await tabEval(app, `document.documentElement.getAttribute('data-shim-probe') || 'null'`).catch(() => 'null')) || 'null');
      if (!probe) await sleep(250);
    }
    expect(probe).toEqual({ shim: true, omnibox: 'object', action: 'function' });
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
