// favicons.ts — regras PURAS dos ícones dos favoritos (barra, "»", ⋮ → Favoritos, autocomplete).
// Sem electron, sem fs, sem DOM: o main, o renderer e os testes usam a MESMA regra.
//  • Origem: só http/https, no formato "https://site.com" (porta padrão some, host minúsculo).
//  • Endereço bloqueado: nada de buscar ícone em localhost, rede de casa/empresa ou IP privado
//    (um favorito malicioso não pode fazer o Bah "cutucar" o roteador ou um serviço local).
//  • Imagem: confere os bytes de verdade (PNG/ICO/JPEG/GIF/WebP/SVG); ICO com 10 tamanhos vira 1 só.
//  • Cache: ícone achado vale 30 dias, "não tem ícone" vale 7; o mais esquecido sai primeiro.
//  • Barra: quantos favoritos cabem antes do botão "»" (o resto vai pra lista dele).

export const HIT_TTL_MS = 30 * 24 * 3_600_000;   // ícone achado: confere de novo depois de 30 dias
export const MISS_TTL_MS = 7 * 24 * 3_600_000;   // site sem ícone: só tenta de novo depois de 7 dias
export const MAX_ORIGINS_PER_ASK = 400;          // teto de sites por pedido do renderer
// Download maior que isso não é favicon. 1 MB porque .ico com vários tamanhos passa fácil de
// 200 KB (o do Hugging Face tem 205 KB) e era descartado — o Bah corta pro de 32px de qualquer jeito.
export const MAX_ICON_BYTES = 1024 * 1024;
export const MAX_STORED_BYTES = 48 * 1024;       // depois de enxugar, o que passar disso não entra no cache

// ── Origem ──

/** "https://www.Site.com:443/a?b" → "https://www.site.com". null = não é http/https (ou URL inválida). */
export function faviconOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || !url || url.length > 4096) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}

/** Lista que veio do renderer (não confiável): só origens válidas, sem repetir, com teto. */
export function sanitizeOrigins(input: unknown, max = MAX_ORIGINS_PER_ASK): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const item of input.slice(0, max * 2)) {
    const o = faviconOrigin(item);
    if (o) out.add(o);
    if (out.size >= max) break;
  }
  return [...out];
}

// ── Endereços que o Bah nunca busca ──

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.home.arpa', '.corp', '.test', '.invalid', '.example'];

function ipv4Parts(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every(n => n <= 255) ? p : null;
}

