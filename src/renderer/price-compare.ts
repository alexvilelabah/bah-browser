// Comparar preço ENTRE LOJAS ("compare prices for AirPods Pro on Amazon and other stores").
// O que dava errado: o atalho virava `amazon search for "AirPods Pro other stores"` (palavras do pedido
// na busca, várias lojas viravam uma) e o agente lia uma MATÉRIA de blog de ofertas como se fosse a
// tabela de preços. A pessoa usa um NAVEGADOR: espera que o Bah vá em cada loja, busque lá, olhe o
// preço na página da própria loja e monte a tabela com essas leituras.
//
// Regras de honestidade (o laço em App.tsx segue estas funções):
//  - preço só conta se foi lido no domínio da PRÓPRIA loja (artigo, blog de ofertas, agregador e
//    trecho de resultado de busca nunca viram linha da tabela);
//  - página de erro, captcha, checagem de robô ou exigência de login → a linha diz "couldn't read —
//    <motivo>" e o Bah segue pra próxima loja. Nunca tenta driblar a checagem nem resolver captcha;
//  - nunca põe no carrinho, compra ou entra em conta.
// Puro (sem DOM/Electron): testado em tests/unit/price-compare.test.ts.
import { amazonDomainForCountry } from './known-sites.ts';
import { namesStore } from './stores.ts';

export interface PriceStore {
  id: string;
  label: string;
  /** Nomes como a pessoa escreve (minúsculas, sem acento). */
  names: string[];
  /** Domínio da loja: a página lida tem que estar nele (ou num subdomínio). */
  domain: string;
  /** Busca da própria loja; {query} = o produto já codificado. */
  search: string;
  /** Nome que também é palavra comum ("target"): só conta logo depois de on/at/and/vs… */
  ambiguous?: boolean;
}

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lojas com endereço e busca conferidos à mão. Loja fora da lista NUNCA vira domínio chutado.
function catalog(country: string): PriceStore[] {
  const c = (country || 'US').toUpperCase();
  const amazon = amazonDomainForCountry(c);
  const list: PriceStore[] = [
    { id: 'amazon', label: 'Amazon', names: ['amazon'], domain: amazon, search: `https://www.${amazon}/s?k={query}` },
    c === 'CA'
      ? { id: 'bestbuy', label: 'Best Buy', names: ['best buy', 'bestbuy'], domain: 'bestbuy.ca', search: 'https://www.bestbuy.ca/en-ca/search?search={query}' }
      : { id: 'bestbuy', label: 'Best Buy', names: ['best buy', 'bestbuy'], domain: 'bestbuy.com', search: 'https://www.bestbuy.com/site/searchpage.jsp?st={query}' },
    c === 'CA'
      ? { id: 'walmart', label: 'Walmart', names: ['walmart'], domain: 'walmart.ca', search: 'https://www.walmart.ca/search?q={query}' }
      : { id: 'walmart', label: 'Walmart', names: ['walmart'], domain: 'walmart.com', search: 'https://www.walmart.com/search?q={query}' },
    { id: 'target', label: 'Target', names: ['target'], domain: 'target.com', search: 'https://www.target.com/s?searchTerm={query}', ambiguous: true },
    { id: 'costco', label: 'Costco', names: ['costco'], domain: 'costco.com', search: 'https://www.costco.com/CatalogSearch?keyword={query}' },
    { id: 'ebay', label: 'eBay', names: ['ebay'], domain: 'ebay.com', search: 'https://www.ebay.com/sch/i.html?_nkw={query}' },
    { id: 'newegg', label: 'Newegg', names: ['newegg'], domain: 'newegg.com', search: 'https://www.newegg.com/p/pl?d={query}' },
    { id: 'bhphoto', label: 'B&H Photo', names: ['b&h photo', 'b&h', 'bh photo', 'b and h'], domain: 'bhphotovideo.com', search: 'https://www.bhphotovideo.com/c/search?q={query}' },
    { id: 'homedepot', label: 'The Home Depot', names: ['home depot', 'homedepot'], domain: 'homedepot.com', search: 'https://www.homedepot.com/s/{query}' },
    // "apple" sozinho é marca do PRODUTO ("Apple AirPods"); a loja só com "apple store".
    { id: 'apple', label: 'Apple Store', names: ['apple store', 'apple.com'], domain: 'apple.com', search: 'https://www.apple.com/us/search/{query}?src=globalnav' },
    { id: 'mercadolivre', label: 'Mercado Livre', names: ['mercado livre', 'mercadolivre'], domain: 'mercadolivre.com.br', search: 'https://lista.mercadolivre.com.br/{query}' },
    { id: 'magalu', label: 'Magazine Luiza', names: ['magazine luiza', 'magalu'], domain: 'magazineluiza.com.br', search: 'https://www.magazineluiza.com.br/busca/{query}/' },
    { id: 'casasbahia', label: 'Casas Bahia', names: ['casas bahia'], domain: 'casasbahia.com.br', search: 'https://www.casasbahia.com.br/{query}/b' },
    { id: 'kabum', label: 'KaBuM!', names: ['kabum'], domain: 'kabum.com.br', search: 'https://www.kabum.com.br/busca/{query}' },
    { id: 'argos', label: 'Argos', names: ['argos'], domain: 'argos.co.uk', search: 'https://www.argos.co.uk/search/{query}/' },
    { id: 'currys', label: 'Currys', names: ['currys'], domain: 'currys.co.uk', search: 'https://www.currys.co.uk/search?q={query}' },
    { id: 'johnlewis', label: 'John Lewis', names: ['john lewis'], domain: 'johnlewis.com', search: 'https://www.johnlewis.com/search?search-term={query}' },
    { id: 'mediamarkt', label: 'MediaMarkt', names: ['mediamarkt', 'media markt'], domain: 'mediamarkt.de', search: 'https://www.mediamarkt.de/de/search.html?query={query}' },
    { id: 'otto', label: 'OTTO', names: ['otto'], domain: 'otto.de', search: 'https://www.otto.de/suche/{query}/', ambiguous: true },
  ];
  return list;
}

