// APIs de rede e privacidade das extensões do Chrome no Bah — o que uma VPN/proxy da Chrome Web
// Store precisa (medido no Electron 44: proxy.settings é casca, privacy/cookies/notifications
// não existem, webRequest.onAuthRequired nunca dispara):
//  - chrome.proxy.settings: DE VERDADE, só na sessão das abas (persist:browser). Uma extensão
//    controla de cada vez (a do set() mais recente), guardado em userData e reaplicado no
//    início se ela continuar instalada e ligada. Sem ninguém controlando = proxy do sistema.
//    Desligar a extensão só PAUSA o controle (igual ao Chrome): ligar de novo devolve; só
//    remover apaga.
//  - webRequest.onAuthRequired: emulado pelo evento 'login' do Electron. SÓ o login de PROXY,
//    SÓ pra extensão que controla o proxy. Login de site nunca vai pra extensão.
//  - chrome.privacy: webRTCIPHandlingPolicy DE VERDADE (todas as abas); o resto o Bah não
//    aplica e diz isso ("not_controllable"), como o Chrome faz com o que não dá pra controlar.
//  - chrome.cookies, chrome.notifications, chrome.management (o que faltava).
// O calço (extension-shim-preload) chama aqui pelo handleCall de chrome-extensions.ts; o ID
// da extensão vem SEMPRE de quem chamou, nunca dos argumentos.
//
// Fora do alcance (de propósito): as outras sessões do Bah (a padrão: chamadas da IA, login do
// Google numa janela à parte etc.) NÃO passam pelo proxy da extensão. O motor de downloads de
// várias conexões devolve o download pro Chromium quando a aba usa proxy; o botão de baixar
// vídeo (yt-dlp) e o torrent avisam antes de sair direto (main.ts).
import { app, nativeImage, Notification, webContents, type Session, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import * as R from './chrome-extension-rules';

export interface ApiExt { id: string; name: string; root: string; manifest: any }
export interface ApiDeps {
  ses: Session;
  userData: string;
  /** Extensão carregada (ligada) com esse ID. */
  getExt: (id: string) => ApiExt | undefined;
  /** Todas as carregadas. */
  loaded: () => ApiExt[];
  /** Evento pro worker + páginas abertas da extensão (wake = acorda o worker). */
  send: (extId: string, name: string, args: unknown[], wake?: boolean) => Promise<void>;
  /** Evento só pro worker (acorda se precisar); false = não tem worker. */
  sendToWorker: (extId: string, name: string, args: unknown[]) => Promise<boolean>;
  /** A tela redesenha a lista (o "controla o proxy" do quebra-cabeça). */
  pushState: () => void;
  /** chrome.management.ExtensionInfo de todas as instaladas (ligadas e desligadas). */
  managementList: () => Array<Record<string, unknown>>;
  confirmSelfUninstall: (name: string) => Promise<boolean>;
  removeExtension: (id: string) => Promise<void>;
  disableExtension: (id: string) => Promise<void>;
  /** No início, antes de carregar: ela ainda existe e pode controlar isso? (instalada, não removida, aprovada) */
  canKeepControl: (id: string, perm: string) => boolean;
  /** Desligada no interruptor. */
  isDisabled: (id: string) => boolean;
  readJson: (file: string) => unknown;
  writeJson: (file: string, data: unknown) => void;
}

export interface ExtensionApis {
  /** Atende o método, ou NOT_MINE se ele não é daqui. */
  handle: (ext: ApiExt, method: string, d: Record<string, unknown>) => Promise<unknown> | typeof NOT_MINE;
  extensionLoaded: (id: string) => void;
  /** Descarregou (pode ser atualização/reload): pausa o controle só se ela não voltar logo. */
  extensionUnloaded: (id: string) => void;
  /** Desligada no interruptor: o que ela controla PAUSA agora (proxy volta ao normal) e volta ao ligar. */
  extensionDisabled: (id: string) => void;
  /** Ligada de novo (já carregada e fora da lista de desligadas): devolve o que estava pausado. */
  extensionEnabled: (id: string) => void;
  /** Removida: apaga tudo dela AGORA (proxy volta ao normal). */
  extensionGone: (id: string) => void;
  /** Todas as do disco já carregaram: quem controlava e não carregou fica pausado. */
  startupLoaded: () => void;
  controlsProxy: (id: string) => boolean;
}

export const NOT_MINE = Symbol('not-mine');

// O Electron não tem "getProxy": não dá pra LER o proxy de antes. O Bah nunca chama setProxy na
// sessão das abas fora daqui, então o "de antes" é o padrão da sessão — o proxy do sistema.
const BASE_PROXY: Electron.ProxyConfig = { mode: 'system' };
const AUTH_TIMEOUT_MS = 15000;
const AUTH_RETRY_WINDOW_MS = 60000;
const AUTH_MAX_ATTEMPTS = 5;
const MAX_PARKED_AUTH = 100;
const UNLOAD_GRACE_MS = 5000;
const MAX_NOTIFICATIONS = 50;
const NOTE_ICON_PX = 256;
const UNINSTALL_COOLDOWN_MS = 30000;
const COOKIE_FLUSH_MS = 50;
const COOKIE_BATCH_MAX = 500;
const COOKIE_QUEUE_MAX = 20000;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Arquivo de ícone da extensão: só arquivo comum de até 1 MB (o resto nem é lido). */
export function readIconFile(file: string): Buffer | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > R.MAX_ICON_BYTES) return null;
    return fs.readFileSync(file);
  } catch { return null; }
}

