import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

// Gerenciador de senha em extensão (LastPass/Bitwarden/1Password) — com uma extensão LOCAL que imita
// um deles (nada de conta de verdade, nada de senha de ninguém: a "senha" é do formulário de teste).
//  1. auto-login ligado (tipo LastPass: preenche e envia): o agente espera e segue já dentro da conta;
//  2. só preenche (tipo Bitwarden, "Autofill on page load"): o Bah aperta Entrar e segue;
//  3. auto-login desligado: o cartão manda ligar "Auto-login" na extensão; e a interface que ela injeta
//     (iframe chrome-extension:// + ícone no campo) não vira alvo de clique. A extensão entra pelo botão
//     "Adicionar ao Bah" numa página da loja (servida aqui, sem internet).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require('adm-zip');

const FIXTURE_PASSWORD = 'fixture-pw-only-for-this-test';
type Mode = 'submit' | 'fill' | 'off';

// ── A extensão de teste ─────────────────────────────────────────────────────────────
function makeExtension(mode: Mode) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const idBytes = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
  const id = idBytes.toString('hex').replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  const manifest = {
    manifest_version: 3, name: 'FakePass (test)', version: '1.0.0', key: der.toString('base64'),
    background: { service_worker: 'bg.js' },
    permissions: ['storage', 'tabs', 'webNavigation', 'idle', 'offscreen', 'alarms'],
    host_permissions: ['http://127.0.0.1/*'],
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['cs.js'], run_at: 'document_idle' }],
    web_accessible_resources: [{ resources: ['menu.html'], matches: ['http://127.0.0.1/*'] }],
    action: { default_title: 'FakePass', default_popup: 'menu.html' },
  };
  // O background usa o que os gerenciadores de verdade usam logo no começo (webNavigation, windows,
  // idle, offscreen) — antes do calço do Bah, o Bitwarden e o LastPass morriam aqui.
  const bg = `
    chrome.webNavigation.onCommitted.addListener(() => {});
    chrome.windows.onFocusChanged.addListener(() => {});
    chrome.idle.onStateChanged.addListener(() => {});
    chrome.runtime.onMessage.addListener((m, sender, reply) => {
      if (m !== 'hello') return;
      (async () => {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: sender.tab.id });
        if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'test' });
        reply({ ok: true, frames: frames.length, offscreen: await chrome.offscreen.hasDocument(), win: (await chrome.windows.getCurrent()).id });
      })().catch(e => reply({ ok: false, error: String(e) }));
      return true;
    });`;
  const cs = `
    (async () => {
      const r = await chrome.runtime.sendMessage('hello').catch(e => ({ ok: false, error: String(e) }));
      document.documentElement.setAttribute('data-fakepass', JSON.stringify(r));
      const pw = document.querySelector('input[type=password]');
      const user = document.querySelector('input[autocomplete=username]');
      if (!pw || !user) return;
      // Ícone no campo, como o do LastPass (raiz marcada, botão num shadow root fechado).
      const host = document.createElement('div');
      host.setAttribute('data-lastpass-icon-root', '');
      host.style.cssText = 'display:inline-block';
      const b = document.createElement('button');
      b.textContent = 'Fill with FakePass';
      host.attachShadow({ mode: 'closed' }).appendChild(b);
      user.after(host);
      // Menu da extensão num iframe chrome-extension:// por cima da página.
      const f = document.createElement('iframe');
      f.src = chrome.runtime.getURL('menu.html');
      f.style.cssText = 'position:absolute;left:30px;top:220px;width:320px;height:110px;border:1px solid #888;z-index:2147483647;background:#fff';
      document.body.appendChild(f);
      const MODE = ${JSON.stringify(mode)};
      if (MODE === 'off') return;
      setTimeout(() => {
        user.value = 'ada@example.com';
        pw.value = ${JSON.stringify(FIXTURE_PASSWORD)};
        for (const el of [user, pw]) el.dispatchEvent(new Event('input', { bubbles: true }));
        f.remove();
        if (MODE === 'submit') pw.form.requestSubmit();
      }, MODE === 'submit' ? 10000 : 1200);   // devagar o bastante pro agente chegar no formulário e esperar
    })();`;
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest, null, 1),
    'bg.js': bg,
    'cs.js': cs,
    'menu.html': '<!doctype html><meta charset="utf-8"><button>Use login ada@example.com</button> <button>Open FakePass vault</button>',
    'offscreen.html': '<!doctype html><meta charset="utf-8"><p>offscreen</p>',
  };
  return { id, manifest, files };
}