// Lojas gerais conhecidas por país, pra completar 3–4 quando a pessoa pede "e outras lojas".
const REGION_DEFAULTS: Record<string, string[]> = {
  US: ['amazon', 'bestbuy', 'walmart', 'target'],
  CA: ['amazon', 'bestbuy', 'walmart'],
  GB: ['amazon', 'argos', 'currys', 'johnlewis'],
  UK: ['amazon', 'argos', 'currys', 'johnlewis'],
  BR: ['amazon', 'mercadolivre', 'magalu', 'casasbahia'],
  DE: ['amazon', 'mediamarkt', 'otto'],
};

export function priceStoresFor(country: string): PriceStore[] { return catalog(country); }

// Antes do nome ambíguo ("target"): só vale como loja numa lista de lojas.
const LIST_CUE = String.raw`(?:on|at|from|in|across|between|among|vs\.?|versus|and|or|&|,|plus|na|no|nas|nos|em|entre|e|ou)`;

/** Lojas do catálogo que o pedido nomeia, na ordem em que aparecem. */
export function namedStores(command: string, country = 'US'): PriceStore[] {
  const c = norm(command);
  const hits: Array<{ s: PriceStore; at: number }> = [];
  for (const s of catalog(country)) {
    let at = -1;
    for (const name of [...s.names].sort((a, b) => b.length - a.length)) {
      const word = `(?<![\\w.@/-])${esc(name)}(?:'s)?(?![\\w@-]|\\.\\w)`;
      const re = s.ambiguous ? new RegExp(`(?:^|[\\s,])${LIST_CUE}\\s+(?:the\\s+)?(${word})`) : new RegExp(`(${word})`);
      const m = re.exec(c);
      if (m && (at < 0 || m.index < at)) at = m.index + m[0].length - m[1].length;
    }
    if (at >= 0) hits.push({ s, at });
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.s);
}

