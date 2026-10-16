// Ícones dos favoritos (barra, "»", ⋮ → Favoritos, autocomplete) SEM serviço de terceiros:
// nada de Google s2 / DuckDuckGo (eles ficariam sabendo da sua lista de sites). O Bah busca o
// ícone no PRÓPRIO site, pela sessão das abas (persist:browser → proxy/VPN de extensão valem),
// sem cookies, e guarda num JSON em userData com teto de tamanho.
// De onde vem o ícone, em ordem:
//   1. o que a aba mostrou quando você abriu o site (page-favicon-updated);
//   2. https://site/favicon.ico;
//   3. o <link rel="icon"> da página inicial (só os primeiros 128 KB do HTML).
// Nunca busca em localhost / rede local / IP privado (nem depois de redirecionamento ou DNS).
// Só guarda ícone de site que o renderer PEDIU (favoritos): a aba avisa de todo site aberto,
// mas o que não é favorito fica só na memória — o cache não vira um segundo histórico.
import { app, ipcMain, nativeImage, net, type BrowserWindow, type Session } from 'electron';
import fs from 'fs';
import {
  faviconOrigin, sanitizeOrigins, isBlockedHost, isFetchableUrl, isIpLiteral, isPrivateIp,
  normalizeIcon, decodeDataUrl, parseIconLinks, isFresh, pruneOrder,
  MAX_ICON_BYTES, MAX_STORED_BYTES, type FaviconEntry, type IconMime,
} from '../shared/favicons';

const MAX_ENTRIES = 1500;            // sites no cache
const MAX_CHARS = 4_000_000;         // ~4 MB de data URLs no JSON
const CONCURRENCY = 4;               // downloads de ícone ao mesmo tempo
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 128 * 1024;   // <link rel=icon> fica no <head>: não precisa da página toda
const MAX_REDIRECTS = 3;
const RESIZE_OVER = 12 * 1024;       // PNG/JPEG maior que isso é grande demais pra 16px → reduz pra 32px
const PAGE_ICON_RECHECK_MS = 24 * 3_600_000;   // ícone da aba: troca no cache no máximo 1x por dia
const MISS_RETRY_MS = 10 * 60_000;   // "sem ícone" + a aba mostrou um: tenta de novo no máximo a cada 10 min
const MAX_PAGE_ICONS = 200;          // ícones vistos nas abas (só memória)
const MAX_PAGE_DATA_URL = 64 * 1024; // ícone inline (data:) da aba maior que isso nem é guardado na memória
const FORGET_UNUSED_MS = 90 * 24 * 3_600_000;   // site que ninguém pediu em 90 dias (favorito apagado) sai do cache
const MAX_WANTED = 5000;

type Fetched = { bytes: Buffer; finalUrl: string };
// answered = algum servidor respondeu (mesmo 404). Se NENHUM respondeu (sem internet, site fora do ar),
// não é "site sem ícone": não grava a falta por 7 dias, tenta de novo na próxima vez.
type Ctx = { answered: boolean };