/** Pasta pronta em <userData>/Extensions/<id>/<versão>_0 (como a loja deixa depois de instalar). */
function stageExtension(userData: string, ext: ReturnType<typeof makeExtension>) {
  const dir = path.join(userData, 'Extensions', ext.id, '1.0.0_0');
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(ext.files)) fs.writeFileSync(path.join(dir, f), c);
}

/** .crx (CRX3) com a chave da extensão — o mesmo formato que a loja serve. */
function makeCrx(ext: ReturnType<typeof makeExtension>): Buffer {
  const zip = new AdmZip();
  const files = { ...ext.files, 'manifest.json': JSON.stringify({ ...ext.manifest, key: undefined }) };
  for (const [f, c] of Object.entries(files)) zip.addFile(f, Buffer.from(c));
  const der = Buffer.from(ext.manifest.key, 'base64');
  const varint = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return Buffer.from(o); };
  const field = (no: number, bytes: Buffer) => Buffer.concat([varint(no * 8 + 2), varint(bytes.length), bytes]);
  const idBytes = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, der), field(2, Buffer.alloc(256))])),
    field(10000, field(1, idBytes)),
  ]);
  const pre = Buffer.alloc(12);
  pre.write('Cr24', 0, 'latin1'); pre.writeUInt32LE(3, 4); pre.writeUInt32LE(header.length, 8);
  return Buffer.concat([pre, header, zip.toBuffer()]);
}

// ── O site de teste ──────────────────────────────────────────────────────────────────
function siteServer() {
  const posts: Array<{ user: string; pwOk: boolean }> = [];
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (q.method === 'POST' && q.url === '/login') {
      let body = '';
      q.on('data', c => { body += c; });
      q.on('end', () => {
        const p = new URLSearchParams(body);
        posts.push({ user: p.get('email') || '', pwOk: p.get('password') === FIXTURE_PASSWORD });
        res.statusCode = 303; res.setHeader('Location', '/home'); res.setHeader('Set-Cookie', 'sid=1; Path=/'); res.end();
      });
      return;
    }
    if (q.url === '/home') { res.end('<title>Home - Example</title><h1>Welcome back</h1><a href="/saved">My saved jobs</a> <a href="/logout">Sign out</a>'); return; }
    res.end(`<title>Sign in - Example</title><h1>Sign in</h1><form action="/login" method="post">
<label>Email <input name="email" type="email" autocomplete="username"></label><br>
<label>Password <input name="password" type="password" autocomplete="current-password"></label><br>
<button type="submit">Sign in</button></form>`);
  });
  return { server, posts };
}

async function launch(userData: string, extId: string, kind: string, script: unknown[]): Promise<ElectronApplication> {
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  return electron.launch({
    executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${userData}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test', BAH_TEST_PASSWORD_EXTENSIONS: JSON.stringify({ [extId]: kind }) },
  });
}

async function ready(app: ElectronApplication) {
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  return page;
}

const loaded = (app: ElectronApplication, id: string) => app.evaluate(({ session }, x) => !!session.fromPartition('persist:browser').extensions.getExtension(x as string), id);
const tabEval = (app: ElectronApplication, js: string) => app.evaluate(({ webContents }, code) => {
  const w = webContents.getAllWebContents().filter(x => x.getType() === 'webview').pop()!;
  return w.executeJavaScript(code as string);
}, js);