// "e outras lojas", "across stores", "which store", "cheapest place", "where to buy", "outras lojas", "onde comprar".
const OTHER_STORES_RE = /\b(?:other|different|several|multiple|various|major|more|many|all\s+the|big|popular)\s+(?:online\s+)?(?:stores?|retailers?|shops?|sites?|websites?|sellers?)\b|\b(?:across|between|among)\s+(?:the\s+)?(?:stores?|retailers?|shops?|sites?)\b|\b(?:and|or)\s+others\b|\belsewhere\b|\bshop\s+around\b|\bcheapest\s+(?:place|store|retailer|shop|site|seller)\b|\bwhere\s+(?:to|can\s+i|should\s+i|do\s+i)\s+(?:buy|get)\b|\b(?:which|what)\s+(?:store|retailer|shop|site|seller)s?\b|\b(?:outr[ao]s|varias|diferentes|demais|algumas|mais)\s+(?:lojas|sites|varejistas)\b|\bentre\s+(?:as\s+)?lojas\b|\bem\s+lojas\b|\bonde\s+(?:comprar|compro|encontrar)\b|\b(?:qual|que|em\s+qual)\s+loja\b|\bloja\s+mais\s+barata\b/;
const COMPARE_PRICES_RE = /\bcompar\w*\s+(?:the\s+|os\s+)?(?:\w+\s+){0,4}?(?:prices?|precos?|pricing)\b|\bprice\s+comparison\b|\bcomparacao\s+de\s+precos?\b/;
const PRICE_WORD_RE = /\b(?:prices?|pricing|cheap(?:est|er)?|lowest|deals?|cost|costs|how\s+much|buy|precos?|barat\w*|custa|valor|comprar)\b/;
// Não é produto de loja: viagem, cotação, carrinho de mercado.
const NOT_SHOPPING_RE = /\b(?:hotels?|motels?|lodging|airbnb|hostels?|resorts?|flights?|airfare|rental\s+cars?|car\s+rentals?|hoteis|hospedage\w*|pousadas?|voos?|passage\w*|stocks?|shares?|crypto|bitcoin|acoes|cotacao|ibovespa|dollar|dolar|euro)\b|\b(?:add|put|adicion\w+|coloc\w+)\b[^.]*\b(?:cart|carrinho|basket)\b/;

/** Pedido de comparar o preço de UM produto em VÁRIAS lojas (en + pt-BR). */
export function isPriceComparison(command: string): boolean {
  const c = norm(command);
  if (!c || NOT_SHOPPING_RE.test(c)) return false;
  if (!priceCompareQuery(command)) return false;
  if (OTHER_STORES_RE.test(c) && (PRICE_WORD_RE.test(c) || /\bcompar/.test(c))) return true;
  const named = namedStores(command);
  if (named.length + unknownNamedStores(command).length >= 2 && (PRICE_WORD_RE.test(c) || /\bcompar/.test(c))) return true;
  // "compare prices for X" sem loja nenhuma → várias lojas. Com UMA loja ("compare prices at Whole
  // Foods for oat milk") é comparar dentro daquela loja — não é este fluxo.
  return COMPARE_PRICES_RE.test(c) && named.length === 0 && !namesStore(command);
}

// ── Produto limpo pra busca ────────────────────────────────────────────────────────────────────
const GENERIC_STORE = String.raw`(?:(?:other|different|several|multiple|various|major|more|many|all\s+the|big|popular)\s+(?:online\s+)?(?:stores?|retailers?|shops?|sites?|websites?|sellers?)|others|elsewhere|everywhere|(?:outr[ao]s|v[aá]rias|diferentes|demais|algumas|mais)\s+(?:lojas|sites|varejistas)|lojas|stores?|retailers?|shops?)`;
function storeItem(country: string, includeAmbiguous: boolean): string {
  const names = catalog(country).filter(s => includeAmbiguous || !s.ambiguous).flatMap(s => s.names).sort((a, b) => b.length - a.length);
  return `(?:${names.map(n => esc(n).replace(/\\ /g, '\\s+')).join('|')}|${GENERIC_STORE})(?:'s)?`;
}
const JOIN = String.raw`\s*(?:,|&|/|\band\b|\bor\b|\bvs\.?|\bversus\b|\bplus\b|\be\b|\bou\b)\s*(?:(?:the|o|a|na|no|nas|nos|em|on|at|in)\s+)*`;

