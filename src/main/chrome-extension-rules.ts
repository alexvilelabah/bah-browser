// Regras PURAS das extensões do Chrome (sem Electron): ícone do manifesto, estado do botão
// da extensão (badge, título, popup…) com a semântica do Chrome, quais endereços uma
// extensão pode abrir numa aba, o que o Bah ainda não sabe fazer, e caminhos que não
// conseguem sair da pasta da extensão. A parte que liga isso no Electron fica em
// chrome-extensions.ts; aqui tudo é testável com node --test.
import path from 'node:path';
import { createHash } from 'node:crypto';

// ── Identidade ────────────────────────────────────────────────────────────────

/** ID de extensão do Chrome: 32 letras de a a p. */
export function isExtensionId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-p]{32}$/.test(id);
}

/**
 * ID a partir do "key" do manifesto (chave pública em base64), igual ao Chrome: SHA-256,
 * 16 primeiros bytes em hexadecimal, cada dígito 0–f vira uma letra a–p. Sem chave → ''.
 */
export function extensionIdFromKey(key: unknown): string {
  if (typeof key !== 'string' || !key.trim()) return '';
  try {
    const hex = createHash('sha256').update(key, 'base64').digest().subarray(0, 16).toString('hex');
    return hex.replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  } catch { return ''; }
}

/**
 * Tira o ID de um endereço chrome-extension:// (escopo do service worker, origem do frame).
 * Qualquer outra coisa → ''. O ID vem SÓ daqui — nunca dos argumentos que a extensão manda.
 */
export function extensionIdFromUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const m = /^chrome-extension:\/\/([a-p]{32})(?:[/?#]|$)/.exec(url);
  return m ? m[1] : '';
}

export function extensionUrl(id: string, rel: string): string {
  return `chrome-extension://${id}/${rel.replace(/^\/+/, '')}`;
}

// ── Caminhos dentro da extensão ───────────────────────────────────────────────

/**
 * Normaliza um caminho relativo à raiz da extensão ("popup.html", "/img/a.png",
 * "chrome-extension://<mesmo id>/x.html"). Devolve o caminho limpo sem barra inicial,
 * '' para vazio, ou null se for de outro esquema/outra extensão ou tentar sair da raiz.
 */
export function normalizeExtPath(p: unknown, extId: string): string | null {
  if (p === '') return '';
  if (typeof p !== 'string' || p.length > 2048 || p.includes('\0')) return null;
  let s = p.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (extensionIdFromUrl(s) !== extId) return null;
    s = s.slice(`chrome-extension://${extId}`.length);
  }
  s = s.split(/[?#]/)[0].replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;            // não sobe nunca (nem "a/../b": desconfia)
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Caminho absoluto de um arquivo da extensão no disco, ou null se ele escaparia da pasta
 * (.., caminho absoluto, outra unidade do Windows).
 */
export function resolveInsideRoot(root: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const clean = rel.split(/[?#]/)[0].replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || /^[a-zA-Z]:/.test(clean)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, clean);
  const back = path.relative(base, full);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return full;
}

// ── Ícones ────────────────────────────────────────────────────────────────────

/**
 * Melhor ícone pra um tamanho em pixels, igual ao Chrome: o menor que ainda cobre o tamanho;
 * se nenhum cobre, o maior que houver. Aceita "logo.png" ou { "16": "a.png", "48": "b.png" }.
 */
export function pickIconPath(spec: unknown, px: number): string {
  if (typeof spec === 'string') return spec;
  if (!spec || typeof spec !== 'object') return '';
  const sizes = Object.entries(spec as Record<string, unknown>)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([n, v]) => Number.isFinite(n) && n > 0 && typeof v === 'string' && v)
    .sort((a, b) => a[0] - b[0]);
  if (!sizes.length) return '';
  const fit = sizes.find(([n]) => n >= px);
  return String((fit || sizes[sizes.length - 1])[1]);
}

/** Ícone do botão: o do action (MV3), senão o do browser_action/page_action, senão icons. */
export function actionIconPath(manifest: any, px: number): string {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  for (const spec of [m.action?.default_icon, m.browser_action?.default_icon, m.page_action?.default_icon, m.icons]) {
    const p = pickIconPath(spec, px);
    if (p) return p;
  }
  return '';
}

/** Página de opções declarada no manifesto (options_ui.page ou options_page), já limpa. */
export function optionsPagePath(manifest: any, extId: string): string {
  const raw = manifest?.options_ui?.page || manifest?.options_page;
  const p = normalizeExtPath(raw, extId);
  return p || '';
}

// ── Textos __MSG_nome__ ───────────────────────────────────────────────────────

/** Troca __MSG_nome__ pela mensagem do _locales (chaves sem diferenciar maiúsculas). */
export function localizeMessage(text: unknown, messages: Record<string, { message?: unknown }> | null | undefined): string {
  const s = typeof text === 'string' ? text : '';
  if (!messages || !s.includes('__MSG_')) return s;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(messages)) {
    if (v && typeof v.message === 'string') lower[k.toLowerCase()] = v.message;
  }
  return s.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (all, key: string) => lower[key.toLowerCase()] ?? all);
}

/** Pastas de _locales a tentar, da preferida pra última: pt_BR → pt → padrão → en. */
export function localeCandidates(appLocale: string, defaultLocale: unknown): string[] {
  const out: string[] = [];
  const add = (l: string) => { if (l && !out.includes(l)) out.push(l); };
  const norm = (appLocale || '').replace('-', '_');
  if (norm) { add(norm); add(norm.split('_')[0]); }
  if (typeof defaultLocale === 'string' && /^[A-Za-z_]{2,10}$/.test(defaultLocale)) add(defaultLocale);
  add('en');
  return out.filter(l => /^[A-Za-z]{2,3}(_[A-Za-z]{2,4})?$/.test(l));
}

// ── Cores do badge ────────────────────────────────────────────────────────────

export type Rgba = [number, number, number, number];

const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 255], white: [255, 255, 255, 255], red: [255, 0, 0, 255], green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255], yellow: [255, 255, 0, 255], orange: [255, 165, 0, 255], purple: [128, 0, 128, 255],
  gray: [128, 128, 128, 255], grey: [128, 128, 128, 255], transparent: [0, 0, 0, 0],
};
const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Cor do jeito que o Chrome aceita: [r,g,b,a] (0–255) ou texto CSS (#rgb, #rrggbb, #rrggbbaa,
 * rgb(), rgba(), hsl(), hsla(), alguns nomes). Cor que não dá pra entender → null (o Chrome dá erro).
 */
