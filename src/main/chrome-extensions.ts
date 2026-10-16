// Extensões do Chrome no Bah: instalar pela Chrome Web Store, mostrar o botão de cada uma
// na barra (ícone + badge + dica), abrir o popup ou avisar o clique, e remover.
//
// Peças:
//  - electron-chrome-web-store (MIT): faz o botão "Usar no Chrome" da loja funcionar, baixa
//    o .crx, desempacota em userData/Extensions, carrega tudo no boot e atualiza sozinho.
//  - extension-shim-preload: põe no background (service worker) e nas páginas da extensão
//    as APIs que o Electron não tem (chrome.action, tabs.create, omnibox…). Elas chamam
//    aqui pelo canal 'bah-ext:call'.
//  - chrome-extension-rules.ts: as regras puras (ícone, badge, URL permitida…), testadas.
//  - chrome-extension-apis.ts: proxy/VPN, login do proxy, privacy, cookies, notificações e
//    management (o que uma VPN da loja precisa).
//
// Regra de segurança: o ID da extensão vem SEMPRE de quem chamou (escopo do worker ou
// origem do frame), nunca dos argumentos. E todo argumento é conferido antes de usar.
import { app, BrowserWindow, dialog, ipcMain, screen, webContents, type Session, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store';
import * as R from './chrome-extension-rules';
import { setupExtensionApis, NOT_MINE, readIconFile, safeIconImage, iconDataUrlBytes, type ExtensionApis } from './chrome-extension-apis';

const CALL = 'bah-ext:call';
const EVENT = 'bah-ext:event';
const STORE_ORIGIN = 'https://chromewebstore.google.com';
const ICON_PX = 32;   // ícone desenhado a 16–20px; 32 fica nítido em tela de alta densidade
const MAX_ALARMS = 500;   // por extensão, como o Chrome
const NOT_APPROVED = 'New permissions were not approved.';

interface LoadedExt {
  id: string;
  name: string;
  version: string;
  root: string;
  manifest: any;            // pra saber o que ela pode ver (tabs, activeTab, host_permissions)
  hasWorker: boolean;
  options: string;          // caminho relativo da página de opções ('' = não tem)
  defaultIcon: string;      // data URL do ícone do manifesto ('' = letra)
  action: R.ActionState;
}
interface WorkerEntry {
  worker: Electron.ServiceWorkerMain;
  extId: string;
  task: { end: () => void } | null;
}
interface PendingTab {
  reqId: number;
  url: string;
  active: boolean;
  sent: boolean;
  resolve: (wc: WebContents | null) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface AlarmSlot { alarm: R.Alarm; timer: ReturnType<typeof setTimeout> | null }
type Anchor = { left: number; top: number; right: number; bottom: number };

export type ExtensionView = R.ExtensionView;

// JSON pequeno do Bah: grava num .tmp e troca; se a troca falhar (antivírus segurando o
// arquivo no Windows), grava direto.
function readJsonFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJsonFile(file: string, data: unknown): void {
  const text = JSON.stringify(data);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
  } catch {
    try { fs.writeFileSync(file, text); } catch (e) { console.warn(`[Extensões] não deu pra gravar ${path.basename(file)}:`, e); }
  }
}

export function setupChromeExtensions(deps: {
  getMainWindow: () => BrowserWindow | null;
  session: Session;
  /** Texto traduzido do processo principal (mt do main.ts). */
  t: (key: string) => string;
}): void {
  const ses = deps.session;
  const userData = app.getPath('userData');
  const extensionsPath = path.join(userData, 'Extensions');
  const fmt = (key: string, vars: Record<string, string> = {}) => {
    let s = deps.t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  };
  const send = (channel: string, payload: unknown) => {
    try { deps.getMainWindow()?.webContents.send(channel, payload); } catch {}
  };
  const fromMainWindow = (e: Electron.IpcMainInvokeEvent) => {
    const mw = deps.getMainWindow();
    return !!mw && !mw.isDestroyed() && e.sender === mw.webContents;
  };
  const showBox = async (opts: Electron.MessageBoxOptions) => {
    const mw = deps.getMainWindow();
    return mw && !mw.isDestroyed() ? dialog.showMessageBox(mw, opts) : dialog.showMessageBox(opts);
  };

  // ── 1. Calço das APIs: preload de service worker + de frame ────────────────
  // Registrado ANTES de qualquer extensão carregar, pra o primeiro worker já nascer com ele.
  const shimPath = path.join(__dirname, '..', 'preload', 'extension-shim-preload.js');
  if (!fs.existsSync(shimPath)) console.error(`[Extensões] preload do calço NÃO encontrado em ${shimPath} — extensões que usam chrome.action vão quebrar.`);
  try {
    ses.registerPreloadScript({ id: 'bah-extension-shim', type: 'service-worker', filePath: shimPath });
    ses.registerPreloadScript({ id: 'bah-extension-shim-frame', type: 'frame', filePath: shimPath });
  } catch (e) { console.error('[Extensões] falha ao registrar o calço:', e); }

  // ── 2. Estado das extensões carregadas ─────────────────────────────────────
  const exts = new Map<string, LoadedExt>();
  // proxy/privacy/cookies/notificações/management (montado na seção 10c, depois das aprovações).
  let apis: ExtensionApis | null = null;
  // Desligadas no interruptor: não carregam (nem no início), mas continuam no menu com o
  // nome/ícone/versão guardados aqui. Arquivos, dados e acesso aprovado ficam onde estão.
  const disabledPath = path.join(userData, 'extension-disabled.json');
  const disabledSet: Record<string, R.DisabledEntry> = R.parseDisabledSet(readJsonFile(disabledPath), extensionsPath);
  const saveDisabled = () => writeJsonFile(disabledPath, disabledSet);
  const isDisabled = (id: string) => Object.prototype.hasOwnProperty.call(disabledSet, id);
  // Sendo ligada agora (ainda na lista de desligadas até o carregamento dar certo).
  const enabling = new Set<string>();

  const readMessages = (root: string, manifest: any): Record<string, { message?: unknown }> | null => {
    for (const loc of R.localeCandidates(app.getLocale(), manifest?.default_locale)) {
      const file = R.resolveInsideRoot(root, `_locales/${loc}/messages.json`);
      if (!file) continue;
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
    return null;
  };
  const imageToDataUrl = (img: Electron.NativeImage): string => {
    if (img.isEmpty()) return '';
    const s = img.getSize();
    if (s.width > ICON_PX || s.height > ICON_PX) {
      const k = ICON_PX / Math.max(s.width, s.height);
      img = img.resize({ width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)), quality: 'best' });
    }
    return img.toDataURL();
  };
  const loadDefaultIcon = (root: string, manifest: any): string => {
    const rel = R.normalizeExtPath(R.actionIconPath(manifest, ICON_PX), '');
    const file = rel ? R.resolveInsideRoot(root, rel) : null;
    if (!file) return '';
    // Tamanho conferido no cabeçalho antes de decodificar (PNG pequeno que declara 12000×12000).
    const img = safeIconImage(readIconFile(file), ICON_PX);
    return img ? imageToDataUrl(img) : '';
  };

  const register = (ext: Electron.Extension): LoadedExt | null => {
    if (!R.isExtensionId(ext.id)) return null;
    const manifest = ext.manifest || {};
    const needsMsg = /__MSG_/.test(String(ext.name || '') + String(manifest.action?.default_title || ''));
    const messages = needsMsg ? readMessages(ext.path, manifest) : null;
    const action = R.initialActionState(manifest, ext.id);
    if (messages && action.defaults.title) {
      const title = R.localizeMessage(action.defaults.title, messages);
      action.defaults.title = title; action.global.title = title;
    }
    const loaded: LoadedExt = {
      id: ext.id,
      name: R.localizeMessage(ext.name || manifest.name || ext.id, messages) || ext.id,
      version: String(ext.version || manifest.version || ''),
      root: ext.path,
      manifest,
      hasWorker: Number(manifest.manifest_version) === 3 && typeof manifest.background?.service_worker === 'string',
      options: R.optionsPagePath(manifest, ext.id),
      defaultIcon: loadDefaultIcon(ext.path, manifest),
      action,
    };
    exts.set(ext.id, loaded);
    return loaded;
  };

  const viewOf = (e: LoadedExt): Omit<ExtensionView, 'enabled'> => {
    const tabs: Record<string, R.ActionView> = {};
    for (const k of Object.keys(e.action.tabs)) tabs[k] = R.actionView(e.action, e.name, e.defaultIcon, Number(k));
    return {
      id: e.id, name: e.name, version: e.version, hasOptions: !!e.options,
      global: R.actionView(e.action, e.name, e.defaultIcon), tabs,
      controlsProxy: !!apis?.controlsProxy(e.id),
    };
  };
  // Carregadas (ligadas) + desligadas, cada uma com o "enabled" do interruptor.
  const listView = (): ExtensionView[] => R.mergeExtensionViews(Array.from(exts.values()).map(viewOf), disabledSet);
  // Várias mudanças seguidas (cor + texto + título) viram UM envio pra tela.
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const pushState = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; send('extensions:state', listView()); }, 30);
  };

  // Valores por aba somem quando a aba fecha ou abre outra página (igual ao Chrome).
  const watchedTabs = new Set<number>();
  const watchTab = (tabId: number) => {
    if (watchedTabs.has(tabId)) return;
    const wc = webContents.fromId(tabId);
    if (!wc || wc.isDestroyed()) return;
    watchedTabs.add(tabId);
    const clear = () => {
      let changed = false;
      for (const e of exts.values()) {
        const next = R.clearTabAction(e.action, tabId);
        if (next !== e.action) { e.action = next; changed = true; }
      }
      if (changed) pushState();
    };
    wc.on('did-navigate', clear);
    wc.once('destroyed', () => { watchedTabs.delete(tabId); clear(); });
  };

  // ── 3. Abas: abrir pelo caminho de sempre do Bah e saber QUAL webview é a do pedido ──
  const tabOf = (id: number): WebContents | null => {
    const wc = webContents.fromId(id);
    return wc && !wc.isDestroyed() && wc.getType() === 'webview' ? wc : null;
  };
  // Igual ao Chrome: url/título só pra quem pode ver (tabs, activeTab ou host da página).
  const tabInfo = (wc: WebContents, active: boolean, canSee: boolean) => {
    const t: Record<string, unknown> = {
      id: wc.id, index: 0, windowId: 1, active, highlighted: active, selected: active,
      pinned: false, incognito: false, discarded: false, autoDiscardable: true, groupId: -1,
      status: wc.isLoading() ? 'loading' : 'complete',
    };
    if (canSee) { t.url = wc.getURL(); t.title = wc.getTitle(); }
    return t;
  };
  // Cada pedido leva um número; a tela cria a aba e devolve o webContents DAQUELA aba
  // ('extensions:tab-opened'). Nada de "a próxima webview que anexar é a minha": a aba
  // escondida do agente ou um Ctrl+T não podem ser confundidos com a aba da extensão.
  // Até a tela avisar que já escuta ('extensions:renderer-ready'), os pedidos esperam aqui.
  const pendingTabs = new Map<number, PendingTab>();
  let nextReqId = 1;
  let rendererReady = false;
  const hookedWindows = new WeakSet<WebContents>();
  const finishTab = (p: PendingTab, wc: WebContents | null) => {
    if (pendingTabs.get(p.reqId) !== p) return;
    pendingTabs.delete(p.reqId);
    clearTimeout(p.timer);
    p.resolve(wc);
  };
  const flushTabs = () => {
    const mw = deps.getMainWindow();
    if (!rendererReady || !mw || mw.isDestroyed()) return;
    for (const p of Array.from(pendingTabs.values())) {
      if (p.sent) continue;
      p.sent = true;
      clearTimeout(p.timer);
      p.timer = setTimeout(() => finishTab(p, null), 5000);
      try { mw.webContents.send('extensions:open-tab', { reqId: p.reqId, url: p.url, active: p.active }); } catch { finishTab(p, null); }
    }
  };
  const openTab = (url: string, active: boolean): Promise<WebContents | null> => new Promise(resolve => {
    const p: PendingTab = {
      reqId: nextReqId++, url, active, sent: false, resolve,
      timer: setTimeout(() => finishTab(p, null), 30000),   // janela/tela ainda não pronta
    };
    pendingTabs.set(p.reqId, p);
    flushTabs();
  });
  ipcMain.handle('extensions:renderer-ready', (e) => {
    if (!fromMainWindow(e)) return false;
    const wc = e.sender;
    if (!hookedWindows.has(wc)) {
      hookedWindows.add(wc);
      // A tela recarregou ou o processo dela caiu: até ela avisar de novo, os pedidos esperam.
      wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) rendererReady = false; });
      wc.on('render-process-gone', () => { rendererReady = false; });
      wc.once('destroyed', () => { rendererReady = false; });
    }
    rendererReady = true;
    flushTabs();
    return true;
  });
  ipcMain.handle('extensions:tab-opened', (e, reqId: unknown, wcId: unknown) => {
    if (!fromMainWindow(e) || typeof reqId !== 'number' || typeof wcId !== 'number' || !Number.isInteger(wcId)) return false;
    const p = pendingTabs.get(reqId);
    if (!p || !p.sent) return false;
    const wc = tabOf(wcId);
    if (!wc || wc.hostWebContents !== e.sender) return false;   // tem que ser uma aba DESTA janela
    finishTab(p, wc);
    return true;
  });

  // chrome.tabs.remove: a tela fecha a aba (só aba visível desta janela) e aqui espera a
  // webview sumir de verdade. A mesma aba sendo fechada de novo espera o MESMO pedido (sem
  // juntar ouvinte de 'destroyed' nem mandar outro aviso pra tela a cada chamada).
  const closing = new Map<number, Promise<boolean>>();
  const closeTab = (wc: WebContents): Promise<boolean> => {
    const mw = deps.getMainWindow();
    if (!mw || mw.isDestroyed() || wc.hostWebContents !== mw.webContents || !rendererReady) return Promise.resolve(false);
    const id = wc.id;
    const cur = closing.get(id);
    if (cur) return cur;
    const p = new Promise<boolean>(resolve => {
      let done = false;
      const onDestroyed = () => finish(true);
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { wc.removeListener('destroyed', onDestroyed); } catch {}
        resolve(ok);
      };
      const timer = setTimeout(() => finish(wc.isDestroyed()), 3000);
      wc.once('destroyed', onDestroyed);
      try { mw.webContents.send('extensions:close-tab', { wcId: id }); } catch { finish(false); }
    });
    closing.set(id, p);
    void p.finally(() => { if (closing.get(id) === p) closing.delete(id); });
    return p;
  };

  // ── 4. Eventos pra extensão (worker + páginas abertas dela) ────────────────
  const workers = new Map<number, WorkerEntry>();
  const findWorker = (extId: string) =>
    Array.from(workers.values()).find(w => w.extId === extId && !w.worker.isDestroyed()) || null;
  let startWorker: (extId: string) => Promise<WorkerEntry | null> = async () => null;   // definido na seção 6
  let waitReady: (extId: string, ms: number) => Promise<boolean> = async () => false;      // idem
  const READY_WAIT_MS = 10000;
  const sendToExtension = async (extId: string, name: string, args: unknown[], wake = false) => {
    let entry = findWorker(extId);
    if (!entry && wake) entry = await startWorker(extId);
    if (entry && !entry.worker.isDestroyed()) { try { entry.worker.send(EVENT, name, args); } catch {} }
    const origin = `chrome-extension://${extId}`;
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.isDestroyed() || wc.session !== ses) continue;
        for (const f of wc.mainFrame.framesInSubtree) if (f.origin === origin) f.send(EVENT, name, args);
      } catch {}
    }
  };

  // Só pro worker (o login do proxy precisa de UMA resposta, e quem escuta é o background).
  // Só entrega a worker RODANDO (entry.task só existe depois disso): o ServiceWorkerMain joga
  // fora, calado, o que vai pra um worker ainda "starting". Extensão que acabou de carregar
  // (início do Bah) espera o 'extension-ready' antes de ligar o worker.
  const sendToWorker = async (extId: string, name: string, args: unknown[]): Promise<boolean> => {
    let entry = findWorker(extId);
    if (!entry || !entry.task) entry = await startWorker(extId);
    if (!entry && exts.get(extId)?.hasWorker && !ready.has(extId) && await waitReady(extId, READY_WAIT_MS)) entry = await startWorker(extId);
    if (!entry || entry.worker.isDestroyed()) return false;
    try { entry.worker.send(EVENT, name, args); return true; } catch { return false; }
  };

  // chrome.tabs.onUpdated/onCreated/onRemoved: no Electron 44 são casca (nunca disparam) — e a
  // VPN espera o onUpdated 'complete' da aba que ela abre pra conectar. Igual ao Chrome: vai
  // pra toda extensão que escuta; url/título só pra quem pode ver aquela aba. Só pra quem
  // escuta (o calço pede 'tabs.subscribe' no primeiro addListener), e título/endereço da mesma
  // página em rajada (document.title, pushState em laço) saem juntos, no máximo a cada 200 ms.
  const tabSubs = new Set<string>();
  const TAB_COALESCE_MS = 200;
  const sendTabEvent = (wc: WebContents, change: Record<string, unknown>) => {
    if (!tabSubs.size || wc.isDestroyed() || !tabOf(wc.id)) return;
    for (const id of tabSubs) {
      const ext = exts.get(id);
      if (!ext) continue;
      let see = false;
      try { see = R.canSeeTabUrl(ext.manifest, wc.getURL(), ext.id); } catch {}
      const info: Record<string, unknown> = { ...change };
      if (!see) { delete info.url; delete info.title; }
      if (!Object.keys(info).length) continue;
      void sendToExtension(id, 'tabs.onUpdated', [wc.id, info, tabInfo(wc, false, see)]);
    }
  };
  app.on('web-contents-created', (_e, wc) => {
    let mine = false;
    try { mine = wc.session === ses; } catch {}
    if (!mine) return;
    const id = wc.id;
    // Aba = webview (popup, opções e o worker da extensão são da mesma sessão, mas não são aba).
    let isTab: boolean | null = null;
    const tab = () => { if (isTab === null) { try { isTab = !wc.isDestroyed() && wc.getType() === 'webview'; } catch { isTab = false; } } return isTab; };
    let pending: Record<string, unknown> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      const p = pending;
      pending = null;
      if (p) sendTabEvent(wc, p);
    };
    const later = (change: Record<string, unknown>) => {
      if (!tabSubs.size) return;
      pending = { ...(pending || {}), ...change };
      if (!timer) timer = setTimeout(flush, TAB_COALESCE_MS);
    };
    // Mudança de estado vai na hora e em ordem (o que estava juntando sai antes).
    const now = (change: Record<string, unknown>) => { if (!tabSubs.size) return; flush(); sendTabEvent(wc, change); };
    setImmediate(() => {
      if (!tab() || !tabSubs.size || wc.isDestroyed()) return;
      for (const extId of tabSubs) {
        const ext = exts.get(extId);
        if (!ext) continue;
        let see = false;
        try { see = R.canSeeTabUrl(ext.manifest, wc.getURL(), ext.id); } catch {}
        void sendToExtension(extId, 'tabs.onCreated', [tabInfo(wc, false, see)]);
      }
    });
    wc.on('did-start-loading', () => now({ status: 'loading' }));
    wc.on('did-navigate', (_ev, url) => now({ url }));
    wc.on('did-navigate-in-page', (_ev, url, isMainFrame) => { if (isMainFrame) later({ url }); });
    wc.on('page-title-updated', (_ev, title) => later({ title }));
    // Também depois de uma carga que falhou (o 'complete' do Chrome vem do mesmo jeito).
    wc.on('did-stop-loading', () => now({ status: 'complete' }));
    wc.once('destroyed', () => {
      if (timer) clearTimeout(timer);
      pending = null;
      if (!tab()) return;
      for (const extId of tabSubs) void sendToExtension(extId, 'tabs.onRemoved', [id, { windowId: 1, isWindowClosing: false }]);
    });
  });

  // chrome.storage.sync: um JSON por extensão (o storage.sync do Electron 44 é casca).
  const syncDir = path.join(userData, 'Extension Sync Storage');
  const syncFile = (id: string) => path.join(syncDir, `${id}.json`);
  const syncCache = new Map<string, R.StorageItems>();
  const readSync = (id: string): R.StorageItems => {
    let s = syncCache.get(id);
    if (!s) {
      const raw = readJsonFile(syncFile(id));
      s = raw && typeof raw === 'object' && !Array.isArray(raw) ? R.storageGet(raw as R.StorageItems, null) : {};
      syncCache.set(id, s);
    }
    return s;
  };
  const writeSync = (id: string, r: { store: R.StorageItems; changes: R.StorageChanges }) => {
    syncCache.set(id, r.store);
    writeJsonFile(syncFile(id), r.store);
    if (Object.keys(r.changes).length) void sendToExtension(id, 'storage.sync.changed', [r.changes]);
    return undefined;
  };

  // chrome.alarms: tabela por extensão aqui no Bah (o popup que cria o alarme fecha logo).
  const alarmTables = new Map<string, Map<string, AlarmSlot>>();
  const armAlarm = (extId: string, slot: AlarmSlot) => {
    // Em pedaços de no máximo ~24,8 dias: só dispara quando a hora chegou DE VERDADE.
    slot.timer = setTimeout(() => {
      slot.timer = null;
      if (Date.now() >= slot.alarm.scheduledTime) fireAlarm(extId, slot); else armAlarm(extId, slot);
    }, R.alarmTimerDelay(slot.alarm.scheduledTime, Date.now()));
  };
  const fireAlarm = (extId: string, slot: AlarmSlot) => {
    const table = alarmTables.get(extId);
    if (!table || table.get(slot.alarm.name) !== slot) return;
    const info = { ...slot.alarm };
    if (slot.alarm.periodInMinutes) {
      slot.alarm = { ...slot.alarm, scheduledTime: Date.now() + slot.alarm.periodInMinutes * 60000 };
      armAlarm(extId, slot);
    } else table.delete(slot.alarm.name);
    void sendToExtension(extId, 'alarms.onAlarm', [info], true);   // acorda o worker se precisar
  };
  const clearAlarmTable = (extId: string) => {
    const table = alarmTables.get(extId);
    if (!table) return;
    for (const s of table.values()) if (s.timer) clearTimeout(s.timer);
    alarmTables.delete(extId);
  };

  // ── 5. O que a extensão pede (chrome.action.*, tabs.create…) ───────────────
  const loadIcon = (ext: LoadedExt, d: Record<string, unknown>): string => {
    if (d.imageData !== undefined) {
      const s = d.imageData;
      if (typeof s !== 'string' || !/^data:image\/png;base64,/.test(s)) throw new Error('Invalid imageData.');
      // Até ~1 MB e 1024×1024 px pelo cabeçalho, ANTES de decodificar no processo principal.
      const img = safeIconImage(iconDataUrlBytes(s), ICON_PX);
      const url = img ? imageToDataUrl(img) : '';
      if (!url) throw new Error('Invalid imageData.');
      return url;
    }
    const rel = R.normalizeExtPath(R.pickIconPath(d.path, ICON_PX), ext.id);
    const file = rel ? R.resolveInsideRoot(ext.root, rel) : null;
    if (!file) throw new Error('Invalid icon path.');
    const img = safeIconImage(readIconFile(file), ICON_PX);
    const url = img ? imageToDataUrl(img) : '';
    if (!url) throw new Error(`Could not load action icon '${rel}'.`);
    return url;
  };

  const handleCall = async (extId: string, method: string, raw: unknown): Promise<unknown> => {
    const ext = exts.get(extId);
    if (!ext) throw new Error('Extension is not loaded.');
    const d = R.asDetails(raw);
    const tabId = R.asTabId(d.tabId);
    if (tabId !== undefined && !tabOf(tabId)) throw new Error(`No tab with id: ${tabId}.`);
    const cur = () => R.resolveAction(ext.action, tabId);
    const set = <K extends R.ActionKey>(key: K, value: R.ActionValues[K] | null) => {
      ext.action = R.updateAction(ext.action, key, value, tabId);
      if (tabId !== undefined) watchTab(tabId);
      pushState();
    };
    const str = (v: unknown, what: string, max: number): string | null => {
      if (v === undefined || v === null) {
        if (tabId !== undefined) return null;
        return '';
      }
      if (typeof v !== 'string') throw new Error(`Invalid ${what}.`);
      return v.slice(0, max);
    };
    const alarmName = typeof d.name === 'string' ? d.name : '';
    switch (method) {
      case 'action.setBadgeText': {
        const v = str(d.text, 'text', 64);
        set('badgeText', v === null ? null : R.normalizeBadgeText(v));
        return undefined;
      }
      case 'action.getBadgeText': return cur().badgeText || '';
      case 'action.setBadgeBackgroundColor': {
        const c = R.parseColor(d.color);
        if (!c) throw new Error('The color specification could not be parsed.');
        set('badgeBg', c); return undefined;
      }
      case 'action.getBadgeBackgroundColor': return cur().badgeBg || R.DEFAULT_BADGE_BG;
      case 'action.setBadgeTextColor': {
        const c = R.parseColor(d.color);
        if (!c) throw new Error('The color specification could not be parsed.');
        set('badgeFg', c); return undefined;
      }
      case 'action.getBadgeTextColor': { const v = cur(); return v.badgeFg || R.autoTextColor(v.badgeBg || R.DEFAULT_BADGE_BG); }
      case 'action.setTitle': set('title', str(d.title, 'title', 1024)); return undefined;
      case 'action.getTitle': return cur().title || '';
      case 'action.setIcon': set('icon', loadIcon(ext, d)); return undefined;
      case 'action.setPopup': {
        if (d.popup === null && tabId !== undefined) { set('popup', null); return undefined; }
        const p = R.normalizeExtPath(d.popup, ext.id);
        if (p === null) throw new Error('Invalid popup path.');
        set('popup', p); return undefined;
      }
      case 'action.getPopup': { const p = cur().popup; return p ? R.extensionUrl(ext.id, p) : ''; }
      case 'action.enable': set('enabled', true); return undefined;
      case 'action.disable': set('enabled', false); return undefined;
      case 'action.isEnabled': return cur().enabled !== false;
      case 'tabs.create': {
        const r = R.checkTabUrl(d.url, ext.id);
        if (!r.ok) throw new Error(r.reason);
        const active = d.active !== false;
        const wc = await openTab(r.url, active);
        if (!wc) throw new Error('Could not open the tab.');
        // A webview acabou de nascer: o endereço ainda pode estar vazio — o pedido vai em pendingUrl.
        const see = R.canSeeTabUrl(ext.manifest, r.url, ext.id);
        return { ...tabInfo(wc, active, see), ...(see ? { url: wc.getURL() || '', pendingUrl: r.url } : {}) };
      }
      case 'tabs.remove': {
        const ids = Array.isArray(d.tabIds) ? d.tabIds : [];
        if (!ids.length || ids.length > 500) throw new Error('Invalid tabIds.');
        // Sem repetir: a mesma aba 500 vezes é UM fechamento.
        const tabs = Array.from(new Set(ids.map(id => {
          const n = R.asTabId(id);
          const wc = n === undefined ? null : tabOf(n);
          if (!wc) throw new Error(`No tab with id: ${String(id)}.`);
          return wc;
        })));
        const ok = await Promise.all(tabs.map(closeTab));
        if (ok.some(x => !x)) throw new Error('Could not close the tab.');
        return undefined;
      }
      case 'tabs.subscribe': tabSubs.add(extId); return true;
      case 'runtime.getPlatformInfo': return R.platformInfo(process.platform, process.arch);
      case 'storage.sync.get': return R.storageGet(readSync(extId), d.keys);
      case 'storage.sync.getKeys': return Object.keys(readSync(extId));
      case 'storage.sync.getBytesInUse': return R.storageBytesInUse(readSync(extId), d.keys);
      case 'storage.sync.set': return writeSync(extId, R.storageSet(readSync(extId), d.items));
      case 'storage.sync.remove': return writeSync(extId, R.storageRemove(readSync(extId), d.keys));
      case 'storage.sync.clear': return writeSync(extId, R.storageClear(readSync(extId)));
      case 'alarms.create': {
        const alarm = R.createAlarm(d.name, d.info, Date.now());
        let table = alarmTables.get(extId);
        if (!table) { table = new Map(); alarmTables.set(extId, table); }
        const old = table.get(alarm.name);
        if (!old && table.size >= MAX_ALARMS) throw new Error('Too many alarms.');
        if (old?.timer) clearTimeout(old.timer);
        const slot: AlarmSlot = { alarm, timer: null };
        table.set(alarm.name, slot);
        armAlarm(extId, slot);
        return undefined;
      }
      case 'alarms.get': { const s = alarmTables.get(extId)?.get(alarmName); return s ? { ...s.alarm } : undefined; }
      case 'alarms.getAll': return Array.from(alarmTables.get(extId)?.values() || []).map(s => ({ ...s.alarm }));
      case 'alarms.clear': {
        const table = alarmTables.get(extId);
        const s = table?.get(alarmName);
        if (!table || !s) return false;
        if (s.timer) clearTimeout(s.timer);
        table.delete(alarmName);
        return true;
      }
      case 'alarms.clearAll': clearAlarmTable(extId); return true;
      default: {
        const r = apis ? apis.handle(ext, method, d) : NOT_MINE;
        if (r !== NOT_MINE) return r;
        throw new Error(`${method} is not supported in Bah yet.`);
      }
    }
  };

  // Páginas da extensão (popup, opções) chamam pelo ipcMain normal; o ID vem da ORIGEM do frame.
  ipcMain.handle(CALL, (e, method: unknown, details: unknown) => {
    const ev: any = e;
    let src = '';
    if (ev.type === 'service-worker') src = String(ev.serviceWorker?.scope || '');
    else {
      if (e.sender.session !== ses) throw new Error('Not allowed.');
      src = String(e.senderFrame?.origin || '');
    }
    const extId = R.extensionIdFromUrl(src);
    if (!extId || !exts.has(extId)) throw new Error('Not allowed.');
    return handleCall(extId, String(method), details);
  });

  // ── 6. Workers das extensões: atendimento + mantidos vivos ─────────────────
  // Igual a um background persistente: sem isso o Chromium para o worker ocioso em ~30s e
  // os timers da extensão (a cotação a cada 10 min do Dólar Hoje) param junto.
  const dropWorker = (versionId: number) => {
    const w = workers.get(versionId);
    if (!w) return;
    workers.delete(versionId);
    try { w.task?.end(); } catch {}
    try { if (!w.worker.isDestroyed()) w.worker.ipc.removeHandler(CALL); } catch {}
  };
  const startTask = (worker: Electron.ServiceWorkerMain) => {
    try { return worker.startTask(); } catch { return null; }
  };
  const attachWorker = (worker: Electron.ServiceWorkerMain | undefined): WorkerEntry | null => {
    if (!worker || worker.isDestroyed()) return null;
    const extId = R.extensionIdFromUrl(worker.scope);
    if (!extId) return null;
    if (!exts.has(extId)) {
      const e = ses.extensions.getExtension(extId);
      if (!e || !register(e)) return null;
      pushState();
    }
    const old = workers.get(worker.versionId);
    if (old && old.worker === worker && !worker.isDestroyed()) {
      if (!old.task) old.task = startTask(worker);
      return old;
    }
    if (old) dropWorker(worker.versionId);
    try { worker.ipc.removeHandler(CALL); } catch {}
    worker.ipc.handle(CALL, (_e, method: unknown, details: unknown) => handleCall(extId, String(method), details));
    const entry: WorkerEntry = { worker, extId, task: startTask(worker) };
    workers.set(worker.versionId, entry);
    return entry;
  };
  ses.serviceWorkers.on('running-status-changed', (ev) => {
    const { versionId, runningStatus } = ev;
    if (runningStatus === 'stopping' || runningStatus === 'stopped') { dropWorker(versionId); return; }
    let worker: Electron.ServiceWorkerMain | undefined;
    try { worker = ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { return; }
    if (worker && R.extensionIdFromUrl(worker.scope)) attachWorker(worker);
  });
  // Só liga o worker depois do 'extension-ready': antes disso a rede ainda não sabe que a
  // extensão pode acessar os sites dela (host_permissions) e o fetch do começo leva bloqueio
  // de CORS — visto ao vivo (1 em 8 aberturas, o Dólar Hoje ficava sem cotação por 10 min).
  const ready = new Set<string>();
  const readyWaiters = new Map<string, Set<(ok: boolean) => void>>();
  waitReady = (extId: string, ms: number) => new Promise<boolean>(resolve => {
    if (ready.has(extId)) { resolve(true); return; }
    let set = readyWaiters.get(extId);
    if (!set) { set = new Set(); readyWaiters.set(extId, set); }
    const done = (ok: boolean) => {
      clearTimeout(timer);
      const cur = readyWaiters.get(extId);
      if (cur) { cur.delete(done); if (!cur.size) readyWaiters.delete(extId); }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    set.add(done);
  });
  const wakeReady = (extId: string, ok: boolean) => {
    for (const fn of Array.from(readyWaiters.get(extId) || [])) fn(ok);
  };
  startWorker = (extId: string) => {
    const ext = exts.get(extId);
    if (!ext?.hasWorker || !ready.has(extId)) return Promise.resolve(null);
    return ses.serviceWorkers.startWorkerForScope(`chrome-extension://${extId}/`)
      .then(w => attachWorker(w))
      .catch(() => null);   // o registro do worker ainda não terminou: 'registration-completed' tenta de novo
  };
  ses.serviceWorkers.on('registration-completed', (_e, d) => {
    const id = R.extensionIdFromUrl(d?.scope);
    if (id && exts.has(id)) void startWorker(id);
  });
  // O que a extensão escreve no console do background aparece no log do Bah.
  ses.serviceWorkers.on('console-message', (_e, m) => {
    const id = R.extensionIdFromUrl(m?.sourceUrl);
    if (!id) return;
    const name = exts.get(id)?.name || id;
    const say = m.level >= 3 ? console.warn : console.log;
    say(`[Extensão ${name}] ${m.message}`);
  });

  // ── 7. Carregou / descarregou ──────────────────────────────────────────────
  ses.extensions.on('extension-loaded', (_e, ext) => {
    if (!register(ext)) return;
    apis?.extensionLoaded(ext.id);
    pushState();
  });
  // Pronta = a rede já conhece as permissões dela. Aí liga o worker, pro badge aparecer já,
  // sem esperar o primeiro clique.
  ses.extensions.on('extension-ready', (_e, ext) => {
    ready.add(ext.id);
    if (exts.has(ext.id)) void startWorker(ext.id);
    wakeReady(ext.id, true);
  });
  ses.extensions.on('extension-unloaded', (_e, ext) => {
    ready.delete(ext.id);
    wakeReady(ext.id, false);
    tabSubs.delete(ext.id);
    if (popup?.extId === ext.id) closePopup();
    for (const [v, w] of Array.from(workers)) if (w.extId === ext.id) dropWorker(v);
    clearAlarmTable(ext.id);
    exts.delete(ext.id);
    apis?.extensionUnloaded(ext.id);
    pushState();
  });
  for (const ext of ses.extensions.getAllExtensions()) {
    // Desligada que já estava carregada (não deveria acontecer): sai agora.
    if (isDisabled(ext.id)) { try { ses.extensions.removeExtension(ext.id); } catch {} continue; }
    register(ext); ready.add(ext.id);   // já carregadas antes = já prontas
  }

  // ── 8. Popup do botão ──────────────────────────────────────────────────────
  let popup: { win: BrowserWindow; extId: string } | null = null;
  let lastClosed = { extId: '', at: 0 };
  const closePopup = () => {
    if (!popup) return;
    const p = popup;
    popup = null;
    lastClosed = { extId: p.extId, at: Date.now() };
    try {
      if (!p.win.isDestroyed()) {
        p.win.close();
        // Reserva: se algo ainda segurar a janela, ela sai à força (o Chrome sempre fecha o popup).
        setTimeout(() => { try { if (!p.win.isDestroyed()) p.win.destroy(); } catch {} }, 1000);
      }
    } catch {}
  };
  const openPopup = (ext: LoadedExt, rel: string, anchor: Anchor | null) => {
    // Clicar no MESMO ícone com o popup aberto fecha. O clique tira o foco do popup antes
    // de chegar aqui (blur fecha), então "acabou de fechar este" também conta como fechar.
    if (popup && popup.extId === ext.id) { closePopup(); return; }
    if (lastClosed.extId === ext.id && Date.now() - lastClosed.at < 400) return;
    closePopup();
    const mw = deps.getMainWindow();
    if (!mw || mw.isDestroyed()) return;
    const win = new BrowserWindow({
      parent: mw, show: false, frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      width: 25, height: 25, useContentSize: true, backgroundColor: '#ffffff',
      webPreferences: {
        session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false,
        enablePreferredSizeMode: true, spellcheck: false,
      },
    });
    popup = { win, extId: ext.id };
    // O beforeunload da página não pode cancelar o fechamento (ficaria um popup órfão que
    // não fecha mais). Os handlers de unload/pagehide continuam rodando — a extensão salva.
    win.webContents.on('will-prevent-unload', (ev) => ev.preventDefault());
    let size = { width: 25, height: 25 };
    const place = () => {
      if (win.isDestroyed() || mw.isDestroyed()) return;
      const cb = mw.getContentBounds();
      const work = screen.getDisplayMatching(cb).workArea;
      const a = anchor || { left: 0, top: 0, right: cb.width - 8, bottom: 52 };
      let zoom = 1;
      try { zoom = mw.webContents.getZoomFactor() || 1; } catch {}
      const pos = R.popupPosition(a, cb, size, work, zoom);
      win.setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height });
    };
    let shown = false;
    const show = () => {
      if (shown || win.isDestroyed() || popup?.win !== win) return;
      shown = true; place(); win.show(); win.focus();
    };
    win.webContents.on('preferred-size-changed', (_e, s) => { size = R.clampPopupSize(s.width, s.height); place(); show(); });
    win.webContents.once('did-finish-load', () => setTimeout(show, 150));   // página que não avisa o tamanho
    win.on('blur', () => { if (popup?.win === win) closePopup(); });
    win.on('closed', () => { if (popup?.win === win) popup = null; });
    win.webContents.on('before-input-event', (ev, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { ev.preventDefault(); closePopup(); }
    });
    // Link do popup abre numa aba do Bah (só http/https ou página da própria extensão).
    const toTab = (url: string) => { const r = R.checkTabUrl(url, ext.id); if (r.ok && r.url) void openTab(r.url, true); };
    win.webContents.setWindowOpenHandler(({ url }) => { toTab(url); closePopup(); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (ev, url) => {
      if (R.extensionIdFromUrl(url) === ext.id) return;
      ev.preventDefault(); toTab(url); closePopup();
    });
    win.loadURL(R.extensionUrl(ext.id, rel)).catch(err => {
      console.warn(`[Extensões] popup de ${ext.name} não abriu:`, err?.message || err);
      if (popup?.win === win) closePopup();
    });
  };

  // ── 9. Clique no ícone ─────────────────────────────────────────────────────
  const dispatchClick = async (ext: LoadedExt, tab: WebContents | null) => {
    let entry = findWorker(ext.id);
    if (!entry) entry = await startWorker(ext.id);
    if (!entry || entry.worker.isDestroyed()) return false;
    // O clique no botão conta como activeTab (o Chrome também libera a aba nessa hora) —
    // mas só pra quem declarou activeTab/tabs/host. O resto recebe a aba sem url/título.
    const info = tab ? tabInfo(tab, true, R.canSeeTabUrl(ext.manifest, tab.getURL(), ext.id)) : { id: -1, index: -1, windowId: 1, active: true };
    entry.worker.send(EVENT, 'action.onClicked', [info]);
    return true;
  };

  // ── 10. Aprovação de acesso, remoção de verdade ────────────────────────────
  // Igual ao Chrome: o que a pessoa aprovou fica guardado por extensão. Versão nova (ou o
  // .crx baixado) que pede MAIS do que isso só carrega depois de a pessoa aprovar de novo;
  // se ela recusar, a extensão fica desligada (os arquivos ficam, e pergunta no próximo início).
  const grantsPath = path.join(userData, 'extension-grants.json');
  const tombstonesPath = path.join(userData, 'extension-tombstones.json');
  const grants: Record<string, R.AccessGrant & { version?: string }> = {};
  {
    const raw = readJsonFile(grantsPath);
    if (raw && typeof raw === 'object') {
      for (const [id, g] of Object.entries(raw as Record<string, unknown>)) {
        const ok = R.isExtensionId(id) ? R.asGrant(g) : null;
        if (ok) grants[id] = { ...ok, version: typeof (g as any)?.version === 'string' ? (g as any).version : '' };
      }
    }
  }
  const saveGrants = () => writeJsonFile(grantsPath, grants);
  // Aprovado no diálogo da loja, ainda não carregou (aí confere com o .crx de verdade).
  const pendingGrants = new Map<string, R.AccessGrant>();
  // Removidas: nada delas carrega de novo (nem uma atualização que estava baixando na hora).
  const tombstones = new Set<string>(
    (() => { const raw = readJsonFile(tombstonesPath); return Array.isArray(raw) ? raw.filter(R.isExtensionId) : []; })(),
  );
  const saveTombstones = () => writeJsonFile(tombstonesPath, Array.from(tombstones));
  // Desligada que foi removida, ou cuja pasta sumiu do disco: sai da lista.
  {
    let changed = false;
    for (const id of Object.keys(disabledSet)) {
      const e = disabledSet[id];
      const onDisk = (e.path && fs.existsSync(e.path)) || fs.existsSync(path.join(extensionsPath, id));
      if (tombstones.has(id) || !onDisk) { delete disabledSet[id]; changed = true; }
    }
    if (changed) saveDisabled();
  }
  // No início, antes de qualquer extensão abrir os bancos dela: apaga o que sobrou das removidas.
  for (const id of tombstones) {
    const dirs = [path.join(extensionsPath, id), syncFile(id)];
    if (ses.storagePath) {
      for (const sub of ['Local Extension Settings', 'Sync Extension Settings', 'Managed Extension Settings']) dirs.push(path.join(ses.storagePath, sub, id));
    }
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { console.warn('[Extensões] limpeza de removida falhou:', d, e); } }
  }

  const accessLines = (a: R.AccessGrant): string[] => {
    const lines: string[] = [];
    if (a.all) lines.push(deps.t('ext.install.allSites'));
    else if (a.hosts.length) {
      const shown = a.hosts.slice(0, 6).join(', ') + (a.hosts.length > 6 ? ', …' : '');
      lines.push(fmt('ext.install.hosts', { hosts: shown }));
    }
    return lines;
  };
  const askMoreAccess = async (name: string, more: R.AccessGrant): Promise<boolean> => {
    const perms = R.permissionLineKeys(more.permissions);
    const lines = [deps.t('ext.update.can'), ...perms.keys.map(k => deps.t(k)), ...accessLines(more)];
    if (perms.rest.length) lines.push(fmt('ext.update.perms', { list: perms.rest.join(', ') }));
    const r = await showBox({
      type: 'question',
      title: deps.t('ext.update.title'),
      message: fmt('ext.update.question', { name }),
      detail: lines.join('\n'),
      buttons: [deps.t('ext.update.allow'), deps.t('ext.update.keepOff')],
      defaultId: 1, cancelId: 1, noLink: true,
    });
    return r.response === 0;
  };

  // Todo carregamento passa por session.extensions.loadExtension: o do início, o da loja e o
  // da atualização automática da biblioteca. A trava fica ANTES de carregar — a versão que
  // pede mais nunca roda sem aprovação.
  const exApi = ses.extensions;
  const origLoad = exApi.loadExtension.bind(exApi);
  const gatedLoad = async (extPath: string, opts?: Electron.LoadExtensionOptions): Promise<Electron.Extension> => {
    let manifest: any = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8')); } catch {}
    const id = R.extensionIdFromKey(manifest?.key);
    if (!id) return origLoad(extPath, opts);   // sem "key" = não veio da loja (o Bah não carrega)
    if (tombstones.has(id)) {
      try { await fs.promises.rm(extPath, { recursive: true, force: true }); } catch {}
      throw new Error('This extension was removed.');
    }
    // Desligada no interruptor: não carrega (início, atualização automática, loja). Sem erro:
    // quem chamou (a biblioteca) só confere "if (extension)" e segue — nada de log assustador.
    // Ligar de novo marca o ID em "enabling" (ele só sai da lista de desligadas depois de carregar).
    if (R.blockedAsDisabled(id, disabledSet, enabling)) {
      console.log(`[Extensões] ${disabledSet[id].name}: desligada — não carregada.`);
      return undefined as unknown as Electron.Extension;
    }
    const pending = pendingGrants.get(id);
    const base = pending || R.asGrant(grants[id]);
    // Sem base nenhuma (já estava no disco antes de existir este registro): o que ela tem
    // hoje vira a base, sem perguntar.
    if (base) {
      const more = R.accessIncrease(base, manifest);
      if (more) {
        const name = R.localizeMessage(manifest?.name, readMessages(extPath, manifest)) || id;
        if (!(await askMoreAccess(name, more))) {
          pendingGrants.delete(id);
          // Instalação nova recusada: o que acabou de baixar sai. Atualização recusada: fica
          // tudo no disco (versão velha e nova) e a extensão desligada até aprovar.
          if (pending && !grants[id]) { try { await fs.promises.rm(path.join(extensionsPath, id), { recursive: true, force: true }); } catch {} }
          console.warn(`[Extensões] ${name}: acesso novo não aprovado — não carregada.`);
          throw new Error(NOT_APPROVED);
        }
      }
    }
    pendingGrants.delete(id);
    grants[id] = { ...R.accessGrant(manifest), version: String(manifest?.version || '') };
    saveGrants();
    return origLoad(extPath, opts);
  };
  let gated = false;
  try {
    (exApi as any).loadExtension = gatedLoad;
    gated = ses.extensions === exApi && ses.extensions.loadExtension === gatedLoad;
  } catch {}
  if (!gated) console.error('[Extensões] não deu pra conferir permissões no carregamento — atualização automática DESLIGADA.');

  // Remover de verdade: descarrega, apaga a pasta, os dados (storage, IndexedDB, cache…) e
  // marca como removida — uma atualização baixando nessa hora não traz ela de volta.
  const removeExtension = async (extId: string) => {
    if (popup?.extId === extId) closePopup();
    tombstones.add(extId);
    saveTombstones();
    clearAlarmTable(extId);
    apis?.extensionGone(extId);   // proxy/WebRTC voltam ao normal já
    try {
      // Desligada também: não está carregada, mas a pasta Extensions/<id> sai do mesmo jeito.
      await uninstallExtension(extId, { session: ses, extensionsPath });
    } finally {
      if (isDisabled(extId)) { delete disabledSet[extId]; saveDisabled(); pushState(); }
      delete grants[extId];
      saveGrants();
      pendingGrants.delete(extId);
      syncCache.delete(extId);
      try { fs.rmSync(syncFile(extId), { force: true }); } catch {}
      try { await ses.clearStorageData({ origin: `chrome-extension://${extId}` }); } catch (e) { console.warn('[Extensões] limpar dados falhou:', e); }
      if (exts.delete(extId)) pushState();   // caso o 'extension-unloaded' não venha
    }
  };

  // ── 10b. Ligar / desligar (igual ao interruptor do chrome://extensions) ─────
  // Desligar = descarregar da sessão: scripts de conteúdo, worker, alarmes, popup e botão
  // param. Os arquivos, o chrome.storage, o sync e o acesso aprovado ficam. Ligar = carregar
  // de novo da pasta pelo MESMO carregador com trava (aprovação de acesso e removidas valem).
  const findInstallDir = (id: string, entry: R.DisabledEntry | null): { path: string; version: string; manifest: any } | null => {
    const cands: Array<{ path: string; version: string; manifest: any }> = [];
    const seen = new Set<string>();
    const consider = (dir: string) => {
      const key = path.resolve(dir).toLowerCase();
      if (seen.has(key) || !R.isInsideDir(extensionsPath, dir)) return;
      seen.add(key);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        if (R.extensionIdFromKey(manifest?.key) === id) cands.push({ path: path.resolve(dir), version: String(manifest.version || ''), manifest });
      } catch {}
    };
    if (entry?.path) consider(entry.path);
    // A atualização automática pode ter trocado a pasta da versão (apaga a antiga depois de
    // baixar a nova): procura em Extensions/<id> e fica com a versão mais nova, como a biblioteca.
    const base = path.join(extensionsPath, id);
    consider(base);
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) if (d.isDirectory()) consider(path.join(base, d.name));
    } catch {}
    return R.pickLatestVersion(cands);
  };
  const toggling = new Set<string>();
  const setExtensionEnabled = async (id: string, on: boolean): Promise<{ ok: boolean; error?: string; quiet?: boolean }> => {
    if (tombstones.has(id)) return { ok: false, error: 'This extension was removed.' };
    if (toggling.has(id)) return { ok: false, error: 'busy', quiet: true };
    toggling.add(id);
    try {
      if (on) {
        if (!isDisabled(id)) return { ok: !!ses.extensions.getExtension(id) };
        const entry = disabledSet[id];
        const found = findInstallDir(id, entry);
        if (!found) return { ok: false, error: 'Extension files not found.' };
        // Continua na lista de desligadas (no arquivo e no menu) até carregar de verdade: se o
        // Bah fechar com o diálogo de acesso aberto, ela segue desligada no próximo início, e a
        // linha não some do menu enquanto carrega. "enabling" deixa só ESTE carregamento passar.
        enabling.add(id);
        try {
          const ext = await ses.extensions.loadExtension(found.path);
          if (!ext || ext.id !== id) throw new Error('Extension did not load.');
          delete disabledSet[id];
          saveDisabled();
          if (!exts.has(id)) register(ext);
          // Ligou de novo: o proxy/WebRTC que ela controlava antes de desligar volta (igual ao Chrome).
          apis?.extensionEnabled(id);
          // O worker liga sozinho no 'extension-ready' (a rede já sabe das permissões).
        } catch (err: any) {
          // Não carregou (acesso novo recusado, arquivo estragado…): continua desligada — a
          // entrada nunca saiu da lista (se foi removida no meio, o removeExtension já tirou).
          pushState();
          const msg = String(err?.message || err);
          console.warn(`[Extensões] ligar ${entry.name} falhou:`, msg);
          // Recusou o acesso novo no diálogo: a pessoa já sabe, a tela não avisa de novo.
          return { ok: false, error: msg, quiet: msg === NOT_APPROVED };
        } finally {
          enabling.delete(id);
        }
        pushState();
        return { ok: true };
      }
      const ext = ses.extensions.getExtension(id);
      if (!ext) return { ok: isDisabled(id) };
      const loaded = exts.get(id) || register(ext);
      const view = loaded ? viewOf(loaded) : null;
      disabledSet[id] = R.sanitizeDisabledEntry(id, {
        name: loaded?.name || ext.name, version: loaded?.version || ext.version,
        icon: view?.global.icon || loaded?.defaultIcon || '', path: ext.path,
      }, extensionsPath);
      saveDisabled();
      if (popup?.extId === id) closePopup();
      clearAlarmTable(id);
      apis?.extensionDisabled(id);   // desligou a VPN: as abas voltam a sair direto (o proxy dela fica guardado)
      for (const [v, w] of Array.from(workers)) if (w.extId === id) dropWorker(v);
      try {
        ses.extensions.removeExtension(id);
      } catch (err: any) {
        delete disabledSet[id];
        saveDisabled();
        pushState();
        return { ok: false, error: String(err?.message || err) };
      }
      // O 'extension-unloaded' faz o mesmo; aqui garante caso ele não venha.
      ready.delete(id);
      exts.delete(id);
      pushState();
      return { ok: true };
    } finally {
      toggling.delete(id);
    }
  };

  // ── 10c. proxy/VPN, privacy, cookies, notificações, management ─────────────
  // chrome.management.ExtensionInfo de todas (a loja e as extensões com "management" veem as
  // desligadas também, com enabled: false).
  const managementList = (): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = [];
    for (const ext of ses.extensions.getAllExtensions()) {
      if (!R.isExtensionId(ext.id)) continue;
      const on = !isDisabled(ext.id);
      out.push({ ...R.managementInfo(ext.id, ext.manifest, on, exts.get(ext.id)?.name), ...(on ? {} : { disabledReason: 'unknown' }) });
    }
    for (const [id, entry] of Object.entries(disabledSet)) {
      if (ses.extensions.getExtension(id)) continue;
      const manifest = findInstallDir(id, entry)?.manifest || { name: entry.name, version: entry.version };
      out.push({ ...R.managementInfo(id, manifest, false, entry.name), disabledReason: 'unknown' });
    }
    return out;
  };
  apis = setupExtensionApis({
    ses, userData,
    getExt: (id) => exts.get(id),
    loaded: () => Array.from(exts.values()),
    send: sendToExtension,
    sendToWorker,
    pushState,
    managementList,
    confirmSelfUninstall: async (name) => {
      const r = await showBox({
        type: 'question',
        title: deps.t('ext.uninstall.title'),
        message: fmt('ext.uninstall.question', { name }),
        detail: deps.t('ext.selfUninstall.detail'),
        buttons: [deps.t('ext.uninstall.remove'), deps.t('ext.install.cancel')],
        defaultId: 1, cancelId: 1, noLink: true,
      });
      return r.response === 0;
    },
    removeExtension,
    disableExtension: async (id) => { await setExtensionEnabled(id, false); },
    // No início (antes de carregar): instalada, não removida e com a permissão aprovada. Desligada
    // conta como instalada (o controle fica pausado até ligar de novo).
    canKeepControl: (id, perm) => R.isExtensionId(id) && !tombstones.has(id) &&
      fs.existsSync(path.join(extensionsPath, id)) && !!grants[id]?.permissions.includes(perm),
    isDisabled,
    readJson: readJsonFile,
    writeJson: writeJsonFile,
  });

  // ── 11. Pedidos da tela do Bah ─────────────────────────────────────────────
  ipcMain.handle('extensions:get-state', () => listView());
  ipcMain.handle('extensions:action-click', async (e, extId: unknown, wcId: unknown, anchorRaw: unknown) => {
    if (!fromMainWindow(e)) return { ok: false };
    const ext = exts.get(String(extId));
    if (!ext) return { ok: false };
    const tab = typeof wcId === 'number' && Number.isInteger(wcId) ? tabOf(wcId) : null;
    const v = R.resolveAction(ext.action, tab ? tab.id : undefined);
    if (v.enabled === false) return { ok: false, disabled: true };
    if (v.popup) { openPopup(ext, v.popup, R.asAnchor(anchorRaw)); return { ok: true, popup: true }; }
    return { ok: await dispatchClick(ext, tab) };
  });
  ipcMain.handle('extensions:remove', async (e, extId: unknown) => {
    if (!fromMainWindow(e) || !R.isExtensionId(extId)) return { ok: false };
    try {
      await removeExtension(extId);
      return { ok: true };
    } catch (err: any) {
      console.warn('[Extensões] remover falhou:', err?.message || err);
      return { ok: false, error: String(err?.message || err) };
    }
  });
  ipcMain.handle('extensions:set-enabled', async (e, extId: unknown, on: unknown) => {
    if (!fromMainWindow(e) || !R.isExtensionId(extId) || typeof on !== 'boolean') return { ok: false };
    return setExtensionEnabled(extId, on);
  });
  ipcMain.handle('extensions:open-store', (e) => {
    if (!fromMainWindow(e)) return { ok: false };
    void openTab(`${STORE_ORIGIN}/`, true);
    return { ok: true };
  });
  ipcMain.handle('extensions:open-options', (e, extId: unknown) => {
    if (!fromMainWindow(e)) return { ok: false };
    const ext = exts.get(String(extId));
    if (!ext?.options) return { ok: false };
    void openTab(R.extensionUrl(ext.id, ext.options), true);
    return { ok: true };
  });

  // ── 12. Loja + instalação ──────────────────────────────────────────────────
  const beforeInstall = async (details: { id: string; localizedName: string; manifest: any; icon: Electron.NativeImage; frame?: Electron.WebFrameMain }) => {
    // Só a loja de verdade instala, e só com um ID de verdade (o ID vira caminho no disco).
    let frameOrigin = '';
    try { frameOrigin = String(details.frame?.origin || ''); } catch {}
    if (!R.isExtensionId(details.id) || frameOrigin !== STORE_ORIGIN) return { action: 'deny' as const };
    // Já instalada e desligada: a loja oferece "Ativar" (setEnabled), não instalar de novo.
    if (isDisabled(details.id)) return { action: 'deny' as const };
    const manifest = details.manifest || {};
    const name = details.localizedName || manifest.name || details.id;
    const access = R.hostAccessSummary(manifest);
    const missing = R.unsupportedFeatures(manifest);
    const lines: string[] = [];
    const hostLines = accessLines({ permissions: [], ...access });
    const permLines = R.permissionLineKeys(R.accessGrant(manifest).permissions).keys.map(k => deps.t(k));
    if (hostLines.length || permLines.length) lines.push(deps.t('ext.install.can'), ...permLines, ...hostLines);
    if (missing.length) lines.push('', fmt('ext.install.unsupported', { list: missing.join(', ') }));
    let icon: Electron.NativeImage | undefined;
    try { if (details.icon && !details.icon.isEmpty()) icon = details.icon.resize({ width: 64, height: 64, quality: 'best' }); } catch {}
    const r = await showBox({
      type: 'question',
      title: deps.t('ext.install.title'),
      message: fmt('ext.install.question', { name }),
      detail: lines.join('\n'),
      buttons: [deps.t('ext.install.add'), deps.t('ext.install.cancel')],
      defaultId: 1, cancelId: 1, noLink: true,
      ...(icon ? { icon } : {}),
    });
    if (r.response !== 0) return { action: 'deny' as const };
    // O que a pessoa viu e aprovou. O .crx baixado é conferido contra isso antes de carregar.
    pendingGrants.set(details.id, R.accessGrant(manifest));
    if (tombstones.delete(details.id)) saveTombstones();
    return { action: 'allow' as const };
  };

  const libPreload = (() => { try { return require.resolve('electron-chrome-web-store/preload'); } catch { return ''; } })();
  if (!libPreload || !fs.existsSync(libPreload)) {
    console.error(`[Extensões] preload da Chrome Web Store não encontrado (${libPreload || 'sem caminho'}) — o botão "Usar no Chrome" não vai funcionar.`);
  }
  installChromeWebStore({
    session: ses,
    extensionsPath,
    autoUpdate: gated,
    loadExtensions: true,
    allowUnpackedExtensions: false,
    minimumManifestVersion: 3,
    beforeInstall,
  }).then(() => {
    console.log(`[Extensões] ${ses.extensions.getAllExtensions().length} carregada(s) de ${extensionsPath}`);
  }).catch(err => console.error('[Extensões] Chrome Web Store falhou ao iniciar:', err))
    // Quem controlava o proxy e não carregou (pasta estragada, acesso novo recusado…) solta agora.
    .finally(() => apis?.startupLoaded());

  // A biblioteca registra os handlers da loja de forma síncrona logo no começo da chamada
  // acima. Alguns o Bah troca pelos dele — mesma checagem de origem EXATA e mesma sessão.
  const storeHandle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      let origin = '';
      try { origin = String(e.senderFrame?.origin || ''); } catch {}
      if (origin !== STORE_ORIGIN || e.sender.session !== ses) return undefined;
      return fn(e, ...args);
    });
  };
  const installed = (id: unknown): id is string => R.isExtensionId(id) && (!!ses.extensions.getExtension(id) || isDisabled(id));

  // O "remover" da biblioteca apaga path.join(Extensions, id) com o id do jeito que a página
  // mandou ('..' apagaria a pasta de dados inteira) e sem perguntar: troca pelo do Bah.
  storeHandle('chrome.management.uninstall', async (e, id) => {
    if (!installed(id)) return 'unknown_error';
    // O Chrome sempre confirma quando a loja pede pra remover.
    const name = exts.get(id)?.name || ses.extensions.getExtension(id)?.name || disabledSet[id]?.name || id;
    const r = await showBox({
      type: 'question',
      title: deps.t('ext.uninstall.title'),
      message: fmt('ext.uninstall.question', { name }),
      detail: deps.t('ext.uninstall.detail'),
      buttons: [deps.t('ext.uninstall.remove'), deps.t('ext.install.cancel')],
      defaultId: 1, cancelId: 1, noLink: true,
    });
    if (r.response !== 0) return 'user_cancelled';
    try {
      await removeExtension(id);
      queueMicrotask(() => { try { if (!e.sender.isDestroyed()) e.sender.send('chrome.management.onUninstalled', id); } catch {} });
      return 'success';
    } catch (err) {
      console.error('[Extensões] remover pela loja falhou:', err);
      return 'unknown_error';
    }
  });
  // Desligada: a loja mostra "Ativar este item" em vez de "Usar no Bah".
  storeHandle('chromeWebstore.getExtensionStatus', (_e, id, manifestJson) => {
    let manifest: any = null;
    try { manifest = typeof manifestJson === 'string' ? JSON.parse(manifestJson) : null; } catch {}
    const ok = R.isExtensionId(id);
    return R.storeInstallStatus({
      manifest, minimumManifestVersion: 3,
      loaded: ok && !!ses.extensions.getExtension(id), disabledByUser: ok && isDisabled(id),
    });
  });
  // O botão da loja liga (ou desliga) uma JÁ instalada. Sem diálogo: a pessoa clicou no botão,
  // igual ao Chrome. A versão que pedir mais acesso ainda pergunta (carregador com trava).
  storeHandle('chrome.management.setEnabled', async (_e, id, on) => {
    if (!installed(id) || typeof on !== 'boolean') return false;
    return (await setExtensionEnabled(id, on)).ok;
  });
  // A lista que a loja vê inclui as desligadas (enabled: false).
  storeHandle('chrome.management.getAll', () => managementList());

  // O preload da biblioteca também é registrado de forma síncrona lá em cima.
  if (libPreload) guardStorePreload(ses, libPreload);
  else { try { ses.unregisterPreloadScript('electron-chrome-web-store'); } catch {} }
}