/** Tira as lojas do texto. Devolve o resto e nomes de loja que NÃO conhecemos ("and Micro Center"). */
function stripStoreSpans(text: string, country: string): { rest: string; unknown: string[] } {
  const all = storeItem(country, true), safe = storeItem(country, false);
  const list = (first: string) => String.raw`(?:(?:the|o|a)\s+)?${first}(?:${JOIN}${all})*`;
  const prep = new RegExp(String.raw`(?<![\w-])(?:on|at|from|in|across|between|among|vs\.?|versus|against|na|no|nas|nos|em|entre)\s+${list(all)}(?![\w-])`, 'gi');
  const bare = new RegExp(String.raw`(?<![\w-])${list(safe)}(?![\w-])`, 'gi');
  const unknown: string[] = [];
  const cut = (s: string, re: RegExp) => {
    let out = '', last = 0, m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += s.slice(last, m.index) + ' ';
      last = m.index + m[0].length;
      // Loja que não está no catálogo, logo depois da lista: "on Amazon and Micro Center" (Maiúsculas, até 3 palavras).
      const tail = /^\s*(?:,|&|and|or|e|ou)\s+((?:[A-Z][\w&'.-]*)(?:\s+[A-Z][\w&'.-]*){0,2})(?=\s*(?:$|[.!?,;]|\s+(?:for|to|and|or|e|ou)\b))/.exec(s.slice(last));
      if (tail) { unknown.push(tail[1]); last += tail[0].length; re.lastIndex = last; }
    }
    return out + s.slice(last);
  };
  let rest = cut(text, prep);
  rest = cut(rest, bare);
  return { rest, unknown };
}

const LEAD_RES: RegExp[] = [
  /^\s*(?:hey|hi|hello|ok|okay|oi|ol[aá]|opa)\b[\s,!.]*/i,
  /^\s*(?:please|pls|por\s+favor|pfv)\b[\s,!.]*/i,
  /^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+)?/i,
  /^\s*(?:(?:vc|voc[eê])\s+)?(?:pode|poderia|consegue)\s+(?:me\s+)?(?:ajudar\s+a\s+)?/i,
  /^\s*(?:i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:to\s+)?|help\s+me\s+|me\s+ajud[ae]\s+a\s+|quero\s+|queria\s+)/i,
  /^\s*(?:compare|comparing|check|checking|find|look\s+up|look\s+for|search(?:\s+for)?|get|show(?:\s+me)?|give\s+me|tell\s+me|what\s+(?:is|are|'s)|what're|compar[ae]r?|ver|veja|mostr[ae](?:\s+me)?|busc[ae]r?|procur[ae]r?|pesquis[ae]r?|encontr[ae]r?|ach[ae]r?)\b\s*/i,
  /^\s*(?:(?:the|os|as|o|a)\s+)?(?:best\s+|lowest\s+|cheapest\s+|current\s+|melhores?\s+|menores?\s+)?(?:prices?|price\s+comparison|pricing|deals?|offers?|pre[cç]os?|ofertas?|compara[cç][aã]o\s+de\s+pre[cç]os?)\b\s*(?:(?:for|of|on|de|do|da|dos|das|para|pra)\b\s*)?/i,
  /^\s*(?:where|onde)\s+(?:to|can\s+i|should\s+i|do\s+i|posso|devo|eu\s+posso)?\s*(?:buy|get|find|comprar|compro|achar|encontrar)\s+(?:the\s+|o\s+|a\s+)?(?:cheapest\s+|mais\s+barat[oa]\s+)?/i,
  /^\s*(?:the\s+)?(?:cheapest|best)\s+(?:place|store|retailer|shop|site|seller)\s+(?:to\s+(?:buy|get)|for)\s+/i,
  /^\s*(?:which|what)\s+(?:store|retailer|shop|site|seller)s?\s+(?:has|have|sells?|offers?|is)\s+(?:the\s+)?(?:cheapest|lowest\s+price|best\s+price|best\s+deal)?\s*(?:(?:for|on|of)\s+)?/i,
  /^\s*(?:em\s+)?(?:qual|que)\s+loja\s+(?:tem|vende|est[aá])\s+(?:o\s+|a\s+)?/i,
  /^\s*(?:how\s+much\s+(?:is|are|does|do|for)|quanto\s+(?:custa|custam|sai|est[aá]|t[aá]))\s+(?:the\s+|an?\s+|o\s+|a\s+)?/i,
  /^\s*(?:the\s+)?cheapest\s+/i,
];
const TAIL_RES: RegExp[] = [
  /\s+(?:and|e)\s+(?:show|make|put|give|build|render|list|mostr|fa[cç]a|monte|coloque)\b.*$/i,
  /\s+(?:in|into|as|numa|em\s+uma|em)\s+(?:a\s+)?(?:table|tabela|chart|list|lista)\b.*$/i,
  /\s+(?:for|at)\s+(?:the\s+)?(?:best|lowest|cheapest)\s+price\b.*$/i,
  /\s+(?:pelo|com\s+o)\s+menor\s+pre[cç]o\b.*$/i,
  /\s+(?:mais\s+barat[oa]s?|cheapest|prices?|pricing|pre[cç]os?|price\s+comparison|deals?|cost|costs)\s*$/i,
];
const EDGE = /^(?:for|of|on|at|and|or|vs|the|a|an|to|de|do|da|dos|das|e|ou|na|no|em|para|pra|o|um|uma|with|com)$/i;