export function parseColor(input: unknown): Rgba | null {
  if (Array.isArray(input)) {
    if (input.length < 3 || input.length > 4 || !input.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
    return [byte(input[0]), byte(input[1]), byte(input[2]), input.length === 4 ? byte(input[3]) : 255];
  }
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return [...NAMED[s]] as Rgba;
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 255 : byte(Math.min(1, Number(m[4])) * 255);
    return [byte(Number(m[1])), byte(Number(m[2])), byte(Number(m[3])), a];
  }
  // hsl()/hsla(): o Chrome aceita (ParseCssColorString) — extensão que pinta o selo pelo valor.
  m = /^hsla?\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    const h = (((Math.trunc(Number(m[1])) % 360) + 360) % 360) / 360;
    const sat = Math.max(0, Math.min(100, Number(m[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(m[3]))) / 100;
    const a = m[4] === undefined ? 255 : byte(Math.max(0, Math.min(1, Number(m[4]))) * 255);
    if (![h, sat, l, a].every(Number.isFinite)) return null;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [byte(hue2rgb(h + 1 / 3) * 255), byte(hue2rgb(h) * 255), byte(hue2rgb(h - 1 / 3) * 255), a];
  }
  return null;
}

export function cssColor(c: Rgba): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.round((c[3] / 255) * 1000) / 1000})`;
}

/** Sem cor de texto escolhida, o Chrome escolhe branco ou preto pra contrastar com o fundo. */
export function autoTextColor(bg: Rgba): Rgba {
  const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
  return lum > 0.62 ? [0, 0, 0, 255] : [255, 255, 255, 255];
}

export const DEFAULT_BADGE_BG: Rgba = [26, 115, 232, 255];

/** Badge cabe ~4 caracteres (o Chrome corta o resto). Conta letras, não bytes. */
export function normalizeBadgeText(text: unknown): string {
  if (text === undefined || text === null) return '';
  return Array.from(String(text)).slice(0, 4).join('');
}

// ── Estado do botão (global + por aba) ────────────────────────────────────────

export interface ActionValues {
  title?: string;
  badgeText?: string;
  badgeBg?: Rgba;
  badgeFg?: Rgba;
  popup?: string;     // caminho relativo; '' = sem popup
  icon?: string;      // data URL; undefined = ícone do manifesto
  enabled?: boolean;
}
export type ActionKey = keyof ActionValues;
export interface ActionState {
  defaults: ActionValues;
  global: ActionValues;
  tabs: Record<string, ActionValues>;
}

export function initialActionState(manifest: any, extId: string): ActionState {
  const a = manifest?.action || manifest?.browser_action || {};
  const defaults: ActionValues = {
    title: typeof a.default_title === 'string' ? a.default_title : '',
    badgeText: '',
    popup: normalizeExtPath(a.default_popup, extId) || '',
    enabled: true,
  };
  return { defaults, global: { ...defaults }, tabs: {} };
}

/**
 * Muda um valor do botão, igual ao Chrome: com tabId vale só praquela aba (e ganha do global);
 * value null com tabId apaga o da aba (volta a valer o global); null sem tabId volta ao padrão.
 */
export function updateAction<K extends ActionKey>(state: ActionState, key: K, value: ActionValues[K] | null, tabId?: number): ActionState {
  if (tabId === undefined) {
    const global = { ...state.global };
    if (value === null) {
      if (state.defaults[key] === undefined) delete global[key]; else global[key] = state.defaults[key];
    } else global[key] = value;
    return { ...state, global };
  }
  const k = String(tabId);
  const tabs = { ...state.tabs };
  const cur = { ...(tabs[k] || {}) };
  if (value === null) delete cur[key]; else cur[key] = value;
  if (Object.keys(cur).length) tabs[k] = cur; else delete tabs[k];
  return { ...state, tabs };
}

/** Aba fechou ou abriu outra página: os valores daquela aba somem (o Chrome faz igual). */
export function clearTabAction(state: ActionState, tabId: number): ActionState {
  const k = String(tabId);
  if (!state.tabs[k]) return state;
  const tabs = { ...state.tabs };
  delete tabs[k];
  return { ...state, tabs };
}

export function resolveAction(state: ActionState, tabId?: number): ActionValues {
  const over = tabId === undefined ? undefined : state.tabs[String(tabId)];
  return over ? { ...state.global, ...over } : { ...state.global };
}

/** O que a tela desenha pro botão (cores já em CSS, título com o nome como reserva). */
export interface ActionView {
  title: string; badgeText: string; badgeBg: string; badgeFg: string;
  icon: string; enabled: boolean; hasPopup: boolean;
}
export function actionView(state: ActionState, name: string, defaultIcon: string, tabId?: number): ActionView {
  const v = resolveAction(state, tabId);
  const bg = v.badgeBg || DEFAULT_BADGE_BG;
  return {
    title: v.title || name,
    badgeText: normalizeBadgeText(v.badgeText),
    badgeBg: cssColor(bg),
    badgeFg: cssColor(v.badgeFg || autoTextColor(bg)),
    icon: v.icon || defaultIcon,
    enabled: v.enabled !== false,
    hasPopup: !!v.popup,
  };
}

// ── Argumentos que vêm da extensão ────────────────────────────────────────────

/** details tem que ser um objeto simples (ou nada). */
export function asDetails(d: unknown): Record<string, unknown> {
  if (d === undefined || d === null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new Error('Invalid arguments: expected an object.');
  return d as Record<string, unknown>;
}

/** tabId opcional: inteiro ≥ 0. Qualquer outra coisa é erro (o Chrome também recusa). */
export function asTabId(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error('Invalid tabId.');
  return v;
}

// ── Abrir aba a pedido da extensão (tabs.create) ──────────────────────────────

/**
 * Só abre http/https e páginas da PRÓPRIA extensão (relativo vale: "options.html").
 * javascript:, file:, data:, chrome:, outra extensão… → recusa.
 */
export function checkTabUrl(url: unknown, extId: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (url === undefined || url === null || url === '') return { ok: true, url: '' };   // aba nova padrão
  if (typeof url !== 'string' || url.length > 8192) return { ok: false, reason: 'Invalid url.' };
  let u: URL;
  try { u = new URL(url.trim(), `chrome-extension://${extId}/`); } catch { return { ok: false, reason: 'Invalid url.' }; }
  if (u.protocol === 'http:' || u.protocol === 'https:') return { ok: true, url: u.href };
  if (u.protocol === 'chrome-extension:' && u.host === extId) {
    const rel = normalizeExtPath(u.pathname, extId);
    if (rel === null) return { ok: false, reason: 'Invalid url.' };
    return { ok: true, url: extensionUrl(extId, rel) + u.search + u.hash };
  }
  return { ok: false, reason: `Cannot open ${u.protocol} URLs.` };
}

// ── O que pedir pra pessoa na instalação ──────────────────────────────────────

const ALL_HOSTS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', '*://*/']);

/** Sites onde a extensão lê/muda dados (host_permissions + content_scripts + permissões MV2). */
export function hostAccessSummary(manifest: any): { all: boolean; hosts: string[] } {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const patterns: string[] = [];
  const push = (v: unknown) => { if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') patterns.push(x); };
  push(m.host_permissions);
  // optional_host_permissions só valem quando a extensão pede depois: não entram aqui.
  if (Array.isArray(m.content_scripts)) for (const cs of m.content_scripts) push(cs?.matches);
  if (Array.isArray(m.permissions)) push(m.permissions.filter((p: unknown) => typeof p === 'string' && (p.includes('://') || p === '<all_urls>')));
  let all = false;
  const hosts: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (ALL_HOSTS.has(p)) { all = true; continue; }
    // file:// não é "todos os sites": o Bah nunca carrega extensão com acesso a arquivo
    // local (allowFileAccess), então não há o que avisar.
    if (/^file:/i.test(p)) continue;
    const mm = /^(\*|https?|wss?|ftp):\/\/([^/]*)/i.exec(p);
    if (!mm) continue;
    let host = mm[2].toLowerCase();
    if (host === '*' || host === '') { all = true; continue; }
    host = host.replace(/:\d+$/, '');
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { all, hosts };
}

// Esquemas que o <all_urls> cobre no Bah (file:// nunca: o Bah não dá acesso a arquivo local).
const ALL_URLS_SCHEMES = ['http', 'https', 'ws', 'wss', 'ftp'];
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };

/**
 * Padrão de endereço do Chrome ("match pattern"): `<all_urls>`, `*://*.site.com/*`,
 * `https://a.com:8080/caminho*`. Igual ao Chrome: esquema `*` = http ou https; host `*`,
 * `*.domínio` (cobre o próprio domínio e os subdomínios) ou exato; porta omitida = qualquer
 * porta; caminho com `*` como curinga (casado contra caminho + query). `ignorePath` é o que o
 * Chrome faz com host_permissions (o caminho delas não conta).
 */
export function matchPattern(pattern: unknown, url: unknown, opts: { ignorePath?: boolean } = {}): boolean {
  if (typeof pattern !== 'string' || typeof url !== 'string' || pattern.length > 2048) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const proto = u.protocol.replace(/:$/, '').toLowerCase();
  const p = pattern.trim();
  if (p === '<all_urls>') return ALL_URLS_SCHEMES.includes(proto);
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/(\[[0-9a-f:.]+\]|[^/:]*)(?::(\*|\d{1,5}))?(\/.*)?$/i.exec(p);
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  if (scheme === '*' ? proto !== 'http' && proto !== 'https' : scheme !== proto) return false;
  if (scheme === 'file') return false;   // o Bah não carrega extensão com acesso a arquivo local
  const host = m[2].toLowerCase();
  const h = u.hostname.toLowerCase();
  if (!host) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const d = host.slice(2);
      if (!d || d.includes('*') || !(h === d || h.endsWith('.' + d))) return false;
    } else if (host.includes('*') || h !== host) return false;
  }
  const port = m[3];
  if (port && port !== '*' && (u.port || DEFAULT_PORTS[proto] || '') !== String(Number(port))) return false;
  if (opts.ignorePath) return true;
  const pathGlob = m[4] || '/';
  const re = new RegExp('^' + pathGlob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

/** Padrões de host que a extensão tem (host_permissions + os de "permissions" do MV2). */
function hostPermissionPatterns(manifest: any): string[] {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);
  return [...strs(m.host_permissions), ...strs(m.permissions).filter(p => p.includes('://') || p === '<all_urls>')];
}

/**
 * A extensão tem permissão de host pra este endereço? (cookies, ver aba…). Só
 * host_permissions/permissions contam — content_scripts não (igual ao Chrome).
 */
export function hasHostPermission(manifest: any, url: unknown): boolean {
  return hostPermissionPatterns(manifest).some(p => matchPattern(p, url, { ignorePath: true }));
}

/** Permissão de API declarada no manifesto ("proxy", "cookies"…). */
export function hasApiPermission(manifest: any, perm: string): boolean {
  const perms = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];
  return perms.includes(perm);
}

function hostPatternMatches(pattern: string, u: URL): boolean {
  return matchPattern(pattern, u.href, { ignorePath: true });
}

