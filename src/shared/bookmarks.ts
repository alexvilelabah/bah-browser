// bookmarks.ts — importar/exportar favoritos. PURO (sem electron, sem fs, sem DOM) pra o main,
// o renderer e os testes usarem a MESMA regra.
//  • Chrome/Edge: arquivo "Bookmarks" (JSON) do perfil — raízes bookmark_bar / other / synced.
//  • Arquivo HTML no formato Netscape (o que todo navegador exporta e importa).
// Entrada é SEMPRE não confiável: limite de tamanho, só http/https, títulos limpos, profundidade
// de pastas limitada. Nada aqui executa script nem monta DOM — é só texto → dados.

export type BookmarkNode =
  | { kind: 'url'; title: string; url: string; addDate?: number }
  | { kind: 'folder'; title: string; children: BookmarkNode[]; toolbar?: boolean; addDate?: number };

/** Favorito do Bah (lista plana em localStorage 'favorites.v1'). */
export interface FlatBookmark { url: string; title: string }

export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;   // arquivo maior que isso não é favorito, é lixo
export const MAX_ITEMS = 100_000;                    // teto de links lidos de UM arquivo
export const MAX_DEPTH = 24;                         // pastas mais fundas que isso viram planas
export const MAX_TITLE = 300;
export const MAX_URL = 4096;
// Teto da lista do Bah: cabe folgado no localStorage (≈150 B por favorito).
export const MAX_FAVORITES = 15_000;
// Teto em caracteres do JSON salvo: o localStorage (~5 milhões de caracteres) é dividido com
// configurações da IA, histórico, macros… Favoritos não podem ocupar tudo e fazer esses saves falharem.
export const MAX_FAVORITES_CHARS = 2_000_000;
// Tamanho aproximado de um favorito no JSON (url + título + aspas/chaves/vírgulas).
const favChars = (f: FlatBookmark) => (f?.url?.length || 0) + (f?.title?.length || 0) + 30;

export class BookmarkParseError extends Error {
  code: 'too-big' | 'bad-format';
  constructor(code: 'too-big' | 'bad-format') { super(code); this.code = code; }
}

// Controles, quebras e marcas de direção (bidi) somem: título "invisível" ou que vira o texto
// de trás pra frente é truque de golpe.
const CTRL_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

/** Só http/https, normalizado (new URL().href). Qualquer outra coisa (javascript:, data:, file:, place:) → null. */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  return u.href.length > MAX_URL ? null : u.href;
}

// Chave de duplicata: a URL normalizada (o que o Bah já guardou pode não estar normalizado).
function urlKey(u: string): string { return cleanUrl(u) ?? u; }

// ── Chrome / Edge (JSON "Bookmarks") ─────────────────────────────────────────────────────────

// date_added do Chromium = microssegundos desde 1601-01-01 (época do Windows).
function chromeTimeToUnix(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const s = Math.floor(n / 1e6) - 11_644_473_600;
  return s > 0 ? s : undefined;
}

/**
 * Lê o JSON do Chrome/Edge e devolve as raízes (barra, outros, sincronizados/celular) como pastas,
 * na ordem do Chrome, já sem as vazias. Pastas além de MAX_DEPTH são achatadas na última permitida.
 */