/** Só o produto: "compare prices for AirPods Pro on Amazon and other stores" → "AirPods Pro". */
export function priceCompareQuery(command: string, country = 'US'): string {
  let s = String(command || '').replace(/[“”"]/g, ' ').replace(/[?!]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Começo do pedido antes de tirar as lojas: "which STORE has…" é frase, não loja.
  for (const re of LEAD_RES) s = s.replace(re, '');
  s = stripStoreSpans(s, country).rest;
  for (let pass = 0; pass < 4; pass++) {
    const before = s;
    for (const re of LEAD_RES) s = s.replace(re, '');
    for (const re of TAIL_RES) s = s.replace(re, '');
    // "AirPods Pro prices" / "prices of X" no meio sobra só nas bordas.
    s = s.replace(/\s+(?:prices?|pre[cç]os?)\s+(?:for|of|de|do|da)\s*$/i, '').trim();
    if (s === before) break;
  }
  const toks = s.replace(/[,;.:]+/g, ' ').split(/\s+/).filter(Boolean);
  while (toks.length && EDGE.test(toks[0])) toks.shift();
  while (toks.length && EDGE.test(toks[toks.length - 1])) toks.pop();
  return toks.join(' ').slice(0, 80).trim();
}

/** Lojas que o pedido nomeia mas que não conhecemos — viram linha "not checked", nunca domínio chutado. */
export function unknownNamedStores(command: string, country = 'US'): string[] {
  return stripStoreSpans(String(command || ''), country).unknown;
}

/**
 * As lojas a visitar: as nomeadas e, quando a pessoa pede "outras lojas" (ou nomeou menos de 2),
 * as gerais conhecidas do país até chegar a `target` (4). Nomeou 2+ sem pedir outras → só essas.
 */
export function pickStores(command: string, country = 'US', target = 4): PriceStore[] {
  const named = namedStores(command, country);
  const unknown = unknownNamedStores(command, country).length;   // viram linha "not checked" e contam no total
  const c = norm(command);
  const wantsOthers = OTHER_STORES_RE.test(c) || named.length + unknown < 2;
  if (!wantsOthers) return named.slice(0, 6);
  const out = [...named];
  const byId = new Map(catalog(country).map(s => [s.id, s]));
  const defaults = REGION_DEFAULTS[(country || '').toUpperCase()] || ['amazon', 'ebay'];
  for (const id of defaults) {
    if (out.length + unknown >= Math.max(target, named.length + unknown)) break;
    const s = byId.get(id);
    if (s && !out.some(o => o.id === id)) out.push(s);
  }
  return out.slice(0, 6);
}

export function storeSearchUrl(store: PriceStore, query: string): string {
  return store.search.replace('{query}', encodeURIComponent(query));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** A página está no domínio da própria loja? (artigo/blog/agregador/buscador → não) */
export function isStoreSource(url: string, store: PriceStore): boolean {
  if (!/^https?:/i.test(url || '')) return false;
  const h = hostOf(url);
  const d = store.domain.toLowerCase();
  return !!h && (h === d || h.endsWith(`.${d}`));
}

// ── Página bloqueada? ──────────────────────────────────────────────────────────────────────────
const CAPTCHA_RE = /\b(?:captcha|recaptcha|hcaptcha|are\s+you\s+a\s+(?:robot|human)|robot\s+or\s+human|not\s+a\s+robot|verify\s+(?:that\s+)?you(?:'re|\s+are)\s+(?:a\s+)?human|human\s+verification|press\s+(?:&|and)\s+hold|bot\s+detection|checking\s+your\s+browser|just\s+a\s+moment|unusual\s+traffic|automated\s+(?:access|queries|requests)|pardon\s+our\s+interruption|n[aã]o\s+sou\s+um\s+rob[oô]|confirme\s+que\s+voc[eê]\s+[eé]\s+humano)\b/i;
const DENIED_RE = /\b(?:access\s+denied|acesso\s+negado|forbidden|you\s+don't\s+have\s+permission\s+to\s+access|request\s+(?:was\s+)?blocked|you\s+have\s+been\s+blocked|too\s+many\s+requests)\b/i;
const ERROR_RE = /(?:sorry[!,.]?\s+something\s+went\s+wrong|something\s+went\s+wrong|page\s+not\s+found|\b404\b|service\s+unavailable|temporarily\s+unavailable|internal\s+server\s+error|an\s+error\s+(?:has\s+)?occurred|we'?re\s+having\s+(?:some\s+)?trouble|algo\s+deu\s+errado|p[aá]gina\s+n[aã]o\s+encontrada|this\s+site\s+can'?t\s+be\s+reached|err_[a-z_]+)/i;
const SIGNIN_RE = /\b(?:sign\s+in\s+to\s+continue|log\s+in\s+to\s+continue|please\s+sign\s+in|sign\s+in\s+required|you\s+must\s+(?:be\s+)?(?:signed|logged)\s+in|fa[cç]a\s+login\s+para\s+continuar|entre\s+na\s+sua\s+conta\s+para)\b/i;
const COUNTRY_RE = /\b(?:choose\s+a\s+country|select\s+your\s+(?:country|region)|escolha\s+(?:o\s+)?(?:seu\s+)?pa[ií]s)\b/i;

/**
 * Motivo pra NÃO ler a página (erro, captcha, checagem de robô, login, saiu da loja) ou null.
 * Texto curto = página-porteira; numa página de resultados cheia, a palavra "robot" é produto (aspirador).
 */
export function blockedReason(page: { url: string; title?: string; text?: string }, store: PriceStore): string | null {
  const url = page.url || '';
  const title = page.title || '';
  const text = (page.text || '').trim();
  if (!url || /^(?:about:blank|chrome-error:|data:)/i.test(url)) return "the page didn't load";
  if (!isStoreSource(url, store)) return `left ${store.domain} (ended on ${hostOf(url) || url})`;
  const short = text.length < 2500;
  const head = `${title}\n${short ? text : text.slice(0, 600)}`;
  if (CAPTCHA_RE.test(title) || (short && CAPTCHA_RE.test(text))) return 'bot check / captcha';
  if (DENIED_RE.test(title) || (short && DENIED_RE.test(text))) return 'access denied (blocked)';
  if (/\/(?:ap\/signin|signin|sign-in|login|log-in|account\/login|identity)\b/i.test(new URL(url).pathname) || (short && SIGNIN_RE.test(head))) return 'sign-in wall';
  if (short && COUNTRY_RE.test(head)) return 'country selection page';
  if (ERROR_RE.test(title) || (short && ERROR_RE.test(head))) return 'error page';
  if (text.length < 40) return 'empty page';
  return null;
}

// ── Preço ──────────────────────────────────────────────────────────────────────────────────────
/** "$1,299.99" → 1299.99 · "R$ 1.299,90" → 1299.9 · "£249" → 249 · sem número → null. */
export function parsePrice(s: string): number | null {
  const m = /(\d[\d.,\s ]*\d|\d)/.exec(String(s || ''));
  if (!m) return null;
  let n = m[1].replace(/[\s ]/g, '');
  const lastDot = n.lastIndexOf('.'), lastComma = n.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  if (dec >= 0 && n.length - dec - 1 === 2) {
    n = n.slice(0, dec).replace(/[.,]/g, '') + '.' + n.slice(dec + 1);
  } else {
    n = n.replace(/[.,]/g, '');
  }
  const v = parseFloat(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** O preço que o modelo leu está mesmo na página? (aceita "$199.99", "199,99", "$199\n99"). */
export function priceOnPage(price: string, text: string): boolean {
  const v = parsePrice(price);
  if (v == null) return false;
  const collapsed = String(text || '').replace(/(\d)[\s .,]+(?=\d)/g, '$1');
  const cents = Math.round(v * 100);
  const forms = [String(cents)];
  if (cents % 100 === 0) forms.push(String(cents / 100));
  return forms.some(f => new RegExp(`(?<!\\d)${f}(?!\\d)`).test(collapsed));
}

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'with', 'o', 'a', 'de', 'do', 'da', 'com', 'e', 'new']);
function tokens(s: string): string[] {
  return norm(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t));
}

/** O título lido é o produto pedido (as palavras do produto estão lá)? */
export function titleMatchesQuery(title: string, query: string): boolean {
  const q = tokens(query), t = new Set(tokens(title));
  const tJoined = tokens(title).join('');
  if (!q.length || !t.size) return false;
  const has = (w: string) => t.has(w) || tJoined.includes(w);
  if (!has(q[0])) return false;
  return q.filter(has).length >= Math.ceil(q.length * 0.7);
}

const ACCESSORY = String.raw`(?:case|cases|cover|covers|skin|skins|sleeve|protector|holder|stand|mount|strap|ear\s*tips?|eartips|charger|cable|replacement|adapter|capa|capinha|pelicula|suporte|carregador|cabo)`;
/**
 * Acessório que a pessoa não pediu: a palavra de acessório vem ANTES do produto ("Silicone Case for
 * AirPods Pro"), logo DEPOIS dele ("AirPods Pro 2 Case"), ou "for/compatible with <produto>".
 * "AirPods Pro 2 with MagSafe Charging Case" é o produto (o estojo faz parte).
 */
export function looksLikeAccessory(title: string, query: string): boolean {
  const t = norm(title), q = norm(query);
  const qt = tokens(query);
  if (!qt.length) return false;
  const first = esc(qt[0]), last = esc(qt[qt.length - 1]);
  const at = t.search(new RegExp(`\\b${first}`));
  if (at < 0) return false;
  const before = t.slice(0, at);
  const accBefore = new RegExp(`\\b${ACCESSORY}\\b`).exec(before);
  if (accBefore && !q.includes(accBefore[0])) return true;
  const after = new RegExp(`\\b${last}(?:\\s+(?:\\d+|\\(?\\d*(?:st|nd|rd|th)\\b|gen\\w*|generation|\\)))*\\s+${ACCESSORY}\\b`).exec(t);
  if (after && !new RegExp(`\\b${ACCESSORY}\\b`).test(q)) return true;
  return new RegExp(`\\b(?:for|para|compatible\\s+with|compativel\\s+com)\\s+(?:apple\\s+)?${first}`).test(t);
}

// ── O que o modelo vê pra ler o preço ─────────────────────────────────────────────────────────
/** Trechos da página em volta do produto (título + as linhas logo depois, onde mora o preço). */
export function pageSnippets(text: string, query: string, max = 4500): string {
  const lines = String(text || '').split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const q = tokens(query);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    const lt = new Set(tokens(l));
    if (q.length && q.filter(w => lt.has(w) || norm(l).includes(w)).length >= Math.ceil(q.length * 0.7)) {
      for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 6); k++) keep.add(k);
    }
  });
  let out = '';
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const piece = (i === prev + 1 ? '' : '\n…\n') + lines[i] + '\n';
    if (out.length + piece.length > max) break;
    out += piece;
    prev = i;
  }
  return out.trim() || lines.join('\n').slice(0, Math.min(max, 3000));
}

