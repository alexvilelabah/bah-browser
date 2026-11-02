import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { machineProfile, checkBuild } from '../../src/shared/software-download.ts';

// "Baixe a última versão do <programa> pra este computador", em páginas de fabricante FALSAS (locais):
// botão que detecta o SO, lista de builds por SO/CPU, seletor de modelo de impressora e parede de
// login. O agente roteirizado escolhe certo, erra de propósito (o aviso WRONG OS/CPU tem que vir) e,
// na parede de login, Bah pausa — nada é digitado no formulário.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Os builds do "Tool 2.1" da página de lista, e qual é o certo/errado PRA ESTA máquina.
const BUILDS: Array<[string, string]> = [
  ['macOS — Apple Silicon (arm64)', 'Tool-2.1-arm64.dmg'],
  ['macOS — Intel (x64)', 'Tool-2.1-x64.dmg'],
  ['macOS — Universal', 'Tool-2.1-universal.dmg'],
  ['Windows (x64)', 'ToolSetup-2.1-x64.exe'],
  ['Windows (ARM64)', 'ToolSetup-2.1-arm64.exe'],
  ['Linux (.deb, amd64)', 'tool_2.1_amd64.deb'],
  ['Linux (.deb, arm64)', 'tool_2.1_arm64.deb'],
];
const ME = machineProfile({ platform: process.platform, arch: process.arch });
const labelOf = (file: string) => BUILDS.find(b => b[1] === file)![0];
const right = ME.os === 'macos' ? (ME.arch === 'arm64' ? 'Tool-2.1-arm64.dmg' : 'Tool-2.1-x64.dmg')
  : ME.os === 'windows' ? (ME.arch === 'arm64' ? 'ToolSetup-2.1-arm64.exe' : 'ToolSetup-2.1-x64.exe')
  : (ME.arch === 'arm64' ? 'tool_2.1_arm64.deb' : 'tool_2.1_amd64.deb');
const wrongOs = ME.os === 'windows' ? 'Tool-2.1-universal.dmg' : 'ToolSetup-2.1-x64.exe';
// CPU errada no MESMO SO (não roda): só existe pra máquina x64 (num ARM o x64 roda emulado → só aviso).
const wrongCpu = ME.arch !== 'x64' ? '' : ME.os === 'macos' ? 'Tool-2.1-arm64.dmg' : ME.os === 'windows' ? 'ToolSetup-2.1-arm64.exe' : 'tool_2.1_arm64.deb';