// O preload da loja se liga em qualquer endereço que COMECE com
// "https://chromewebstore.google.com" — então "https://chromewebstore.google.com.site-ruim.tld"
// também ganhava a API da loja. Aqui o Bah troca pelo mesmo preload embrulhado numa checagem
// de origem EXATA, com o nome "Bah" e SEM o disfarce de Mac. Se qualquer coisa falhar, o da
// biblioteca sai do mesmo jeito: a loja só perde o botão nesta sessão (falha FECHADA).
function guardStorePreload(ses: Session, libPreload: string): void {
  try {
    // A loja troca "Chrome" pelo nome do app nos botões ("Usar no …"). O nome interno do Bah é
    // "bah-browser" (é o da pasta de dados, não dá pra mudar) — aqui vira "Bah".
    const BRAND_FROM = 'setAppName(result.app_name)';
    let src = fs.readFileSync(libPreload, 'utf8');
    if (src.includes(BRAND_FROM)) src = src.replace(BRAND_FROM, 'setAppName("Bah")');
    else console.warn('[Extensões] preload da loja mudou — os botões vão mostrar o nome interno do app.');
    // A troca pega QUALQUER texto com "Chrome" — o aviso do Google "Instalar o Google Chrome"
    // virava "Instalar o Google Bah". Só os botões mudam; o que diz "Google Chrome" fica.
    const BRAND_FILTER = '(node) => node.innerText.includes("Chrome")';
    if (src.includes(BRAND_FILTER)) src = src.replace(BRAND_FILTER, '(node) => node.innerText.includes("Chrome") && !node.innerText.includes("Google Chrome")');
    // A biblioteca também finge que a página está num Mac (navigator.userAgent), enquanto os
    // cabeçalhos e o userAgentData dizem Windows. Sem disfarce: o Bah não usa isso. Se o texto
    // mudou numa versão nova da biblioteca, NÃO segue com o disfarce: vai pro catch.
    const UA_FROM = 'overrideUserAgent();';
    if (!src.includes(UA_FROM)) throw new Error('o preload da loja mudou (overrideUserAgent não encontrado)');
    src = src.replace(UA_FROM, '/* overrideUserAgent() desligado pelo Bah */');
    const out = path.join(app.getPath('userData'), 'bah-webstore-preload.js');
    const code = [
      '"use strict";',
      '// Gerado pelo Bah a cada início (electron-chrome-web-store, MIT) — só roda na loja de verdade.',
      `if (location.origin === ${JSON.stringify(STORE_ORIGIN)}) {`,
      // A biblioteca faz chrome.webstorePrivate = … e Object.assign(chrome.runtime/management, …)
      // no mundo da página; garante que esses objetos existem antes (sem trocar os que já há).
      '  try { require("electron").webFrame.executeJavaScript("globalThis.chrome = globalThis.chrome || {}; chrome.runtime = chrome.runtime || {}; chrome.management = chrome.management || {}; void 0;"); } catch (e) {}',
      src,
      '}',
      '',
    ].join('\n');
    // Gera de novo a cada início; se trocar o arquivo falhar (antivírus segurando o antigo),
    // usa o .tmp, que já está completo.
    let filePath = out;
    fs.writeFileSync(out + '.tmp', code);
    try { fs.renameSync(out + '.tmp', out); } catch { filePath = out + '.tmp'; }
    ses.registerPreloadScript({ id: 'bah-webstore', type: 'frame', filePath });
  } catch (e) {
    console.error('[Extensões] preload da loja do Bah não montou — o botão da Chrome Web Store fica desligado nesta sessão (sem disfarce de Mac e sem a checagem de origem frouxa):', e);
  }
  try { ses.unregisterPreloadScript('electron-chrome-web-store'); }
  catch (e) { console.error('[Extensões] não deu pra tirar o preload original da loja:', e); }
}