export function readPricePrompt(o: { store: string; query: string; url: string; title: string; snippets: string }): string {
  return [
    `You are reading ONE store page in a web browser: ${o.store} (${o.url}), page title "${o.title.slice(0, 120)}".`,
    `Find the listing for this product: "${o.query}". Read its price as the store shows it on THIS page (the screenshot, if attached, is this page).`,
    'Rules:',
    '- Only the product asked for. Not a case, cover, charger, cable, ear tips or any accessory; not a different model.',
    '- The current selling price, with its currency symbol, copied exactly. Not a crossed-out list price, not a monthly or installment price, not a trade-in or "save $X" amount.',
    '- Prefer a regular result over a "Sponsored" one when both match.',
    '- If no matching product with a visible price is on the page, answer found=false. Never guess a price.',
    '- If the page is an error page, a captcha/robot check or a sign-in wall, answer found=false and put the reason in "blocked".',
    'Reply with ONLY this JSON, nothing else:',
    '{"found": true, "title": "exact product title as shown", "price": "$0.00", "availability": "in stock / out of stock / delivery or pickup info as shown, or empty", "blocked": ""}',
    '',
    'PAGE TEXT (the parts that mention the product):',
    o.snippets,
  ].join('\n');
}

export type PriceRead = { found: boolean; title: string; price: string; availability: string; blocked: string };
/** Resposta do modelo → leitura (tolera ```json, texto em volta e campos faltando). */
export function parseReadReply(reply: string): PriceRead | null {
  const s = String(reply || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
    return { found: j.found === true || j.found === 'true', title: str(j.title).slice(0, 200), price: str(j.price).slice(0, 40), availability: str(j.availability).slice(0, 120), blocked: str(j.blocked).slice(0, 120) };
  } catch { return null; }
}