/**
 * A extensão pode ver o endereço e o título da aba? Igual ao Chrome (ExtensionTabUtil): só com
 * "tabs", "activeTab" (o clique no botão conta como activeTab) ou permissão de host que cubra o
 * endereço. Os content_scripts NÃO contam (pro Chrome são outra coisa). Página da PRÓPRIA
 * extensão (extId) ela sempre vê. O resto → sem url/título.
 */
export function canSeeTabUrl(manifest: any, url: unknown, extId = ''): boolean {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const perms: string[] = Array.isArray(m.permissions) ? m.permissions.filter((p: unknown) => typeof p === 'string') : [];
  if (perms.includes('tabs') || perms.includes('activeTab')) return true;
  if (typeof url !== 'string' || !url) return false;
  if (extId && extensionIdFromUrl(url) === extId) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const hostPerms: string[] = Array.isArray(m.host_permissions) ? m.host_permissions.filter((p: unknown) => typeof p === 'string') : [];
  const patterns = [...hostPerms, ...perms.filter(p => p.includes('://') || p === '<all_urls>')];
  return patterns.some(p => hostPatternMatches(p, u));
}

// ── Acesso aprovado pela pessoa (instalação × atualização) ───────────────────

/** O que a pessoa aprovou: permissões de API (sem as de host) + sites. Tudo ordenado. */
export interface AccessGrant { permissions: string[]; all: boolean; hosts: string[] }

const isHostPattern = (p: string) => p.includes('://') || p === '<all_urls>';

export function accessGrant(manifest: any): AccessGrant {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const perms = Array.isArray(m.permissions) ? m.permissions.filter((p: unknown): p is string => typeof p === 'string' && !isHostPattern(p)) : [];
  const { all, hosts } = hostAccessSummary(m);
  return { permissions: Array.from(new Set<string>(perms)).sort(), all, hosts: [...hosts].sort() };
}

/** Registro salvo em disco → AccessGrant, ou null se não tiver o formato certo. */
export function asGrant(raw: unknown): AccessGrant | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : null);
  const permissions = strs(r.permissions);
  const hosts = strs(r.hosts);
  if (!permissions || !hosts || typeof r.all !== 'boolean') return null;
  return { permissions, all: r.all, hosts };
}

// Permissões que o Chrome instala/atualiza sem avisar nada (não têm aviso de permissão).
const NO_WARNING_PERMISSIONS = new Set([
  'activeTab', 'alarms', 'background', 'contextMenus', 'idle', 'offscreen', 'power', 'scripting',
  'sidePanel', 'storage', 'unlimitedStorage', 'webRequest',
]);

/** "*.a.com" aprovado cobre "x.a.com" e "*.x.a.com"; nome exato só cobre ele mesmo. */
function hostCovered(host: string, granted: string[]): boolean {
  if (granted.includes(host)) return true;
  const base = host.startsWith('*.') ? host.slice(2) : host;
  return granted.some(g => g.startsWith('*.') && (base === g.slice(2) || base.endsWith('.' + g.slice(2))));
}

/**
 * O que o manifesto pede A MAIS do que foi aprovado (null = nada novo). É o que o Chrome faz
 * numa atualização: pediu mais, a extensão fica desligada até a pessoa aprovar de novo.
 */
export function accessIncrease(granted: AccessGrant | null | undefined, manifest: any): AccessGrant | null {
  const g = asGrant(granted) || { permissions: [], all: false, hosts: [] };
  const next = accessGrant(manifest);
  const permissions = next.permissions.filter(p => !g.permissions.includes(p) && !NO_WARNING_PERMISSIONS.has(p));
  const all = next.all && !g.all;
  const hosts = g.all || all ? [] : next.hosts.filter(h => !hostCovered(h, g.hosts));
  if (!permissions.length && !all && !hosts.length) return null;
  return { permissions, all, hosts };
}

// Recursos que o Bah (Electron 44) não entrega pra extensão. webRequest/DNR existem no
// Electron, mas o Bah já tem ouvintes de webRequest na sessão das abas, e nesse caso o
// Electron desliga o das extensões — o Bah só emula o webRequest.onAuthRequired do proxy
// (webRequestAuthProvider). omnibox e contextMenus só têm "casca" (não quebram, mas não
// aparecem). proxy, cookies, notifications, privacy e management o Bah faz (calço + main).
const UNSUPPORTED_PERMISSIONS = [
  'webRequest', 'webRequestBlocking',
  'declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'declarativeNetRequestFeedback',
  'sidePanel', 'identity', 'identity.email', 'nativeMessaging', 'debugger', 'offscreen',
  'tabCapture', 'desktopCapture', 'downloads', 'downloads.open', 'downloads.ui',
  'history', 'bookmarks', 'contextMenus', 'webNavigation', 'tabGroups', 'tts', 'ttsEngine',
  'pageCapture', 'browsingData', 'topSites', 'sessions', 'search', 'fontSettings',
  'contentSettings', 'idle', 'power', 'gcm', 'readingList', 'userScripts', 'favicon', 'printing',
  'printingMetrics', 'certificateProvider', 'platformKeys', 'documentScan', 'enterprise.platformKeys',
  'enterprise.deviceAttributes', 'enterprise.hardwarePlatform', 'enterprise.networkingAttributes',
  'system.cpu', 'system.memory', 'system.display', 'system.storage', 'vpnProvider', 'wallpaper',
  'loginState', 'fileBrowserHandler', 'fileSystemProvider', 'declarativeContent', 'processes',
];
const UNSUPPORTED_KEYS: Array<[string, string]> = [
  ['omnibox', 'omnibox'],
  ['side_panel', 'sidePanel'],
  ['chrome_url_overrides', 'chrome_url_overrides'],
  ['chrome_settings_overrides', 'chrome_settings_overrides'],
  ['commands', 'commands'],
  ['declarative_net_request', 'declarativeNetRequest'],
  ['tts_engine', 'ttsEngine'],
  ['file_browser_handlers', 'fileBrowserHandler'],
];

/** Lista (sem repetição, na ordem em que aparece) do que a extensão usa e o Bah não tem. */
export function unsupportedFeatures(manifest: any): string[] {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const out: string[] = [];
  const add = (f: string) => { if (!out.includes(f)) out.push(f); };
  const perms = Array.isArray(m.permissions) ? m.permissions.filter((p: unknown) => typeof p === 'string') : [];
  // Extensão de proxy/VPN: o webRequest dela é o do login no proxy (onAuthRequired), que o
  // Bah faz — não assusta a pessoa com "webRequest não funciona".
  const proxyAuth = perms.includes('proxy') && perms.includes('webRequestAuthProvider');
  for (const p of perms) {
    if (p === 'webRequest' && proxyAuth) continue;
    if (UNSUPPORTED_PERMISSIONS.includes(p)) add(p);
  }
  for (const [key, label] of UNSUPPORTED_KEYS) {
    const v = m[key];
    if (v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) add(label);
  }
  return out;
}

// ── Diversos ──────────────────────────────────────────────────────────────────

/** chrome.runtime.getPlatformInfo() a partir do process.platform/arch do Node. */
export function platformInfo(platform: string, arch: string): { os: string; arch: string; nacl_arch: string } {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux'
    : platform === 'openbsd' ? 'openbsd' : platform === 'freebsd' ? 'linux' : platform;
  const a = arch === 'x64' ? 'x86-64' : arch === 'ia32' ? 'x86-32' : arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm' : arch;
  const nacl = a === 'arm64' ? 'arm' : a;
  return { os, arch: a, nacl_arch: nacl };
}

/** Popup do Chrome: entre 25×25 e 800×600. */
export function clampPopupSize(w: unknown, h: unknown): { width: number; height: number } {
  const c = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.ceil(v) : lo;
    return Math.max(lo, Math.min(hi, n));
  };
  return { width: c(w, 25, 800), height: c(h, 25, 600) };
}

/**
 * Onde o popup aparece: canto de cima à direita embaixo do ícone clicado, sem sair da área
 * útil da tela. anchor vem em px CSS da janela; zoom é o zoom da UI do Bah.
 */
export function popupPosition(
  anchor: { left: number; right: number; bottom: number },
  content: { x: number; y: number },
  size: { width: number; height: number },
  work: { x: number; y: number; width: number; height: number },
  zoom = 1,
): { x: number; y: number } {
  let x = Math.round(content.x + anchor.right * zoom - size.width);
  let y = Math.round(content.y + anchor.bottom * zoom + 2);
  x = Math.max(work.x, Math.min(x, work.x + work.width - size.width));
  y = Math.max(work.y, Math.min(y, work.y + work.height - size.height));
  return { x, y };
}

// ── chrome.storage.sync (guardado pelo Bah, separado do local) ───────────────

export type StorageItems = Record<string, unknown>;
export type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;