export function parseChromeBookmarks(input: string | unknown): BookmarkNode[] {
  let data: any = input;
  if (typeof input === 'string') {
    if (input.length > MAX_SOURCE_BYTES) throw new BookmarkParseError('too-big');
    try { data = JSON.parse(input); } catch { throw new BookmarkParseError('bad-format'); }
  }
  const roots = data && typeof data === 'object' ? data.roots : null;
  if (!roots || typeof roots !== 'object') throw new BookmarkParseError('bad-format');
  const budget = { left: MAX_ITEMS };

  const walk = (node: any, depth: number, into: BookmarkNode[]): void => {
    if (!node || typeof node !== 'object' || budget.left <= 0) return;
    if (node.type === 'url') {
      const url = cleanUrl(node.url);
      if (!url) return;
      budget.left--;
      into.push({ kind: 'url', title: cleanTitle(node.name), url, addDate: chromeTimeToUnix(node.date_added) });
      return;
    }
    const kids: any[] = Array.isArray(node.children) ? node.children : [];
    if (depth >= MAX_DEPTH) {
      // Fundo demais: os links descem pra pasta atual (sem recursão — pilha explícita).
      const stack = [...kids].reverse();
      while (stack.length && budget.left > 0) {
        const n = stack.pop();
        if (n?.type === 'url') walk(n, depth, into);
        else if (n && Array.isArray(n.children)) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
      }
      return;
    }
    const folder: BookmarkNode = { kind: 'folder', title: cleanTitle(node.name), children: [], addDate: chromeTimeToUnix(node.date_added) };
    for (const k of kids) walk(k, depth + 1, folder.children);
    if (folder.children.length) into.push(folder);
  };

  const out: BookmarkNode[] = [];
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    const before = out.length;
    walk(roots[key], 0, out);
    if (key === 'bookmark_bar' && out.length > before) {
      const f = out[out.length - 1];
      if (f.kind === 'folder') f.toolbar = true;
    }
  }
  return out;
}

// Chrome logado: os favoritos da CONTA ficam em "AccountBookmarks" (o "Bookmarks" guarda só os
// locais, e muitas vezes vem vazio ou nem existe). Conta primeiro: é o que o Chrome mostra na barra.
export const CHROME_BM_FILES = ['AccountBookmarks', 'Bookmarks'] as const;

/**
 * Junta os arquivos de UM perfil (na ordem de CHROME_BM_FILES), sem URL repetida, pra contagem do
 * seletor de perfil bater. Arquivo que falhou não estraga o outro; só dá erro se TODOS falharem.
 */
