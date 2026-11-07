// Sites conhecidos pelo NOME → endereço OFICIAL. "browse to linkedin, find a job…" fazia o agente
// gastar ~25s num web_search("LinkedIn") só pra descobrir linkedin.com. Lista curta e curada à mão:
// cada endereço aqui foi conferido. Nome fora da lista NUNCA vira domínio chutado (linkedln.com,
// walmart.co… é exatamente o que um golpista registra) — continua indo pra busca.
// Puro (sem DOM/Electron): testado em tests/unit/known-sites.test.ts.

// Loja/enciclopédia do PAÍS da pessoa (era fixo amazon.com.br e pt.wikipedia — usuário nos EUA
// caía na Amazon do Brasil, em reais). País/idioma vêm do navegador (locale do sistema).
const AMAZON_BY_COUNTRY: Record<string, string> = {
  US: 'amazon.com', GB: 'amazon.co.uk', UK: 'amazon.co.uk', CA: 'amazon.ca', DE: 'amazon.de', AT: 'amazon.de', BR: 'amazon.com.br',
  ES: 'amazon.es', FR: 'amazon.fr', IT: 'amazon.it', MX: 'amazon.com.mx', IN: 'amazon.in', JP: 'amazon.co.jp', AU: 'amazon.com.au',
  NL: 'amazon.nl', SE: 'amazon.se', PL: 'amazon.pl', BE: 'amazon.com.be', TR: 'amazon.com.tr', AE: 'amazon.ae', SA: 'amazon.sa', SG: 'amazon.sg',
};
function userLocale(): string {
  try { return (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en-US'; } catch { return 'en-US'; }
}
export function userAmazonDomain(locale = userLocale()): string {
  const country = (locale.split(/[-_]/)[1] || (locale.toLowerCase().startsWith('pt') ? 'BR' : 'US')).toUpperCase();
  return AMAZON_BY_COUNTRY[country] || 'amazon.com';
}

export interface OfficialSite {
  id: string;
  label: string;
  names: string[];
  url: string;
  /** Nome que também é palavra comum ("indeed", "target", "x"): só conta logo depois de "go to/on/at/abra…". */
  ambiguous?: boolean;
}

export function officialSites(locale?: string): OfficialSite[] {
  const amazon = userAmazonDomain(locale);
  return [
    { id: 'linkedin', label: 'LinkedIn', names: ['linkedin', 'linked in'], url: 'https://www.linkedin.com/' },
    { id: 'indeed', label: 'Indeed', names: ['indeed'], url: 'https://www.indeed.com/', ambiguous: true },
    { id: 'glassdoor', label: 'Glassdoor', names: ['glassdoor'], url: 'https://www.glassdoor.com/' },
    { id: 'github', label: 'GitHub', names: ['github', 'git hub'], url: 'https://github.com/' },
    { id: 'gitlab', label: 'GitLab', names: ['gitlab'], url: 'https://gitlab.com/' },
    { id: 'amazon', label: 'Amazon', names: ['amazon'], url: `https://www.${amazon}/` },
    { id: 'walmart', label: 'Walmart', names: ['walmart'], url: 'https://www.walmart.com/' },
    { id: 'wholefoods', label: 'Whole Foods Market', names: ['whole foods market', 'whole foods', 'wholefoods'], url: 'https://www.wholefoodsmarket.com/' },
    { id: 'target', label: 'Target', names: ['target'], url: 'https://www.target.com/', ambiguous: true },
    { id: 'costco', label: 'Costco', names: ['costco'], url: 'https://www.costco.com/' },
    { id: 'bestbuy', label: 'Best Buy', names: ['best buy', 'bestbuy'], url: 'https://www.bestbuy.com/' },
    { id: 'homedepot', label: 'The Home Depot', names: ['home depot', 'homedepot'], url: 'https://www.homedepot.com/' },
    { id: 'ebay', label: 'eBay', names: ['ebay'], url: 'https://www.ebay.com/' },
    { id: 'etsy', label: 'Etsy', names: ['etsy'], url: 'https://www.etsy.com/' },
    { id: 'mercadolivre', label: 'Mercado Livre', names: ['mercado livre', 'mercadolivre'], url: 'https://www.mercadolivre.com.br/' },
    { id: 'youtube', label: 'YouTube', names: ['youtube', 'you tube'], url: 'https://www.youtube.com/' },
    { id: 'gmail', label: 'Gmail', names: ['gmail'], url: 'https://mail.google.com/' },
    { id: 'googlemaps', label: 'Google Maps', names: ['google maps'], url: 'https://www.google.com/maps' },
    { id: 'googledrive', label: 'Google Drive', names: ['google drive'], url: 'https://drive.google.com/' },
    { id: 'google', label: 'Google', names: ['google'], url: 'https://www.google.com/' },
    { id: 'wikipedia', label: 'Wikipedia', names: ['wikipedia'], url: 'https://www.wikipedia.org/' },
    { id: 'reddit', label: 'Reddit', names: ['reddit'], url: 'https://www.reddit.com/' },
    { id: 'facebook', label: 'Facebook', names: ['facebook'], url: 'https://www.facebook.com/' },
    { id: 'instagram', label: 'Instagram', names: ['instagram'], url: 'https://www.instagram.com/' },
    // Só "twitter": "x" sozinho casa com "click on x" (o botão fechar).
    { id: 'x', label: 'X (Twitter)', names: ['twitter'], url: 'https://x.com/' },
    { id: 'netflix', label: 'Netflix', names: ['netflix'], url: 'https://www.netflix.com/' },
    { id: 'spotify', label: 'Spotify', names: ['spotify'], url: 'https://open.spotify.com/' },
    { id: 'outlook', label: 'Outlook', names: ['outlook'], url: 'https://outlook.live.com/', ambiguous: true },
    { id: 'zillow', label: 'Zillow', names: ['zillow'], url: 'https://www.zillow.com/' },
    { id: 'airbnb', label: 'Airbnb', names: ['airbnb'], url: 'https://www.airbnb.com/' },
    { id: 'expedia', label: 'Expedia', names: ['expedia'], url: 'https://www.expedia.com/' },
    { id: 'craigslist', label: 'Craigslist', names: ['craigslist'], url: 'https://www.craigslist.org/' },
  ];
}

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Nome exato (sem diferença de caixa/acento/espaço) → site oficial. Nome desconhecido → null, nunca palpite. */
export function officialSiteForName(name: string, locale?: string): OfficialSite | null {
  const n = norm(name).replace(/^(the|o|a|el|la)\s+/, '').replace(/\s*(\.com|'s)$/, '');
  if (!n) return null;
  return officialSites(locale).find(s => s.names.includes(n) || norm(s.label) === n) ?? null;
}

// Palavras que, logo antes do nome, dizem "vá a esse site" (en/pt/es). Pra nome ambíguo é obrigatório.
const CUE = String.raw`(?:go(?:es|ing)?\s+(?:to|on(?:to)?)|browse\s+(?:to|on)?|navigate\s+to|head(?:\s+over)?\s+to|open(?:\s+up)?|visit|launch|log\s*in\s+to|sign\s+in\s+to|on|at|from|search|ir\s+(?:para|pra|ao|no|na)|va[ia]?\s+(?:para|pra|ao|no|na)|abr[aei]r?|abre|acess[aeo]r?|entr[aeo]r?\s+(?:no|na|em)|no|na|em|en|al|desde|ve\s+a)`;

/**
 * O comando nomeia um site da lista? Devolve o mais específico ("google maps" antes de "google").
 * Nome ambíguo só conta depois de uma deixa ("go to indeed", "on target", "abra o outlook").
 */
export function namedOfficialSite(command: string, locale?: string): OfficialSite | null {
  const c = norm(command);
  if (!c) return null;
  let best: { site: OfficialSite; len: number } | null = null;
  for (const site of officialSites(locale)) {
    for (const name of site.names) {
      const word = `(?<![\\w.@/-])${esc(name)}(?:'s)?(?![\\w@-]|\\.\\w)`;
      const re = site.ambiguous
        ? new RegExp(`(?:^|\\W)${CUE}\\s+(?:the\\s+|o\\s+|a\\s+|el\\s+|la\\s+)?${word}`)
        : new RegExp(word);
      if (re.test(c) && (!best || name.length > best.len)) best = { site, len: name.length };
    }
  }
  return best?.site ?? null;
}

/** Bloco pro prompt do agente: a lista curada, pra navegar direto em vez de buscar o nome. */
export function officialSitesPromptBlock(locale?: string): string {
  return [
    'OFFICIAL SITES (verified addresses — when the user names one of these, navigate straight to it; never web_search its name):',
    officialSites(locale).map(s => `${s.id}: ${s.url}`).join(' | '),
  ].join('\n');
}

/** Dica do primeiro passo quando o comando nomeia um site da lista (o modelo decide; isto só poupa a busca). */
export function namedSiteHint(command: string, locale?: string): string {
  const site = namedOfficialSite(command, locale);
  if (!site) return '';
  return `NAMED SITE: the user named ${site.label}; its official address is ${site.url}. If the task needs that site, open it directly with navigate (or new_tab) as your first action — do NOT web_search its name.`;
}
