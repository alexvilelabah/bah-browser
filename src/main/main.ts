import { app, BrowserWindow, ipcMain, session, Menu, clipboard, webContents, shell, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import fetch from 'cross-fetch';
import fs from 'fs';
import path from 'path';
import { AIEngine, AIProvider, setEngineLang } from './ai-engine';
import { PageAgent } from './page-agent';
import { downloadVideo, resolveTopVideo, resolveTopVideos, resolveTopNVideos } from './media-downloader';
import { searchVideoCuts } from './video-cuts';
import { fetchTranscript } from './transcript';
import { fetchStockMovers, openDataView, type DataViewSpec } from './data-view';
import { makeSupercut } from './supercut';
import { harvestDownload, generateImages } from './image-harvester';
import { cortarTrecho, removerSilencio, extrairAudio } from './video-editor';
import { enqueueJob } from './job-queue';
import { isHttpUrl, isHttpOrSearch, clampCount, isInsideAllowedRoot, isExistingFile } from './validate';
import * as os from 'os';
import { OVERLAY_DISMISS_SCRIPT } from './overlay-script';
import { decidePopup } from './popup-shield';
import { setupDownloadManager } from './download-manager';
// Idioma que os SITES recebem (Accept-Language, navigator.languages, --lang) — FONTE ÚNICA.
import { LANG_SWITCH, NAV_LANGUAGES, ACCEPT_LANGUAGE } from './site-locale';

// ── i18n do processo principal: menus nativos (clique-direito, Alt) e diálogos
// seguem o idioma do SO, como o Chrome. Base pt/es/en; cai pro inglês. ──
function mainLang(): 'en' | 'pt' | 'es' {
  let l = 'en';
  try { l = (app.getLocale() || 'en').toLowerCase(); } catch {}
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('es')) return 'es';
  return 'en';
}
const MAIN_STRINGS: Record<'en' | 'pt' | 'es', Record<string, string>> = {
  en: {
    'ctx.copy': 'Copy', 'ctx.cut': 'Cut', 'ctx.paste': 'Paste', 'ctx.selectAll': 'Select all',
    'ctx.copyLink': 'Copy link address', 'ctx.reload': 'Reload', 'ctx.inspect': 'Inspect',
    'mnu.navigate': 'Navigate', 'mnu.newTab': 'New tab', 'mnu.closeTab': 'Close tab', 'mnu.reopenTab': 'Reopen tab',
    'mnu.focusUrl': 'Focus address bar', 'mnu.reload': 'Reload', 'mnu.reloadF5': 'Reload (F5)',
    'mnu.back': 'Back', 'mnu.forward': 'Forward', 'mnu.bookmark': 'Add bookmark', 'mnu.find': 'Find in page',
    'mnu.zoomIn': 'Zoom in', 'mnu.zoomOut': 'Zoom out', 'mnu.zoomReset': 'Reset zoom', 'mnu.history': 'History', 'mnu.downloads': 'Downloads',
    'mnu.nextTab': 'Next tab', 'mnu.prevTab': 'Previous tab', 'mnu.tab': 'Tab',
    'upd.title': 'Update available', 'upd.restart': 'Restart now', 'upd.later': 'Later',
    'upd.message': 'A new version ({v}) has been downloaded.',
    'upd.detail': 'Restart to finish updating. Your settings and login are kept.',
    'dlg.pickVideo': 'Choose a video to edit',
  },
  pt: {
    'ctx.copy': 'Copiar', 'ctx.cut': 'Recortar', 'ctx.paste': 'Colar', 'ctx.selectAll': 'Selecionar tudo',
    'ctx.copyLink': 'Copiar endereço do link', 'ctx.reload': 'Recarregar', 'ctx.inspect': 'Inspecionar',
    'mnu.navigate': 'Navegar', 'mnu.newTab': 'Nova aba', 'mnu.closeTab': 'Fechar aba', 'mnu.reopenTab': 'Reabrir aba',
    'mnu.focusUrl': 'Focar endereço', 'mnu.reload': 'Recarregar', 'mnu.reloadF5': 'Recarregar (F5)',
    'mnu.back': 'Voltar', 'mnu.forward': 'Avançar', 'mnu.bookmark': 'Favoritar', 'mnu.find': 'Buscar na página',
    'mnu.zoomIn': 'Aumentar zoom', 'mnu.zoomOut': 'Diminuir zoom', 'mnu.zoomReset': 'Zoom normal', 'mnu.history': 'Histórico', 'mnu.downloads': 'Downloads',
    'mnu.nextTab': 'Próxima aba', 'mnu.prevTab': 'Aba anterior', 'mnu.tab': 'Aba',
    'upd.title': 'Atualização disponível', 'upd.restart': 'Reiniciar agora', 'upd.later': 'Depois',
    'upd.message': 'Uma nova versão ({v}) foi baixada.',
    'upd.detail': 'Reinicie para concluir a atualização. Suas configurações e login são mantidos.',
    'dlg.pickVideo': 'Escolha um vídeo pra editar',
  },
  es: {
    'ctx.copy': 'Copiar', 'ctx.cut': 'Cortar', 'ctx.paste': 'Pegar', 'ctx.selectAll': 'Seleccionar todo',
    'ctx.copyLink': 'Copiar dirección del enlace', 'ctx.reload': 'Recargar', 'ctx.inspect': 'Inspeccionar',
    'mnu.navigate': 'Navegar', 'mnu.newTab': 'Nueva pestaña', 'mnu.closeTab': 'Cerrar pestaña', 'mnu.reopenTab': 'Reabrir pestaña',
    'mnu.focusUrl': 'Enfocar la dirección', 'mnu.reload': 'Recargar', 'mnu.reloadF5': 'Recargar (F5)',
    'mnu.back': 'Atrás', 'mnu.forward': 'Adelante', 'mnu.bookmark': 'Añadir a favoritos', 'mnu.find': 'Buscar en la página',
    'mnu.zoomIn': 'Acercar', 'mnu.zoomOut': 'Alejar', 'mnu.zoomReset': 'Restablecer zoom', 'mnu.history': 'Historial', 'mnu.downloads': 'Descargas',
    'mnu.nextTab': 'Pestaña siguiente', 'mnu.prevTab': 'Pestaña anterior', 'mnu.tab': 'Pestaña',
    'upd.title': 'Actualización disponible', 'upd.restart': 'Reiniciar ahora', 'upd.later': 'Después',
    'upd.message': 'Se ha descargado una nueva versión ({v}).',
    'upd.detail': 'Reinicia para completar la actualización. Tus ajustes y sesión se mantienen.',
    'dlg.pickVideo': 'Elige un vídeo para editar',
  },
};
function mt(key: string, vars?: Record<string, string>): string {
  const L = mainLang();
  let s = MAIN_STRINGS[L][key] || MAIN_STRINGS.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
  return s;
}

let mainWindow: BrowserWindow | null = null;
let aiEngine: AIEngine;
let pageAgent: PageAgent;
let localEngine: AIEngine | null = null;
let localPageAgent: PageAgent | null = null;
// Escudo de popup: timestamps de novas abas por webContents (anti-bombardeio).
const popupTimes = new Map<number, number[]>();

const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const CHROME_MAJOR = CHROME_VERSION.split('.')[0] || '130';
// Keep HTTP UA and JS Client Hints aligned with the Chromium embedded in Electron.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const CHROME_SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Not;A=Brand";v="8", "Chromium";v="${CHROME_MAJOR}"`;
const BROWSER_PARTITION = 'persist:browser';
const GOOGLE_LOGIN_PARTITION = 'persist:google-login';

// Shared ensureDebugger used by CDP handlers AND the hybrid pipeline
// NOTE: only attaches + enables Accessibility — exactly as the original.
// DOM.enable / Page.enable are enabled on-demand inside page-capture.ts.
const debuggerAttachedSet = new Set<number>();
async function sharedEnsureDebugger(wc: Electron.WebContents, wcId: number): Promise<void> {
  if (!debuggerAttachedSet.has(wcId)) {
    try { wc.debugger.attach('1.3'); } catch (err: any) {
      if (!String(err.message).includes('already attached')) throw err;
    }
    debuggerAttachedSet.add(wcId);
    wc.once('destroyed', () => debuggerAttachedSet.delete(wcId));
    await wc.debugger.sendCommand('Accessibility.enable');
  }
}


// Rede de segurança: um erro não tratado no processo PRINCIPAL não pode derrubar o app
// inteiro (ex.: um módulo nativo/lib emitindo um erro assíncrono). Logamos e seguimos,
// em vez de mostrar o diálogo fatal do Electron e fechar tudo.
function logMainError(tag: string, err: unknown): void {
  const msg = (err as any)?.stack || (err as any)?.message || String(err);
  console.error(`[${tag}]`, msg);
  try {
    const logPath = path.join(app.getPath('userData'), 'agent.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} [${tag}] ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', (err) => logMainError('uncaughtException', err));
process.on('unhandledRejection', (reason) => logMainError('unhandledRejection', reason));

async function flushBrowserState(): Promise<void> {
  const sessions = [session.fromPartition(BROWSER_PARTITION), session.fromPartition(GOOGLE_LOGIN_PARTITION), session.defaultSession];
  await Promise.all(sessions.map(async (ses) => {
    try { await ses.cookies.flushStore(); } catch {}
    try { await (ses as any).flushStorageData?.(); } catch {}
  }));
}

function isGoogleCookie(cookie: Electron.Cookie): boolean {
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return domain.endsWith('google.com') ||
    domain.endsWith('google.com.br') ||
    domain.endsWith('youtube.com') ||
    domain.endsWith('googleusercontent.com') ||
    domain.endsWith('gstatic.com');
}

function cookieUrl(cookie: Electron.Cookie): string | null {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!domain) return null;
  const pathPart = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
  return `${cookie.secure ? 'https' : 'http'}://${domain}${pathPart}`;
}

async function clearGoogleCookies(target: Electron.Session): Promise<void> {
  const existing = (await target.cookies.get({})).filter(isGoogleCookie);
  await Promise.all(existing.map(async (cookie) => {
    const url = cookieUrl(cookie);
    if (!url) return;
    try { await target.cookies.remove(url, cookie.name); } catch {}
  }));
}

async function copyGoogleCookies(source: Electron.Session, target: Electron.Session): Promise<number> {
  try { await source.cookies.flushStore(); } catch {}
  const cookies = (await source.cookies.get({})).filter(isGoogleCookie);
  if (!cookies.length) return 0;

  await clearGoogleCookies(target);

  let copied = 0;
  for (const cookie of cookies) {
    const url = cookieUrl(cookie);
    if (!url) continue;
    const details: Electron.CookiesSetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    };
    if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain;
    if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
    if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
    try {
      await target.cookies.set(details);
      copied++;
    } catch (err) {
      console.warn(`[GoogleLogin] cookie copy failed for ${cookie.name}:`, err);
    }
  }

  try { await target.cookies.flushStore(); } catch {}
  try { await (target as any).flushStorageData?.(); } catch {}
  return copied;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findSystemBrowser(): { name: string; exe: string } | null {
  const env = process.env;
  const candidates = [
    { name: 'Google Chrome', exe: path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', exe: path.join(env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', exe: path.join(env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Microsoft Edge', exe: path.join(env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', exe: path.join(env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Brave', exe: path.join(env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
    { name: 'Brave', exe: path.join(env.ProgramFiles || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
  ];
  return candidates.find(c => c.exe && fs.existsSync(c.exe)) || null;
}

function getFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error('no free port')));
    });
  });
}

