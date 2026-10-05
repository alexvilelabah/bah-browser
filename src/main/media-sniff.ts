// Botão "Baixar" em QUALQUER site — a parte PURA (sem electron, roda nos testes):
// - reconhecer, no tráfego da aba, o arquivo de vídeo ou a "lista de pedaços" (HLS/DASH)
//   que a página carregou — o truque do IDM pros sites que o yt-dlp não conhece;
// - "mesmo site" (g1.globo.com e globo.com são o mesmo; uol.com.br não é com.br);
// - cookies do Bah no formato que o yt-dlp lê (Netscape), pra baixar o que precisa de login.

export interface SniffedMedia {
  url: string;
  kind: 'file' | 'hls' | 'dash';
  mime: string;
  size?: number;
  pageUrl?: string;
  at: number;
}

const header = (h: Record<string, string[] | string> | undefined, name: string): string | undefined => {
  if (!h) return undefined;
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === name) { const v = h[k]; return Array.isArray(v) ? v[0] : v; }
  }
  return undefined;
};

// Abaixo disso é pedaço de stream, prévia ou anúncio curto — não é "o vídeo".
const MIN_FILE_BYTES = 512 * 1024;

/** Uma resposta de rede é um vídeo baixável? (null = não) */
export function classifyMediaResponse(d: {
  url: string;
  statusCode: number;
  resourceType?: string;
  responseHeaders?: Record<string, string[] | string>;
}): Omit<SniffedMedia, 'at' | 'pageUrl'> | null {
  let u: URL;
  try { u = new URL(d.url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (d.statusCode !== 200 && d.statusCode !== 206) return null;
  const mime = (header(d.responseHeaders, 'content-type') || '').toLowerCase().split(';')[0].trim();
  const p = u.pathname.toLowerCase();
  // YouTube tem caminho próprio (yt-dlp por id); os pedaços dele não servem pra nada aqui.
  if (/(^|\.)googlevideo\.com$/i.test(u.hostname)) return null;

  if (mime.includes('mpegurl') || p.endsWith('.m3u8')) return { url: d.url, kind: 'hls', mime: mime || 'application/vnd.apple.mpegurl' };
  if (mime === 'application/dash+xml' || p.endsWith('.mpd')) return { url: d.url, kind: 'dash', mime: mime || 'application/dash+xml' };

  if (/\.(ts|m4s|m4a|aac|mp3)$/.test(p)) return null;   // pedaço de stream / só áudio
  const videoMime = mime.startsWith('video/') && mime !== 'video/mp2t' && !mime.includes('segment');
  const videoExt = /\.(mp4|webm|mov|m4v|mkv)$/.test(p);
  if (!videoMime && !(videoExt && d.resourceType === 'media')) return null;
  // Pedaço de um arquivo maior pedido por faixa na URL (Instagram/Facebook "bytestart",
  // DASH "range="): o arquivo inteiro não é esse — o yt-dlp cuida desses sites.
  if (u.searchParams.has('bytestart') || u.searchParams.has('range')) return null;

  const range = header(d.responseHeaders, 'content-range');
  const fromRange = range ? /\/(\d+)\s*$/.exec(range) : null;
  const len = Number(header(d.responseHeaders, 'content-length'));
  const size = fromRange ? Number(fromRange[1]) : (Number.isFinite(len) && len > 0 ? len : undefined);
  if (size !== undefined && size < MIN_FILE_BYTES) return null;
  return { url: d.url, kind: 'file', mime: mime || 'video/mp4', size };
}

/** Os últimos vídeos que cada aba carregou (por webContents), mais novos primeiro. */
export class MediaLog {
  byTab = new Map<number, SniffedMedia[]>();
  max: number;
  constructor(max = 30) { this.max = max; }

  add(tabId: number, m: SniffedMedia): void {
    const list = (this.byTab.get(tabId) || []).filter(x => x.url !== m.url);
    list.unshift(m);
    this.byTab.set(tabId, list.slice(0, this.max));
  }

  /** Só o que veio da página que está aberta agora (o resto é de páginas anteriores). */
  list(tabId: number, pageUrl?: string): SniffedMedia[] {
    const all = this.byTab.get(tabId) || [];
    const strip = (s?: string) => (s || '').split('#')[0];
    return pageUrl ? all.filter(m => !m.pageUrl || strip(m.pageUrl) === strip(pageUrl)) : all;
  }

  forget(tabId: number): void { this.byTab.delete(tabId); }
}

const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'gob', 'mil', 'nom']);

/** Domínio "registrável": g1.globo.com → globo.com; www.uol.com.br → uol.com.br. */
export function siteOf(host: string): string {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const tld = parts[parts.length - 1], sld = parts[parts.length - 2];
  return (tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3) : parts.slice(-2)).join('.');
}

// O mesmo site com dois nomes.
const ALIASES: Record<string, string> = { 'twitter.com': 'x.com', 'fb.watch': 'facebook.com', 'youtu.be': 'youtube.com' };

export function sameSite(a: string, b: string): boolean {
  try {
    const sa = siteOf(new URL(a).hostname), sb = siteOf(new URL(b).hostname);
    return (ALIASES[sa] || sa) === (ALIASES[sb] || sb);
  } catch { return false; }
}

export interface CookieLike {
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  name: string;
  value: string;
}

/** Cookies → arquivo Netscape (o --cookies do yt-dlp). Linha #HttpOnly_ o yt-dlp entende. */
export function toNetscapeCookies(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const dom = String(c.domain || '');
    if (!dom || !c.name) continue;
    if (/[\t\r\n]/.test(c.name + c.value)) continue;   // quebraria o formato
    const hostOnly = c.hostOnly ?? !dom.startsWith('.');
    const domain = hostOnly ? dom.replace(/^\./, '') : (dom.startsWith('.') ? dom : `.${dom}`);
    lines.push([
      (c.httpOnly ? '#HttpOnly_' : '') + domain,
      hostOnly ? 'FALSE' : 'TRUE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(c.expirationDate ? Math.floor(c.expirationDate) : 0),
      c.name,
      c.value,
    ].join('\t'));
  }
  return lines.join('\n') + '\n';
}
