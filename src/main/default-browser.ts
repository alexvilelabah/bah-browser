// "Bah como navegador padrão" no Electron.
//  1) Links e arquivos que chegam de outros apps viram abas: na 1ª abertura (process.argv), com o
//     Bah já aberto (a 2ª abertura entrega o pedido pra 1ª pelo single-instance lock) e no macOS
//     (open-url/open-file). Ficam na fila até a tela (renderer) avisar que está pronta.
//  2) "Tornar o Bah padrão" (⋮ → Navegador padrão): grava o registro do Windows SÓ no clique e SÓ
//     no Bah instalado, e abre as Configurações — o Windows não deixa app nenhum se fazer padrão
//     sozinho, quem escolhe é a pessoa. No Mac, o próprio sistema pergunta.
// As regras (o que aceitar de fora, o que gravar) são puras e testadas: default-browser-rules.ts.

import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  launchTarget, launchTargets, windowsRegistrationPlan, regAddArgs, regQueryValue, userChoiceKeys,
  isBahDefault, exeMark, EXE_MARK_VALUE, PROG_ID_URL, WINDOWS_SETTINGS_URIS,
  type LaunchEnv, type LaunchTarget,
} from './default-browser-rules';

/** Link/arquivo de fora a caminho de virar aba. launch: foi ele que ABRIU o Bah agora. */
export interface OutsideOpen extends LaunchTarget { launch: boolean }

export interface DefaultBrowserStatus { platform: 'win32' | 'darwin' | 'other'; packaged: boolean; isDefault: boolean }
export type MakeDefaultResult =
  | { ok: true; alreadyDefault?: boolean; openedSettings?: boolean }
  | { ok: false; error: 'dev' | 'unsupported' | 'registry' | 'denied' | 'busy' };

interface OutsideDeps {
  getMainWindow: () => BrowserWindow | null;
  showWindow: () => void;   // traz o Bah pra frente (ou recria a janela no Mac)
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
const envFor = (cwd: string): LaunchEnv => ({ cwd: cwd || process.cwd(), platform: process.platform, isFile });
// Rodando do código-fonte (electron .), o argumento depois do electron.exe é a pasta do app.
const argsOf = (argv: readonly string[], defaultApp: boolean): string[] => argv.slice(defaultApp ? 2 : 1).map(String);

let deps: OutsideDeps | null = null;
let queue: OutsideOpen[] = [];
let rendererReady = false;

function flush(): void {
  const win = deps?.getMainWindow();
  if (!rendererReady || !win || win.isDestroyed() || !queue.length) return;
  const items = queue;
  queue = [];
  for (const it of items) { try { win.webContents.send('outside-open', it); } catch {} }
}

function enqueue(targets: LaunchTarget[], launch: boolean): void {
  if (!targets.length) return;
  for (const t of targets) queue.push({ url: t.url, noScript: t.noScript, launch });
  if (queue.length > 50) queue = queue.slice(-50);
  flush();
}

/** A tela principal começou a (re)carregar: o que chegar fica na fila até ela avisar de novo. */
export function outsideRendererLoading(): void { rendererReady = false; }

/**
 * Liga a entrada de links de fora. Chamar no TOPO do main, antes do 'ready' (o lock e o open-url
 * do macOS precisam disso). false = já tem um Bah aberto neste perfil e o pedido foi entregue a
 * ele — quem chamou sai na hora (app.exit), sem abrir nada.
 */
export function setupOutsideOpen(d: OutsideDeps): boolean {
  deps = d;
  // Um Bah por perfil, igual ao Chrome: abrir de novo (atalho, link de outro app) entrega o pedido
  // pro Bah que já está aberto. Só no Bah INSTALADO: rodando do código-fonte, os testes (Playwright,
  // tools/claude-*.mjs) abrem outro Bah no mesmo perfil de dev e não podem ser engolidos. O lock é
  // por pasta de dados (medido): um perfil de teste com --user-data-dir roda ao lado do normal.
  if (app.isPackaged) {
    if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) return false;
    app.on('second-instance', (_e, argv, workingDirectory, additionalData) => {
      // O argv do evento vem reordenado pelo Chromium (opções antes) e com opções a mais; o
      // additionalData traz o argv EXATO da 2ª abertura. Desconfia dos dois igual: mesmas regras.
      const extra = (additionalData && typeof additionalData === 'object') ? additionalData as { argv?: unknown; cwd?: unknown } : {};
      const exact = Array.isArray(extra.argv) && extra.argv.length < 500 && extra.argv.every(a => typeof a === 'string')
        ? extra.argv as string[] : null;
      const cwd = typeof extra.cwd === 'string' ? extra.cwd : workingDirectory;
      d.showWindow();
      enqueue(launchTargets(argsOf(exact ?? argv, false), envFor(cwd)), false);
    });
  }
  // macOS: link e arquivo chegam por evento — antes do 'ready' também, quando foi o link que abriu o Bah.
  const fromMac = (raw: string) => {
    const t = launchTarget(raw, envFor(process.cwd()));
    if (!t) return;
    const launching = !app.isReady();
    enqueue([t], launching);
    if (!launching) d.showWindow();
  };
  app.on('open-url', (e, url) => { e.preventDefault(); fromMac(url); });
  app.on('open-file', (e, file) => { e.preventDefault(); fromMac(file); });
  // A tela avisa quando já escuta 'outside-open' (só a janela principal vale).
  ipcMain.on('outside-open:ready', (e) => {
    if (e.sender !== deps?.getMainWindow()?.webContents) return;
    rendererReady = true;
    flush();
  });
  // Windows/Linux: o que veio na linha de comando desta abertura (link clicado, arquivo aberto).
  enqueue(launchTargets(argsOf(process.argv, !!process.defaultApp), envFor(process.cwd())), true);
  return true;
}