// ── Linhas e tabela ────────────────────────────────────────────────────────────────────────────
export type PriceRow = {
  store: string;
  status: 'read' | 'blocked' | 'not_found' | 'not_checked';
  url: string;
  title?: string;
  price?: string;
  amount?: number;
  availability?: string;
  reason?: string;
};

/**
 * Confere a leitura do modelo contra a página e devolve a linha. Só vira 'read' se: página no domínio
 * da loja, título é o produto (não acessório) e o preço aparece no texto da página.
 */
export function checkRead(read: PriceRead | null, page: { url: string; text: string }, store: PriceStore, query: string): PriceRow {
  const base = { store: store.label, url: page.url };
  if (!isStoreSource(page.url, store)) return { ...base, status: 'blocked', reason: `left ${store.domain}` };
  if (!read) return { ...base, status: 'not_found', reason: "couldn't read the page" };
  if (read.blocked) return { ...base, status: 'blocked', reason: read.blocked };
  if (!read.found || !read.price) return { ...base, status: 'not_found', reason: 'no matching product with a visible price' };
  if (!titleMatchesQuery(read.title, query) || looksLikeAccessory(read.title, query)) return { ...base, status: 'not_found', reason: `best match was "${read.title.slice(0, 60)}", not the product` };
  if (!priceOnPage(read.price, page.text)) return { ...base, status: 'not_found', reason: `price ${read.price} not confirmed on the page` };
  return { ...base, status: 'read', title: read.title, price: read.price, amount: parsePrice(read.price) ?? undefined, availability: read.availability };
}

