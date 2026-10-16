// Mecanismo de pesquisa da barra de endereço (igual ao do Chrome): a tabela dos prontos,
// a validação do "Personalizado" e a montagem do endereço da busca. Puro (sem DOM/Electron)
// — o renderer e o main usam o mesmo arquivo, e os testes ficam em tests/unit.
//
// Só vale pro que a PESSOA digita/escolhe (barra, sugestões, "Pesquisar no … por", nova aba).
// As buscas internas do agente (Pesquisa Rápida, notícias, compras…) continuam no Google: os
// extratores de lá leem a página de resultados do Google.

export type SearchLang = 'en' | 'pt' | 'es';
export type PresetEngineId = 'google' | 'bing' | 'duckduckgo' | 'ecosia' | 'brave' | 'yahoo';
export type SearchEngineId = PresetEngineId | 'custom';

/** O que fica salvo. `custom` só é lido quando id === 'custom'. */
export interface SearchEngineSetting {
  id: SearchEngineId;
  custom?: string;
}

export interface SearchEnginePreset {
  id: PresetEngineId;
  name: string;
  /** %s = a busca já codificada. {google:locale} = hl/gl do idioma da interface (só Google). */
  search: string;
  /** Sugestões no formato OpenSearch ([busca, [sugestões…]]). {hl} = idioma. */
  suggest?: string;
  /** Página da nova aba — por idioma quando o site muda de endereço (Google Brasil). */
  home: string | Record<SearchLang, string>;
}

export const DEFAULT_SEARCH_ENGINE: SearchEngineSetting = { id: 'google' };

// Google com os MESMOS parâmetros que o Bah sempre usou (pws=0 = sem personalização;
// gws_rd=cr = não redireciona pro Google do país do IP).
export const SEARCH_ENGINES: readonly SearchEnginePreset[] = [
  {
    id: 'google', name: 'Google',
    search: 'https://www.google.com/search?{google:locale}&pws=0&q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&hl={hl}&q=%s',
    home: {
      pt: 'https://www.google.com.br/webhp?hl=pt-BR&gl=BR&pws=0&gws_rd=cr',
      es: 'https://www.google.com/webhp?hl=es&pws=0',
      en: 'https://www.google.com/webhp?hl=en&pws=0',
    },
  },
  {
    id: 'bing', name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://www.bing.com/osjson.aspx?query=%s',
    home: 'https://www.bing.com/',
  },
  {
    id: 'duckduckgo', name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
    home: 'https://duckduckgo.com/',
  },
  {
    id: 'ecosia', name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
    home: 'https://www.ecosia.org/',
  },
  {
    id: 'brave', name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s',
    home: 'https://search.brave.com/',
  },
  {
    id: 'yahoo', name: 'Yahoo',
    search: 'https://search.yahoo.com/search?p=%s',
    suggest: 'https://search.yahoo.com/sugg/chrome?output=fxjson&appid=crmas&command=%s',
    home: 'https://search.yahoo.com/',
  },
];

export const CUSTOM_TEMPLATE_MAX = 2048;
export const SEARCH_QUERY_MAX = 2000;   // busca maior que isso é colagem acidental — corta

export type CustomTemplateError = 'empty' | 'tooLong' | 'notHttps' | 'placeholder' | 'invalid';

export function presetById(id: unknown): SearchEnginePreset | undefined {
  return SEARCH_ENGINES.find(e => e.id === id);
}

/**
 * Valida o endereço do "Personalizado": https, um %s só (e depois do domínio — nunca no
 * nome do site), sem espaço/controle, sem usuário:senha, tamanho razoável. Isso barra
 * javascript:, data:, file:, http: e "https://%s.site.com".
 */