export function parseChromeProfile(files: Array<{ text: string } | { error: unknown }>): FlatBookmark[] {
  const out: FlatBookmark[] = [];
  const seen = new Set<string>();
  let ok = 0;
  let lastErr: unknown = null;
  for (const f of files) {
    let items: FlatBookmark[];
    try {
      if ('error' in f) throw f.error;
      items = flattenBookmarks(parseChromeBookmarks(f.text));
      ok++;
    } catch (e) { lastErr = e; continue; }
    for (const b of items) {
      const k = urlKey(b.url);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
  }
  if (!ok && lastErr) throw lastErr;
  return out;
}

// ── HTML Netscape ────────────────────────────────────────────────────────────────────────────

/**
 * Bytes do arquivo HTML → texto. BOM UTF-16 primeiro; depois UTF-8 estrito; se não for UTF-8
 * válido, usa o charset que o próprio arquivo declara no <META> (export antigo do IE/Firefox vem
 * em windows-1252) — igual ao importador do Chrome. Charset desconhecido → windows-1252.
 */
export function decodeBookmarkHtml(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch {}
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
  const label = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  if (label && !/^utf-?8$/i.test(label)) {
    try { return new TextDecoder(label).decode(buf); } catch {}
  }
  return new TextDecoder('windows-1252').decode(buf);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8}|#39);/gi, (m, e: string) => {
    const low = e.toLowerCase();
    if (low[0] === '#') {
      const cp = low[1] === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    }
    return NAMED[low] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toUpperCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

// Texto entre <A>…</A> / <H3>…</H3>: tira qualquer tag aninhada e decodifica entidades.
function innerText(s: string): string { return cleanTitle(decodeEntities(s.replace(/<[^>]*>/g, ''))); }

function unixAttr(v: string | undefined): number | undefined {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Lê um arquivo de favoritos Netscape (Chrome, Edge, Firefox, Safari exportam assim).
 * Varredura linear por tags; <DL> abre a pasta do último <H3>, </DL> fecha. Tolerante a HTML torto.
 */
export function parseNetscapeHtml(html: string): BookmarkNode[] {
  if (typeof html !== 'string') throw new BookmarkParseError('bad-format');
  if (html.length > MAX_SOURCE_BYTES) throw new BookmarkParseError('too-big');
  // Só aceita arquivo de favoritos de verdade (cabeçalho Netscape ou <DT><A>/<DT><H3>, que todo
  // navegador grava). Página qualquer salva com "Salvar como" viraria centenas de favoritos lixo.
  const sig = /<!doctype\s+netscape-bookmark-file/i.test(html.slice(0, 2048)) || /<dt\b[^>]*>\s*<(?:a|h3)\b/i.test(html);
  if (!sig) throw new BookmarkParseError('bad-format');
  const root: BookmarkNode & { kind: 'folder' } = { kind: 'folder', title: '', children: [] };
  const stack: Array<BookmarkNode & { kind: 'folder' }> = [root];
  let pending: (BookmarkNode & { kind: 'folder' }) | null = null;
  let left = MAX_ITEMS;
  const tagRe = /<(\/?)(dl|h3|a)\b([^>]*)>/gi;
  // Busca direto no html (com /i): toLowerCase() muda o tamanho ('İ' vira 2 caracteres) e
  // deslocaria todos os índices seguintes.
  const stopRe = /<\/?(?:a|h3|dl|dt|dd)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) && left > 0) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const cur = stack[stack.length - 1];
    if (tag === 'dl') {
      if (closing) { if (stack.length > 1) stack.pop(); }
      else stack.push(pending ?? cur);   // <DL> sem <H3> antes (a lista raiz) continua na pasta atual
      pending = null;
      continue;
    }
    if (closing) continue;
    // O texto vai até o fechamento OU até a próxima tag de estrutura (<A> sem </A> não engole o vizinho).
    stopRe.lastIndex = tagRe.lastIndex;
    const stop = stopRe.exec(html);
    const end = stop ? stop.index : html.length;
    const body = html.slice(tagRe.lastIndex, end);
    tagRe.lastIndex = end;
    const attrs = parseAttrs(m[3]);
    if (tag === 'h3') {
      // Fundo demais: não cria pasta; os filhos caem na pasta atual (pending null → <DL> empilha cur).
      if (stack.length > MAX_DEPTH) { pending = null; continue; }
      const f: BookmarkNode & { kind: 'folder' } = { kind: 'folder', title: innerText(body), children: [], addDate: unixAttr(attrs.ADD_DATE) };
      if (/^true$/i.test(attrs.PERSONAL_TOOLBAR_FOLDER || '')) f.toolbar = true;
      cur.children.push(f);
      pending = f;
    } else {
      pending = null;
      const url = cleanUrl(attrs.HREF);
      if (!url) continue;
      left--;
      cur.children.push({ kind: 'url', title: innerText(body), url, addDate: unixAttr(attrs.ADD_DATE) });
    }
  }
  return pruneEmpty(root.children);
}

function pruneEmpty(nodes: BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'url') { out.push(n); continue; }
    const children = pruneEmpty(n.children);
    if (children.length) out.push({ ...n, children });
  }
  return out;
}

// ── Achatar + juntar (o Bah guarda favoritos numa lista plana) ──────────────────────────────

/** Todos os links na ordem do documento (pasta por pasta), sem estrutura. */
export function flattenBookmarks(nodes: BookmarkNode[]): FlatBookmark[] {
  const out: FlatBookmark[] = [];
  const stack: BookmarkNode[] = [...nodes].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (n.kind === 'url') out.push({ url: n.url, title: n.title });
    else for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return out;
}

export function countUrls(nodes: BookmarkNode[]): number { return flattenBookmarks(nodes).length; }

/**
 * Junta importados no FIM da lista (os favoritos que a pessoa já tinha continuam na frente da barra,
 * como o Chrome faz com a pasta importada). Pula URL repetida — já existente ou repetida no próprio
 * arquivo — e corta no teto MAX_FAVORITES. Título vazio vira o próprio endereço.
 */