export function rowResult(r: PriceRow): string {
  return r.status === 'read' ? 'read on the store page'
    : r.status === 'not_checked' ? `not checked — ${r.reason}`
    : `couldn't read — ${r.reason || 'unknown'}`;
}

/** Tabela pro render_view: todas as lojas tentadas (lidas primeiro, da mais barata), cada uma com link. */
export function compareTableSpec(query: string, rows: PriceRow[], when = new Date()) {
  const read = rows.filter(r => r.status === 'read').sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity));
  const rest = rows.filter(r => r.status !== 'read');
  const ordered = [...read, ...rest];
  return {
    title: `Prices: ${query}`,
    subtitle: `Read on each store's own site — ${read.length} of ${rows.length} stores read`,
    columns: ['Store', 'Product (as listed)', 'Price', 'Availability / shipping', 'Result'],
    rows: ordered.map(r => [r.store, r.title || '—', r.price || '—', r.availability || '—', rowResult(r)]),
    links: ordered.map(r => r.url || undefined),
    ...(read.length >= 2 ? { chart: { type: 'bar' as const, label: 'Price', labels: read.map(r => r.store), values: read.map(r => r.amount ?? 0) } } : {}),
    sourceNote: `Each price was read on the store's own page (link in the Store column) — ${when.toLocaleString()}. Prices change; confirm on the store before buying.`,
  };
}

/** Mensagem final: quantas lojas lidas × bloqueadas, e a mais barata. */
export function compareSummary(query: string, rows: PriceRow[]): string {
  const read = rows.filter(r => r.status === 'read').sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity));
  const blocked = rows.filter(r => r.status === 'blocked');
  const missing = rows.filter(r => r.status === 'not_found' || r.status === 'not_checked');
  const parts = [`Checked "${query}" at ${rows.length} store${rows.length === 1 ? '' : 's'}: read ${read.length}${read.length ? ` (${read.map(r => `${r.store} ${r.price}`).join(', ')})` : ''}`];
  if (blocked.length) parts.push(`blocked ${blocked.length} (${blocked.map(r => `${r.store} — ${r.reason}`).join('; ')})`);
  if (missing.length) parts.push(`no price found ${missing.length} (${missing.map(r => `${r.store} — ${r.reason}`).join('; ')})`);
  let msg = parts.join('; ') + '.';
  if (read.length) msg += ` Cheapest: ${read[0].store} — ${read[0].price} (${read[0].title}).`;
  return msg;
}