async function runSignedIn(mode: 'submit' | 'fill', kind: 'lastpass' | 'bitwarden') {
  const { server, posts } = siteServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-pwext-'));
  const ext = makeExtension(mode);
  stageExtension(tmp, ext);
  const app = await launch(tmp, ext.id, kind, [
    { type: 'navigate', url: `${T}login` },
    { type: 'done', reason: 'Opened your saved jobs.', success: true },
  ]);
  try {
    const page = await ready(app);
    for (let i = 0; i < 40 && !(await loaded(app, ext.id)); i++) await sleep(250);
    expect(await loaded(app, ext.id)).toBe(true);
    await page.getByTestId('agent-command-input').fill('open my saved jobs on this site');
    await page.getByTestId('agent-command-input').press('Enter');
    let ps: string[] = [];
    for (let i = 0; i < 160; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      ps = await app.evaluate(() => (global as any).__e2ePrompts || []);
      if (ps.some(p => /SIGN-IN: /.test(p))) break;
      // Nunca pode pausar pedindo login: a extensão é quem entra.
      expect(await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)).toBe(false);
      await sleep(500);
    }
    if (!ps.some(p => /SIGN-IN: /.test(p))) console.log('PROMPTS:\n' + ps.map(p => p.slice(-1500)).join('\n=====\n'));
    expect(ps.some(p => /SIGN-IN: LastPass|SIGN-IN: Bitwarden/.test(p))).toBe(true);
    // A extensão enviou o login uma vez, com a senha dela; o agente não digitou nada e a senha não
    // apareceu pra IA em lugar nenhum.
    expect(posts).toEqual([{ user: 'ada@example.com', pwOk: true }]);
    expect(ps.join('\n')).not.toContain(FIXTURE_PASSWORD);
    expect(await tabEval(app, 'location.pathname')).toBe('/home');
    // O background e o content script da extensão rodaram (calço: webNavigation, windows, offscreen).
    const hello = JSON.parse(String(await tabEval(app, `document.documentElement.getAttribute('data-fakepass') || 'null'`)) || 'null');
    expect(hello).toMatchObject({ ok: true, offscreen: true, win: 1 });
    expect(hello.frames).toBeGreaterThanOrEqual(1);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('password-manager extension with auto-login: the agent waits, never types, and continues signed in', async () => {
  test.setTimeout(150_000);
  await runSignedIn('submit', 'lastpass');
});

test('fill-only extension (Bitwarden "Autofill on page load"): Bah presses Sign in once and continues', async () => {
  test.setTimeout(150_000);
  await runSignedIn('fill', 'bitwarden');
});

test('auto-login off: guidance card names the setting; extension UI is never a click target; "Add to Bah" installs from the store page', async () => {
  test.setTimeout(180_000);
  const { server, posts } = siteServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-pwext-'));
  const ext = makeExtension('off');
  const crx = makeCrx(ext);
  const app = await launch(tmp, ext.id, 'lastpass', [
    { type: 'navigate', url: `${T}login` },
    { type: 'done', reason: 'Stopped.', success: false },
  ]);
  try {
    const page = await ready(app);
    // Loja e download do .crx servidos aqui (sem internet); o "Adicionar?" do Bah responde "Adicionar".
    await app.evaluate(({ session, net, dialog }, [id, b64]) => {
      const ses = session.fromPartition('persist:browser');
      const bytes = Buffer.from(b64 as string, 'base64');
      ses.protocol.handle('https', (req) => {
        const u = new URL(req.url);
        if (u.hostname === 'chromewebstore.google.com') return new Response('<title>FakePass - Chrome Web Store</title><h1>FakePass</h1><p>Switch to Chrome to install extensions and themes</p>', { headers: { 'content-type': 'text/html' } });
        if (u.hostname === 'clients2.google.com' && u.pathname === '/service/update2/crx' && (u.searchParams.get('x') || '').includes(`id=${id}`)) {
          return new Response(bytes, { headers: { 'content-type': 'application/x-chrome-extension' } });
        }
        return net.fetch(req, { bypassCustomProtocolHandlers: true });
      });
      (dialog as any).showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, [ext.id, crx.toString('base64')] as const);
    await app.evaluate(({ webContents }, u) => {
      webContents.getAllWebContents().filter(x => x.getType() === 'webview').pop()!.loadURL(u as string);
    }, `https://chromewebstore.google.com/detail/fakepass/${ext.id}`);
    await expect(page.getByTestId('ext-store-install')).toBeVisible();
    // A identidade e a API da loja continuam como antes (preload da loja registrado, brands com
    // "Google Chrome", webstorePrivate na página da loja) — o botão do Bah não troca nada disso.
    expect(await app.evaluate(({ session }) => session.fromPartition('persist:browser').getPreloadScripts().some(p => p.id === 'bah-webstore'))).toBe(true);
    for (let i = 0; i < 20 && (await tabEval(app, 'typeof (window.chrome && chrome.webstorePrivate)')) !== 'object'; i++) await sleep(250);
    expect(await tabEval(app, 'typeof (window.chrome && chrome.webstorePrivate)')).toBe('object');
    expect(await tabEval(app, `navigator.userAgentData.brands.map(b => b.brand).join('|')`)).toContain('Google Chrome');
    await page.getByTestId('ext-store-install').click();
    for (let i = 0; i < 60 && !(await loaded(app, ext.id)); i++) await sleep(250);
    expect(await loaded(app, ext.id)).toBe(true);
    await expect(page.getByTestId('ext-store-install')).toBeHidden();

    await page.getByTestId('agent-command-input').fill('open my saved jobs on this site');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 120 && !(await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await expect(page.getByTestId('agent-manual-continue')).toBeVisible();
    // O cartão fala do LastPass e da opção certa.
    await expect(page.getByText(/turn on "Auto-login" for this site in LastPass/).last()).toBeVisible();
    expect(posts).toEqual([]);

    // A extensão pôs o ícone e o menu na página…
    expect(await tabEval(app, `!!document.querySelector('[data-lastpass-icon-root]') && !!document.querySelector('iframe[src^="chrome-extension://"]')`)).toBe(true);
    // …e nada disso chega ao agente: nem na árvore da página, nem como iframe.
    const seen = await page.evaluate(async () => {
      const wv: any = Array.from(document.querySelectorAll('webview')).find((w: any) => w.offsetParent !== null) || document.querySelector('webview');
      const id = wv.getWebContentsId();
      const api: any = (window as any).electronAPI;
      const ax = await api.getAxTree(id);
      const fr = await api.getFramesAx(id);
      // O que dá pra clicar (botão, link, item de menu, campo): o rótulo <label> que envolve o ícone soma o
      // texto dele no nome, mas rótulo não é alvo.
      const CLICKABLE = /^(button|link|menuitem|textbox|checkbox|combobox|option|tab)$/;
      const names = (nodes: any[]) => (nodes || []).filter((n: any) => !n.ignored && CLICKABLE.test(String(n?.role?.value || '')))
        .map((n: any) => String(n?.name?.value || '')).filter(Boolean);
      return { page: names(ax.nodes), frames: (fr.frames || []).map((f: any) => ({ label: f.label, names: names(f.nodes) })) };
    });
    expect(seen.page).toContain('Sign in');
    // (O campo "Email" pode levar o texto do ícone no nome — o <label> envolve o ícone —, mas o botão
    // do ícone em si não aparece.)
    const extControl = /^(Fill with FakePass|Use login|Open FakePass vault)/;
    expect(seen.page.filter(n => extControl.test(n))).toEqual([]);
    expect(seen.frames.flatMap(f => f.names).filter(n => extControl.test(n))).toEqual([]);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