/** Limites do chrome.storage.sync do Chrome (as constantes que a extensão lê). */
export const SYNC_LIMITS = {
  QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
  MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
};

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
// Define como propriedade própria: "__proto__" é uma chave como outra qualquer.
const put = (o: StorageItems, k: string, v: unknown) => {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
};
const copyItems = (o: StorageItems): StorageItems => {
  const out: StorageItems = {};
  for (const k of Object.keys(o)) put(out, k, o[k]);
  return out;
};
const itemBytes = (k: string, v: unknown) => k.length + (JSON.stringify(v) ?? '').length;

/** storage.get: null/undefined = tudo; texto; lista; objeto = chaves com valor padrão. */
export function storageGet(store: StorageItems, keys: unknown): StorageItems {
  if (keys === null || keys === undefined) return copyItems(store);
  const out: StorageItems = {};
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    for (const k of keys) if (typeof k === 'string' && hasOwn(store, k)) put(out, k, store[k]);
    return out;
  }
  if (typeof keys === 'object') {
    for (const [k, def] of Object.entries(keys as StorageItems)) put(out, k, hasOwn(store, k) ? store[k] : def);
    return out;
  }
  throw new Error('Invalid keys.');
}

/** Bytes em uso (chave + JSON do valor, como o Chrome conta). keys null = tudo. */
export function storageBytesInUse(store: StorageItems, keys?: unknown): number {
  let list: string[];
  if (keys === null || keys === undefined) list = Object.keys(store);
  else if (typeof keys === 'string') list = [keys];
  else if (Array.isArray(keys)) list = keys.filter((k): k is string => typeof k === 'string');
  else throw new Error('Invalid keys.');
  let n = 0;
  for (const k of list) if (hasOwn(store, k)) n += itemBytes(k, store[k]);
  return n;
}

/** storage.set: guarda em JSON (o que não vira JSON some) e respeita as cotas do sync. */
export function storageSet(store: StorageItems, items: unknown, limits = SYNC_LIMITS): { store: StorageItems; changes: StorageChanges } {
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('Invalid items.');
  const next = copyItems(store);
  const changes: StorageChanges = {};
  for (const k of Object.keys(items as object)) {
    const json = JSON.stringify((items as StorageItems)[k]);
    if (json === undefined) continue;
    const value = JSON.parse(json);
    if (itemBytes(k, value) > limits.QUOTA_BYTES_PER_ITEM) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    const had = hasOwn(next, k);
    if (had && JSON.stringify(next[k]) === json) continue;   // igual: o Chrome não avisa
    changes[k] = had ? { oldValue: next[k], newValue: value } : { newValue: value };
    put(next, k, value);
  }
  if (Object.keys(next).length > limits.MAX_ITEMS) throw new Error('MAX_ITEMS quota exceeded');
  if (storageBytesInUse(next) > limits.QUOTA_BYTES) throw new Error('QUOTA_BYTES quota exceeded');
  return { store: next, changes };
}

export function storageRemove(store: StorageItems, keys: unknown): { store: StorageItems; changes: StorageChanges } {
  const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : null;
  if (!list) throw new Error('Invalid keys.');
  const next = copyItems(store);
  const changes: StorageChanges = {};
  for (const k of list) {
    if (!hasOwn(next, k)) continue;
    changes[k] = { oldValue: next[k] };
    delete next[k];
  }
  return { store: next, changes };
}

export function storageClear(store: StorageItems): { store: StorageItems; changes: StorageChanges } {
  const changes: StorageChanges = {};
  for (const k of Object.keys(store)) changes[k] = { oldValue: store[k] };
  return { store: {}, changes };
}

// ── chrome.alarms (os timers ficam no Bah, não na página) ────────────────────

export interface Alarm { name: string; scheduledTime: number; periodInMinutes?: number }

/** O Chrome não deixa alarme mais curto que 30 s (extensão instalada). */
export const MIN_ALARM_MINUTES = 0.5;
/** setTimeout só aguenta até 2^31-1 ms (~24,8 dias); mais que isso dispara NA HORA. */
export const MAX_TIMER_MS = 0x7fffffff;

/** alarms.create(name, info) → o alarme do jeito do Chrome (tempos mínimos aplicados). */
export function createAlarm(name: unknown, info: unknown, now: number): Alarm {
  const n = typeof name === 'string' ? name : '';
  const i = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
  const minutes = (v: unknown, what: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Invalid ${what}.`);
    return Math.max(MIN_ALARM_MINUTES, v);
  };
  const delay = minutes(i.delayInMinutes, 'delayInMinutes');
  const period = minutes(i.periodInMinutes, 'periodInMinutes');
  if (i.when !== undefined && i.when !== null && (typeof i.when !== 'number' || !Number.isFinite(i.when))) throw new Error('Invalid when.');
  if (typeof i.when === 'number' && delay !== undefined) throw new Error('Cannot set both when and delayInMinutes.');
  const scheduledTime = typeof i.when === 'number' ? i.when : now + (delay ?? period ?? MIN_ALARM_MINUTES) * 60000;
  return period !== undefined ? { name: n, scheduledTime, periodInMinutes: period } : { name: n, scheduledTime };
}

/** Quanto esperar no próximo setTimeout (em pedaços: alarme longe re-arma até chegar a hora). */
export function alarmTimerDelay(scheduledTime: number, now: number): number {
  return Math.min(Math.max(0, scheduledTime - now), MAX_TIMER_MS);
}

/** Retângulo do ícone vindo da tela: só números finitos e razoáveis. */
export function asAnchor(a: unknown): { left: number; top: number; right: number; bottom: number } | null {
  if (!a || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100000 ? v : NaN);
  const out = { left: n(r.left), top: n(r.top), right: n(r.right), bottom: n(r.bottom) };
  return Object.values(out).some(Number.isNaN) ? null : out;
}

// ── Ligar/desligar (o interruptor do quebra-cabeça) ──────────────────────────

/**
 * p fica DENTRO de base (nunca igual, nunca fora: "..", outra unidade, caminho absoluto
 * esquisito)? Compara sem diferenciar maiúsculas no Windows.
 */
export function isInsideDir(base: string, p: unknown, platform: string = process.platform): boolean {
  if (typeof p !== 'string' || !p || p.includes('\0') || typeof base !== 'string' || !base) return false;
  const P = platform === 'win32' ? path.win32 : path.posix;
  const b = P.resolve(base);
  const full = P.resolve(p);
  const rel = platform === 'win32' ? P.relative(b.toLowerCase(), full.toLowerCase()) : P.relative(b, full);
  return !!rel && rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel);
}

/** O que o menu precisa de uma extensão desligada (ela não está carregada pra perguntar). */
export interface DisabledEntry { name: string; version: string; icon: string; path: string }

const MAX_ICON_URL = 200_000;
const cleanIcon = (v: unknown): string =>
  typeof v === 'string' && v.length <= MAX_ICON_URL && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';
const cleanVersion = (v: unknown): string =>
  typeof v === 'string' && v.length <= 64 && /^[0-9A-Za-z._\- ]*$/.test(v) ? v : '';
const cleanName = (v: unknown, id: string): string => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : '';
  return s || id;
};

/** Uma entrada (lida do disco ou montada agora) no formato certo; pasta fora de Extensions → ''. */
export function sanitizeDisabledEntry(id: string, raw: unknown, extensionsPath: string, platform: string = process.platform): DisabledEntry {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const P = platform === 'win32' ? path.win32 : path.posix;
  const dir = isInsideDir(extensionsPath, r.path, platform) ? P.resolve(String(r.path)) : '';
  return { name: cleanName(r.name, id), version: cleanVersion(r.version), icon: cleanIcon(r.icon), path: dir };
}

/**
 * extension-disabled.json → { id: entrada }. Só IDs de verdade; lista antiga (só os IDs)
 * também vale. Qualquer coisa estranha some sem derrubar o resto.
 */
export function parseDisabledSet(raw: unknown, extensionsPath: string, platform: string = process.platform): Record<string, DisabledEntry> {
  const out: Record<string, DisabledEntry> = {};
  if (Array.isArray(raw)) {
    for (const id of raw) if (isExtensionId(id)) out[id] = sanitizeDisabledEntry(id, null, extensionsPath, platform);
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    if (isExtensionId(id)) out[id] = sanitizeDisabledEntry(id, e, extensionsPath, platform);
  }
  return out;
}

/** Versões do Chrome ("1.2.10" > "1.2.9"); pedaço que não é número conta como 0. */
export function compareVersions(a: unknown, b: unknown): number {
  const parts = (v: unknown) => String(typeof v === 'string' ? v : '').split('.').map(x => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Entre as pastas de uma extensão no disco, a da versão mais nova (como a biblioteca escolhe). */
export function pickLatestVersion<T extends { version: string }>(cands: T[]): T | null {
  let best: T | null = null;
  for (const c of cands) if (!best || compareVersions(best.version, c.version) < 0) best = c;
  return best;
}

/** O que a tela recebe de cada extensão. enabled = ligada no interruptor (≠ action.enable/disable). */
export interface ExtensionView {
  id: string; name: string; version: string; hasOptions: boolean;
  enabled: boolean;
  /** Ela controla o proxy das abas agora (VPN ligada): a tela mostra isso no quebra-cabeça. */
  controlsProxy?: boolean;
  global: ActionView;
  tabs: Record<string, ActionView>;
}

/**
 * O carregador com trava recusa uma extensão desligada — menos a que está sendo ligada agora
 * (ela continua na lista de desligadas até o carregamento dar certo).
 */
export function blockedAsDisabled(id: string, disabled: Record<string, DisabledEntry>, enabling: ReadonlySet<string>): boolean {
  return Object.prototype.hasOwnProperty.call(disabled, id) && !enabling.has(id);
}

/**
 * Lista pra tela: as carregadas (ligadas) + as desligadas que não estão carregadas, por nome
 * (ordem fixa: ligar/desligar não embaralha a barra). Uma desligada que ainda aparece como
 * carregada (descarregando agora) vai como desligada.
 */
export function mergeExtensionViews(
  loaded: Array<Omit<ExtensionView, 'enabled'>>,
  disabled: Record<string, DisabledEntry>,
): ExtensionView[] {
  const out: ExtensionView[] = [];
  const seen = new Set<string>();
  for (const v of loaded) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({ ...v, enabled: !Object.prototype.hasOwnProperty.call(disabled, v.id) });
  }
  for (const [id, e] of Object.entries(disabled)) {
    if (seen.has(id) || !isExtensionId(id)) continue;
    seen.add(id);
    const global = { ...actionView(initialActionState({}, id), e.name || id, e.icon), enabled: false };
    out.push({ id, name: e.name || id, version: e.version, hasOptions: false, enabled: false, global, tabs: {} });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * chromeWebstore.getExtensionStatus, do jeito da biblioteca + o "desligada" do Bah: a loja
 * mostra "Ativar este item" em vez de oferecer instalar de novo.
 */
export function storeInstallStatus(opts: {
  manifest: any; minimumManifestVersion: number;
  loaded: boolean; disabledByUser: boolean;
}): 'deprecated_manifest_version' | 'installable' | 'enabled' | 'disabled' {
  const mv = Number(opts.manifest?.manifest_version);
  if (opts.manifest && Number.isFinite(mv) && mv < opts.minimumManifestVersion) return 'deprecated_manifest_version';
  if (opts.disabledByUser) return 'disabled';
  return opts.loaded ? 'enabled' : 'installable';
}

/** chrome.management.ExtensionInfo no formato que a biblioteca manda pra loja. */
export function managementInfo(id: string, manifest: any, enabled: boolean, name?: string) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const displayName = name || (typeof m.name === 'string' ? m.name : id);
  return {
    description: typeof m.description === 'string' ? m.description : '',
    enabled,
    homepageUrl: typeof m.homepage_url === 'string' ? m.homepage_url : '',
    hostPermissions: strArr(m.host_permissions),
    icons: Object.keys(m.icons && typeof m.icons === 'object' ? m.icons : {})
      .map(size => parseInt(size, 10)).filter(n => Number.isFinite(n) && n > 0)
      .map(size => ({ size, url: `chrome://extension-icon/${id}/${size}/0` })),
    id,
    installType: 'normal',
    isApp: !!m.app,
    mayDisable: true,
    name: displayName,
    offlineEnabled: !!m.offline_enabled,
    optionsUrl: typeof m.options_page === 'string' && m.options_page ? `chrome-extension://${id}/${m.options_page}` : '',
    permissions: strArr(m.permissions),
    shortName: typeof m.short_name === 'string' && m.short_name ? m.short_name : displayName,
    type: m.app ? 'app' : 'extension',
    updateUrl: typeof m.update_url === 'string' ? m.update_url : '',
    version: typeof m.version === 'string' ? m.version : '',
  };
}

