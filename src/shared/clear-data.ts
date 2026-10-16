// clear-data.ts — regras PURAS do "Limpar dados de navegação" (menu ⋮ / Ctrl+Shift+Delete).
// Sem electron, sem fs, sem DOM: o renderer, o main e os testes usam a MESMA regra.
//  • Período → a partir de quando apagar (Última hora … Todo o período, igual ao Chrome).
//  • Histórico/downloads: o que sai e o que fica, respeitando o período.
//  • Cookies/cache: o que pedir ao session.clearData do Electron. Ele NÃO aceita período
//    (sempre "desde sempre") e o Cookie do Electron não tem data de criação. Então, igual em
//    espírito ao Chrome, nos períodos menores apagamos só os dados dos SITES QUE VOCÊ ABRIU
//    nesse período (pelo histórico do Bah); em "Todo o período", de todos os sites.
//  • Nunca: extensões instaladas (origens chrome-extension://) e configurações do Bah
//    (essas moram no defaultSession, que esta limpeza nem toca).

export type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'all';
export const TIME_RANGES: readonly TimeRange[] = ['hour', 'day', 'week', 'month', 'all'];

const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  hour: HOUR,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
  month: 28 * 24 * HOUR,   // "Últimas 4 semanas" do Chrome = 28 dias, não "um mês"
};

export function isTimeRange(x: unknown): x is TimeRange {
  return typeof x === 'string' && (TIME_RANGES as readonly string[]).includes(x);
}

/** Momento (ms) a partir do qual apagar: tudo com ts >= isto sai. "Todo o período" = -Infinity. */
export function rangeSince(range: TimeRange, now: number): number {
  return range === 'all' ? -Infinity : now - RANGE_MS[range];
}

const validTs = (ts: unknown): ts is number => typeof ts === 'number' && Number.isFinite(ts);

/** Caiu no período? Sem data válida só sai no "Todo o período" (não dá pra saber quando foi). */
export function inRange(ts: unknown, since: number): boolean {
  if (since === -Infinity) return true;
  return validTs(ts) && ts >= since;
}

export type HistoryEntry = { url: string; title?: string; ts: number };

/** Divide o histórico em o que fica e o que sai. A ordem (mais novo primeiro) é mantida. */
export function splitHistory<T extends { url: string; ts?: unknown }>(list: readonly T[], since: number): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const h of list) (inRange(h?.ts, since) ? removed : kept).push(h);
  return { kept, removed };
}

/** Origem http(s) normalizada ("https://site.com"), ou null pra qualquer outra coisa. */
export function webOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
    return u.origin;
  } catch { return null; }
}

/** Máximo de sites por limpeza (o histórico do Bah guarda até 1000 endereços). */
export const MAX_ORIGINS = 1000;

/** Sites (origens) visitados no período, sem repetir, pelo histórico. */
export function originsVisited(list: readonly { url: string; ts?: unknown }[], since: number): string[] {
  const out = new Set<string>();
  for (const h of list) {
    if (out.size >= MAX_ORIGINS) break;
    if (!inRange(h?.ts, since)) continue;
    const o = webOrigin(h?.url);
    if (o) out.add(o);
  }
  return [...out];
}

/** Downloads: só sai o que já terminou e começou no período. Em andamento NUNCA (nem o arquivo). */
export function keepDownloads<T extends { state?: string; at?: unknown }>(list: readonly T[], since: number): T[] {
  const active = (s?: string) => s === 'started' || s === 'progress' || s === 'queued';
  return list.filter(d => active(d.state) || !inRange(d.at, since));
}

// ── Pedido que vai do renderer pro main (IPC) ────────────────────────────────

export type ClearRequest = {
  range: TimeRange;
  cookies: boolean;      // Cookies e outros dados de sites
  cache: boolean;        // Imagens e arquivos em cache
  /** Sites visitados no período (só conta fora do "Todo o período"). */
  origins: string[];
};

/**
 * Confere o pedido que chega do renderer: só períodos conhecidos, só booleanos e só origens
 * http(s) já normalizadas (nada de chrome-extension://, file://, lixo). Sem lista livre de
 * "storages": o renderer escolhe CAIXAS, o main decide o que cada caixa apaga.
 */
export function sanitizeClearRequest(raw: unknown): ClearRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isTimeRange(r.range)) return null;
  const origins: string[] = [];
  if (Array.isArray(r.origins)) {
    const seen = new Set<string>();
    for (const o of r.origins) {
      if (seen.size >= MAX_ORIGINS) break;
      const n = webOrigin(o);
      // Só aceita se já veio como origem pura (sem caminho/usuário/senha): ninguém "esconde" nada no meio.
      if (n && n === o && !seen.has(n)) { seen.add(n); origins.push(n); }
    }
  }
  return { range: r.range, cookies: r.cookies === true, cache: r.cache === true, origins: r.range === 'all' ? [] : origins };
}

// ── O que pedir ao session.clearData ─────────────────────────────────────────

export type DataType = 'backgroundFetch' | 'cache' | 'cookies' | 'fileSystems' | 'indexedDB' | 'localStorage' | 'serviceWorkers' | 'webSQL';

/** "Cookies e outros dados de sites": cookies + armazenamento dos sites (o que o Chrome chama de site data). */
export const SITE_DATA_TYPES: readonly DataType[] = ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL', 'backgroundFetch'];
/** "Imagens e arquivos em cache": cache HTTP; no Electron inclui o Cache Storage e o cache de shaders. */
export const CACHE_TYPES: readonly DataType[] = ['cache'];

export type ClearDataCall = { dataTypes: DataType[]; origins?: string[]; excludeOrigins?: string[] };
export type ClearPlan = {
  /** Sessão das abas (persist:browser). null = nada a apagar lá. */
  browser: ClearDataCall | null;
  /** Sessão antiga do login do Google (persist:google-login): só com cookies + "Todo o período". */
  googleLogin: ClearDataCall | null;
};

/** Origem de cada extensão instalada (id de 32 letras a–p, o formato do Chrome). */
export function extensionOrigins(ids: Iterable<unknown>): string[] {
  const out = new Set<string>();
  for (const id of ids) if (typeof id === 'string' && /^[a-p]{32}$/.test(id)) out.add(`chrome-extension://${id}`);
  return [...out];
}

export function planClear(req: ClearRequest, extensionIds: Iterable<unknown>): ClearPlan {
  const dataTypes: DataType[] = [...(req.cookies ? SITE_DATA_TYPES : []), ...(req.cache ? CACHE_TYPES : [])];
  if (!dataTypes.length) return { browser: null, googleLogin: null };
  if (req.range === 'all') {
    const exclude = extensionOrigins(extensionIds);
    // excludeOrigins vazio = "apaga tudo" no Electron; só manda a chave quando tem o que proteger.
    const browser: ClearDataCall = exclude.length ? { dataTypes, excludeOrigins: exclude } : { dataTypes };
    return { browser, googleLogin: req.cookies ? { dataTypes } : null };
  }
  // Período menor: só os sites abertos nesse período. Nenhum → não chama (sem filtro = apagaria TUDO).
  const origins = req.origins.filter(o => webOrigin(o) === o);
  return { browser: origins.length ? { dataTypes, origins } : null, googleLogin: null };
}