test('software download: auto-detect button, OS/CPU list, printer model, sign-in wall', async () => {
  test.setTimeout(240_000);
  const got: string[] = [];
  let signinPosts = 0;
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    if (u.pathname.startsWith('/files/')) {
      got.push(decodeURIComponent(u.pathname.slice(7)) + u.search);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${decodeURIComponent(u.pathname.slice(7))}"` });
      res.end(Buffer.alloc(64 * 1024, 7));
      return;
    }
    if (q.method === 'POST') { signinPosts++; res.end('no'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/steam') {
      // Botão que detecta o SO (como o "Install Steam" de verdade).
      res.end(`<title>About Steam</title><h1>Steam — the ultimate destination for playing games</h1>
<a id="dl" href="#">Download</a>
<script>var p = navigator.platform || ''; var a = document.getElementById('dl');
if (/Mac/.test(p)) { a.textContent = 'Download for Mac'; a.href = '/files/Steam.dmg'; }
else if (/Win/.test(p)) { a.textContent = 'Download for Windows'; a.href = '/files/SteamSetup.exe'; }
else { a.textContent = 'Download for Linux'; a.href = '/files/steam_latest.deb'; }</script>`);
      return;
    }
    if (u.pathname === '/tool') {
      res.end(`<title>Tool 2.1 downloads</title><h1>Download Tool 2.1</h1><p>Choose your operating system and processor.</p>
<ul>${BUILDS.map(([label, file]) => `<li><a href="/files/${file}">${label}</a></li>`).join('')}</ul>`);
      return;
    }
    if (u.pathname === '/printer') {
      res.end(`<title>Printer drivers</title><h1>Software and Drivers for your printer</h1>
<label>Choose your model <select id="m" aria-label="Choose your model"><option value="">— select —</option>
<option>HP OfficeJet Pro 9010e</option><option>HP OfficeJet Pro 9015e</option><option>HP OfficeJet Pro 9020e</option></select></label>
<p id="out"></p>
<script>document.getElementById('m').addEventListener('change', function () {
  var m = this.value; if (!m) return; var mac = /Mac/.test(navigator.platform || '');
  document.getElementById('out').innerHTML = '<a href="/files/' + (mac ? 'HP_Easy_Start.app.zip' : 'HP_Smart_Driver_x64.exe') + '?model=' + encodeURIComponent(m) + '">Download driver</a>';
});</script>`);
      return;
    }
    if (u.pathname === '/cad') {
      res.end(`<title>CAD Pro 2026</title><h1>CAD Pro 2026 — Downloads</h1><p>Get the latest installer.</p><a href="/signin?next=/files/CADPro2026_x64.exe">Download CAD Pro</a>`);
      return;
    }
    if (u.pathname === '/signin') {
      res.end(`<title>Sign in</title><h1>Sign in to download</h1><form method="post"><label>Email <input name="e" type="email"></label>
<label>Password <input name="p" type="password"></label><button>Sign in</button></form><a href="/register">Create account</a>`);
      return;
    }
    res.end('<title>Home</title>home');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-swdl-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-swdl-files-'));
  const script = [
    { type: 'navigate', url: T + 'steam' },
    { type: 'click_ref', ref: '__REF:Download for__' },
    { type: 'navigate', url: T + 'tool' },
    { type: 'click_ref', ref: `__REF:${labelOf(wrongOs)}__` },
    ...(wrongCpu ? [{ type: 'click_ref', ref: `__REF:${labelOf(wrongCpu)}__` }] : []),
    { type: 'click_ref', ref: `__REF:${labelOf(right)}__` },
    { type: 'navigate', url: T + 'printer' },
    { type: 'select_option', ref: '__REF:Choose your model__', option: 'OfficeJet Pro 9015e' },
    { type: 'click_ref', ref: '__REF:Download driver__' },
    { type: 'navigate', url: T + 'cad' },
    { type: 'click_ref', ref: '__REF:Download CAD Pro__' },
    // Na parede de login Bah pausa antes de pedir o próximo passo: este nunca pode ser usado.
    { type: 'fill_ref', ref: '__REF:Password__', text: 'hunter2' },
    { type: 'done', reason: 'Signed in.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dlDir);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('download the latest version of the software for this computer');
    await page.getByTestId('agent-command-input').press('Enter');
    const cont = page.getByTestId('agent-manual-continue');
    for (let i = 0; i < 360 && !(await cont.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await expect(cont).toBeVisible();
    await expect(page.getByText(/download on 127\.0\.0\.1 needs an account/).first()).toBeVisible();
    await sleep(3000);   // pausado: o agente não pede mais passo nenhum
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    const all = ps.join('\n');
    // A máquina e o que escolher, no prompt de download.
    expect(ps[0]).toContain(`THIS COMPUTER: ${ME.osName.split(' ')[0]}`);
    expect(ps[0]).toMatch(/PICK: /);
    // Auto-detect: o arquivo do SO certo, sem aviso.
    const autoFile = ME.os === 'macos' ? 'Steam.dmg' : ME.os === 'windows' ? 'SteamSetup.exe' : 'steam_latest.deb';
    expect(all).toMatch(new RegExp(`DOWNLOAD STARTED[^\\n]*${autoFile.replace('.', '\\.')}`));
    expect(all).not.toMatch(new RegExp(`${autoFile.replace('.', '\\.')}[^\\n]*WRONG`));
    // Escolha errada de propósito: o aviso vem na linha do download.
    expect(all).toMatch(new RegExp(`${wrongOs.replace(/\./g, '\\.')}[^\\n]*WRONG OS`));
    if (wrongCpu) expect(all).toMatch(new RegExp(`${wrongCpu.replace(/\./g, '\\.')}[^\\n]*WRONG CPU`));
    expect(checkBuild(right, ME).level).toBe('');
    expect(all).toMatch(new RegExp(`DOWNLOAD STARTED[^\\n]*${right.replace(/\./g, '\\.')}`));
    expect(all).not.toMatch(new RegExp(`${right.replace(/\./g, '\\.')}[^\\n]*WRONG`));
    // Impressora: o modelo escolhido no seletor é o que foi pedido.
    expect(got.some(g => /model=HP%20OfficeJet%20Pro%209015e|model=HP\+OfficeJet\+Pro\+9015e/.test(g))).toBe(true);
    // Parede de login: pausado, nada digitado nem enviado, e o instalador do CAD não saiu.
    expect(ps.length).toBe(script.length - 2);
    expect(signinPosts).toBe(0);
    expect(got.some(g => g.startsWith('CADPro'))).toBe(false);
    // Nada foi aberto/executado: só os arquivos baixados, na pasta temporária.
    await page.getByTestId('agent-stop').click().catch(() => {});
  } finally {
    await app.close(); server.close();
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true });
  }
});