// ── chrome.proxy: config do Chrome → config do Electron (session.setProxy) ───

export type ProxyScheme = 'http' | 'https' | 'quic' | 'socks4' | 'socks5';
export interface ChromeProxyServer { scheme: ProxyScheme; host: string; port: number }
/** O que o Electron recebe (Electron.ProxyConfig, sem depender do Electron aqui). */
export interface ElectronProxyConfig {
  mode: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system';
  proxyRules?: string;
  proxyBypassRules?: string;
  pacScript?: string;
}

const PROXY_SCHEMES: ProxyScheme[] = ['http', 'https', 'quic', 'socks4', 'socks5'];
const PROXY_DEFAULT_PORT: Record<ProxyScheme, number> = { http: 80, https: 443, quic: 443, socks4: 1080, socks5: 1080 };
/** PAC em texto (pacScript.data): até 1 MB. Mais que isso não é PAC, é abuso. */
export const MAX_PAC_BYTES = 1_000_000;
export const MAX_BYPASS_ENTRIES = 1000;
/** Os proxies por esquema do Chrome, na ordem e com o prefixo que o Chromium usa nas regras. */
const RULE_FIELDS: Array<[string, string]> = [['proxyForHttp', 'http'], ['proxyForHttps', 'https'], ['proxyForFtp', 'ftp'], ['fallbackProxy', 'socks']];

/** Host de proxy: nome (letras, números, ponto, hífen), IPv4 ou IPv6 (com ou sem colchetes). */
function proxyHost(v: unknown): string {
  if (typeof v !== 'string') throw new Error('Invalid proxy server: host must be a string.');
  let h = v.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const ipv6 = h.includes(':');
  const ok = ipv6
    ? /^[0-9a-f:.]{2,45}$/.test(h) && (h.match(/:/g) || []).length >= 2
    : h.length >= 1 && h.length <= 253 && /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/.test(h) &&
      h.split('.').every(l => l.length <= 63 && !l.startsWith('-') && !l.endsWith('-'));
  if (!ok) throw new Error(`Invalid proxy server host: "${String(v).slice(0, 100)}".`);
  return ipv6 ? `[${h}]` : h;
}

/** Um chrome.proxy.ProxyServer validado: esquema (padrão http), host, porta 1..65535. */
export function parseProxyServer(raw: unknown, field = 'proxy'): ChromeProxyServer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid ${field}: expected an object.`);
  const r = raw as Record<string, unknown>;
  const scheme = (r.scheme === undefined ? 'http' : r.scheme) as ProxyScheme;
  if (!PROXY_SCHEMES.includes(scheme)) throw new Error(`Invalid ${field}: unsupported scheme "${String(r.scheme).slice(0, 20)}".`);
  const host = proxyHost(r.host);
  let port = PROXY_DEFAULT_PORT[scheme];
  if (r.port !== undefined && r.port !== null) {
    if (typeof r.port !== 'number' || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535) throw new Error(`Invalid ${field}: port must be an integer from 1 to 65535.`);
    port = r.port;
  }
  return { scheme, host, port };
}

/** Servidor no formato de regra do Chromium, sempre com esquema explícito ("socks5://h:1080"). */
export function proxyServerUri(s: ChromeProxyServer): string {
  return `${s.scheme}://${s.host}:${s.port}`;
}

/** PAC em texto → data: URL que o Chromium aceita (medido no Electron 44). */
export function pacDataUrl(data: string): string {
  return 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(data, 'utf8').toString('base64');
}

function bypassEntry(v: unknown): string {
  // "<local>", "*.site.com", "10.0.0.0/8", "[::1]:8080", "http://x.com"… sem vírgula/espaço (viraria outra regra).
  if (typeof v !== 'string' || !/^[A-Za-z0-9.*:\-[\]/<>_]{1,255}$/.test(v.trim())) throw new Error(`Invalid bypassList entry: "${String(v).slice(0, 100)}".`);
  return v.trim();
}

/**
 * chrome.proxy.ProxyConfig → { value: o que o get() devolve (normalizado), electron: o que vai
 * pro session.setProxy }. Tudo conferido; qualquer coisa fora do formato → Error.
 * pacScript.mandatory é guardado, mas o Electron não tem como aplicar.
 */