export function setupFaviconCache(deps: {
  getMainWindow: () => BrowserWindow | null;
  session: Session;
  file: string;
  userAgent: string;
}): { notePageFavicons: (pageUrl: string, favicons: string[]) => void } {
  const ses = deps.session;
  const entries: Record<string, FaviconEntry> = load();
  const wanted = new Set<string>();            // origens pedidas pelo renderer nesta sessão
  const pageIcons = new Map<string, string>(); // origem → ícone que a aba mostrou (memória)
  const queue: string[] = [];
  const queued = new Set<string>();
  let active = 0;
  let push: Record<string, string | null> = {};
  let pushTimer: NodeJS.Timeout | null = null;
  let saveTimer: NodeJS.Timeout | null = null;

  function load(): Record<string, FaviconEntry> {
    const out: Record<string, FaviconEntry> = Object.create(null);
    try {
      const raw = JSON.parse(fs.readFileSync(deps.file, 'utf8'));
      if (!raw || typeof raw !== 'object') return out;
      for (const [k, e] of Object.entries<any>(raw)) {
        if (faviconOrigin(k) !== k || !e || typeof e !== 'object') continue;
        const icon = typeof e.icon === 'string' && /^data:image\/[a-z+.-]+;base64,/i.test(e.icon) && e.icon.length < MAX_STORED_BYTES * 2 ? e.icon : null;
        const checked = Number(e.checked) || 0, used = Number(e.used) || 0;
        out[k] = { icon, checked, used, ...(typeof e.src === 'string' && e.src.length < 2048 ? { src: e.src } : {}) };
      }
      const now = Date.now();
      for (const k of Object.keys(out)) if (out[k].used < now - FORGET_UNUSED_MS) delete out[k];
      for (const k of pruneOrder(out, MAX_ENTRIES, MAX_CHARS)) delete out[k];
    } catch {}
    return out;
  }

  // Grava trocando o arquivo inteiro (temp + rename): se o Bah fechar no meio, o antigo fica.
  function saveNow(): void {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      const tmp = `${deps.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entries));
      fs.renameSync(tmp, deps.file);
    } catch {}
  }
  const scheduleSave = (ms = 4000) => { if (!saveTimer) saveTimer = setTimeout(saveNow, ms); };
  app.on('will-quit', () => { if (saveTimer) saveNow(); });

  // Avisa o renderer em lote (vários ícones chegando juntos = um repaint só).
  function sendLater(origin: string, icon: string | null): void {
    push[origin] = icon;
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const batch = push;
      push = {};
      const mw = deps.getMainWindow();
      if (mw && !mw.isDestroyed()) mw.webContents.send('favicons:updated', batch);
    }, 120);
  }

  function rememberWanted(o: string): void {
    if (wanted.has(o)) return;
    wanted.add(o);
    if (wanted.size > MAX_WANTED) wanted.delete(wanted.values().next().value as string);
  }

  function enqueue(o: string): void {
    if (queued.has(o)) return;
    queued.add(o);
    queue.push(o);
    pump();
  }
  function pump(): void {
    while (active < CONCURRENCY && queue.length) {
      const o = queue.shift()!;
      active++;
      resolveOrigin(o).catch(() => {}).finally(() => { active--; queued.delete(o); pump(); });
    }
  }

  // Com proxy (VPN de extensão, proxy do sistema) quem resolve o nome é o proxy: o Bah não vê o IP
  // final e nem deve perguntar ao DNS local (vazaria o site fora do proxy). Sem proxy, confere o DNS:
  // "site.com" apontando pra 127.0.0.1/192.168.x não é buscado.
  async function hostIsPublic(url: string): Promise<boolean> {
    const host = new URL(url).hostname;
    if (isIpLiteral(host)) return !isPrivateIp(host);
    let route = '';
    try { route = await ses.resolveProxy(url); } catch {}
    if (route && route.trim().toUpperCase() !== 'DIRECT') return true;
    try {
      const r = await ses.resolveHost(host);
      return r.endpoints.length > 0 && r.endpoints.every(ep => !isPrivateIp(ep.address));
    } catch { return false; }
  }

  // Um GET sem cookies, sem seguir redirecionamento sozinho (cada salto é conferido de novo).
  function requestOnce(url: string, accept: string, maxBytes: number, keepPartial: boolean, ctx: Ctx): Promise<{ redirect: string } | Fetched | null> {
    return new Promise(resolve => {
      let settled = false;
      const done = (v: { redirect: string } | Fetched | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      let req: Electron.ClientRequest;
      try {
        req = net.request({ url, session: ses, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false, referrerPolicy: 'no-referrer' });
        req.setHeader('Accept', accept);
        req.setHeader('User-Agent', deps.userAgent);
      } catch { resolve(null); return; }
      const timer = setTimeout(() => { try { req.abort(); } catch {} done(null); }, TIMEOUT_MS);
      req.on('redirect', (_status, _method, redirectUrl) => { ctx.answered = true; try { req.abort(); } catch {} done({ redirect: redirectUrl }); });
      req.on('error', () => done(null));
      req.on('abort', () => done(null));
      req.on('response', res => {
        ctx.answered = true;
        if (res.statusCode !== 200) { try { req.abort(); } catch {} done(null); return; }
        const len = Number([res.headers['content-length']].flat()[0]);
        if (!keepPartial && len > maxBytes) { try { req.abort(); } catch {} done(null); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (settled) return;
          size += c.length;
          if (size > maxBytes) {
            if (keepPartial) { chunks.push(c.subarray(0, c.length - (size - maxBytes))); done({ bytes: Buffer.concat(chunks), finalUrl: url }); }
            else done(null);
            try { req.abort(); } catch {}
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => done({ bytes: Buffer.concat(chunks), finalUrl: url }));
        res.on('error', () => done(null));
      });
      req.end();
    });
  }

  async function fetchBytes(url: string, accept: string, maxBytes: number, ctx: Ctx, keepPartial = false): Promise<Fetched | null> {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isFetchableUrl(url) || !(await hostIsPublic(url))) return null;
      const r = await requestOnce(url, accept, maxBytes, keepPartial, ctx);
      if (!r || !('redirect' in r)) return r;
      try { url = new URL(r.redirect, url).href; } catch { return null; }
    }
    return null;
  }

  // Bytes → data URL pequeno (16px na tela: PNG/JPEG grande vira 32px; ICO já veio enxuto).
  function toStored(img: { mime: IconMime; bytes: Uint8Array }): string | null {
    let { mime, bytes } = img;
    if ((mime === 'image/png' || mime === 'image/jpeg') && bytes.length > RESIZE_OVER) {
      try {
        const ni = nativeImage.createFromBuffer(Buffer.from(bytes));
        if (!ni.isEmpty() && ni.getSize().width > 32) { bytes = ni.resize({ width: 32, quality: 'best' }).toPNG(); mime = 'image/png'; }
      } catch {}
    }
    if (!bytes.length || bytes.length > MAX_STORED_BYTES) return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  async function fetchIcon(url: string, ctx: Ctx): Promise<string | null> {
    let raw: Uint8Array | null;
    if (/^data:/i.test(url)) raw = decodeDataUrl(url);
    else raw = (await fetchBytes(url, 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', MAX_ICON_BYTES, ctx))?.bytes ?? null;
    const img = raw ? normalizeIcon(raw) : null;
    return img ? toStored(img) : null;
  }

  async function resolveOrigin(o: string): Promise<void> {
    let icon: string | null = null;
    let src = '';
    const tried = new Set<string>();
    const ctx: Ctx = { answered: false };
    const attempt = async (url: string | undefined) => {
      if (icon || !url || tried.has(url)) return;
      tried.add(url);
      const got = await fetchIcon(url, ctx);
      if (got) { icon = got; src = url; }
    };
    await attempt(pageIcons.get(o));
    await attempt(`${o}/favicon.ico`);
    if (!icon) {
      const page = await fetchBytes(`${o}/`, 'text/html,application/xhtml+xml', MAX_HTML_BYTES, ctx, true);
      if (page) {
        const html = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes);
        for (const u of parseIconLinks(html, page.finalUrl, 2)) await attempt(u);
      }
    }
    const now = Date.now();
    const prev = entries[o];
    if (icon) entries[o] = { icon, checked: now, used: prev?.used ?? now, ...(src.length < 2048 ? { src } : {}) };
    else if (prev?.icon) prev.checked = now;             // falhou agora (site fora do ar?): fica o antigo
    else if (ctx.answered) entries[o] = { icon: null, checked: now, used: prev?.used ?? now };
    else { sendLater(o, null); return; }                 // ninguém respondeu: mostra a letra, sem gravar a falta
    sendLater(o, entries[o].icon);
    for (const k of pruneOrder(entries, MAX_ENTRIES, MAX_CHARS)) delete entries[k];
    scheduleSave();
  }

  // Renderer pede vários sites de uma vez; responde na hora com o que já tem e busca o resto
  // em segundo plano (chega depois por 'favicons:updated').
  // peek = só o que já está guardado, sem buscar nem marcar como "favorito" (o autocomplete mostra
  // sites do histórico: eles não podem entrar no cache por causa disso).
  ipcMain.handle('favicons:get', (e, origins: unknown, peek?: unknown): Record<string, string | null> => {
    const mw = deps.getMainWindow();
    if (!mw || mw.isDestroyed() || e.sender !== mw.webContents) return {};
    const now = Date.now();
    const out: Record<string, string | null> = {};
    for (const o of sanitizeOrigins(origins)) {
      if (isBlockedHost(new URL(o).hostname)) { out[o] = null; continue; }
      const entry = entries[o];
      if (peek === true) { if (entry?.icon) out[o] = entry.icon; continue; }
      rememberWanted(o);
      if (entry) {
        entry.used = now;
        out[o] = entry.icon;
        if (!isFresh(entry, now)) enqueue(o);
      } else enqueue(o);
    }
    if (peek !== true) scheduleSave(15000);   // só o "usado em" mudou: sem pressa
    return out;
  });

  return {
    // A aba mostrou o ícone do site: se esse site é favorito, o cache passa a usar ESSE ícone.
    notePageFavicons(pageUrl: string, favicons: string[]): void {
      const o = faviconOrigin(pageUrl);
      if (!o || isBlockedHost(new URL(o).hostname) || !Array.isArray(favicons)) return;
      const url = favicons.find(u => typeof u === 'string' && (/^https?:/i.test(u) ? u.length <= 4096 : /^data:image\//i.test(u) && u.length <= MAX_PAGE_DATA_URL));
      if (!url) return;
      pageIcons.delete(o);
      pageIcons.set(o, url);
      if (pageIcons.size > MAX_PAGE_ICONS) pageIcons.delete(pageIcons.keys().next().value as string);
      if (!wanted.has(o) && !entries[o]) return;
      const entry = entries[o];
      if (entry?.icon && (entry.src === url || Date.now() - entry.checked < PAGE_ICON_RECHECK_MS)) return;
      // Sem ícone e acabou de tentar: não refaz a cada página que a pessoa abre no mesmo site.
      if (entry && !entry.icon && Date.now() - entry.checked < MISS_RETRY_MS) return;
      enqueue(o);
    },
  };
}