// ── Windows: reg.exe (por caminho absoluto, argumentos em array — nada passa por shell) ──
const REG_EXE = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe');

function reg(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    try {
      execFile(REG_EXE, args, { windowsHide: true, timeout: 15_000, maxBuffer: 1 << 20 },
        (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? '') }));
    } catch { resolve({ ok: false, stdout: '' }); }
  });
}

async function userChoice(scheme: string): Promise<string | null> {
  for (const key of userChoiceKeys(scheme)) {
    const r = await reg(['query', key, '/v', 'ProgId']);
    const v = r.ok ? regQueryValue(r.stdout, 'ProgId') : null;
    if (v !== null) return v;
  }
  return null;
}

async function windowsIsDefault(): Promise<boolean> {
  const [http, https, mark] = await Promise.all([
    userChoice('http'),
    userChoice('https'),
    reg(['query', `HKCU\\Software\\Classes\\${PROG_ID_URL}`, '/v', EXE_MARK_VALUE]),
  ]);
  const markOk = mark.ok && regQueryValue(mark.stdout, EXE_MARK_VALUE) === exeMark(process.execPath);
  return isBahDefault({ http, https, markOk });
}

async function makeDefaultWindows(description: string): Promise<MakeDefaultResult> {
  let plan;
  try { plan = windowsRegistrationPlan(process.execPath, description); } catch (e) {
    console.warn('[Navegador padrão]', e);
    return { ok: false, error: 'registry' };
  }
  for (const v of plan) {
    const r = await reg(regAddArgs(v));
    if (!r.ok) { console.warn('[Navegador padrão] reg add falhou:', v.key, v.name ?? '(padrão)'); return { ok: false, error: 'registry' }; }
  }
  // Já era o padrão (só faltava atualizar o caminho do Bah.exe): nem abre as Configurações.
  if (await windowsIsDefault()) return { ok: true, alreadyDefault: true };
  for (const uri of WINDOWS_SETTINGS_URIS) {
    try { await shell.openExternal(uri); return { ok: true, openedSettings: true }; } catch {}
  }
  return { ok: true, openedSettings: false };
}

/** IPC do ⋮ → Navegador padrão. t = textos do main (mt). */
export function setupDefaultBrowser(o: { getMainWindow: () => BrowserWindow | null; t: (key: string) => string }): void {
  const platform: DefaultBrowserStatus['platform'] =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'other';

  ipcMain.handle('default-browser:status', async (): Promise<DefaultBrowserStatus> => {
    // Do código-fonte não consulta nada: o padrão do PC é (ou não) o Bah INSTALADO, não este.
    if (!app.isPackaged || platform === 'other') return { platform, packaged: app.isPackaged, isDefault: false };
    try {
      const isDefault = platform === 'win32'
        ? await windowsIsDefault()
        : app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
      return { platform, packaged: true, isDefault };
    } catch { return { platform, packaged: true, isDefault: false }; }
  });

  let busy = false;
  ipcMain.handle('default-browser:make', async (e): Promise<MakeDefaultResult> => {
    if (e.sender !== o.getMainWindow()?.webContents) return { ok: false, error: 'denied' };
    // NUNCA mexe no sistema rodando do código-fonte: o registro apontaria pro electron.exe de dev
    // e trocaria o navegador do PC de quem está testando. Só o Bah instalado grava, no clique.
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    if (platform === 'other') return { ok: false, error: 'unsupported' };
    if (busy) return { ok: false, error: 'busy' };
    busy = true;
    try {
      if (platform === 'win32') return await makeDefaultWindows(o.t('defbrowser.appDescription'));
      // macOS: o sistema mostra "Usar o Bah ou manter o Safari?" — a resposta chega depois (o ⋮
      // reconsulta quando a janela volta a ter foco).
      const ok = app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https');
      return ok ? { ok: true } : { ok: false, error: 'registry' };
    } catch (err) {
      console.warn('[Navegador padrão] falhou:', err);
      return { ok: false, error: 'registry' };
    } finally { busy = false; }
  });
}