export function translateProxyConfig(raw: unknown): { value: Record<string, unknown>; electron: ElectronProxyConfig } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid proxy configuration: expected an object.');
  const r = raw as Record<string, unknown>;
  const mode = r.mode;
  if (mode === 'direct' || mode === 'auto_detect' || mode === 'system') return { value: { mode }, electron: { mode } };
  if (mode === 'pac_script') {
    const pac = r.pacScript;
    if (!pac || typeof pac !== 'object' || Array.isArray(pac)) throw new Error("Invalid proxy configuration: mode 'pac_script' needs pacScript.");
    const p = pac as Record<string, unknown>;
    const pacValue: Record<string, unknown> = {};
    let electron: ElectronProxyConfig;
    if (typeof p.data === 'string' && p.data) {
      if (Buffer.byteLength(p.data, 'utf8') > MAX_PAC_BYTES) throw new Error('Invalid pacScript: data is too large.');
      pacValue.data = p.data;
      electron = { mode: 'pac_script', pacScript: pacDataUrl(p.data) };
    } else if (typeof p.url === 'string' && p.url) {
      let u: URL;
      try { u = new URL(p.url); } catch { throw new Error('Invalid pacScript: bad url.'); }
      if (p.url.length > 8192 || !['http:', 'https:', 'data:'].includes(u.protocol)) throw new Error('Invalid pacScript: url must be http, https or data.');
      pacValue.url = p.url;
      electron = { mode: 'pac_script', pacScript: p.url };
    } else throw new Error('Invalid pacScript: needs data or url.');
    if (typeof p.mandatory === 'boolean') pacValue.mandatory = p.mandatory;
    return { value: { mode, pacScript: pacValue }, electron };
  }
  if (mode === 'fixed_servers') {
    const rules = r.rules;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error("Invalid proxy configuration: mode 'fixed_servers' needs rules.");
    const ru = rules as Record<string, unknown>;
    const outRules: Record<string, unknown> = {};
    const parts: string[] = [];
    if (ru.singleProxy !== undefined) {
      const s = parseProxyServer(ru.singleProxy, 'singleProxy');
      outRules.singleProxy = s;
      parts.push(proxyServerUri(s));
    } else {
      for (const [field, prefix] of RULE_FIELDS) {
        if (ru[field] === undefined) continue;
        const s = parseProxyServer(ru[field], field);
        outRules[field] = s;
        parts.push(`${prefix}=${proxyServerUri(s)}`);
      }
    }
    if (!parts.length) throw new Error('Invalid proxy rules: no proxy server given.');
    const electron: ElectronProxyConfig = { mode: 'fixed_servers', proxyRules: parts.join(';') };
    if (ru.bypassList !== undefined) {
      if (!Array.isArray(ru.bypassList) || ru.bypassList.length > MAX_BYPASS_ENTRIES) throw new Error('Invalid bypassList.');
      const list = ru.bypassList.map(bypassEntry);
      outRules.bypassList = list;
      if (list.length) electron.proxyBypassRules = list.join(',');
    }
    return { value: { mode, rules: outRules }, electron };
  }
  throw new Error(`Invalid proxy mode: "${String(mode).slice(0, 40)}".`);
}

/**
 * A config da extensão aponta pra este servidor? Serve pro pedido de senha de proxy que chega
 * SEM aba (worker, fetch da própria extensão): só vai pra extensão se o proxy que pediu é dela.
 */
export function proxyConfigMentions(value: unknown, host: unknown, port: unknown): boolean {
  if (!value || typeof value !== 'object' || typeof host !== 'string' || typeof port !== 'number') return false;
  let h = host.trim().toLowerCase();
  if (!h) return false;
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]`;
  const v = value as Record<string, any>;
  if (v.mode === 'fixed_servers' && v.rules && typeof v.rules === 'object') {
    return Object.values(v.rules).some((s: any) => s && typeof s === 'object' && s.host === h && s.port === port);
  }
  if (v.mode === 'pac_script' && typeof v.pacScript?.data === 'string') {
    return v.pacScript.data.toLowerCase().includes(`${h}:${port}`);
  }
  return false;
}

/**
 * O resultado do session.resolveProxy ("HTTPS a:443; PROXY b:8080; DIRECT") passa por este
 * servidor? Pro pedido de senha SEM aba quando o PAC monta o endereço na hora (ou vem por
 * pacScript.url) e o texto não tem "host:porta" literal.
 */
export function proxyChainMentions(chain: unknown, host: unknown, port: unknown): boolean {
  if (typeof chain !== 'string' || typeof host !== 'string' || typeof port !== 'number') return false;
  let h = host.trim().toLowerCase();
  if (!h) return false;
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]`;
  const want = `${h}:${port}`;
  return chain.split(';').some(part => {
    const t = part.trim().toLowerCase().split(/\s+/);
    // "PROXY a:80" / "HTTPS a:443" / "SOCKS5 a:1080"; às vezes só "a:80" ou "https://a:443".
    const addr = (t.length > 1 ? t[1] : t[0]) || '';
    return addr.replace(/^[a-z0-9]+:\/\//, '') === want;
  });
}

// ── ChromeSetting (proxy.settings, privacy.*) ────────────────────────────────

export type LevelOfControl = 'not_controllable' | 'controlled_by_other_extensions' | 'controllable_by_this_extension' | 'controlled_by_this_extension';

export const PROXY_SETTING = 'proxy';
export const WEBRTC_SETTING = 'privacy.network.webRTCIPHandlingPolicy';
export const WEBRTC_POLICIES = ['default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp'] as const;
export type WebRtcPolicy = typeof WEBRTC_POLICIES[number];

// As outras opções de chrome.privacy: o Bah NÃO aplica nenhuma delas. Igual ao Chrome com uma
// preferência que a extensão não pode controlar: o set() passa calado e o get() diz o valor
// de verdade (o padrão) com "not_controllable" — nunca "controlled_by_this_extension" de uma
// proteção que está desligada. Valor padrão = o do Chrome.
const PRIVACY_BOOLEANS: Record<string, boolean> = {
  'network.networkPredictionEnabled': true,
  'services.alternateErrorPagesEnabled': true,
  'services.autofillEnabled': true,
  'services.autofillAddressEnabled': true,
  'services.autofillCreditCardEnabled': true,
  'services.passwordSavingEnabled': true,
  'services.safeBrowsingEnabled': true,
  'services.safeBrowsingExtendedReportingEnabled': false,
  'services.searchSuggestEnabled': true,
  'services.spellingServiceEnabled': false,
  'services.translationServiceEnabled': true,
  'websites.adMeasurementEnabled': true,
  'websites.doNotTrackEnabled': false,
  'websites.fledgeEnabled': true,
  'websites.hyperlinkAuditingEnabled': true,
  'websites.protectedContentEnabled': true,
  'websites.referrersEnabled': true,
  'websites.relatedWebsiteSetsEnabled': true,
  'websites.thirdPartyCookiesAllowed': true,
  'websites.topicsEnabled': true,
};
/** Chaves de chrome.privacy (sem o "privacy."), na ordem em que o calço monta. */
export const PRIVACY_SETTING_KEYS = ['network.webRTCIPHandlingPolicy', ...Object.keys(PRIVACY_BOOLEANS)];

/** Uma configuração conhecida: qual permissão ela pede e o valor quando ninguém controla. */
export function settingInfo(key: unknown): { perm: 'proxy' | 'privacy'; def: unknown } | null {
  if (key === PROXY_SETTING) return { perm: 'proxy', def: { mode: 'system' } };
  if (key === WEBRTC_SETTING) return { perm: 'privacy', def: 'default' };
  if (typeof key === 'string' && key.startsWith('privacy.')) {
    const k = key.slice('privacy.'.length);
    if (Object.prototype.hasOwnProperty.call(PRIVACY_BOOLEANS, k)) return { perm: 'privacy', def: PRIVACY_BOOLEANS[k] };
  }
  return null;
}

/** O Bah aplica esta configuração DE VERDADE? (proxy das abas e WebRTC; o resto não muda nada) */
export function isEnforcedSetting(key: unknown): boolean {
  return key === PROXY_SETTING || key === WEBRTC_SETTING;
}

/** Valor que a extensão quer pôr, conferido (e normalizado no caso do proxy). */
export function validateSettingValue(key: string, value: unknown): unknown {
  if (key === PROXY_SETTING) return translateProxyConfig(value).value;
  if (key === WEBRTC_SETTING) {
    if (!WEBRTC_POLICIES.includes(value as WebRtcPolicy)) throw new Error('Invalid value for webRTCIPHandlingPolicy.');
    return value;
  }
  if (!settingInfo(key)) throw new Error('Unknown setting.');
  if (typeof value !== 'boolean') throw new Error('Invalid value: expected a boolean.');
  return value;
}

/**
 * levelOfControl do Chrome do ponto de vista de QUEM pergunta. No Bah uma extensão controla de
 * cada vez e a do set() mais recente ganha; as outras veem "controlled_by_other_extensions"
 * (ainda podem pôr o delas, mas a extensão bem-comportada olha isso antes).
 */
export function settingLevel(hasPermission: boolean, controllerId: string | null | undefined, callerId: string): LevelOfControl {
  if (!hasPermission) return 'not_controllable';
  if (!controllerId) return 'controllable_by_this_extension';
  return controllerId === callerId ? 'controlled_by_this_extension' : 'controlled_by_other_extensions';
}