/**
 * Bytes de ícone vindos de extensão → NativeImage, conferindo o tamanho no CABEÇALHO antes de
 * decodificar (PNG de 23 KB que declara 12000×12000 = ~576 MB no processo principal) e já
 * reduzido pra no máximo maxSide px. null = não serve.
 */
export function safeIconImage(buf: Uint8Array | null | undefined, maxSide: number): Electron.NativeImage | null {
  if (!buf || !R.iconBytesOk(buf)) return null;
  try {
    let img = nativeImage.createFromBuffer(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
    if (img.isEmpty()) return null;
    const s = img.getSize();
    if (s.width > maxSide || s.height > maxSide) {
      const k = maxSide / Math.max(s.width, s.height);
      img = img.resize({ width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)), quality: 'best' });
    }
    return img.isEmpty() ? null : img;
  } catch { return null; }
}

/** data:image/png|jpeg;base64,… → bytes (até ~1 MB), ou null. */
export function iconDataUrlBytes(url: unknown): Buffer | null {
  const b64 = R.iconDataUrlBase64(url);
  return b64 ? Buffer.from(b64, 'base64') : null;
}

export function setupExtensionApis(deps: ApiDeps): ExtensionApis {
  const ses = deps.ses;
  const perm = (ext: ApiExt, p: string) => R.hasApiPermission(ext.manifest, p);
  const need = (ext: ApiExt, p: string) => {
    if (!perm(ext, p)) throw new Error(`The "${p}" permission is required.`);
  };
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });

  // ── 1. Quem controla cada configuração (proxy, WebRTC) ────────────────────────
  // controllers = o que vale agora. dormant = o que fica PAUSADO de extensão desligada (ou que
  // ainda não voltou): igual ao Chrome, que só apaga ao remover.
  const settingsPath = path.join(deps.userData, 'extension-settings.json');
  const rawSettings = deps.readJson(settingsPath);
  const controllers = R.parseSettingControllers(rawSettings);
  const dormant = R.parseDormantSettings(rawSettings);
  const saveSettings = () => deps.writeJson(settingsPath, Object.keys(dormant).length ? { ...controllers, [R.DORMANT_KEY]: dormant } : { ...controllers });
  const putDormant = (extId: string, key: string, value: unknown) => { (dormant[extId] ||= {})[key] = value; };
  const dropDormant = (extId: string, key: string) => {
    const vals = dormant[extId];
    if (!vals || !(key in vals)) return false;
    delete vals[key];
    if (!Object.keys(vals).length) delete dormant[extId];
    return true;
  };
  {
    // Chaves que o Bah não aplica (privacy.* de versões antigas) somem do arquivo.
    let changed = !!rawSettings && typeof rawSettings === 'object' &&
      Object.keys(rawSettings as object).some(k => k !== R.DORMANT_KEY && !controllers[k]);
    for (const [key, c] of Object.entries(controllers)) {
      const info = R.settingInfo(key);
      if (!info || !deps.canKeepControl(c.extId, info.perm)) { delete controllers[key]; changed = true; }
      else if (deps.isDisabled(c.extId)) { putDormant(c.extId, key, c.value); delete controllers[key]; changed = true; }
    }
    for (const [id, vals] of Object.entries(dormant)) {
      for (const key of Object.keys(vals)) {
        const info = R.settingInfo(key);
        if (!info || !deps.canKeepControl(id, info.perm)) { dropDormant(id, key); changed = true; }
      }
    }
    if (changed) saveSettings();
  }

  // Proxy das abas. Em fila: dois set() seguidos não podem chegar fora de ordem no Chromium.
  let proxyChain: Promise<boolean> = Promise.resolve(true);
  let appliedProxy = '';
  const applyProxy = (): Promise<boolean> => {
    const c = controllers[R.PROXY_SETTING];
    let cfg: Electron.ProxyConfig = BASE_PROXY;
    if (c) { try { cfg = R.translateProxyConfig(c.value).electron; } catch { cfg = BASE_PROXY; } }
    const want = JSON.stringify(cfg);
    const who = c ? (deps.getExt(c.extId)?.name || c.extId) : '';
    proxyChain = proxyChain.then(async () => {
      if (want === appliedProxy) return true;
      try {
        await ses.setProxy(cfg);
        appliedProxy = want;
      } catch (e: any) {
        console.warn('[Extensões] proxy não aplicado:', e?.message || e);
        return false;
      }
      // As conexões já abertas (keep-alive, HTTP/2, sockets) seguiriam pelo caminho antigo:
      // fecha, pra aba ir pelo proxy novo (ou voltar a sair direto) no próximo pedido.
      try { await ses.forceReloadProxyConfig(); } catch {}
      try { await ses.closeAllConnections(); } catch {}
      // Sem o PAC/servidores no log: só quem e o modo.
      console.log(`[Extensões] proxy das abas: ${c ? `${who} (${cfg.mode})` : 'o do sistema'}`);
      return true;
    }, () => false);
    return proxyChain;
  };

  // WebRTC: vale por webContents (não por sessão) — toda aba e página da sessão, agora e as novas.
  let webrtcPolicy: R.WebRtcPolicy = 'default';
  const webrtcTo = (wc: WebContents) => {
    try { if (!wc.isDestroyed() && wc.session === ses) wc.setWebRTCIPHandlingPolicy(webrtcPolicy); } catch {}
  };
  const applyWebRtc = () => {
    const c = controllers[R.WEBRTC_SETTING];
    const policy = (c && R.WEBRTC_POLICIES.includes(c.value as R.WebRtcPolicy) ? c.value : 'default') as R.WebRtcPolicy;
    if (policy === webrtcPolicy) return;
    webrtcPolicy = policy;
    for (const wc of webContents.getAllWebContents()) webrtcTo(wc);
  };
  const applyEffects = (key: string) => {
    if (key === R.PROXY_SETTING) return applyProxy();
    if (key === R.WEBRTC_SETTING) applyWebRtc();
    return Promise.resolve(true);
  };

  const detailsFor = (key: string, ext: ApiExt) => {
    const info = R.settingInfo(key)!;
    // O que o Bah não aplica: o valor de verdade (o padrão), e a extensão não controla.
    if (!R.isEnforcedSetting(key)) return { value: clone(info.def), levelOfControl: 'not_controllable' as R.LevelOfControl };
    const c = controllers[key];
    return { value: clone(c ? c.value : info.def), levelOfControl: R.settingLevel(perm(ext, info.perm), c?.extId, ext.id) };
  };
  // Mudou de verdade: todas as que têm a permissão ficam sabendo, cada uma com o SEU levelOfControl.
  const broadcast = (key: string) => {
    const info = R.settingInfo(key)!;
    for (const ext of deps.loaded()) {
      if (!perm(ext, info.perm)) continue;
      void deps.send(ext.id, 'settings.onChange', [key, detailsFor(key, ext)]);
    }
  };
  /** Mudou quem controla `key`: aplica, avisa as extensões e a tela. */
  const changed = (key: string) => {
    void applyEffects(key);
    broadcast(key);
    if (key === R.PROXY_SETTING) deps.pushState();
  };
  /** Apaga o controle de UMA chave (perdeu a permissão, removida). */
  const dropKey = (key: string) => {
    if (!controllers[key]) return;
    delete controllers[key];
    saveSettings();
    changed(key);
  };
  /** Pausa tudo o que a extensão controla (desligada, não voltou da atualização…). */
  const deactivate = (extId: string) => {
    let moved = false;
    for (const key of Object.keys(controllers)) {
      if (controllers[key].extId !== extId) continue;
      putDormant(extId, key, controllers[key].value);
      delete controllers[key];
      moved = true;
      changed(key);
    }
    if (moved) saveSettings();
  };
  /** Devolve o que estava pausado — só onde nenhuma outra extensão pegou nesse meio-tempo. */
  const reactivate = (extId: string) => {
    const ext = deps.getExt(extId);
    const vals = dormant[extId];
    if (!ext || !vals) return;
    let dirty = false;
    for (const [key, value] of Object.entries(vals)) {
      const info = R.settingInfo(key);
      if (!info || !perm(ext, info.perm)) { dropDormant(extId, key); dirty = true; continue; }   // perdeu a permissão
      if (controllers[key]) continue;   // outra controla agora: continua guardado
      controllers[key] = { extId, value };
      dropDormant(extId, key);
      dirty = true;
      changed(key);
    }
    if (dirty) saveSettings();
  };
  /** Removida: some tudo dela, o que vale e o que estava pausado. */
  const forget = (extId: string) => {
    for (const key of Object.keys(controllers)) if (controllers[key].extId === extId) dropKey(key);
    if (dormant[extId]) { delete dormant[extId]; saveSettings(); }
  };

  // O que estava salvo vale já, ANTES das extensões e das abas carregarem: a VPN ligada não
  // deixa a primeira aba sair sem ela. Se a extensão não carregar, startupLoaded() pausa.
  if (controllers[R.PROXY_SETTING]) void applyProxy();
  applyWebRtc();

  const settingKey = (ext: ApiExt, raw: unknown): string => {
    const info = R.settingInfo(raw);
    if (!info) throw new Error('Unknown setting.');
    need(ext, info.perm);
    return String(raw);
  };

  // ── 2. Login de proxy → webRequest.onAuthRequired da extensão que controla o proxy ─
  type AuthCallback = (username?: string, password?: string) => void;
  const cancelAuth = (cb: AuthCallback) => { try { cb(); } catch {} };
  const pendingAuth = new Map<string, { extId: string; finish: (a: R.AuthAnswer | null) => void }>();
  // O Chrome mantém o requestId quando o mesmo pedido pede senha de novo (senha errada): a
  // extensão conta as tentativas e desiste. Aqui: mesmo proxy + mesmo endereço, sem ser a 1ª.
  const recentAuth = new Map<string, { id: string; at: number; attempts: number }>();
  let authSeq = 0;
  // Endereço da navegação principal de cada aba (o 'login' do Electron não diz se é o quadro principal).
  const mainNav = new Map<number, string>();
  // Antes de todas as extensões carregarem (ou na volta de uma atualização), o login de proxy
  // da aba ESPERA a extensão que controla o proxy, em vez de ser cancelado na hora.
  let startupDone = false;
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  interface ParkedAuth { wc: WebContents; det: any; authInfo: Electron.AuthInfo; callback: AuthCallback; timer: ReturnType<typeof setTimeout> | null }
  const parked = new Map<string, ParkedAuth[]>();

  /** A aba/pedido pode ir pra esta extensão? (as mesmas checagens, na hora e na volta da espera) */
  const authAllowed = (ext: ApiExt, wc: WebContents | null, url: string) => {
    if (!R.canAnswerProxyAuth(ext.manifest)) return false;
    if (wc && (wc.isDestroyed() || wc.session !== ses)) return false;   // outra sessão do Bah: não é das abas
    // Igual ao Chrome: o webRequest só mostra pedidos de sites que a extensão pode acessar.
    return R.hasHostPermission(ext.manifest, url);
  };

  const forwardAuth = (ext: ApiExt, wc: WebContents | null, det: any, authInfo: Electron.AuthInfo, callback: AuthCallback) => {
    const url = String(det.url || '');
    const now = Date.now();
    for (const [k, v] of recentAuth) if (now - v.at > AUTH_RETRY_WINDOW_MS) recentAuth.delete(k);
    const key = `${authInfo.host}:${authInfo.port}|${url}`;
    let entry = recentAuth.get(key);
    if (!entry || det.firstAuthAttempt !== false) entry = { id: String(++authSeq), at: now, attempts: 0 };
    entry.attempts++;
    entry.at = now;
    recentAuth.set(key, entry);
    if (entry.attempts > AUTH_MAX_ATTEMPTS) { cancelAuth(callback); return; }   // trava de laço

    const isTab = !!wc && !wc.isDestroyed() && wc.getType() === 'webview';
    const kind = R.authRequestKind({ hasWc: !!wc, isNavigation: !!det.isRequestForNavigation, url, mainFrameUrl: wc ? mainNav.get(wc.id) : undefined });
    const info: Record<string, unknown> = {
      requestId: entry.id, url, method: 'GET',
      frameId: kind.frameId, parentFrameId: -1, tabId: isTab ? wc!.id : -1,
      type: kind.type,
      timeStamp: now, isProxy: true,
      challenger: { host: authInfo.host, port: authInfo.port },
      scheme: authInfo.scheme, statusCode: 407, statusLine: 'HTTP/1.1 407 Proxy Authentication Required',
      // O calço só entrega pra quem pediu 'responseHeaders' no extraInfoSpec.
      responseHeaders: R.chromeHeaders(det.responseHeaders),
    };
    if (authInfo.realm) info.realm = authInfo.realm;
    const token = randomUUID();
    let finished = false;
    const finish = (a: R.AuthAnswer | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pendingAuth.delete(token);
      // Senha nunca vai pro log. Cancelou, não respondeu ou demorou: sem senha (o de sempre).
      try { if (a && a.kind === 'credentials') callback(a.username, a.password); else callback(); } catch {}
    };
    const timer = setTimeout(() => finish(null), AUTH_TIMEOUT_MS);
    pendingAuth.set(token, { extId: ext.id, finish });
    deps.sendToWorker(ext.id, 'webRequest.onAuthRequired', [info, token]).then(ok => { if (!ok) finish(null); }, () => finish(null));
  };

  const takeParked = (extId: string) => {
    const list = parked.get(extId) || [];
    parked.delete(extId);
    for (const p of list) if (p.timer) clearTimeout(p.timer);
    return list;
  };
  /** A extensão não volta: os logins que esperavam por ela são cancelados (o de sempre). */
  const cancelParked = (extId: string) => { for (const p of takeParked(extId)) cancelAuth(p.callback); };
  /** Ela chegou: confere tudo de novo com o manifesto que carregou e segue o caminho normal. */
  const flushParked = (extId: string) => {
    const ext = deps.getExt(extId);
    for (const p of takeParked(extId)) {
      const c = controllers[R.PROXY_SETTING];
      if (!ext || !c || c.extId !== extId || !authAllowed(ext, p.wc, String(p.det.url || ''))) cancelAuth(p.callback);
      else forwardAuth(ext, p.wc, p.det, p.authInfo, p.callback);
    }
  };
  const expectedBack = (extId: string) => !deps.isDisabled(extId) && (!startupDone || graceTimers.has(extId));

  app.on('login', (event, wc, details, authInfo, callback) => {
    // Login de SITE (401) não é com a extensão: o Bah segue como sempre (sem handler = cancela).
    if (!authInfo || !authInfo.isProxy) return;
    const c = controllers[R.PROXY_SETTING];
    if (!c) return;
    if (wc && (wc.isDestroyed() || wc.session !== ses)) return;
    const det: any = details || {};
    const url = String(det.url || '');
    const ext = deps.getExt(c.extId);
    if (!ext) {
      // Ainda carregando (início do Bah, atualização): a aba espera a extensão (até 15 s).
      if (!wc || !expectedBack(c.extId)) return;
      const list = parked.get(c.extId) || [];
      if (list.length >= MAX_PARKED_AUTH) return;
      event.preventDefault();
      const p: ParkedAuth = { wc, det, authInfo, callback, timer: null };
      p.timer = setTimeout(() => {
        const cur = parked.get(c.extId);
        const i = cur ? cur.indexOf(p) : -1;
        if (i >= 0) { cur!.splice(i, 1); if (!cur!.length) parked.delete(c.extId); }
        cancelAuth(callback);
      }, AUTH_TIMEOUT_MS);
      list.push(p);
      parked.set(c.extId, list);
      return;
    }
    if (!authAllowed(ext, wc, url)) return;
    if (!wc && !R.proxyConfigMentions(c.value, authInfo.host, authInfo.port)) {
      // Sem aba e o PAC não traz "host:porta" escrito (pacScript.url, PAC que monta o endereço):
      // pergunta pro Chromium por onde esse endereço sai; se for por esse proxy, é o DELA.
      event.preventDefault();
      void (async () => {
        try {
          const chain = await ses.resolveProxy(url);
          const now = controllers[R.PROXY_SETTING];
          const cur = now ? deps.getExt(now.extId) : undefined;
          if (now && cur && now.extId === ext.id && R.proxyChainMentions(chain, authInfo.host, authInfo.port) && authAllowed(cur, null, url)) {
            forwardAuth(cur, null, det, authInfo, callback);
          } else cancelAuth(callback);
        } catch { cancelAuth(callback); }
      })();
      return;
    }
    event.preventDefault();
    forwardAuth(ext, wc, det, authInfo, callback);
  });

  // ── 3. Abas/páginas novas: WebRTC + erro de proxy (onProxyError, o possível) ──
  const PROXY_ERROR = /PROXY|TUNNEL_CONNECTION_FAILED|PAC_/;
  let lastProxyError = 0;
  app.on('web-contents-created', (_e, wc) => {
    let mine = false;
    try { mine = wc.session === ses; } catch {}
    if (!mine) return;
    if (webrtcPolicy !== 'default') webrtcTo(wc);
    const id = wc.id;
    const navTo = (d: any) => { if (d && d.isMainFrame && !d.isSameDocument && typeof d.url === 'string') mainNav.set(id, d.url); };
    wc.on('did-start-navigation', navTo);
    wc.on('did-redirect-navigation', navTo);
    wc.once('destroyed', () => mainNav.delete(id));
    wc.on('did-fail-load', (_ev, _code, desc, _url, isMainFrame) => {
      if (!isMainFrame || typeof desc !== 'string' || !PROXY_ERROR.test(desc)) return;
      const c = controllers[R.PROXY_SETTING];
      if (!c || Date.now() - lastProxyError < 1000) return;
      lastProxyError = Date.now();
      void deps.send(c.extId, 'proxy.onProxyError', [{ fatal: true, error: `net::${desc}`, details: '' }]);
    });
  });

  // ── 4. Cookies (sessão das abas) ─────────────────────────────────────────────
  // Uma página pode escrever cookie milhares de vezes por segundo: as mudanças vão em LOTE
  // (no máximo uma entrega a cada 50 ms por extensão), não uma mensagem por mudança.
  const cookieSubs = new Set<string>();
  const cookieQueue = new Map<string, unknown[]>();
  let cookieTimer: ReturnType<typeof setTimeout> | null = null;
  const flushCookies = () => {
    cookieTimer = null;
    for (const [id, list] of Array.from(cookieQueue)) {
      const batch = list.splice(0, COOKIE_BATCH_MAX);
      if (!list.length) cookieQueue.delete(id);
      if (batch.length) void deps.send(id, 'cookies.onChangedBatch', [batch]);
    }
    if (cookieQueue.size) cookieTimer = setTimeout(flushCookies, COOKIE_FLUSH_MS);
  };
  let cookieHooked = false;
  const hookCookies = () => {
    if (cookieHooked) return;
    cookieHooked = true;
    ses.cookies.on('changed', (_e, cookie, cause, removed) => {
      if (!cookieSubs.size) return;
      const url = R.cookieUrl(cookie);
      let info: unknown = null;
      for (const id of cookieSubs) {
        const ext = deps.getExt(id);
        if (!ext || !perm(ext, 'cookies') || !R.hasHostPermission(ext.manifest, url)) continue;
        let q = cookieQueue.get(id);
        if (!q) { q = []; cookieQueue.set(id, q); }
        if (q.length >= COOKIE_QUEUE_MAX) continue;   // extensão que não dá conta: o excesso cai
        info ||= { removed, cookie: R.chromeCookie(cookie), cause: R.cookieChangeCause(cause) };
        q.push(info);
      }
      if (cookieQueue.size && !cookieTimer) cookieTimer = setTimeout(flushCookies, COOKIE_FLUSH_MS);
    });
  };
  const needHost = (ext: ApiExt, url: string) => {
    if (!R.hasHostPermission(ext.manifest, url)) throw new Error(`No host permissions for cookies at url: "${url}".`);
  };
  const tabIds = () => webContents.getAllWebContents()
    .filter(wc => { try { return !wc.isDestroyed() && wc.getType() === 'webview' && wc.session === ses; } catch { return false; } })
    .map(wc => wc.id);

  // ── 5. Notificações ──────────────────────────────────────────────────────────
  interface Note { n: Electron.Notification; opts: R.NotificationOpts; closed: boolean; quiet: boolean }
  const notes = new Map<string, Map<string, Note>>();
  const iconFor = (ext: ApiExt, opts: R.NotificationOpts): Electron.NativeImage | undefined => {
    const src = R.notificationIcon(opts.iconUrl, ext.id);
    if (!src) return undefined;
    let buf: Buffer | null = null;
    if (src.kind === 'data') buf = iconDataUrlBytes(src.url);
    else {
      const file = R.resolveInsideRoot(ext.root, src.rel);
      buf = file ? readIconFile(file) : null;
    }
    // Tamanho conferido no cabeçalho ANTES de decodificar, e guardado já reduzido (até 50 por extensão).
    return safeIconImage(buf, NOTE_ICON_PX) || undefined;
  };
  const closeNote = (n: Note) => { n.quiet = true; n.closed = true; try { n.n.close(); } catch {} };
  const showNote = (ext: ApiExt, id: string, opts: R.NotificationOpts, replacing: boolean) => {
    let table = notes.get(ext.id);
    if (!table) { table = new Map(); notes.set(ext.id, table); }
    const old = table.get(id);
    if (old) { closeNote(old); table.delete(id); }
    // Guarda as últimas (o objeto tem que ficar vivo pro clique chegar); a mais velha sai.
    while (table.size >= MAX_NOTIFICATIONS) {
      const first = table.keys().next().value as string;
      closeNote(table.get(first)!);
      table.delete(first);
    }
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: opts.title || ext.name,
      body: R.notificationBody(opts, ext.name),
      icon: iconFor(ext, opts),
      silent: opts.silent || replacing,
      timeoutType: opts.requireInteraction ? 'never' : 'default',
      // Botões: só o macOS tem no Electron (no Windows precisaria de toastXml).
      ...(process.platform === 'darwin' && opts.buttons.length ? { actions: opts.buttons.map(text => ({ type: 'button' as const, text })) } : {}),
    });
    const note: Note = { n, opts, closed: false, quiet: false };
    n.on('click', () => { void deps.send(ext.id, 'notifications.onClicked', [id], true); });
    n.on('action', (_e, index) => { void deps.send(ext.id, 'notifications.onButtonClicked', [id, index], true); });
    n.on('close', () => {
      if (note.closed) return;
      note.closed = true;
      if (!note.quiet) void deps.send(ext.id, 'notifications.onClosed', [id, true], true);
    });
    table.set(id, note);
    try { n.show(); } catch {}
  };
  const clearNotes = (extId: string) => {
    const table = notes.get(extId);
    if (!table) return;
    for (const n of table.values()) closeNote(n);
    notes.delete(extId);
  };

  // ── 6. O que a extensão chama ────────────────────────────────────────────────
  // Remover a si mesma: UM diálogo por vez; "Cancelar" vale por 30 s (sem pilha de diálogos).
  const pendingUninstall = new Map<string, Promise<boolean>>();
  const cancelledAt = new Map<string, number>();
  const removing = new Set<string>();
  const handle = (ext: ApiExt, method: string, d: Record<string, unknown>): Promise<unknown> | typeof NOT_MINE => {
    switch (method) {
      // ChromeSetting: proxy.settings e privacy.*
      case 'settings.get': return (async () => detailsFor(settingKey(ext, d.key), ext))();
      case 'settings.set': return (async () => {
        const key = settingKey(ext, d.key);
        R.checkSettingScope(d.scope);
        const value = R.validateSettingValue(key, d.value);
        // O que o Bah não aplica: passa calado, sem guardar (o get() segue "not_controllable").
        if (!R.isEnforcedSetting(key)) return undefined;
        const prev = controllers[key];
        if (prev && prev.extId === ext.id && JSON.stringify(prev.value) === JSON.stringify(value)) {
          // Nada mudou: só quem pediu fica sabendo (a extensão costuma esperar o onChange).
          void deps.send(ext.id, 'settings.onChange', [key, detailsFor(key, ext)]);
          return undefined;
        }
        controllers[key] = { extId: ext.id, value };
        if (!(await applyEffects(key))) {
          if (prev) controllers[key] = prev; else delete controllers[key];
          await applyEffects(key);
          throw new Error('Could not apply this setting.');
        }
        dropDormant(ext.id, key);
        saveSettings();
        broadcast(key);
        if (key === R.PROXY_SETTING) deps.pushState();
        return undefined;
      })();
      case 'settings.clear': return (async () => {
        const key = settingKey(ext, d.key);
        R.checkSettingScope(d.scope);
        if (!R.isEnforcedSetting(key)) return undefined;
        if (dropDormant(ext.id, key)) saveSettings();
        if (controllers[key]?.extId !== ext.id) {
          void deps.send(ext.id, 'settings.onChange', [key, detailsFor(key, ext)]);
          return undefined;
        }
        delete controllers[key];
        saveSettings();
        await applyEffects(key);
        broadcast(key);
        if (key === R.PROXY_SETTING) deps.pushState();
        return undefined;
      })();

      case 'webRequest.authReply': {
        const p = typeof d.token === 'string' ? pendingAuth.get(d.token) : undefined;
        if (!p || p.extId !== ext.id) return Promise.resolve(false);
        p.finish(R.authAnswer(d.response));
        return Promise.resolve(true);
      }

      case 'cookies.get': return (async () => {
        need(ext, 'cookies');
        R.checkCookieStore(d.storeId);
        const url = R.cookieTargetUrl(d.url);
        if (typeof d.name !== 'string') throw new Error('Invalid cookie name.');
        needHost(ext, url);
        const best = R.pickCookie(await ses.cookies.get({ url, name: d.name }));
        return best ? R.chromeCookie(best) : null;
      })();
      case 'cookies.getAll': return (async () => {
        need(ext, 'cookies');
        const filter = R.cookieFilter(d);
        if (typeof filter.url === 'string' && !R.hasHostPermission(ext.manifest, filter.url)) return [];
        const list = await ses.cookies.get(filter as Electron.CookiesGetFilter);
        return list.filter(c => R.hasHostPermission(ext.manifest, R.cookieUrl(c))).map(R.chromeCookie);
      })();
      case 'cookies.set': return (async () => {
        need(ext, 'cookies');
        const det = R.cookieSetDetails(d);
        needHost(ext, det.url);
        try { await ses.cookies.set(det as Electron.CookiesSetDetails); }
        catch { throw new Error(`Failed to parse or set cookie named "${String(det.name ?? '')}".`); }
        const name = typeof det.name === 'string' ? det.name : '';
        const list = (await ses.cookies.get({ url: det.url })).filter(c => c.name === name);
        const exact = list.filter(c => (det.path === undefined || c.path === det.path));
        const best = R.pickCookie(exact.length ? exact : list);
        return best ? R.chromeCookie(best) : null;
      })();
      case 'cookies.remove': return (async () => {
        need(ext, 'cookies');
        R.checkCookieStore(d.storeId);
        const url = R.cookieTargetUrl(d.url);
        if (typeof d.name !== 'string') throw new Error('Invalid cookie name.');
        needHost(ext, url);
        await ses.cookies.remove(url, d.name);
        return { url, name: d.name, storeId: R.COOKIE_STORE_ID };
      })();
      case 'cookies.getAllCookieStores': return (async () => { need(ext, 'cookies'); return [{ id: R.COOKIE_STORE_ID, tabIds: tabIds() }]; })();
      case 'cookies.subscribe': return (async () => { need(ext, 'cookies'); cookieSubs.add(ext.id); hookCookies(); return true; })();

      case 'notifications.create': return (async () => {
        need(ext, 'notifications');
        const id = R.notificationIdArg(d.notificationId) || randomUUID();
        showNote(ext, id, R.notificationOptions(d.options, null), false);
        return id;
      })();
      case 'notifications.update': return (async () => {
        need(ext, 'notifications');
        const id = R.notificationIdArg(d.notificationId);
        const cur = id ? notes.get(ext.id)?.get(id) : undefined;
        if (!cur || cur.closed) return false;
        showNote(ext, id, R.notificationOptions(d.options, cur.opts), true);
        return true;
      })();
      case 'notifications.clear': return (async () => {
        need(ext, 'notifications');
        const id = R.notificationIdArg(d.notificationId);
        const table = notes.get(ext.id);
        const cur = id ? table?.get(id) : undefined;
        if (!cur) return false;
        const wasOpen = !cur.closed;
        closeNote(cur);
        table!.delete(id);
        return wasOpen;
      })();
      case 'notifications.getAll': return (async () => {
        need(ext, 'notifications');
        const out: Record<string, boolean> = {};
        for (const [id, n] of notes.get(ext.id) || []) if (!n.closed) out[id] = true;
        return out;
      })();

      case 'management.getSelf': return (async () =>
        deps.managementList().find(i => i.id === ext.id) || R.managementInfo(ext.id, ext.manifest, true, ext.name))();
      case 'management.getAll': return (async () => { need(ext, 'management'); return deps.managementList(); })();
      case 'management.get': return (async () => {
        need(ext, 'management');
        const info = R.isExtensionId(d.id) ? deps.managementList().find(i => i.id === d.id) : undefined;
        if (!info) throw new Error(`Failed to find extension with id ${String(d.id).slice(0, 40)}.`);
        return info;
      })();
      case 'management.setEnabled': return (async () => {
        need(ext, 'management');
        if (!R.isExtensionId(d.id) || typeof d.enabled !== 'boolean') throw new Error('Invalid arguments.');
        // Uma extensão não liga/desliga as outras no Bah (a VPN tentava desligar as concorrentes).
        if (d.id !== ext.id) throw new Error('Bah does not let an extension turn other extensions on or off. Use the Extensions menu instead.');
        if (!d.enabled) setTimeout(() => { void deps.disableExtension(ext.id); }, 50);   // responde antes de descarregar
        return undefined;
      })();
      case 'management.uninstall':
      case 'management.uninstallSelf': return (async () => {
        if (method === 'management.uninstall' && d.id !== ext.id) {
          need(ext, 'management');
          throw new Error('Bah does not let an extension remove other extensions.');
        }
        const id = ext.id;
        if (removing.has(id)) return undefined;   // já está saindo
        if (pendingUninstall.has(id)) throw new Error('An uninstall dialog is already open.');
        if (Date.now() - (cancelledAt.get(id) || 0) < UNINSTALL_COOLDOWN_MS) throw new Error('User cancelled uninstall.');
        // Sempre pergunta (mesmo sem showConfirmDialog): remover apaga os dados dela.
        const p = deps.confirmSelfUninstall(ext.name).catch(() => false);
        pendingUninstall.set(id, p);
        let ok = false;
        try { ok = await p; } finally { if (pendingUninstall.get(id) === p) pendingUninstall.delete(id); }
        if (!ok) { cancelledAt.set(id, Date.now()); throw new Error('User cancelled uninstall.'); }
        if (removing.has(id)) return undefined;
        removing.add(id);
        setTimeout(() => {
          void deps.removeExtension(id)
            .catch(e => console.warn('[Extensões] remover (uninstallSelf) falhou:', e))
            .finally(() => removing.delete(id));
        }, 50);
        return undefined;
      })();
      default: return NOT_MINE;
    }
  };

  // ── 7. Ciclo de vida ─────────────────────────────────────────────────────────
  const cleanup = (id: string) => {
    for (const p of Array.from(pendingAuth.values())) if (p.extId === id) p.finish(null);
    clearNotes(id);
    cookieSubs.delete(id);
    cookieQueue.delete(id);
    pendingUninstall.delete(id);
    cancelledAt.delete(id);
  };
  const stopGrace = (id: string) => {
    const t = graceTimers.get(id);
    if (t) { clearTimeout(t); graceTimers.delete(id); }
  };
  return {
    handle,
    extensionLoaded: (id) => {
      stopGrace(id);
      // A versão nova pode ter perdido a permissão (proxy, privacy): o controle sai na hora.
      const ext = deps.getExt(id);
      if (ext) {
        for (const key of Object.keys(controllers)) {
          const info = R.settingInfo(key);
          if (controllers[key].extId === id && (!info || !perm(ext, info.perm))) dropKey(key);
        }
      }
      // Atualização / volta depois do início: devolve o que estava pausado. (Ligando pelo
      // interruptor ela ainda está na lista de desligadas aqui: quem devolve é o extensionEnabled.)
      if (!deps.isDisabled(id)) reactivate(id);
      flushParked(id);
    },
    extensionUnloaded: (id) => {
      cleanup(id);
      if (quitting || graceTimers.has(id)) return;
      // Atualização automática / runtime.reload descarregam e carregam de novo: o Chrome mantém
      // o proxy nesses casos. Só pausa se ela não voltar em alguns segundos.
      graceTimers.set(id, setTimeout(() => {
        graceTimers.delete(id);
        if (quitting || deps.getExt(id)) return;
        deactivate(id);
        cancelParked(id);
      }, UNLOAD_GRACE_MS));
    },
    extensionDisabled: (id) => {
      stopGrace(id);
      cleanup(id);
      cancelParked(id);
      deactivate(id);
    },
    extensionEnabled: (id) => { reactivate(id); },
    extensionGone: (id) => {
      stopGrace(id);
      cleanup(id);
      cancelParked(id);
      forget(id);
    },
    startupLoaded: () => {
      startupDone = true;
      for (const c of Object.values({ ...controllers })) if (!deps.getExt(c.extId)) deactivate(c.extId);
      for (const id of Array.from(parked.keys())) if (!deps.getExt(id) && !graceTimers.has(id)) cancelParked(id);
    },
    controlsProxy: (id) => controllers[R.PROXY_SETTING]?.extId === id,
  };
}