function blockedIpv4(p: number[]): boolean {
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224                 // "esta rede", privada, loopback, multicast/reservado
    || (a === 100 && b >= 64 && b <= 127)                              // CGNAT (rede da operadora)
    || (a === 169 && b === 254)                                        // link-local (inclui metadados de nuvem)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))                  // reservados / documentação
    || (a === 198 && (b === 18 || b === 19))                           // testes de rede
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

// "::ffff:7f00:1" → 8 blocos de 16 bits (null se não for IPv6).
function ipv6Words(s: string): number[] | null {
  let str = s.toLowerCase();
  const zone = str.indexOf('%');
  if (zone >= 0) str = str.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(str) || !str.includes(':')) return null;
  // Final em IPv4 ("::ffff:1.2.3.4") vira dois blocos.
  const lastColon = str.lastIndexOf(':');
  const tail = str.slice(lastColon + 1);
  if (tail.includes('.')) {
    const p = ipv4Parts(tail);
    if (!p) return null;
    str = `${str.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':') : []);
  const head = parse(halves[0]);
  const back = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - back.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const words = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...back];
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.map(w => parseInt(w, 16));
}

function blockedIpv6(w: number[]): boolean {
  const v4 = (hi: number, lo: number) => blockedIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (w.every(x => x === 0)) return true;                                         // ::
  if (w.slice(0, 7).every(x => x === 0) && w[7] === 1) return true;               // ::1
  if ((w[0] & 0xfe00) === 0xfc00) return true;                                    // fc00::/7 (rede local)
  if ((w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0) return true;      // link-local / site-local
  if ((w[0] & 0xff00) === 0xff00) return true;                                    // multicast
  if (w.slice(0, 5).every(x => x === 0) && (w[5] === 0xffff || w[5] === 0)) return v4(w[6], w[7]);  // IPv4 embutido
  if (w[0] === 0x64 && w[1] === 0xff9b) return v4(w[6], w[7]);                    // NAT64
  if (w[0] === 0x2002) return v4(w[1], w[2]);                                     // 6to4
  return false;
}

/** IP (v4 ou v6, com ou sem colchetes) que aponta pra este computador ou pra rede local. */
export function isPrivateIp(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, '');
  const p4 = ipv4Parts(s);
  if (p4) return blockedIpv4(p4);
  const p6 = ipv6Words(s);
  return p6 ? blockedIpv6(p6) : false;
}

/** true = é um IP escrito direto (aí não precisa perguntar ao DNS). */
export function isIpLiteral(host: string): boolean {
  const s = host.replace(/^\[|\]$/g, '');
  return !!ipv4Parts(s) || !!ipv6Words(s);
}

/** Host que o Bah nunca busca: localhost, nomes de rede interna, nome sem ponto, IP privado. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (isIpLiteral(h)) return isPrivateIp(h);
  if (h === 'localhost' || !h.includes('.')) return true;   // "roteador", "intranet"… = rede interna
  return BLOCKED_SUFFIXES.some(sfx => h.endsWith(sfx));
}

/** URL que pode ser buscada (http/https, sem usuário:senha, host público). */
export function isFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !isBlockedHost(u.hostname);
  } catch { return false; }
}

// ── Imagem ──

export type IconMime = 'image/png' | 'image/x-icon' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

/** Tipo de imagem pelos BYTES (o Content-Type do servidor mente: HTML de erro com 200 OK, etc). */
export function sniffImage(b: Uint8Array): IconMime | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b.length >= 6 && (b[4] | (b[5] << 8)) > 0) return 'image/x-icon';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // SVG é texto: começa com "<" (depois de BOM/espaço) e tem <svg logo no começo — página HTML não passa.
  let head = '';
  for (let i = 0; i < Math.min(b.length, 1024); i++) head += String.fromCharCode(b[i]);
  head = head.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head) && !/<html[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/** Num .ico com vários tamanhos, qual usar: 32px (nítido em tela com zoom); senão o mais perto. */
export function pickIcoEntry(entries: Array<{ size: number; bpp: number }>): number {
  if (!entries.length) return -1;
  const score = (e: { size: number; bpp: number }) => {
    const s = e.size;
    // Menor = melhor: 32 exato, depois maiores até 64, depois menores, depois os enormes.
    const d = s === 32 ? 0 : s > 32 && s <= 64 ? s - 32 : s < 32 ? 100 + (32 - s) : 200 + s;
    return d * 64 - Math.min(e.bpp || 0, 32);
  };
  let best = 0;
  for (let i = 1; i < entries.length; i++) if (score(entries[i]) < score(entries[best])) best = i;
  return best;
}

/** .ico com N imagens → só a escolhida (PNG embutido sai como PNG). null = arquivo quebrado. */
export function shrinkIco(b: Uint8Array): { mime: IconMime; bytes: Uint8Array } | null {
  if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return null;
  const count = b[4] | (b[5] << 8);
  if (!count || b.length < 6 + count * 16) return null;
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const entries: Array<{ size: number; bpp: number; len: number; off: number; dir: number }> = [];
  for (let i = 0; i < count; i++) {
    const d = 6 + i * 16;
    const len = u32(d + 8), off = u32(d + 12);
    if (!len || off < 6 + count * 16 || off + len > b.length) continue;   // entrada apontando pra fora = ignora
    entries.push({ size: b[d] || 256, bpp: b[d + 6] | (b[d + 7] << 8), len, off, dir: d });
  }
  const i = pickIcoEntry(entries);
  if (i < 0) return null;
  const e = entries[i];
  const data = b.subarray(e.off, e.off + e.len);
  if (sniffImage(data) === 'image/png') return { mime: 'image/png', bytes: data.slice() };
  if (count === 1) return { mime: 'image/x-icon', bytes: b.slice(0, e.off + e.len) };
  const out = new Uint8Array(22 + e.len);
  out.set([0, 0, 1, 0, 1, 0], 0);
  out.set(b.subarray(e.dir, e.dir + 12), 6);                         // largura…tamanho, iguais
  out.set([22, 0, 0, 0], 18);                                        // dados logo depois do cabeçalho
  out.set(data, 22);
  return { mime: 'image/x-icon', bytes: out };
}

/** Bytes baixados → imagem pronta pro cache (ICO enxuto), ou null se não for imagem. */
export function normalizeIcon(b: Uint8Array): { mime: IconMime; bytes: Uint8Array } | null {
  if (!b.length || b.length > MAX_ICON_BYTES) return null;
  const mime = sniffImage(b);
  if (!mime) return null;
  if (mime === 'image/x-icon') return shrinkIco(b);
  return { mime, bytes: b };
}

/** "data:image/png;base64,…" (ícone que a própria página manda inline) → bytes. */
export function decodeDataUrl(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length > MAX_ICON_BYTES * 2) return null;
  const m = /^data:([^,]*?),(.*)$/s.exec(s);
  if (!m || !/^image\//i.test(m[1])) return null;
  try {
    if (/;base64$/i.test(m[1])) {
      const bin = atob(m[2].replace(/\s+/g, ''));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(m[2]));
  } catch { return null; }
}

/** Ícones que a página declara (<link rel="icon">), em ordem de preferência. Só lê texto. */
export function parseIconLinks(html: string, baseUrl: string, max = 3): string[] {
  const icons: Array<{ url: string; rank: number }> = [];
  const attr = (tag: string, name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  };
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(html)) && n++ < 200) {
    const rel = attr(m[0], 'rel').toLowerCase().split(/\s+/);
    const isIcon = rel.includes('icon');
    const isApple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!isIcon && !isApple) continue;
    const href = attr(m[0], 'href').replace(/&amp;/gi, '&').trim();
    if (!href) continue;
    let url: string;
    try { url = new URL(href, baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(url) && !/^data:image\//i.test(url)) continue;
    const sizes = attr(m[0], 'sizes').toLowerCase();
    // 16/32 primeiro, SVG/sem tamanho depois, os grandes (apple-touch 180px) por último.
    const rank = isApple ? 3 : /\b(16x16|32x32|48x48)\b/.test(sizes) ? 0 : !sizes || sizes === 'any' ? 1 : 2;
    if (!icons.some(i => i.url === url)) icons.push({ url, rank });
  }
  return icons.sort((a, b) => a.rank - b.rank).slice(0, max).map(i => i.url);
}

// ── Cache ──

export interface FaviconEntry {
  icon: string | null;   // data URL pronto pro <img>; null = o site não tem ícone (por enquanto)
  checked: number;       // quando buscou pela última vez
  used: number;          // quando alguém pediu pela última vez (o mais esquecido sai primeiro)
  src?: string;          // de onde veio (pra não baixar de novo o mesmo ícone da aba)
}

/** Ainda vale? Relógio que andou pra trás (checked no futuro) = vencido, pra não travar. */
export function isFresh(e: FaviconEntry, now: number): boolean {
  if (e.checked > now + 60_000) return false;
  return now - e.checked < (e.icon ? HIT_TTL_MS : MISS_TTL_MS);
}

/** Quem sai do cache pra caber nos tetos (quantidade e tamanho total), menos usado primeiro. */
export function pruneOrder(entries: Record<string, FaviconEntry>, maxEntries: number, maxChars: number): string[] {
  const list = Object.entries(entries);
  let count = list.length;
  let chars = list.reduce((s, [k, e]) => s + k.length + (e.icon?.length || 0), 0);
  if (count <= maxEntries && chars <= maxChars) return [];
  list.sort((a, b) => a[1].used - b[1].used);
  const out: string[] = [];
  for (const [k, e] of list) {
    if (count <= maxEntries && chars <= maxChars) break;
    out.push(k);
    count--;
    chars -= k.length + (e.icon?.length || 0);
  }
  return out;
}

// ── Desenho ──

// Cores do quadradinho com a letra (site sem ícone): escuras o bastante pro branco ler bem.
export const TILE_COLORS = ['#5b6ee1', '#2f8f83', '#b5544c', '#8a5cc4', '#3f7fbf', '#a86a2c', '#4f8f3a', '#b04a7e'];

/** Site sem ícone vira quadradinho com a 1ª letra (sempre a mesma cor pro mesmo site). */
export function letterTile(url: string, title = ''): { letter: string; color: string } {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\d?\./, ''); } catch {}
  const src = host || title || url || '?';
  const ch = (src.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return { letter: ch, color: TILE_COLORS[h % TILE_COLORS.length] };
}

/**
 * Quantos favoritos cabem na barra. widths = largura de cada um (na ordem), gap = espaço entre
 * eles, moreWidth = botão "»". Se TODOS cabem, não tem "»"; senão o "»" ocupa o fim e entra
 * só o que cabe antes dele. Nunca devolve mais do que cabe (nada desenhado fora da janela).
 */
export function splitOverflow(widths: number[], available: number, moreWidth: number, gap: number): number {
  const EPS = 0.5;   // arredondamento de subpixel não pode mandar o último pro "»" à toa
  const n = widths.length;
  if (!n || !(available > 0)) return 0;
  const w = widths.map(x => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = w.reduce((s, x) => s + x, 0) + gap * (n - 1);
  if (total <= available + EPS) return n;
  const budget = available - moreWidth - gap;
  let used = 0;
  let fit = 0;
  for (let i = 0; i < n; i++) {
    const next = used + (fit ? gap : 0) + w[i];
    if (next > budget + EPS) break;
    used = next;
    fit++;
  }
  return fit;
}