async function fetchJson(url: string, timeoutMs = 3000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cdpCommand(wsUrl: string, method: string, params: any = {}, timeoutMs = 5000): Promise<any> {
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (!WebSocketCtor) throw new Error('WebSocket unavailable in Node/Electron');

  return await new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000_000);
    const ws = new WebSocketCtor(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', (event: any) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
        const msg = JSON.parse(raw);
        if (msg.id !== id) return;
        cleanup();
        try { ws.close(); } catch {}
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } catch (err) {
        cleanup();
        try { ws.close(); } catch {}
        reject(err);
      }
    });
    ws.addEventListener('error', (err: any) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err?.message || err)));
    });
  });
}

async function getChromeDebugCookies(port: number): Promise<any[]> {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const page = (Array.isArray(targets) ? targets : [])
    .find((t: any) => t.type === 'page' && t.webSocketDebuggerUrl) || targets?.[0];
  if (!page?.webSocketDebuggerUrl) return [];

  try {
    const result = await cdpCommand(page.webSocketDebuggerUrl, 'Network.getAllCookies');
    return Array.isArray(result?.cookies) ? result.cookies : [];
  } catch {
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    if (!version?.webSocketDebuggerUrl) return [];
    const result = await cdpCommand(version.webSocketDebuggerUrl, 'Storage.getCookies');
    return Array.isArray(result?.cookies) ? result.cookies : [];
  }
}

function isGoogleAuthCdpCookie(cookie: any): boolean {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  if (!domain.endsWith('google.com') && !domain.endsWith('google.com.br') && !domain.endsWith('youtube.com')) return false;
  const name = String(cookie?.name || '');
  return /^(SID|HSID|SSID|APISID|SAPISID|LSID|OSID|__Secure-[13]P?SID|__Secure-[13]P?APISID)$/i.test(name);
}

function mapCdpSameSite(value: unknown): Electron.Cookie['sameSite'] | undefined {
  const v = String(value || '').toLowerCase();
  if (v === 'strict') return 'strict';
  if (v === 'lax') return 'lax';
  if (v === 'none' || v === 'no_restriction') return 'no_restriction';
  return undefined;
}

async function copyCdpGoogleCookies(cdpCookies: any[], target: Electron.Session): Promise<number> {
  const googleCookies = cdpCookies.filter((cookie) => isGoogleCookie({
    domain: cookie.domain,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
  } as Electron.Cookie));
  if (!googleCookies.length) return 0;

  await clearGoogleCookies(target);

  let copied = 0;
  for (const cookie of googleCookies) {
    const domain = String(cookie.domain || '').replace(/^\./, '');
    if (!domain || !cookie.name) continue;
    const details: Electron.CookiesSetDetails = {
      url: `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`,
      name: String(cookie.name),
      value: String(cookie.value || ''),
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: !!cookie.secure,
      httpOnly: !!cookie.httpOnly,
    };
    if (!cookie.session && Number.isFinite(cookie.expires) && cookie.expires > 0) details.expirationDate = cookie.expires;
    const sameSite = mapCdpSameSite(cookie.sameSite);
    if (sameSite) details.sameSite = sameSite;
    try {
      await target.cookies.set(details);
      copied++;
    } catch (err) {
      console.warn(`[GoogleLogin] CDP cookie copy failed for ${cookie.name}:`, err);
    }
  }
  try { await target.cookies.flushStore(); } catch {}
  try { await (target as any).flushStorageData?.(); } catch {}
  return copied;
}

async function importGoogleCookiesFromBrowserProfile(
  browser: { name: string; exe: string },
  profileDir: string,
): Promise<{ ok: boolean; copied?: number; browser?: string; error?: string }> {
  const port = await getFreeLocalPort();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];

  const child = require('child_process').spawn(browser.exe, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });

  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', (err: Error) => {
    console.warn('[GoogleLogin] import browser launch failed:', err);
  });

  try {
    const readyBy = Date.now() + 18_000;
    let ready = false;
    while (Date.now() < readyBy) {
      if (exited) return { ok: false, browser: browser.name, error: `${browser.name} closed before the import.` };
      try {
        await fetchJson(`http://127.0.0.1:${port}/json/version`, 1200);
        ready = true;
        break;
      } catch {
        await sleepMs(350);
      }
    }

    if (!ready) {
      return {
        ok: false,
        browser: browser.name,
        error: `Couldn't open the profile in import mode. Close the ${browser.name} window used for login and try again.`,
      };
    }

    const cookies = await getChromeDebugCookies(port);
    if (!cookies.some(isGoogleAuthCdpCookie)) {
      return {
        ok: false,
        browser: browser.name,
        error: `I still couldn't find Google login cookies in this ${browser.name} profile.`,
      };
    }

    const copied = await copyCdpGoogleCookies(cookies, session.fromPartition(BROWSER_PARTITION));
    await flushBrowserState();
    return { ok: copied > 0, copied, browser: browser.name };
  } finally {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
      if (version?.webSocketDebuggerUrl) await cdpCommand(version.webSocketDebuggerUrl, 'Browser.close', {}, 1200);
    } catch {
      try { child.kill(); } catch {}
    }
  }
}

async function loginWithSystemBrowser(): Promise<{ ok: boolean; copied?: number; browser?: string; error?: string }> {
  const browser = findSystemBrowser();
  if (!browser) {
    return { ok: false, error: 'Could not find Chrome, Edge or Brave installed.' };
  }

  const profileDir = path.join(app.getPath('userData'), 'google-system-login-profile');
  // Perfil de login é DESCARTÁVEL: limpa antes de abrir pra cair numa tela de login
  // FRESCA toda vez. Sem isso, o login anterior fica salvo neste perfil → o Chrome reabre
  // já logado, o app detecta o cookie SID nos primeiros 2,5s e fecha a janela na hora
  // ("abre e fecha rapidinho"), sem deixar o usuário logar de novo / trocar de conta.
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(profileDir, { recursive: true });

  // Abre o navegador real JÁ com a porta de debug ligada, direto na tela de login.
  // O app fica VIGIANDO os cookies; quando o login termina, importa e fecha o Chrome
  // SOZINHO — sem o usuário precisar fechar a janela nem clicar em "importar".
  const port = await getFreeLocalPort();
  const loginUrl = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F';
  const child = require('child_process').spawn(browser.exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    loginUrl,
  ], { detached: false, stdio: 'ignore', windowsHide: false });

  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', (err: Error) => { console.warn('[GoogleLogin] system browser launch failed:', err); });

  const closeLoginBrowser = async () => {
    try {
      const v = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
      if (v?.webSocketDebuggerUrl) { await cdpCommand(v.webSocketDebuggerUrl, 'Browser.close', {}, 1500); return; }
    } catch {}
    try { child.kill(); } catch {}
  };

  // 1) Espera a porta de debug subir.
  const readyBy = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < readyBy && !exited) {
    try { await fetchJson(`http://127.0.0.1:${port}/json/version`, 1200); ready = true; break; }
    catch { await sleepMs(400); }
  }
  if (!ready) {
    await closeLoginBrowser();
    return { ok: false, browser: browser.name, error: `Couldn't open ${browser.name} for the login.` };
  }

  // 2) Detecta SOZINHO o fim do login: polla os cookies até aparecer a sessão do Google
  //    (ou até o usuário fechar a janela / dar timeout de 5 min).
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (exited) {
      // usuário fechou a janela na mão → tenta importar do perfil por garantia
      const after = await importGoogleCookiesFromBrowserProfile(browser, profileDir);
      return after.ok ? after : { ok: false, browser: browser.name, error: 'Window closed before completing the login.' };
    }
    let cookies: any[] = [];
    try { cookies = await getChromeDebugCookies(port); } catch {}
    if (cookies.some(isGoogleAuthCdpCookie)) {
      const copied = await copyCdpGoogleCookies(cookies, session.fromPartition(BROWSER_PARTITION));
      await flushBrowserState();
      await closeLoginBrowser();   // fecha o Chrome de login automaticamente
      return { ok: copied > 0, copied, browser: browser.name };
    }
    await sleepMs(2500);
  }
  await closeLoginBrowser();
  return { ok: false, browser: browser.name, error: 'Timed out waiting for the login.' };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#0d0d12',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const isDev = !app.isPackaged && !require('fs').existsSync(rendererPath);
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(rendererPath);
  }

  // Segura o fechamento ATÉ gravar os cookies (login do Google etc.) em disco.
  // Sem o preventDefault, a janela fechava na hora e o flush não terminava → reabria
  // DESLOGADO (pior quando aberto pelo .bat, que desliga abrupto). Agora é confiável.
  let cookiesFlushedOnClose = false;
  mainWindow.on('close', (e) => {
    if (cookiesFlushedOnClose) return;   // 2ª passada: deixa fechar de verdade
    e.preventDefault();
    (async () => {
      try {
        await flushBrowserState();
      } catch {}
      cookiesFlushedOnClose = true;
      try { mainWindow?.close(); } catch {}
    })();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // F12 toggles DevTools
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Forward renderer console messages to main process logs (visible in terminal + file)
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (message.startsWith('[Agent]') || message.startsWith('[DeepSeek]')) {
      console.log(`[renderer] ${message}`);
      try {
        const logPath = path.join(app.getPath('userData'), 'agent.log');
        fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
      } catch {}
    }
  });

  // Right-click context menu on main window (renderer UI)
  attachContextMenu(mainWindow.webContents);

  // Attach context menu + popup-as-new-tab handler + UA override to webviews when they're created
  mainWindow.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setUserAgent(CHROME_UA);
    // Fundo ESCURO do webview antes da página pintar — mata o "flash branco" ao abrir aba/site novo
    // (a UI é escura; sem isto o Chromium pinta BRANCO até o 1º frame da página). Igual ao Chrome.
    try { (wc as any).setBackgroundColor('#121214'); } catch {}
    // Inject stealth script before each navigation to mask Electron/automation signals
    wc.on('dom-ready', () => {
      if (!/accounts\.google\.com|accounts-google\.com/i.test(wc.getURL())) {
        wc.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      }
      // Segue "Você quis dizer X?" sozinho em qualquer busca (Google/YouTube/Bing/DuckDuckGo).
      wc.executeJavaScript(AUTOCORRECT_SCRIPT).catch(() => {});
    });
    attachContextMenu(wc);
    // Ctrl + roda do mouse = zoom (igual ao Chrome). O Chromium dispara 'zoom-changed'
    // com a direção quando o mouse está sobre a página; aplicamos no próprio webContents
    // (limites 30%–300%). Cada aba tem seu webContents → zoom por aba, naturalmente.
    wc.on('zoom-changed', (_e, dir) => {
      const cur = wc.getZoomFactor();
      const next = Math.max(0.3, Math.min(3, Math.round((cur + (dir === 'in' ? 0.1 : -0.1)) * 100) / 100));
      wc.setZoomFactor(next);
      mainWindow?.webContents.send('app:zoom', Math.round(next * 100));   // badge na tela
    });
    // Intercept popup window requests and forward to renderer to open as new tab
    wc.setWindowOpenHandler((details) => {
      const url = details.url;
      if (!url || url === 'about:blank') return { action: 'deny' };
      // Safe browsing na popup
      try {
        const u = new URL(url);
        if (maliciousHosts.has(u.hostname)) {
          mainWindow?.webContents.send('safe-browsing-block', { url, host: u.hostname });
          return { action: 'deny' };
        }
      } catch { return { action: 'deny' }; }   // URL inválida → bloqueia
      // ESCUDO DE POPUP (genérico, todo site): aba real do usuário passa; popup de
      // anúncio (window.open com features) e rajadas são descartados — não viram aba.
      const now = Date.now();
      const recent = (popupTimes.get(wc.id) || []).filter(t => now - t < 4000);
      const decision = decidePopup(details.disposition || '', details.features || '', recent.length);
      if (!decision.open) {
        console.log(`[Popup] bloqueado (${decision.reason}): ${url.slice(0, 80)}`);
        popupTimes.set(wc.id, recent);
        return { action: 'deny' };
      }
      recent.push(now);
      popupTimes.set(wc.id, recent);
      mainWindow?.webContents.send('open-new-tab', url);
      return { action: 'deny' };
    });
    wc.once('destroyed', () => popupTimes.delete(wc.id));
    // Safe browsing on main-frame navigation
    wc.on('will-navigate', (e, url) => {
      try {
        const u = new URL(url);
        if (maliciousHosts.has(u.hostname)) {
          e.preventDefault();
          mainWindow?.webContents.send('safe-browsing-block', { url, host: u.hostname });
        }
      } catch {}
    });
  });
}