export function mergeFavorites(existing: FlatBookmark[], incoming: FlatBookmark[], max = MAX_FAVORITES, maxChars = MAX_FAVORITES_CHARS):
  { list: FlatBookmark[]; added: number; duplicates: number; overLimit: number } {
  const list = existing.slice();
  const seen = new Set(existing.map(f => urlKey(f.url)));
  let chars = existing.reduce((n, f) => n + favChars(f), 0);
  let added = 0, duplicates = 0, overLimit = 0;
  for (const b of incoming) {
    const url = cleanUrl(b?.url);
    if (!url) continue;
    if (seen.has(url)) { duplicates++; continue; }
    const item = { url, title: cleanTitle(b.title) || url };
    // Passou do teto de itens OU do de caracteres → conta como "não coube" (mesmo aviso fav.importOver).
    if (list.length >= max || chars + favChars(item) > maxChars) { overLimit++; continue; }
    seen.add(url);
    chars += favChars(item);
    list.push(item);
    added++;
  }
  return { list, added, duplicates, overLimit };
}

/** Lista que veio do renderer (IPC) → só o que é favorito válido. */
export function sanitizeFavorites(input: unknown, max = MAX_FAVORITES): FlatBookmark[] {
  if (!Array.isArray(input)) return [];
  // Sem teto de caracteres aqui: exportar nunca corta o que a pessoa já tem.
  return mergeFavorites([], input.slice(0, max * 2) as FlatBookmark[], max, Infinity).list;
}

// ── Exportar (HTML Netscape) ─────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Gera o arquivo no formato exato do Chrome (cabeçalho NETSCAPE-Bookmark-file-1, UTF-8, <DT><A>),
 * que Chrome, Edge e Firefox reimportam. `now` em segundos unix (vira ADD_DATE quando falta).
 */
export function serializeNetscapeHtml(nodes: BookmarkNode[], opts: { title?: string; now?: number } = {}): string {
  const now = Math.floor(opts.now ?? Date.now() / 1000);
  const title = escapeHtml(cleanTitle(opts.title || 'Bookmarks') || 'Bookmarks');
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${title}</TITLE>`,
    `<H1>${title}</H1>`,
    '<DL><p>',
  ];
  const emit = (list: BookmarkNode[], depth: number) => {
    const pad = '    '.repeat(depth);
    for (const n of list) {
      if (n.kind === 'url') {
        const url = cleanUrl(n.url);
        if (!url) continue;
        lines.push(`${pad}<DT><A HREF="${escapeHtml(url)}" ADD_DATE="${n.addDate ?? now}">${escapeHtml(cleanTitle(n.title) || url)}</A>`);
      } else {
        const tb = n.toolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
        const d = n.addDate ?? now;
        lines.push(`${pad}<DT><H3 ADD_DATE="${d}" LAST_MODIFIED="${now}"${tb}>${escapeHtml(cleanTitle(n.title))}</H3>`);
        lines.push(`${pad}<DL><p>`);
        if (depth < MAX_DEPTH) emit(n.children, depth + 1);
        lines.push(`${pad}</DL><p>`);
      }
    }
  };
  emit(nodes, 1);
  lines.push('</DL><p>', '');
  return lines.join('\n');
}

/** Favoritos planos do Bah → árvore de export: tudo dentro da "Barra de favoritos" (como o Chrome). */
export function favoritesToExportTree(favs: FlatBookmark[], toolbarName: string): BookmarkNode[] {
  const children: BookmarkNode[] = sanitizeFavorites(favs).map(f => ({ kind: 'url', url: f.url, title: f.title }));
  return [{ kind: 'folder', title: toolbarName, toolbar: true, children }];
}

/** Nome padrão do arquivo exportado: bah-favoritos-AAAA-MM-DD.html (data local). */
export function exportFileName(d: Date, base = 'bah-favoritos'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.html`;
}