/** details.scope do set/clear: só o normal. Anônimo o Bah não tem. */
export function checkSettingScope(scope: unknown): void {
  if (scope === undefined || scope === null || scope === 'regular' || scope === 'regular_only') return;
  if (scope === 'incognito_persistent' || scope === 'incognito_session_only') throw new Error('You do not have permission to access incognito preferences.');
  throw new Error('Invalid scope.');
}

export interface SettingController { extId: string; value: unknown }

/**
 * extension-settings.json → { chave: { extId, value } }, só com o que for válido e só o que o Bah
 * aplica de verdade (as chaves de privacy.* que ficaram de versões antigas somem).
 */
export function parseSettingControllers(raw: unknown): Record<string, SettingController> {
  const out: Record<string, SettingController> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, e] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEnforcedSetting(key) || !e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (!isExtensionId(r.extId)) continue;
    try { out[key] = { extId: r.extId, value: validateSettingValue(key, r.value) }; } catch {}
  }
  return out;
}

/** Configurações guardadas de extensões desligadas (ou que ainda não carregaram): extId → { chave: valor }. */
export type DormantSettings = Record<string, Record<string, unknown>>;
/** Onde elas ficam no extension-settings.json (não é chave de configuração: o parse acima ignora). */
export const DORMANT_KEY = 'dormant';

/**
 * A parte "dormant" do extension-settings.json, conferida. Igual ao Chrome: desligar a extensão
 * só PAUSA o que ela controla (proxy, WebRTC); ligar de novo devolve. Só remover apaga.
 */
export function parseDormantSettings(raw: unknown): DormantSettings {
  const out: DormantSettings = {};
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[DORMANT_KEY] : null;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  for (const [id, entries] of Object.entries(d as Record<string, unknown>)) {
    if (!isExtensionId(id) || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const vals: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(entries as Record<string, unknown>)) {
      if (!isEnforcedSetting(key)) continue;
      try { vals[key] = validateSettingValue(key, v); } catch {}
    }
    if (Object.keys(vals).length) out[id] = vals;
  }
  return out;
}

// ── webRequest.onAuthRequired (só login de PROXY, só pra extensão que controla o proxy) ─

/** Pode responder login de proxy: webRequest + (webRequestAuthProvider ou webRequestBlocking). */
export function canAnswerProxyAuth(manifest: any): boolean {
  return hasApiPermission(manifest, 'webRequest') &&
    (hasApiPermission(manifest, 'webRequestAuthProvider') || hasApiPermission(manifest, 'webRequestBlocking'));
}

/**
 * type/frameId do onAuthRequired. O 'login' do Electron não diz se é o quadro principal: a
 * navegação cujo endereço é o que a aba está abrindo agora (did-start-navigation) é
 * 'main_frame'; outra navegação é 'sub_frame'; sem aba (fetch do worker) é 'xmlhttprequest';
 * recurso de uma aba fica 'other' (o tipo de verdade — imagem, script… — não dá pra saber).
 */
export function authRequestKind(o: { hasWc: boolean; isNavigation: boolean; url: string; mainFrameUrl?: string }): { type: string; frameId: number } {
  if (!o.hasWc) return { type: 'xmlhttprequest', frameId: -1 };
  if (o.isNavigation) return o.mainFrameUrl && o.url === o.mainFrameUrl ? { type: 'main_frame', frameId: 0 } : { type: 'sub_frame', frameId: -1 };
  return { type: 'other', frameId: -1 };
}

/** responseHeaders do Electron ({ nome: valor | valores }) → HttpHeaders do Chrome ([{ name, value }]). */
export function chromeHeaders(raw: unknown): Array<{ name: string; value: string }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    for (const value of Array.isArray(v) ? v : [v]) {
      if (value === undefined || value === null) continue;
      out.push({ name, value: String(value) });
      if (out.length >= 500) return out;
    }
  }
  return out;
}

export type AuthAnswer = { kind: 'credentials'; username: string; password: string } | { kind: 'cancel' } | { kind: 'none' };

/** BlockingResponse da extensão → o que fazer com o pedido de senha. */
export function authAnswer(raw: unknown): AuthAnswer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'none' };
  const r = raw as Record<string, unknown>;
  if (r.cancel === true) return { kind: 'cancel' };
  const c = r.authCredentials as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && typeof c.username === 'string' && typeof c.password === 'string' &&
    c.username.length <= 4096 && c.password.length <= 4096) {
    return { kind: 'credentials', username: c.username, password: c.password };
  }
  return { kind: 'none' };
}

// ── chrome.cookies ────────────────────────────────────────────────────────────

export const COOKIE_STORE_ID = '0';
const SAME_SITE = ['no_restriction', 'lax', 'strict', 'unspecified'];

export interface ChromeCookie {
  domain: string; hostOnly: boolean; httpOnly: boolean; name: string; path: string;
  sameSite: string; secure: boolean; session: boolean; storeId: string; value: string;
  expirationDate?: number;
}

/** Cookie do Electron → chrome.cookies.Cookie. */
export function chromeCookie(c: any): ChromeCookie {
  const out: ChromeCookie = {
    domain: typeof c?.domain === 'string' ? c.domain : '',
    hostOnly: !!c?.hostOnly,
    httpOnly: !!c?.httpOnly,
    name: typeof c?.name === 'string' ? c.name : '',
    path: typeof c?.path === 'string' && c.path ? c.path : '/',
    sameSite: SAME_SITE.includes(c?.sameSite) ? c.sameSite : 'unspecified',
    secure: !!c?.secure,
    session: !!c?.session,
    storeId: COOKIE_STORE_ID,
    value: typeof c?.value === 'string' ? c.value : '',
  };
  if (!out.session && typeof c?.expirationDate === 'number' && Number.isFinite(c.expirationDate)) out.expirationDate = c.expirationDate;
  return out;
}

/** O endereço que o Chrome usa pra conferir a permissão de host de um cookie. */
export function cookieUrl(c: { domain?: string; path?: string; secure?: boolean }): string {
  const host = String(c.domain || '').replace(/^\./, '');
  const p = typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/';
  return `${c.secure ? 'https' : 'http'}://${host}${p}`;
}

export function checkCookieStore(storeId: unknown): void {
  if (storeId === undefined || storeId === null || storeId === COOKIE_STORE_ID) return;
  throw new Error(`Invalid cookie store id: "${String(storeId).slice(0, 40)}".`);
}