function attachContextMenu(wc: Electron.WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const hasSelection = !!params.selectionText;
    const isEditable = params.isEditable;
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (hasSelection) {
      template.push({ label: mt('ctx.copy'), role: 'copy' });
    }
    if (isEditable) {
      template.push({ label: mt('ctx.cut'), role: 'cut', enabled: hasSelection });
      template.push({ label: mt('ctx.paste'), role: 'paste' });
      template.push({ label: mt('ctx.selectAll'), role: 'selectAll' });
    } else if (hasSelection) {
      template.push({ label: mt('ctx.selectAll'), role: 'selectAll' });
    }

    if (params.linkURL) {
      if (template.length) template.push({ type: 'separator' });
      template.push({
        label: mt('ctx.copyLink'),
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (template.length) template.push({ type: 'separator' });
    template.push({ label: mt('ctx.reload'), click: () => wc.reload() });
    template.push({ label: mt('ctx.inspect'), click: () => wc.inspectElement(params.x, params.y) });

    Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined });
  });
}

function setupIPC(): void {
  // Helpers de "humanização" do input (jitter de tempo/trajeto) — DOR 3.
  const rnd = (min: number, max: number) => min + Math.random() * (max - min);
  const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  // Sugestoes da barra de endereco (Google Suggest, estilo Chrome) — fetch no MAIN pra nao
  // esbarrar em CORS. Sem chave. hl segue o idioma da UI. Offline/erro -> [] (cai so nas locais).
  ipcMain.handle('suggest:query', async (_e, q: string) => {
    try {
      const query = (q || '').trim();
      if (!query || /^https?:\/\//i.test(query)) return [];
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 3000);
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(LANG_SWITCH)}&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: ctrl.signal } as any).finally(() => clearTimeout(tm));
      if (!res.ok) return [];
      const data = JSON.parse(await res.text());
      return Array.isArray(data?.[1]) ? data[1].slice(0, 6).map((s: any) => String(s)) : [];
    } catch { return []; }
  });

  // AI configuration
  ipcMain.handle('ai:set-provider', async (_event, provider: AIProvider, apiKey: string, baseUrl?: string) => {
    // Sem chave → cai no Pollinations (grátis, keyless) em vez de quebrar: o app
    // funciona de cara pra quem nunca configurou. Com chave, usa o provedor escolhido.
    aiEngine = (apiKey?.trim() || provider === 'pollinations')
      ? new AIEngine(provider, apiKey, baseUrl)
      : new AIEngine('pollinations', '');
    pageAgent = new PageAgent(aiEngine);
    return { success: true };
  });

  // i18n Fase 2: idioma em que o agente fala com o usuário (segue a UI). Vale pra
  // nuvem E local (engineLang é do módulo ai-engine, compartilhado).
  ipcMain.handle('ai:set-lang', async (_event, lang: string) => {
    setEngineLang(lang);
    // Persiste a escolha de idioma pra o BOOT ajustar o Accept-Language (--lang) na próxima
    // vez — assim os sites seguem o idioma escolhido (igual ao Chrome). Aplica no restart.
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'ui-lang.flag'), lang); } catch {}
    return { success: true };
  });

  // Local (GPU) model configuration
  ipcMain.handle('ai:set-local-provider', async (_event, provider: AIProvider, apiKey: string, baseUrl?: string, modelName?: string) => {
    localEngine = new AIEngine(provider, apiKey || 'local', baseUrl, modelName);
    localPageAgent = new PageAgent(localEngine);
    console.log(`[HybridRouter] Local engine set: ${provider} model=${modelName || 'default'} @ ${baseUrl || 'default'}`);
    // Pré-aquece o modelo na VRAM (fire-and-forget) pra a 1ª tarefa já vir quente.
    localEngine.warmupOllama().catch(() => {});
    return { success: true };
  });

  // AI chat — general conversation / page Q&A
  ipcMain.handle('ai:chat', async (_event, message: string, pageContent?: string, stateless?: boolean, local?: boolean, tabId?: string) => {
    // Em modo IA Local, chat e pesquisa usam o MODELO LOCAL (offline, sem chave).
    // Só cai na nuvem quando o modo local está desligado.
    const engine = (local && localEngine) ? localEngine : aiEngine;
    if (!engine) return { error: 'AI not configured. Open the settings.' };
    try {
      const response = await engine.chat(message, pageContent, stateless, tabId);
      return { response };
    } catch (err: any) {
      const m = err?.message ?? String(err);
      if (local) return { error: `Local AI failed: ${m}. Make sure Ollama is open and a model is downloaded and selected.` };
      if (/401|403|api.?key|unauthorized|invalid.*key|\bsk-/i.test(m)) {
        return { error: 'The cloud (DeepSeek) needs an API key. Paste the key in settings OR switch to 🏠 Local AI (offline, no key).' };
      }
      return { error: m };
    }
  });

  // Limpa o histórico de chat de UMA aba (ao fechar a aba ou limpar o feed) nos dois
  // engines (nuvem + local), pra não vazar memória de chat entre abas.
  ipcMain.handle('ai:clear-history', async (_event, tabId?: string) => {
    aiEngine?.clearHistory(tabId);
    localEngine?.clearHistory(tabId);
    return { ok: true };
  });

  // AI agent action — hybrid routing: 'local' → localEngine, 'flash'/'pro' → mainEngine
  ipcMain.handle('ai:action', async (_event, command: string, pageContent?: string, screenshot?: string, tier?: 'local' | 'flash' | 'pro') => {
    if (process.env.E2E_MOCK_AI === '1') {
      return {
        thought: 'E2E mock: confirming the current browser state.',
        evaluation: 'Success - e2e mock response',
        action: { type: 'done', reason: 'E2E mock completed the task.', success: true },
        _engine: 'e2e-mock',
        metrics: { latencyMs: 1, model: 'e2e-mock', usage: { prompt_tokens: 0, completion_tokens: 0 } },
      };
    }
    const resolvedTier = tier ?? 'pro';
    // Route to local engine if requested AND local is configured
    if (resolvedTier === 'local' && localPageAgent) {
      try {
        const result = await localPageAgent.executeCommand(command, pageContent, screenshot, 'flash');
        if (result.error) throw new Error(result.error);
        return { ...result, _engine: 'local' };
      } catch (err: any) {
        // PRIVACIDADE: em modo local a falha do Ollama NÃO vaza pra nuvem. Em vez de mandar
        // o conteúdo da página pro DeepSeek/Pollinations sem avisar, devolve um erro claro —
        // o modo local fica offline de verdade. (Trocar de provedor é escolha explícita do usuário.)
        const msg = err?.message ?? String(err);
        console.warn('[HybridRouter] Local engine failed (local mode stays offline, no cloud fallback):', msg);
        return { error: `Local AI (Ollama) failed: ${msg}. Local mode stays offline — start Ollama or switch to a cloud provider in settings.` };
      }
    }
    if (!pageAgent) return { error: 'AI provider not configured. Open settings to configure.' };
    try {
      const result = await pageAgent.executeCommand(command, pageContent, screenshot, resolvedTier === 'local' ? 'flash' : resolvedTier);
      return { ...result, _engine: resolvedTier };
    } catch (err: any) {
      return { error: err.message ?? String(err) };
    }
  });

  // ═══ Gerenciador de modelos Ollama (modo local) ═══════════════════════════
  // Deixa o usuário listar / baixar (pelo NOME, ex.: "qwen3:14b") / apagar / importar
  // um .gguf — tudo pela UI, sem terminal. Assim, IA nova = só digitar o nome (não
  // precisa atualizar o app). NÃO toca o caminho da API/nuvem.
  // Normaliza pra IPv4: no Windows `localhost` pode resolver pra IPv6 `::1`, mas o
  // Ollama escuta só em `127.0.0.1` → conexão recusada. Forçar 127.0.0.1 elimina isso
  // (cobre list/pull/delete de uma vez, sem migrar settings salvos do usuário).
  const ollamaUrl = (b?: string) =>
    (b || 'http://localhost:11434').replace(/\/$/, '').replace(/(\/\/)localhost(\b|:)/i, '$1127.0.0.1$2');
  ipcMain.handle('ollama:list', async (_e, baseUrl?: string) => {
    try {
      const r = await fetch(`${ollamaUrl(baseUrl)}/api/tags`);
      if (!r.ok) return { ok: false, error: `status ${r.status}`, models: [] };
      const data = await r.json();
      const models = (data.models || []).map((m: any) => ({
        name: m.name,
        sizeGB: m.size ? +(m.size / 1e9).toFixed(1) : 0,
        params: m.details?.parameter_size || '',
        quant: m.details?.quantization_level || '',
      }));
      return { ok: true, models };
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e), models: [] }; }
  });
  ipcMain.handle('ollama:delete', async (_e, model: string, baseUrl?: string) => {
    try {
      const r = await fetch(`${ollamaUrl(baseUrl)}/api/delete`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      });
      return { ok: r.ok, error: r.ok ? undefined : `status ${r.status}` };
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  // Garante o Ollama RODANDO: se já responde, ok; senão tenta SUBIR sozinho
  // (`ollama serve`) e espera ele responder. Assim o usuário não precisa abrir o app
  // na mão. Se nem o executável existir (ENOENT) → não instalado.
  ipcMain.handle('ollama:ensure-running', async (_e, baseUrl?: string) => {
    const base = ollamaUrl(baseUrl);
    const ping = async () => { try { const r = await fetch(`${base}/api/tags`); return r.ok; } catch { return false; } };
    if (await ping()) return { ok: true, already: true };
    // Acha o executável: caminho padrão do instalador no Windows, senão PATH.
    const localApp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : '';
    const exe = (localApp && fs.existsSync(localApp)) ? localApp : 'ollama';
    let spawnErr = '';
    try {
      const child = require('child_process').spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (er: any) => { spawnErr = String(er?.message ?? er); });
      child.unref();
    } catch (er: any) { spawnErr = String(er?.message ?? er); }
    // Espera o servidor subir (~10s).
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 750));
      if (await ping()) return { ok: true, started: true };
    }
    const notInstalled = /ENOENT/i.test(spawnErr);
    return { ok: false, notInstalled, error: spawnErr || 'timeout' };
  });
  // Pull com PROGRESSO (stream de linhas JSON) — usa Node http direto (streaming confiável).
  // Guarda a requisição ativa pra permitir CANCELAR (destruir a conexão → o Ollama
  // aborta o download). Só um pull por vez na UI, então uma var basta.
  let activePull: { req: any; canceled: boolean } | null = null;
  ipcMain.handle('ollama:pull', async (e, model: string, baseUrl?: string) => {
    const u = new URL(`${ollamaUrl(baseUrl)}/api/pull`);
    const send = (p: any) => { try { e.sender.send('ollama:pull-progress', { model, ...p }); } catch {} };
    return await new Promise((resolve) => {
      let settled = false;
      let req: any = null;
      const finish = (result: any, progress?: any) => {
        if (settled) return; settled = true;
        if (progress) send(progress);
        if (activePull && activePull.req === req) activePull = null;
        resolve(result);
      };
      try {
        const http = require('http');
        req = http.request(
          { hostname: u.hostname, port: u.port || 11434, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res: any) => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buf += chunk;
              let nl: number;
              while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                if (!line) continue;
                try {
                  const o = JSON.parse(line);
                  const pct = o.total ? Math.round((o.completed || 0) / o.total * 100) : undefined;
                  send({ status: o.status, completed: o.completed, total: o.total, percent: pct });
                  if (o.error) send({ done: true, error: o.error });
                } catch {}
              }
            });
            res.on('end', () => finish({ ok: true }, { done: true }));
          },
        );
        activePull = { req, canceled: false };
        req.on('error', (err: any) => {
          if (activePull?.canceled) finish({ ok: false, canceled: true }, { done: true, canceled: true });
          else finish({ ok: false, error: String(err?.message ?? err) }, { done: true, error: String(err?.message ?? err) });
        });
        // destroy() pode emitir só 'close' (sem 'error') — cobre o cancelamento.
        req.on('close', () => { if (activePull?.canceled) finish({ ok: false, canceled: true }, { done: true, canceled: true }); });
        req.write(JSON.stringify({ model, stream: true }));
        req.end();
      } catch (e2: any) { finish({ ok: false, error: String(e2?.message ?? e2) }, { done: true, error: String(e2?.message ?? e2) }); }
    });
  });
  // Cancela o download em andamento (destrói a conexão → Ollama aborta o pull).
  ipcMain.handle('ollama:pull-cancel', async () => {
    if (activePull) { activePull.canceled = true; try { activePull.req.destroy(); } catch {} return { ok: true }; }
    return { ok: false };
  });
  // Importar um .gguf por CAMINHO (modelo fora do catálogo / baixado na mão via IDM).
  // Roda `ollama create <nome> -f <Modelfile>` com `FROM <caminho>`.
  ipcMain.handle('ollama:import-gguf', async (_e, name: string, ggufPath: string) => {
    try {
      if (!ggufPath || !fs.existsSync(ggufPath)) return { ok: false, error: '.gguf not found at this path' };
      const mf = path.join(app.getPath('temp'), `Modelfile_${Date.now()}`);
      fs.writeFileSync(mf, `FROM ${ggufPath.replace(/\\/g, '/')}\n`);
      return await new Promise((resolve) => {
        const child = require('child_process').spawn('ollama', ['create', name || `local-${Date.now()}`, '-f', mf], { windowsHide: true, env: { ...process.env } });
        let err = '';
        child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
        child.on('error', (e2: any) => resolve({ ok: false, error: String(e2?.message ?? e2) }));
        child.on('close', (code: number) => { try { fs.unlinkSync(mf); } catch {} resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(-300) || `exit ${code}` }); });
        setTimeout(() => { try { child.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 600000);
      });
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  });

  // Execute JS directly (from agent or user)
  // ═══ Real OS-level mouse input (Comet-style) ═══
  ipcMain.handle('input:click', async (_e, wcId: number, x: number, y: number, backendNodeId?: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { success: false, error: 'webContents not found' };
    try {
      wc.focus();
      // Re-resolve FRESCO da caixa do alvo pelo backendNodeId (estável a reflow). É chamado
      // no ÚLTIMO instante antes do mouseDown: se a janela mudou de tamanho DURANTE o trajeto
      // do clique, o alvo acompanha o novo layout e o clique não erra. Sem backendNodeId
      // (click_at / click_text) retorna null e o comportamento é IDÊNTICO ao de antes.
      const resolveCenter = async (): Promise<{ x: number; y: number } | null> => {
        if (backendNodeId == null) return null;
        try {
          await sharedEnsureDebugger(wc, wcId);
          const r = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId }) as any;
          const q = r?.model?.border;
          if (q && q.length === 8) {
            const xs = [q[0], q[2], q[4], q[6]]; const ys = [q[1], q[3], q[5], q[7]];
            return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
          }
        } catch { /* alvo sumiu/erro → cai no x,y recebido */ }
        return null;
      };
      // Humanizado: leve desvio do centro (±2px) + trajeto curto com easing + jitter.
      const tx0 = Math.round(x + rnd(-2, 2));
      const ty0 = Math.round(y + rnd(-2, 2));
      const sx = Math.max(0, Math.round(tx0 - rnd(40, 90)));
      const sy = Math.max(0, Math.round(ty0 - rnd(25, 60)));
      const steps = 4 + Math.floor(rnd(0, 3));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const e = t * t * (3 - 2 * t); // smoothstep
        wc.sendInputEvent({ type: 'mouseMove', x: Math.round(sx + (tx0 - sx) * e), y: Math.round(sy + (ty0 - sy) * e) } as any);
        await sleepMs(rnd(8, 22));
      }
      // ÚLTIMO instante: re-resolve a posição (pega resize/scroll ocorrido no trajeto).
      const fresh = await resolveCenter();
      const tx = fresh ? Math.round(fresh.x + rnd(-2, 2)) : tx0;
      const ty = fresh ? Math.round(fresh.y + rnd(-2, 2)) : ty0;
      wc.sendInputEvent({ type: 'mouseMove', x: tx, y: ty } as any);
      await sleepMs(rnd(30, 70));
      wc.sendInputEvent({ type: 'mouseDown', x: tx, y: ty, button: 'left', clickCount: 1 } as any);
      await sleepMs(rnd(60, 130));
      wc.sendInputEvent({ type: 'mouseUp', x: tx, y: ty, button: 'left', clickCount: 1 } as any);
      return { success: true, info: { x: tx, y: ty, refreshed: !!fresh } };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('input:type', async (_e, wcId: number, text: string) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { success: false, error: 'webContents not found' };
    try {
      wc.focus();
      // Humanizado: cadência variável por tecla + pausa ocasional após espaço/pontuação.
      // Mesmo texto digitado; só o ritmo muda (menos "robô"). Textos longos = ritmo menor.
      const s = String(text);
      const longText = s.length > 60;
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' } as any);
          wc.sendInputEvent({ type: 'char', keyCode: 'Enter' } as any);
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' } as any);
        } else {
          wc.sendInputEvent({ type: 'char', keyCode: ch } as any);
        }
        let d = longText ? rnd(10, 28) : rnd(25, 70);
        if (/[\s.,!?;:]/.test(ch) && Math.random() < 0.35) d += rnd(120, 300);
        await sleepMs(d);
      }
      return { success: true, info: { typed: s.length } };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('input:key', async (_e, wcId: number, key: string) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { success: false, error: 'webContents not found' };
    try {
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: key } as any);
      wc.sendInputEvent({ type: 'char', keyCode: key } as any);
      wc.sendInputEvent({ type: 'keyUp', keyCode: key } as any);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Accessibility tree via CDP (Comet-style semantic tree) ═══
  // Uses the shared ensureDebugger (also enables DOM + Page domains for the hybrid pipeline)
  const ensureDebugger = sharedEnsureDebugger;

  ipcMain.handle('cdp:axtree', async (_e, wcId: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { error: 'webContents not found' };
    try {
      await ensureDebugger(wc, wcId);
      const result = await wc.debugger.sendCommand('Accessibility.getFullAXTree') as any;
      return { ok: true, nodes: result.nodes };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });

  // ═══ Resolve backendNodeId → bounding box via CDP DOM.getBoxModel ═══
  ipcMain.handle('cdp:node-coords', async (_e, wcId: number, backendNodeIds: number[]) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { error: 'webContents not found' };
    try {
      await ensureDebugger(wc, wcId);
      const results: Record<number, { x: number; y: number; w: number; h: number } | null> = {};
      // Resolve in parallel (up to 30 at a time to avoid overwhelming CDP)
      const BATCH = 30;
      for (let i = 0; i < backendNodeIds.length; i += BATCH) {
        const batch = backendNodeIds.slice(i, i + BATCH);
        await Promise.all(batch.map(async (id) => {
          try {
            const r = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: id }) as any;
            const quad = r?.model?.border; // [x1,y1, x2,y2, x3,y3, x4,y4]
            if (quad && quad.length === 8) {
              const xs = [quad[0], quad[2], quad[4], quad[6]];
              const ys = [quad[1], quad[3], quad[5], quad[7]];
              const minX = Math.min(...xs), maxX = Math.max(...xs);
              const minY = Math.min(...ys), maxY = Math.max(...ys);
              results[id] = {
                x: Math.round((minX + maxX) / 2),
                y: Math.round((minY + maxY) / 2),
                w: Math.round(maxX - minX),
                h: Math.round(maxY - minY),
              };
            } else {
              results[id] = null;
            }
          } catch {
            results[id] = null;
          }
        }));
      }
      return { ok: true, coords: results };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });

  // ═══ Pre-click verification via CDP ═══
  // Re-resolve a target's fresh box from its backendNodeId (stable across re-renders),
  // then hit-test the center point to detect overlays/modals covering the target.
  // Returns: { ok, stale?, covered?, covering?, x, y }
  //   stale=true   → element no longer exists (caller should re-observe)
  //   covered=true → an unrelated element is on top at the click point
  //   x, y         → fresh center coordinates to click (use instead of cached ones)
  ipcMain.handle('cdp:verify-click', async (_e, wcId: number, backendNodeId: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { error: 'webContents not found' };
    try {
      await ensureDebugger(wc, wcId);
      // 1. Fresh bounding box of the intended target
      let box: any = null;
      try {
        box = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId }) as any;
      } catch {
        return { ok: true, stale: true };
      }
      const quad = box?.model?.border;
      if (!quad || quad.length !== 8) return { ok: true, stale: true };
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
      const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);

      // 2. Hit-test: what element actually sits at the target's center?
      let covered = false;
      let covering: string | undefined;
      try {
        const hit = await wc.debugger.sendCommand('DOM.getNodeForLocation', {
          x: cx, y: cy, includeUserAgentShadowDOM: false,
        }) as any;
        const hitBackend = hit?.backendNodeId;
        if (hitBackend && hitBackend !== backendNodeId) {
          // Different node on top — confirm it's truly unrelated (not a child icon/span or wrapping parent)
          const tObj = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId }) as any;
          const hObj = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: hitBackend }) as any;
          const tId = tObj?.object?.objectId;
          const hId = hObj?.object?.objectId;
          if (tId && hId) {
            const rel = await wc.debugger.sendCommand('Runtime.callFunctionOn', {
              objectId: tId,
              functionDeclaration: 'function(o){return this===o||this.contains(o)||o.contains(this);}',
              arguments: [{ objectId: hId }],
              returnByValue: true,
            }) as any;
            if (rel?.result?.value !== true) {
              covered = true;
              try {
                const desc = await wc.debugger.sendCommand('DOM.describeNode', { backendNodeId: hitBackend }) as any;
                const n = desc?.node;
                covering = String(n?.nodeName || '?').toLowerCase();
                const attrs = n?.attributes || [];
                for (let i = 0; i < attrs.length; i += 2) {
                  if (attrs[i] === 'id') covering += '#' + attrs[i + 1];
                  else if (attrs[i] === 'aria-label') covering += ' [' + String(attrs[i + 1]).slice(0, 40) + ']';
                }
              } catch { /* describe is best-effort */ }
            }
          }
          if (tId) wc.debugger.sendCommand('Runtime.releaseObject', { objectId: tId }).catch(() => {});
          if (hId) wc.debugger.sendCommand('Runtime.releaseObject', { objectId: hId }).catch(() => {});
        }
      } catch { /* hit-test unavailable (e.g. off-screen) — don't block the click */ }

      return { ok: true, stale: false, covered, covering, x: cx, y: cy };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });

  // ═══ Preenchimento à prova de overlay (CDP) ═══
  // Foca o elemento pelo backendNodeId (estável) e seta o valor DIRETO no nó, sem clicar
  // por coordenada. Imune a: modal/overlay cobrindo o campo, redimensionar a janela, e
  // reflow. Generaliza o que descobrimos no salvar-playlist → vale pra preencher campo
  // dentro de QUALQUER diálogo (login, checkout, comentário, "criar X") em qualquer site.
  ipcMain.handle('cdp:fill-node', async (_e, wcId: number, backendNodeId: number, value: string) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { ok: false, error: 'webContents not found' };
    try {
      await ensureDebugger(wc, wcId);
      const resolved = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId }) as any;
      const objectId = resolved?.object?.objectId;
      if (!objectId) return { ok: false, error: 'resolveNode failed' };
      const fn = `function(v){
        try{ this.scrollIntoView({block:'center',inline:'center'}); }catch(e){}
        try{ this.focus(); }catch(e){}
        var el=this;
        if (el.isContentEditable || (el.getAttribute && el.getAttribute('role')==='textbox')){
          try{ el.textContent=v; }catch(e){}
          el.dispatchEvent(new InputEvent('input',{bubbles:true,data:v,inputType:'insertReplacementText'}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        }
        var proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto,'value');
        if (d && d.set) d.set.call(el, v); else el.value=v;
        var k=v.slice(-1)||'a';
        el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:k}));
        el.dispatchEvent(new InputEvent('input',{bubbles:true,data:v,inputType:'insertText'}));
        el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,cancelable:true,key:k}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
      }`;
      const res = await wc.debugger.sendCommand('Runtime.callFunctionOn', {
        objectId, functionDeclaration: fn, arguments: [{ value: String(value ?? '') }], returnByValue: true,
      }) as any;
      wc.debugger.sendCommand('Runtime.releaseObject', { objectId }).catch(() => {});
      return { ok: res?.result?.value === true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Agent-driven file download (images, pdfs...) into the user's Downloads ═══
  // Executables are blocked by extension AND by content sniffing of the first bytes.
  const BLOCKED_EXTENSIONS = /\.(exe|msi|bat|cmd|scr|com|pif|apk|dmg|pkg|deb|rpm|js|jse|vbs|vbe|wsf|ps1|jar|lnk|hta)(\?|#|$)/i;

  // ═══ Supercut: o navegador edita vídeo (frase dita N vezes → MP4 costurado) ═══
  ipcMain.handle('media:make-supercut', async (_e, phrase: string, count?: number) =>
    // FILA (lane 'download', junto com o download de vídeo): uma tarefa pesada por vez.
    enqueueJob('download', async () => {
      try {
        return await makeSupercut(String(phrase || ''), clampCount(count, 1, 15, 6), (p) => {
          mainWindow?.webContents.send('agent:supercut-progress', p);
        });
      } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
      }
    }, (ahead) => mainWindow?.webContents.send('agent:supercut-progress', { stage: 'searching', message: `In queue — ${ahead} video task(s) ahead…` }))
      .catch((e: any) => ({ success: false, error: String(e?.message ?? e) })));

  // ═══ Editor de vídeo: o navegador EDITA um vídeo local (ffmpeg nativo, 0 IA) ═══
  // Escolher arquivo (diálogo nativo — à prova de balas, sem depender de drag-drop).
  ipcMain.handle('video:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: mt('dlg.pickVideo'),
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpeg', 'mpg', 'ts'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return { canceled: false, path: r.filePaths[0] };
  });

  // Edições entram na FILA (lane 'edit') — uma por vez, em ordem, sem rejeitar a
  // próxima. (Roda em paralelo com a lane 'download'.) Mesmas funções de sempre.
  const editProgress = (p: any) => mainWindow?.webContents.send('agent:videoedit-progress', p);
  const onEditQueued = (ahead: number) => editProgress({ stage: 'preparing', message: `In queue — ${ahead} edit(s) ahead…` });
  const queueGuard = (e: any) => ({ success: false, error: String(e?.message ?? e) });
  ipcMain.handle('videoedit:trim', async (_e, input: string, startSec: number, endSec: number) => {
    if (!isExistingFile(input)) return { success: false, error: 'Video file not found.' };
    return enqueueJob('edit', async () => {
      try { return await cortarTrecho(String(input), Number(startSec), Number(endSec), editProgress); }
      catch (e: any) { return { success: false, error: String(e?.message ?? e) }; }
    }, onEditQueued).catch(queueGuard);
  });
  ipcMain.handle('videoedit:remove-silence', async (_e, input: string, opts?: any) => {
    if (!isExistingFile(input)) return { success: false, error: 'Video file not found.' };
    return enqueueJob('edit', async () => {
      try { return await removerSilencio(String(input), opts || {}, editProgress); }
      catch (e: any) { return { success: false, error: String(e?.message ?? e) }; }
    }, onEditQueued).catch(queueGuard);
  });
  ipcMain.handle('videoedit:extract-audio', async (_e, input: string) => {
    if (!isExistingFile(input)) return { success: false, error: 'Video file not found.' };
    return enqueueJob('edit', async () => {
      try { return await extrairAudio(String(input), editProgress); }
      catch (e: any) { return { success: false, error: String(e?.message ?? e) }; }
    }, onEditQueued).catch(queueGuard);
  });

  // ═══ Data views: dados → página bonita local (tabela + gráfico, zero CDN) ═══
  // ═══ Abrir pasta / revelar arquivo no explorador (clique nas miniaturas do feed) ═══
  ipcMain.handle('shell:reveal', async (_e, target: string) => {
    try {
      if (!target) return { success: false };
      // GUARD: só revela dentro de pastas que o app de fato usa (Downloads/userData/temp).
      // Bloqueia pedir pra abrir um caminho arbitrário do sistema. Nunca executa arquivo.
      const roots = [app.getPath('downloads'), app.getPath('userData'), os.tmpdir()];
      if (!isInsideAllowedRoot(target, roots)) {
        console.warn('[shell:reveal] bloqueado (fora das pastas permitidas):', target);
        return { success: false, error: 'Path outside the allowed folders.' };
      }
      const fsx = require('fs');
      // Se for arquivo, revela ele na pasta; se for pasta, abre a pasta.
      if (fsx.existsSync(target) && fsx.statSync(target).isDirectory()) {
        await shell.openPath(target);
      } else {
        shell.showItemInFolder(target);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Abrir link externo no navegador do SISTEMA (ex.: instalar Ollama) ═══
  // Só http/https — nunca file:, exe ou esquema arbitrário.
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { success: false, error: 'scheme not allowed' };
      }
      await shell.openExternal(u.toString());
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Coletor de dados: persiste cada corrida do agente (com a observação) num JSONL ═══
  // É o material pra um futuro treino de modelo local (distilação da IA da nuvem). Append
  // puro, sem cap, só local (fica em userData; nada é enviado pra lugar nenhum).
  const datasetDir = () => path.join(app.getPath('userData'), 'agent-dataset');
  const datasetFile = () => path.join(datasetDir(), 'runs.jsonl');
  ipcMain.handle('dataset:append-run', (_e, run: unknown) => {
    try {
      fs.mkdirSync(datasetDir(), { recursive: true });
      fs.appendFileSync(datasetFile(), JSON.stringify(run) + '\n', 'utf-8');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });
  ipcMain.handle('dataset:info', () => {
    try {
      const file = datasetFile();
      if (!fs.existsSync(file)) return { exists: false, path: file, dir: datasetDir(), runs: 0 };
      const content = fs.readFileSync(file, 'utf-8');
      const runs = content.split('\n').filter(l => l.trim()).length;
      return { exists: true, path: file, dir: datasetDir(), runs };
    } catch (e: any) {
      return { exists: false, error: String(e?.message ?? e) };
    }
  });

  // Google blocks sign-in inside Electron/embedded browsers. Use a real installed
  // Chrome/Edge profile for the login, then import the Google cookies into Bah.
  ipcMain.handle('google:login', async () => loginWithSystemBrowser());

  // ═══ Porteiro de overlays: roda o dispensador de cookie/consent em TODOS os frames ═══
  // Só o processo principal alcança iframes de OUTRA ORIGEM (ex.: Sourcepoint da CNN/Guardian).
  // Tenta o frame principal primeiro (evita clicar dentro de iframe de anúncio). Retorna o
  // rótulo do que fechou (ou ''). Conservador: o próprio script só clica em consent conhecido.
  ipcMain.handle('overlays:dismiss', async (_e, wcId: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { dismissed: '' };
    try {
      const main = wc.mainFrame;
      if (!main) return { dismissed: '' };
      const subtree = (main.framesInSubtree || [main]);
      const frames = [main, ...subtree.filter(f => f !== main)].slice(0, 25);
      for (const frame of frames) {
        try {
          const r = await frame.executeJavaScript(OVERLAY_DISMISS_SCRIPT, false);
          if (r) return { dismissed: String(r) };
        } catch { /* frame detached/cross-process: ignora */ }
      }
    } catch { /* ignore */ }
    return { dismissed: '' };
  });

  // ═══ Colheita de imagens em massa → Downloads/<tema>/ (download paralelo) ═══
  ipcMain.handle('images:harvest', async (_e, urls: string[], theme: string) => {
    try {
      // só URLs http(s) válidas (o harvester ainda aplica seu próprio teto MAX_URLS)
      const safe = (Array.isArray(urls) ? urls : []).filter(isHttpUrl);
      return await harvestDownload(safe, String(theme || 'imagens'), (saved, total) => {
        mainWindow?.webContents.send('agent:harvest-progress', { saved, total });
      });
    } catch (e: any) {
      return { success: false, saved: 0, error: String(e?.message ?? e) };
    }
  });

  // ═══ Geração de imagem (texto→imagem) via Pollinations — grátis, sem chave ═══
  ipcMain.handle('image:generate', async (_e, prompt: string, count?: number) => {
    try {
      return await generateImages(String(prompt || ''), Number(count) || 1, (saved, total) => {
        mainWindow?.webContents.send('agent:harvest-progress', { saved, total });
      });
    } catch (e: any) {
      return { success: false, saved: 0, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('view:render', async (_e, spec: DataViewSpec) => {
    try {
      if (!spec || !Array.isArray(spec.columns) || !Array.isArray(spec.rows)) {
        return { success: false, error: 'Invalid spec (columns/rows required).' };
      }
      spec.rows = spec.rows.slice(0, 200);
      return openDataView(spec);
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });
  ipcMain.handle('stocks:movers', async (_e, direction: 'gainers' | 'losers', count?: number) => {
    try {
      const spec = await fetchStockMovers(direction === 'losers' ? 'losers' : 'gainers', Number(count) || 50);
      return { success: true, spec };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Video cuts: onde uma frase é DITA em vídeos do YouTube (Filmot → legendas) ═══
  ipcMain.handle('videocuts:search', async (_e, phrase: string, count?: number) => {
    try {
      return await searchVideoCuts(String(phrase || ''), Number(count) || 4);
    } catch (e: any) {
      return { success: false, cuts: [], error: String(e?.message ?? e) };
    }
  });
  // Transcrição (legenda) de um vídeo do YouTube → texto, pra IA conversar sobre o conteúdo.
  ipcMain.handle('media:transcript', async (_e, url: string) => {
    try {
      return await fetchTranscript(String(url || ''));
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ═══ Image search via public APIs (direct full-res, rights-clean URLs) ═══
  // Beats Google Images: returns DIRECT downloadable URLs in high resolution from
  // Creative-Commons/public-domain sources — no DOM scraping, no wandering to
  // third-party watermark sites. Openverse (CC) primary; Wikimedia for famous subjects.
  ipcMain.handle('images:search', async (_e, query: string, minWidth?: number, count?: number) => {
    const q = String(query || '').trim();
    if (!q) return { success: false, error: 'empty query', images: [] };
    const want = Math.min(Math.max(count || 12, 1), 30);
    const minW = minWidth && minWidth > 0 ? minWidth : 0;
    const UA = { 'User-Agent': 'bah-browser/1.0 (educational browser agent)' };
    const withTO = <T>(p: Promise<T>, ms: number, fb: T) => Promise.race([p, new Promise<T>(r => setTimeout(() => r(fb), ms))]);
    type Img = { url: string; thumbnail?: string; width: number; height: number; title: string; source: string; license: string };
    const out: Img[] = [];

    // Openverse (Creative Commons)
    try {
      const r = await withTO(fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=30`, { headers: UA }), 9000, null as any);
      if (r && r.ok) {
        const d: any = await r.json();
        for (const it of (d.results || [])) {
          if (!it.url) continue;
          out.push({ url: it.url, thumbnail: it.thumbnail, width: it.width || 0, height: it.height || 0,
            title: (it.title || '').slice(0, 100), source: it.source || 'openverse', license: (it.license || '').toUpperCase() });
        }
      }
    } catch { /* one source down doesn't sink the other */ }

    // Wikimedia Commons (public domain / CC originals, capped to ~2000px for speed)
    try {
      const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=12&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2000&format=json&origin=*`;
      const r = await withTO(fetch(u, { headers: UA }), 9000, null as any);
      if (r && r.ok) {
        const d: any = await r.json();
        for (const p of Object.values<any>(d.query?.pages || {})) {
          const info = (p.imageinfo || [])[0];
          if (!info) continue;
          const url = info.thumburl || info.url;
          if (!url || /\.(svg|gif)$/i.test(url)) continue;
          const lic = info.extmetadata?.LicenseShortName?.value || 'Wikimedia';
          out.push({ url, thumbnail: info.thumburl, width: info.thumbwidth || info.width || 0, height: info.thumbheight || info.height || 0,
            title: String(p.title || '').replace(/^File:/, '').slice(0, 100), source: 'wikimedia', license: String(lic).slice(0, 30) });
        }
      }
    } catch { /* ignore */ }

    // Normalize: dedupe by url, filter min width, sort by area (largest first)
    const seen = new Set<string>();
    const images = out
      .filter(i => i.url && !seen.has(i.url) && (seen.add(i.url), true))
      .filter(i => !i.width || i.width >= minW)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))
      .slice(0, want);
    return { success: images.length > 0, count: images.length, images };
  });

  // ═══ Video download (yt-dlp) with streamed progress ═══
  ipcMain.handle('media:download-video', async (_e, url: string, audioOnly?: boolean, count?: number, quality?: 'best' | 'low') => {
    if (!isHttpOrSearch(url)) return { success: false, error: 'Invalid URL or search.' };
    const n = clampCount(count, 1, 50, 1);
    // FILA (lane 'download', compartilhada com o supercut): um download pesado por vez.
    return enqueueJob('download', async () => {
      try {
        return await downloadVideo(url, { audioOnly: !!audioOnly, count: n, quality }, (p) => {
          mainWindow?.webContents.send('agent:video-progress', p);
        });
      } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
      }
    }, (ahead) => mainWindow?.webContents.send('agent:video-progress', { state: 'preparing', title: `In queue — ${ahead} download(s) ahead…` }))
      .catch((e: any) => ({ success: false, error: String(e?.message ?? e) }));
  });

  // Resolve uma busca → URL do 1º vídeo real (sem Shorts), SEM baixar. Pro "open_video".
  ipcMain.handle('media:resolve-video', async (_e, query: string) => {
    try {
      return await resolveTopVideo(query);
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // Resolve N vídeos DISTINTOS de UMA busca (pro "open_videos": N abas, N clipes).
  ipcMain.handle('media:resolve-many', async (_e, query: string, count: number) => {
    try {
      return await resolveTopNVideos(query, count);
    } catch (e: any) {
      return { ok: false, videos: [], error: String(e?.message ?? e) };
    }
  });

  // Resolve VÁRIAS músicas → ids (pro "create_playlist" montar a playlist por URL).
  ipcMain.handle('media:resolve-videos', async (_e, queries: string[]) => {
    try {
      return await resolveTopVideos(Array.isArray(queries) ? queries.slice(0, 25) : []);
    } catch (e: any) {
      return [];
    }
  });

  // ═══ Site-initiated downloads: NEVER show the native Windows "Save As" dialog ═══
  // When the agent (or user) clicks a download button, Electron would pop a native
  // dialog that no agent can click. Instead we auto-save into Downloads (like a
  // browser with "ask where to save" off) and notify the renderer so the agent
  // KNOWS the click worked (otherwise it sees "no page change" and assumes failure).
  function uniqueDownloadPath(base: string): string {
    const dir = app.getPath('downloads');
    const safe = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'download.bin';
    let target = path.join(dir, safe);
    for (let i = 1; fs.existsSync(target) && i < 100; i++) {
      const dot = safe.lastIndexOf('.') > 0 ? safe.lastIndexOf('.') : safe.length;
      target = path.join(dir, `${safe.slice(0, dot)} (${i})${safe.slice(dot)}`);
    }
    return target;
  }
  // Gerenciador de download nativo (Fase A): pausar/continuar/cancelar/retomar,
  // velocidade+ETA, fila com limite. Registry por id vive no módulo dedicado.
  const downloadManager = setupDownloadManager({
    getMainWindow: () => mainWindow,
    uniqueDownloadPath,
    blockedExtensions: BLOCKED_EXTENSIONS,
  });
  downloadManager.attach(session.fromPartition('persist:browser'));
  downloadManager.attach(session.defaultSession);
  ipcMain.handle('download:url', async (_e, url: string, filename?: string) => {
    try {
      if (!/^https?:\/\//i.test(url)) return { success: false, error: 'Only http(s) URLs can be downloaded.' };
      if (BLOCKED_EXTENSIONS.test(url) || (filename && BLOCKED_EXTENSIONS.test(filename))) {
        return { success: false, error: 'Blocked: executable/script files cannot be downloaded by the agent.' };
      }
      // Full browser-like headers: Wikimedia (and many CDNs) reject generic/partial
      // User-Agents with 429/403. Referer helps with hotlink protection.
      const dlHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': ACCEPT_LANGUAGE,
        'Referer': new URL(url).origin + '/',
      };
      // Many .gov.br / older sites have an incomplete TLS cert chain ("unable to verify
      // the first certificate"). Try strict first; on a cert error retry tolerantly
      // (the file's MZ/executable checks below still protect the user).
      const doFetch = (lenient: boolean) => {
        const opts: any = { headers: dlHeaders };
        if (lenient && url.startsWith('https:')) opts.agent = new (require('https').Agent)({ rejectUnauthorized: false });
        return fetch(url, opts);
      };
      let res: any;
      try {
        res = await doFetch(false);
      } catch (e: any) {
        if (/certificate|unable to verify|self.signed|CERT_|altname|ERR_TLS/i.test(String(e?.message))) {
          console.warn('[Download] TLS cert issue → retrying tolerantly:', url);
          res = await doFetch(true);
        } else throw e;
      }
      if (res.status === 429 || res.status === 403) {
        await new Promise(r => setTimeout(r, 2500));
        res = await doFetch(false).catch(() => doFetch(true));
      }
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) return { success: false, error: 'Empty file.' };
      if (buf.length > 100 * 1024 * 1024) return { success: false, error: 'File larger than 100MB — refused.' };
      // Content sniff: block Windows executables regardless of extension (MZ header)
      if (buf.length > 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
        return { success: false, error: 'Blocked: file content is a Windows executable.' };
      }
      // Derive a safe filename: explicit > URL basename > content-type guess
      const ctype = res.headers.get('content-type') || '';
      const extFromType = ctype.includes('jpeg') ? '.jpg' : ctype.includes('png') ? '.png'
        : ctype.includes('webp') ? '.webp' : ctype.includes('gif') ? '.gif'
        : ctype.includes('svg') ? '.svg' : ctype.includes('pdf') ? '.pdf' : '';
      let base = (filename || decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'download')
        .replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      if (!/\.[a-z0-9]{2,5}$/i.test(base) && extFromType) base += extFromType;
      if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.bin';
      const dir = app.getPath('downloads');
      let target = path.join(dir, base);
      // Never overwrite: suffix (1), (2)...
      for (let i = 1; fs.existsSync(target) && i < 100; i++) {
        const dot = base.lastIndexOf('.');
        target = path.join(dir, `${base.slice(0, dot)} (${i})${base.slice(dot)}`);
      }
      fs.writeFileSync(target, buf);
      console.log(`[Download] saved ${buf.length} bytes → ${target}`);
      return { success: true, info: { path: target, bytes: buf.length, contentType: ctype } };
    } catch (e: any) {
      return { success: false, error: String(e?.message ?? e) };
    }
  });

  // (Importação de cookies do Chrome REMOVIDA: dependia do módulo nativo win-dpapi, que não
  // é confiável de instalar/buildar e só funcionava com o Chrome fechado. O login direto em
  // accounts.google.com já funciona por causa do disfarce de UA/headers — sem dep nativa.)

  // ═══ Adblock controls (with per-site auto-bypass) ═══
  // Sites known to break with adblock (anti-adblock walls, broken players, etc.)
  const ADBLOCK_BYPASS_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
    'twitch.tv', 'www.twitch.tv',
    // Google: o filtro de privacidade (EasyPrivacy) quebra o fluxo de cookie do login/Gmail
    // ("Detectamos um problema com as configurações dos seus cookies"). Não bloquear o
    // Google no próprio Google vale a confiabilidade do login. (evalAdblockForHost casa subdomínio.)
    'google.com', 'google.com.br', 'accounts.google.com', 'mail.google.com', 'myaccount.google.com',
  ]);
  let userAdblockPref = loadAdblockPref();  // user toggle (baseline), persistido em disco
  let actuallyEnabled = userAdblockPref;    // current actual state (bate com setupAdblock)
  const persistSession = session.fromPartition('persist:browser');

  function applyAdblockState(targetEnabled: boolean) {
    if (!blocker) return;
    if (targetEnabled === actuallyEnabled) return;
    if (targetEnabled) blocker.enableBlockingInSession(persistSession);
    else blocker.disableBlockingInSession(persistSession);
    actuallyEnabled = targetEnabled;
  }

  function evalAdblockForHost(host: string) {
    if (!userAdblockPref) { applyAdblockState(false); return; }
    const matches = ADBLOCK_BYPASS_HOSTS.has(host) ||
      [...ADBLOCK_BYPASS_HOSTS].some(h => host.endsWith('.' + h));
    applyAdblockState(!matches);
  }

  ipcMain.handle('adblock:get-state', () => ({ enabled: userAdblockPref, active: actuallyEnabled, bypassedHosts: Array.from(ADBLOCK_BYPASS_HOSTS) }));
  // Aceleração de hardware: lê/grava o flag em userData (aplicado no boot do main). enabled=true → accel ligada.
  ipcMain.handle('app:get-hw-accel', () => {
    try {
      const hwFlag = path.join(app.getPath('userData'), 'hw-accel.flag');
      const off = fs.existsSync(hwFlag) && fs.readFileSync(hwFlag, 'utf8').trim() === 'off';
      return { enabled: !off };
    } catch { return { enabled: true }; }
  });
  ipcMain.handle('app:set-hw-accel', (_e, on: boolean) => {
    try {
      const hwFlag = path.join(app.getPath('userData'), 'hw-accel.flag');
      if (on) { try { fs.unlinkSync(hwFlag); } catch {} } else { fs.writeFileSync(hwFlag, 'off'); }
      return { ok: true, enabled: on };
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('adblock:set-enabled', (_e, on: boolean) => {
    userAdblockPref = !!on;
    saveAdblockPref(userAdblockPref);
    applyAdblockState(userAdblockPref);
    return { enabled: userAdblockPref };
  });
  ipcMain.handle('adblock:active-host-changed', (_e, host: string) => {
    if (host) evalAdblockForHost(host);
    return { active: actuallyEnabled };
  });

  ipcMain.handle('page:execute-js', async (_event, code: string) => {
    // Forwarded to renderer which injects into webview
    if (!mainWindow) return { error: 'No window' };
    return { code };
  });

  // ═══ OCR-only handler — used by the agent loop to enrich DOM with local OCR ═══
  // Takes a screenshot only when DOM text is sparse, runs Tesseract locally,
  // returns plain text. No image is ever sent to DeepSeek.
  ipcMain.handle('pipeline:take-ocr', async (
    _e,
    wcId: number,
    domText: string,       // existing DOM text — used to decide if OCR is needed
    force = false          // force screenshot + OCR even if DOM has text
  ) => {
    const MIN_CHARS = 200;
    const domClean = (domText ?? '').replace(/\s+/g, ' ').trim();
    const needsOcr = force || domClean.length < MIN_CHARS;

    if (!needsOcr) {
      return { ocrText: '', ocrUsed: false, skipped: true };
    }

    try {
      const { captureViewport } = await import('./page-capture');
      const { runOCR } = await import('./ocr-engine');

      const taskId = `ocr_${Date.now()}`;
      const capture = await captureViewport(wcId, sharedEnsureDebugger, taskId);
      let ocr;
      try {
        ocr = await runOCR(capture.imagePath);
      } finally {
        // No image to cloud, no image left on disk — delete the temp PNG right away.
        try { fs.unlinkSync(capture.imagePath); } catch {}
      }

      return {
        ocrText: ocr.text.slice(0, 2000),
        ocrUsed: true,
        skipped: false,
        confidence: Math.round(ocr.confidence),
        durationMs: ocr.durationMs,
      };
    } catch (err: any) {
      // Non-fatal — agent continues without OCR
      return { ocrText: '', ocrUsed: false, skipped: false, error: String(err?.message ?? err) };
    }
  });
}

// ═══ Whitelist (per-site disable adblock) ═══
const WHITELIST_PATH = path.join(app.getPath('userData'), 'adblock-whitelist.json');
let adblockWhitelist: Set<string> = new Set();
try {
  if (fs.existsSync(WHITELIST_PATH)) {
    adblockWhitelist = new Set(JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf-8')));
  }
} catch { /* ignore */ }
function saveWhitelist() {
  try { fs.writeFileSync(WHITELIST_PATH, JSON.stringify([...adblockWhitelist])); } catch {}
}

// ═══ Safe browsing — phishing/malware host blocklist ═══
const SAFE_BROWSING_PATH = path.join(app.getPath('userData'), 'safe-browsing-hosts.txt');
const SAFE_BROWSING_URL = 'https://urlhaus.abuse.ch/downloads/hostfile/';
let maliciousHosts = new Set<string>();

async function refreshSafeBrowsing(): Promise<void> {
  try {
    let raw = '';
    if (fs.existsSync(SAFE_BROWSING_PATH)) {
      raw = fs.readFileSync(SAFE_BROWSING_PATH, 'utf-8');
      const stat = fs.statSync(SAFE_BROWSING_PATH);
      const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > 1) raw = ''; // refresh daily
    }
    if (!raw) {
      const res = await fetch(SAFE_BROWSING_URL);
      if (res.ok) {
        raw = await res.text();
        try { fs.writeFileSync(SAFE_BROWSING_PATH, raw); } catch {}
      }
    }
    const set = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      const host = parts[parts.length - 1];
      if (host && host !== '0.0.0.0' && host !== '127.0.0.1') set.add(host);
    }
    maliciousHosts = set;
    console.log(`[SafeBrowsing] Loaded ${maliciousHosts.size} malicious hosts`);
  } catch (e) {
    console.error('[SafeBrowsing] Failed to load:', e);
  }
}

// ═══ Initialize adblock engine (EasyList, EasyPrivacy, cosmetic filters) ═══
// Preferência do toggle persistida em disco (sobrevive ao restart do app).
const ADBLOCK_PREF_PATH = path.join(app.getPath('userData'), 'adblock-pref.json');
function loadAdblockPref(): boolean {
  try { return JSON.parse(fs.readFileSync(ADBLOCK_PREF_PATH, 'utf-8')).enabled !== false; } catch { return true; }
}
function saveAdblockPref(on: boolean): void {
  try { fs.writeFileSync(ADBLOCK_PREF_PATH, JSON.stringify({ enabled: !!on })); } catch {}
}
let blocker: ElectronBlocker | null = null;
async function setupAdblock(): Promise<void> {
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch as any);
    const persistSession = session.fromPartition('persist:browser');
    // Respeita a preferência salva: só liga se o usuário não tiver desligado.
    if (loadAdblockPref()) blocker.enableBlockingInSession(persistSession);

    console.log('[Adblock] Engine ready (EasyList + EasyPrivacy + cosmetic filters)');
  } catch (e) {
    console.error('[Adblock] Failed to initialize:', e);
  }
}



// Auto-correção SEM IA: em qualquer busca (Google/YouTube/Bing/DuckDuckGo), quando aparece
// "Você quis dizer X?" / "Did you mean X?", o navegador segue a correção sozinho. NUNCA segue
// "Em vez disso, pesquisar por…" (esse desfaz a correção). Escrito sem regex/backslash pra não
// quebrar dentro do template; usa observer+poll curto (cobre páginas SPA tipo YouTube).
const AUTOCORRECT_SCRIPT = `
(function(){
  try {
    if (window.__autoCorrectOn) return;
    var h = location.hostname || '';
    var ok = h.indexOf('google.') >= 0 || h.indexOf('youtube.com') >= 0 || h.indexOf('bing.com') >= 0 || h.indexOf('duckduckgo.com') >= 0;
    if (!ok) return;
    window.__autoCorrectOn = true;
    var DYM = ['você quis dizer','voce quis dizer','did you mean'];
    var SKIP = ['em vez disso','search instead','pesquisar mesmo','buscar mesmo','search anyway'];
    var actedFor = '';
    function low(s){ return (s || '').toLowerCase(); }
    function isSearchHref(u){ return !!u && (u.indexOf('search') >= 0 || u.indexOf('q=') >= 0 || u.indexOf('search_query') >= 0); }
    function tryFix(){
      try {
        var key = location.href;
        if (actedFor === key) return;
        var yt = document.querySelector('ytd-did-you-mean-renderer a[href]');
        if (yt && yt.href) { actedFor = key; location.href = yt.href; return; }
        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          if (!(a.textContent || '').trim()) continue;
          if (!isSearchHref(a.href)) continue;
          var ctx = '';
          try { var p = a.closest('div,span,p,yt-formatted-string'); ctx = low((p && p.textContent) || ''); } catch (e) {}
          if (!ctx) continue;
          var skip = false;
          for (var s = 0; s < SKIP.length; s++) { if (ctx.indexOf(SKIP[s]) >= 0) { skip = true; break; } }
          if (skip) continue;
          var hit = false;
          for (var d = 0; d < DYM.length; d++) { if (ctx.indexOf(DYM[d]) >= 0) { hit = true; break; } }
          if (hit) {
            actedFor = key;
            if (a.href.indexOf('javascript:') !== 0) location.href = a.href; else a.click();
            return;
          }
        }
      } catch (e) {}
    }
    var last = 0;
    function deb(){ var t = Date.now(); if (t - last < 500) return; last = t; tryFix(); }
    try { new MutationObserver(deb).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    var n = 0;
    var iv = setInterval(function(){ n++; tryFix(); if (n > 30) clearInterval(iv); }, 500);
    tryFix();
  } catch (e) {}
})();
`;

// Stealth script — masks automation signals so Google/etc don't flag us
const STEALTH_SCRIPT = `
(function(){
  try {
    // 1. navigator.webdriver — must be undefined (not false)
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });

    // 2. navigator.plugins — populate with realistic Chrome plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        Object.defineProperty(arr, 'item', { value: (i) => arr[i], enumerable: false });
        Object.defineProperty(arr, 'namedItem', { value: (n) => arr.find(p => p.name === n), enumerable: false });
        return arr;
      },
      configurable: true,
    });

    // 2.5. navigator.userAgentData (Crucial para login do Google)
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Google Chrome', version: '${CHROME_MAJOR}' },
          { brand: 'Not;A=Brand', version: '8' },
          { brand: 'Chromium', version: '${CHROME_MAJOR}' }
        ],
        mobile: false,
        platform: 'Windows'
      }),
      configurable: true
    });

    // 3. languages
    Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV_LANGUAGES)}, configurable: true });

    // 4. window.chrome — populate with realistic structure
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
    };
    if (!window.chrome.csi) window.chrome.csi = function() { return { onloadT: Date.now(), pageT: 1, startE: Date.now() - 1000, tran: 15 }; };
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return { commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, firstPaintTime: Date.now()/1000, navigationType: 'Other', requestTime: Date.now()/1000-1, startLoadTime: Date.now()/1000, wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }; };
    if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };

    // 5. Permissions API
    const origQuery = navigator.permissions && navigator.permissions.query;
    if (origQuery) {
      navigator.permissions.query = (params) => params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : origQuery.call(navigator.permissions, params);
    }

    // 6. WebGL vendor — pretend to be a real GPU
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return 'Intel(R) Iris(TM) Graphics 6100'; // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, p);
    };
    if (window.WebGL2RenderingContext) {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Intel Inc.';
        if (p === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
        return getParameter2.call(this, p);
      };
    }

    // 7. Hardware concurrency / device memory
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });

    // 8. Chromium-detected automation flag
    delete (window).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete (window).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete (window).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // 9. Iframe contentWindow trick — Chrome iframes have specific behavior
    try {
      const iframe = document.createElement('iframe');
      iframe.srcdoc = 'blank';
      iframe.style.display = 'none';
      // Make sure HTMLIFrameElement.prototype.contentWindow is OK (real)
    } catch {}

    // 10. Notification.permission — bot pages return 'denied' inconsistently
    if (window.Notification) {
      try {
        Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
      } catch {}
    }

    // 11. window.outerWidth/outerHeight not 0 (headless leak)
    try {
      if (window.outerWidth === 0) Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
      if (window.outerHeight === 0) Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 80, configurable: true });
    } catch {}

    // 12. screen properties — headless reports 0
    try {
      if (screen.width === 0) Object.defineProperty(screen, 'width', { get: () => 1920, configurable: true });
      if (screen.height === 0) Object.defineProperty(screen, 'height', { get: () => 1080, configurable: true });
      if (screen.availWidth === 0) Object.defineProperty(screen, 'availWidth', { get: () => 1920, configurable: true });
      if (screen.availHeight === 0) Object.defineProperty(screen, 'availHeight', { get: () => 1040, configurable: true });
    } catch {}

    // 13. MediaCodec / mediaDevices — bots often have 0 devices
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => {
        const list = await orig();
        if (list.length === 0) {
          return [
            { kind: 'audioinput', deviceId: 'default', groupId: '1', label: '' },
            { kind: 'videoinput', deviceId: 'default', groupId: '2', label: '' },
            { kind: 'audiooutput', deviceId: 'default', groupId: '1', label: '' },
          ];
        }
        return list;
      };
    }

    // 14. Battery API — Chrome has it, bots often don't
    if (!navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
      });
    }
  } catch(e) {}
})();
`;

// Keep the Chromium process close to stock for sensitive sites like Google login.
// Site isolation stays disabled because the app's capture/injection pipeline spans frames.
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');
// Accept-Language / navigator.languages / --lang SEGUEM o idioma escolhido (ver site-locale.ts).
// Switch de boot (antes do 'ready') → trocar o idioma aplica nos sites no próximo restart.
app.commandLine.appendSwitch('lang', LANG_SWITCH);
// Libera áudio sem "gesto do usuário" — necessário pra TTS (read_aloud) e autoplay
// soarem dentro do webview; sem isso o Chromium bloqueia o speechSynthesis em silêncio.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Aceleração de hardware (GPU): em alguns PCs com vídeo integrado/driver velho, abrir uma aba
// nova dá "tela branca" (o compositor da GPU não pinta o 1º frame; só carrega com F5). O usuário
// pode DESLIGAR a aceleração (igual ao Chrome). A escolha fica salva num arquivo lido AQUI no
// boot — disableHardwareAcceleration() só vale se chamado ANTES do app ficar 'ready'. Default: ligada.
try {
  const hwFlag = path.join(app.getPath('userData'), 'hw-accel.flag');
  if (fs.existsSync(hwFlag) && fs.readFileSync(hwFlag, 'utf8').trim() === 'off') {
    app.disableHardwareAcceleration();
  }
} catch {}

// Flush periódico dos cookies (a cada 30s) — garante persistência mesmo se o app travar
function startCookieFlushInterval() {
  setInterval(async () => {
    try {
      const persistSession = session.fromPartition('persist:browser');
      await persistSession.cookies.flushStore();
      await (persistSession as any).flushStorageData?.();
    } catch {}
  }, 30_000);
}

// Flush SÍNCRONO ao fechar o app. Sem isto, se você fecha LOGO depois de logar (antes do
// flush de 30s acima), os cookies do login não chegam ao disco e você reabre DESLOGADO.
// Segura o quit até os cookies serem gravados. (Causa do "fechei e abri deslogado".)
let cookiesFlushedOnQuit = false;
app.on('before-quit', (e) => {
  if (cookiesFlushedOnQuit) return;
  e.preventDefault();
  flushBrowserState()
    .catch(() => {})
    .finally(() => { cookiesFlushedOnQuit = true; app.quit(); });
});

// Sweep any leftover OCR screenshots (older than 1h) so the temp folder never grows.
function sweepOldScreenshots(): void {
  try {
    const dir = path.join(app.getPath('userData'), 'screenshots');
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

// ── Atualização automática (só na versão INSTALADA; nunca em dev/.bat) ─────────
// Checa as Releases do GitHub, baixa em segundo plano e, quando pronto, oferece
// reiniciar pra aplicar. Totalmente aditivo: não toca no agente nem no caminho
// da API/nuvem. Qualquer erro é silencioso (offline, sem release etc.).
function setupAutoUpdater(): void {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', async (info: any) => {
      try {
        const r = await dialog.showMessageBox({
          type: 'info',
          buttons: [mt('upd.restart'), mt('upd.later')],
          defaultId: 0,
          cancelId: 1,
          title: mt('upd.title'),
          message: mt('upd.message', { v: String(info?.version ?? '') }),
          detail: mt('upd.detail'),
        });
        if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
      } catch { /* silencioso */ }
    });
    autoUpdater.on('error', (err: any) => console.warn('[update] erro:', err?.message ?? err));
    autoUpdater.checkForUpdates().catch(() => { /* offline / sem release */ });
  } catch (e) {
    console.warn('[update] setup falhou:', e);
  }
}

app.whenReady().then(() => {
  sweepOldScreenshots();
  setupAdblock();
  refreshSafeBrowsing();
  // Set fixed Chrome UA on every session
  session.defaultSession.setUserAgent(CHROME_UA);
  const persistSession = session.fromPartition('persist:browser');
  persistSession.setUserAgent(CHROME_UA);
  // Write stealth script to disk for diagnostics, but keep Google login free of
  // session preloads. Regular webviews inject this script later on dom-ready.
  try {
    const stealthPath = path.join(app.getPath('userData'), 'stealth-preload.js');
    fs.writeFileSync(stealthPath, STEALTH_SCRIPT);
    // Do not register this as a session preload. Google login must stay clean;
    // regular webviews still get the script later via dom-ready injection.
  } catch (e) {
    console.warn('[Stealth] Failed to register preload:', e);
  }

  // Headers Chrome CONSISTENTES em todas as requisições (header HTTP = navigator JS).
  // O login do Google é feito numa JANELA normal (google:login), que compartilha esta
  // sessão persist:browser → os cookies caem aqui e o webview fica logado.
  const filter = { urls: ['<all_urls>'] };
  const applyHeaders = (details: any, callback: any) => {
    const headers = { ...details.requestHeaders };
    headers['User-Agent'] = CHROME_UA;
    headers['Accept-Language'] = ACCEPT_LANGUAGE;
    headers['sec-ch-ua'] = CHROME_SEC_CH_UA;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    callback({ requestHeaders: headers });
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, applyHeaders);
  persistSession.webRequest.onBeforeSendHeaders(filter, applyHeaders);

  // Remove restrictive CSP headers so webview can load any site
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });

  // Menu oculto (janela sem moldura) — os ACELERADORES funcionam mesmo com uma página
  // (webview) focada, então é o jeito certo de ter atalhos estilo Chrome. Cada item
  // dispara um IPC pro renderer, que executa a ação nas abas. editMenu mantém Ctrl+C/V/X/A.
  const sendSc = (action: string) => { try { mainWindow?.webContents.send('app:shortcut', action); } catch {} };
  const tabNumberItems: Electron.MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `${mt('mnu.tab')} ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => sendSc(`tab-${i + 1}`),
  }));
  const menu = Menu.buildFromTemplate([
    { role: 'editMenu' },
    {
      label: mt('mnu.navigate'),
      submenu: [
        { label: mt('mnu.newTab'), accelerator: 'CmdOrCtrl+T', click: () => sendSc('new-tab') },
        { label: mt('mnu.closeTab'), accelerator: 'CmdOrCtrl+W', click: () => sendSc('close-tab') },
        { label: mt('mnu.reopenTab'), accelerator: 'CmdOrCtrl+Shift+T', click: () => sendSc('reopen-tab') },
        { type: 'separator' },
        { label: mt('mnu.focusUrl'), accelerator: 'CmdOrCtrl+L', click: () => sendSc('focus-url') },
        { label: mt('mnu.reload'), accelerator: 'CmdOrCtrl+R', click: () => sendSc('reload') },
        { label: mt('mnu.reloadF5'), accelerator: 'F5', click: () => sendSc('reload') },
        { label: mt('mnu.back'), accelerator: 'Alt+Left', click: () => sendSc('back') },
        { label: mt('mnu.forward'), accelerator: 'Alt+Right', click: () => sendSc('forward') },
        { label: mt('mnu.bookmark'), accelerator: 'CmdOrCtrl+D', click: () => sendSc('bookmark') },
        { label: mt('mnu.find'), accelerator: 'CmdOrCtrl+F', click: () => sendSc('find') },
        { type: 'separator' },
        { label: mt('mnu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => sendSc('zoom-in') },
        { label: mt('mnu.zoomIn'), accelerator: 'CmdOrCtrl+=', visible: false, click: () => sendSc('zoom-in') },
        { label: mt('mnu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => sendSc('zoom-out') },
        { label: mt('mnu.zoomReset'), accelerator: 'CmdOrCtrl+0', click: () => sendSc('zoom-reset') },
        { label: mt('mnu.history'), accelerator: 'CmdOrCtrl+H', click: () => sendSc('history') },
        { label: mt('mnu.downloads'), accelerator: 'CmdOrCtrl+J', click: () => sendSc('downloads') },
        { type: 'separator' },
        { label: mt('mnu.nextTab'), accelerator: 'Control+Tab', click: () => sendSc('next-tab') },
        { label: mt('mnu.prevTab'), accelerator: 'Control+Shift+Tab', click: () => sendSc('prev-tab') },
        ...tabNumberItems,
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  createWindow();
  setupIPC();
  startCookieFlushInterval();
  setupAutoUpdater();

  // Default cloud engine: Pollinations (free, keyless) so the app works out of the box.
  // The user can switch to DeepSeek/Mistral/NVIDIA with a key in settings for full power.
  aiEngine = new AIEngine('pollinations', '');
  pageAgent = new PageAgent(aiEngine);


  // Default local engine (Ollama on localhost — user configures model in settings)
  try {
    localEngine = new AIEngine('ollama', 'local', 'http://localhost:11434', 'qwen3-vl:8b');
    localPageAgent = new PageAgent(localEngine);
    console.log('[HybridRouter] Local engine (Ollama) initialized at http://localhost:11434');
  } catch (e) {
    console.warn('[HybridRouter] Local engine init failed (Ollama not running?):', e);
  }
});

app.on('before-quit', () => {
  // Free the persistent OCR workers (≈40–80MB) cleanly on exit.
  import('./ocr-engine').then(m => m.terminateOcrWorkers()).catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