export function validateCustomTemplate(raw: unknown): { ok: true; template: string } | { ok: false; error: CustomTemplateError } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > CUSTOM_TEMPLATE_MAX) return { ok: false, error: 'tooLong' };
  if (!/^https:\/\//i.test(s)) return { ok: false, error: 'notHttps' };
  if (s.split('%s').length !== 2) return { ok: false, error: 'placeholder' };
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'invalid' };
  // O %s tem que vir depois do fim do domínio (um / ? ou # antes dele).
  if (!/^https:\/\/[^/?#%]+[/?#]/i.test(s.slice(0, s.indexOf('%s')))) return { ok: false, error: 'invalid' };
  let u: URL;
  try { u = new URL(s.replace('%s', 'bah')); } catch { return { ok: false, error: 'invalid' }; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return { ok: false, error: 'invalid' };
  // Domínio "de verdade" (letras/números/ponto/hífen; acento já vem como xn--) ou IPv6.
  if (!/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/.test(u.hostname)) return { ok: false, error: 'invalid' };
  return { ok: true, template: s };
}

/**
 * Lê o que veio do disco/IPC. Qualquer coisa estranha (perfil antigo sem a chave, JSON
 * quebrado, id desconhecido, Personalizado inválido) = Google, o padrão de sempre.
 */
export function normalizeSearchSetting(raw: unknown): SearchEngineSetting {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SEARCH_ENGINE };
  const r = raw as { id?: unknown; custom?: unknown };
  const v = r.custom === undefined ? null : validateCustomTemplate(r.custom);
  if (r.id === 'custom') return v && v.ok ? { id: 'custom', custom: v.template } : { ...DEFAULT_SEARCH_ENGINE };
  const p = presetById(r.id);
  if (!p) return { ...DEFAULT_SEARCH_ENGINE };
  // O Personalizado fica guardado mesmo com um pronto escolhido (voltar pra ele sem redigitar).
  return v && v.ok ? { id: p.id, custom: v.template } : { id: p.id };
}

/** Busca → pedaço de URL. encodeURIComponent cobre espaço, + & # = ? / e acentos/emoji (UTF-8). */
export function encodeQuery(query: string): string {
  return encodeURIComponent(String(query ?? '').trim().slice(0, SEARCH_QUERY_MAX));
}

// Troca o 1º %s pela busca SEM String.replace com texto: lá "$&" e "$1" virariam padrão
// (encodeURIComponent não codifica o "$").
function putQuery(template: string, encoded: string): string {
  const i = template.indexOf('%s');
  return i < 0 ? template : template.slice(0, i) + encoded + template.slice(i + 2);
}

function templateOf(setting: SearchEngineSetting): string {
  const s = normalizeSearchSetting(setting);
  if (s.id === 'custom' && s.custom) return s.custom;
  return (presetById(s.id) || SEARCH_ENGINES[0]).search;
}

/** Endereço da busca no mecanismo escolhido. googleLocale = "hl=pt-BR&gl=BR" etc. */
export function buildSearchUrl(setting: SearchEngineSetting, query: string, opts: { googleLocale?: string } = {}): string {
  const tpl = templateOf(setting).split('{google:locale}').join(opts.googleLocale || 'hl=en');
  return putQuery(tpl, encodeQuery(query));
}

/** Endereço das sugestões, ou null (Personalizado não busca sugestões: não sabemos o formato). */
export function buildSuggestUrl(setting: SearchEngineSetting, query: string, hl = 'en'): string | null {
  const s = normalizeSearchSetting(setting);
  const p = s.id === 'custom' ? undefined : presetById(s.id);
  if (!p || !p.suggest) return null;
  return putQuery(p.suggest.split('{hl}').join(encodeURIComponent(hl)), encodeQuery(query));
}

/** Resposta OpenSearch → lista de sugestões (texto), no máximo `max`. Formato estranho → []. */
export function parseSuggestResponse(data: unknown, max = 6): string[] {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return data[1].filter(x => typeof x === 'string' && x.trim()).slice(0, max).map(x => String(x));
}

function presetHome(p: SearchEnginePreset, lang: SearchLang): string {
  return typeof p.home === 'string' ? p.home : (p.home[lang] || p.home.en);
}

/** Página inicial da nova aba. Personalizado = raiz do site do endereço. */
export function engineHome(setting: SearchEngineSetting, lang: SearchLang = 'en'): string {
  const s = normalizeSearchSetting(setting);
  if (s.id === 'custom' && s.custom) {
    try { return new URL(s.custom.replace('%s', '')).origin + '/'; } catch {}
  }
  return presetHome(presetById(s.id) || SEARCH_ENGINES[0], lang);
}

/** Endereço que serve de ícone (favicon) do mecanismo. */
export function engineIconUrl(setting: SearchEngineSetting): string {
  return engineHome(setting, 'en');
}

/** Nome pra mostrar ("Google", "Bing"…). Personalizado = o domínio (sem www). */
export function engineName(setting: SearchEngineSetting): string {
  const s = normalizeSearchSetting(setting);
  if (s.id === 'custom' && s.custom) {
    try { return new URL(s.custom.replace('%s', '')).hostname.replace(/^www\./i, ''); } catch {}
  }
  return (presetById(s.id) || SEARCH_ENGINES[0]).name;
}

// Nome do parâmetro que carrega a busca (q, p…), pra não confundir a página de resultados
// do DuckDuckGo (duckduckgo.com/?q=…) com a página inicial dele (duckduckgo.com/).
function queryParamOf(template: string): string | null {
  try {
    const u = new URL(putQuery(template.split('{google:locale}').join('hl=en'), '__bah_q__'));
    for (const [k, v] of u.searchParams) if (v === '__bah_q__') return k;
  } catch {}
  return null;
}

const GOOGLE_HOME = /^https?:\/\/(www\.)?google\.[a-z.]+\/(webhp|\?|$)/i;

/**
 * A URL é a página inicial de algum mecanismo pronto (= "nova aba")? Aí a barra mostra o
 * placeholder em vez do endereço e a IA não conta como "página aberta". Vale pra todos os
 * prontos (uma aba aberta antes da troca continua "nova"). O Personalizado fica de fora de
 * propósito: a raiz dele pode ser um site comum (youtube.com/), que deixaria de mostrar o
 * endereço e de valer como página pra IA.
 */
export function isEngineHome(url: string | undefined): boolean {
  if (!url) return false;
  if (GOOGLE_HOME.test(url)) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.pathname !== '/' && u.pathname !== '') return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const cands = SEARCH_ENGINES
    .filter(p => p.id !== 'google')
    .map(p => ({ home: presetHome(p, 'en'), search: p.search }));
  for (const c of cands) {
    let h: string;
    try { h = new URL(c.home).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    if (h !== host) continue;
    const qp = queryParamOf(c.search);
    if (qp && u.searchParams.has(qp)) return false;   // é página de RESULTADO, não a inicial
    return true;
  }
  return false;
}

/** Rótulo curto do texto selecionado pro menu do clique direito (o Chrome corta em ~32). */
export function selectionLabel(text: string, max = 32): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}