/** url de cookie: http ou https, até 8 KB. */
export function cookieTargetUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length > 8192) throw new Error('Invalid url.');
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`Invalid url: "${url.slice(0, 200)}".`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Invalid url: "${url.slice(0, 200)}".`);
  return u.href;
}

const cookieStr = (v: unknown, what: string, max = 4096): string => {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new Error(`Invalid cookie ${what}.`);
  return v;
};

/** chrome.cookies.set(details) → o que o session.cookies.set do Electron recebe. */
export function cookieSetDetails(raw: unknown): Record<string, unknown> & { url: string } {
  const d = asDetails(raw);
  checkCookieStore(d.storeId);
  const out: Record<string, unknown> & { url: string } = { url: cookieTargetUrl(d.url) };
  if (d.name !== undefined) out.name = cookieStr(d.name, 'name');
  if (d.value !== undefined) out.value = cookieStr(d.value, 'value');
  if (d.domain !== undefined) out.domain = cookieStr(d.domain, 'domain', 255);
  if (d.path !== undefined) {
    const p = cookieStr(d.path, 'path', 1024);
    if (!p.startsWith('/')) throw new Error('Invalid cookie path.');
    out.path = p;
  }
  for (const k of ['secure', 'httpOnly'] as const) {
    if (d[k] === undefined) continue;
    if (typeof d[k] !== 'boolean') throw new Error(`Invalid cookie ${k}.`);
    out[k] = d[k];
  }
  if (d.expirationDate !== undefined) {
    if (typeof d.expirationDate !== 'number' || !Number.isFinite(d.expirationDate)) throw new Error('Invalid cookie expirationDate.');
    out.expirationDate = d.expirationDate;
  }
  if (d.sameSite !== undefined && !SAME_SITE.includes(d.sameSite as string)) throw new Error('Invalid cookie sameSite.');
  // Igual ao Chrome: sem sameSite = 'unspecified' (cookie SEM o atributo). O Electron poria 'lax'.
  out.sameSite = d.sameSite === undefined ? 'unspecified' : d.sameSite;
  return out;
}

/** chrome.cookies.getAll(details) → filtro do Electron (a permissão de host o Bah confere depois). */
export function cookieFilter(raw: unknown): Record<string, unknown> {
  const d = asDetails(raw);
  checkCookieStore(d.storeId);
  const out: Record<string, unknown> = {};
  if (d.url !== undefined) out.url = cookieTargetUrl(d.url);
  for (const k of ['name', 'domain', 'path'] as const) if (d[k] !== undefined) out[k] = cookieStr(d[k], k, 1024);
  for (const k of ['secure', 'session'] as const) {
    if (d[k] === undefined) continue;
    if (typeof d[k] !== 'boolean') throw new Error(`Invalid ${k}.`);
    out[k] = d[k];
  }
  return out;
}

/** Motivo da mudança do Electron → OnChangedCause do Chrome. */
export function cookieChangeCause(cause: unknown): string {
  switch (cause) {
    case 'expired': return 'expired';
    case 'evicted': return 'evicted';
    case 'expired-overwrite': return 'expired_overwrite';
    case 'overwrite': case 'inserted-no-change-overwrite': case 'inserted-no-value-change-overwrite': return 'overwrite';
    default: return 'explicit';
  }
}

/** cookies.get devolve UM: o de caminho mais comprido (o Chrome ordena assim). */
export function pickCookie<T extends { path?: string }>(list: T[]): T | null {
  let best: T | null = null;
  for (const c of list) if (!best || String(c.path || '').length > String(best.path || '').length) best = c;
  return best;
}

// ── chrome.notifications ──────────────────────────────────────────────────────

export interface NotificationOpts {
  type: string; title: string; message: string; iconUrl: string; contextMessage: string;
  buttons: string[]; items: Array<{ title: string; message: string }>; progress: number | null;
  requireInteraction: boolean; silent: boolean; priority: number;
}
const TEMPLATE_TYPES = ['basic', 'image', 'list', 'progress'];

/** ID da notificação: vazio/omitido = o Bah gera; texto até 500. */
export function notificationIdArg(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || raw.length > 500) throw new Error('Invalid notification id.');
  return raw;
}

/** Opções conferidas. base = a notificação que já existe (update); null = create (pede o mínimo). */
export function notificationOptions(raw: unknown, base: NotificationOpts | null): NotificationOpts {
  const d = asDetails(raw);
  const text = (v: unknown, what: string, max: number): string => {
    if (typeof v !== 'string') throw new Error(`Invalid notification ${what}.`);
    return v.slice(0, max);
  };
  if (!base && (typeof d.type !== 'string' || typeof d.title !== 'string' || typeof d.message !== 'string')) {
    throw new Error('Some of the required properties are missing: type, iconUrl, title and message.');
  }
  const o: NotificationOpts = base ? { ...base, buttons: [...base.buttons], items: base.items.map(i => ({ ...i })) } : {
    type: 'basic', title: '', message: '', iconUrl: '', contextMessage: '', buttons: [], items: [],
    progress: null, requireInteraction: false, silent: false, priority: 0,
  };
  if (d.type !== undefined) {
    if (!TEMPLATE_TYPES.includes(d.type as string)) throw new Error('Invalid notification type.');
    o.type = d.type as string;
  }
  if (d.title !== undefined) o.title = text(d.title, 'title', 1000);
  if (d.message !== undefined) o.message = text(d.message, 'message', 4000);
  if (d.iconUrl !== undefined) o.iconUrl = text(d.iconUrl, 'iconUrl', 2_800_000);
  if (d.contextMessage !== undefined) o.contextMessage = text(d.contextMessage, 'contextMessage', 1000);
  if (d.buttons !== undefined) {
    if (!Array.isArray(d.buttons)) throw new Error('Invalid notification buttons.');
    o.buttons = d.buttons.slice(0, 2).map(b => text(b && typeof b === 'object' ? (b as any).title : undefined, 'button title', 200));
  }
  if (d.items !== undefined) {
    if (!Array.isArray(d.items)) throw new Error('Invalid notification items.');
    o.items = d.items.slice(0, 20).map(i => ({ title: text((i as any)?.title, 'item title', 200), message: text((i as any)?.message, 'item message', 500) }));
  }
  if (d.progress !== undefined) {
    if (typeof d.progress !== 'number' || !Number.isInteger(d.progress) || d.progress < 0 || d.progress > 100) throw new Error('Invalid notification progress.');
    o.progress = d.progress;
  }
  for (const k of ['requireInteraction', 'silent'] as const) {
    if (d[k] === undefined) continue;
    if (typeof d[k] !== 'boolean') throw new Error(`Invalid notification ${k}.`);
    o[k] = d[k] as boolean;
  }
  if (d.priority !== undefined) {
    if (typeof d.priority !== 'number' || !Number.isInteger(d.priority) || d.priority < -2 || d.priority > 2) throw new Error('Invalid notification priority.');
    o.priority = d.priority;
  }
  return o;
}

/** Texto da notificação do sistema: mensagem, itens/progresso, contexto e o nome da extensão. */
export function notificationBody(o: NotificationOpts, extName: string): string {
  const lines = [o.message];
  if (o.type === 'list') for (const i of o.items) lines.push(`${i.title}: ${i.message}`);
  if (o.type === 'progress' && o.progress !== null) lines.push(`${o.progress}%`);
  if (o.contextMessage) lines.push(o.contextMessage);
  // Quem mandou: no Windows a notificação sai como "Bah" — sem o nome, uma extensão se passaria pelo Bah.
  if (extName) lines.push(`— ${extName}`);
  return lines.filter(Boolean).join('\n');
}

/** Ícone vindo de extensão: no máximo 1 MB no arquivo e 1024×1024 px (conferido ANTES de decodificar). */
export const MAX_ICON_BYTES = 1_000_000;
export const MAX_ICON_SIDE = 1024;

/** data:image/png|jpeg;base64,… de até maxBytes → só a parte em base64 (o conteúdo não é conferido aqui), ou null. */
export function iconDataUrlBase64(url: unknown, maxBytes = MAX_ICON_BYTES): string | null {
  // 4 caracteres de base64 a cada 3 bytes, mais o cabeçalho "data:image/jpeg;base64,".
  if (typeof url !== 'string' || url.length > Math.ceil(maxBytes / 3) * 4 + 32) return null;
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  return m ? m[1] : null;
}

/**
 * Largura e altura que o cabeçalho do PNG/JPEG declara, SEM decodificar (um PNG de 23 KB pode
 * declarar 12000×12000 e virar ~576 MB na memória). Outro formato = null — o nativeImage do
 * Electron só decodifica PNG e JPEG mesmo.
 */
export function imageHeaderSize(buf: Uint8Array): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;
  const be32 = (i: number) => buf[i] * 0x1000000 + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3];
  const be16 = (i: number) => (buf[i] << 8) + buf[i + 1];
  // PNG: assinatura de 8 bytes, depois o bloco IHDR (largura e altura em 32 bits).
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((b, i) => buf[i] === b)) {
    if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null;   // 'IHDR'
    return { width: be32(16), height: be32(20) };
  }
  // JPEG: FF D8 e os segmentos um atrás do outro (pelo tamanho de cada um) até o primeiro SOFn.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }   // byte de preenchimento antes do marcador
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }   // marcadores sem tamanho
      if (marker === 0xda || marker === 0xd9) return null;   // SOS / EOI antes do SOF: não dá pra saber
      const len = be16(i + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 > buf.length) return null;
        return { width: be16(i + 7), height: be16(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Os bytes cabem no limite (até maxBytes e lados de 1 até maxSide, pelo cabeçalho)? Formato desconhecido = não. */
export function iconBytesOk(buf: Uint8Array, maxBytes = MAX_ICON_BYTES, maxSide = MAX_ICON_SIDE): boolean {
  if (!buf || buf.length > maxBytes) return false;
  const s = imageHeaderSize(buf);
  return !!s && s.width >= 1 && s.height >= 1 && s.width <= maxSide && s.height <= maxSide;
}

/** De onde vem o ícone: data: PNG/JPEG de até ~1 MB, ou arquivo DA PRÓPRIA extensão. O resto não carrega. */
export function notificationIcon(iconUrl: unknown, extId: string): { kind: 'data'; url: string } | { kind: 'file'; rel: string } | null {
  if (typeof iconUrl !== 'string' || !iconUrl) return null;
  if (/^data:/i.test(iconUrl)) return iconDataUrlBase64(iconUrl) ? { kind: 'data', url: iconUrl } : null;
  if (extensionIdFromUrl(iconUrl) !== extId) return null;
  const rel = normalizeExtPath(iconUrl, extId);
  return rel ? { kind: 'file', rel } : null;
}

// ── Diálogo de instalação: o que cada permissão deixa fazer ──────────────────

const PERMISSION_LINES = ['proxy', 'privacy', 'cookies', 'management', 'notifications'];

/**
 * Permissões que ganham uma linha própria no diálogo (chave de texto ext.perm.<nome>, da mais
 * séria pra menos) + o resto, como veio.
 */
export function permissionLineKeys(perms: unknown): { keys: string[]; rest: string[] } {
  const list = Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : [];
  return {
    keys: PERMISSION_LINES.filter(p => list.includes(p)).map(p => `ext.perm.${p}`),
    rest: list.filter(p => !PERMISSION_LINES.includes(p)),
  };
}
