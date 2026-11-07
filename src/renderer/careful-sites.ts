// Sites "cuidadosos": os termos proíbem navegação automatizada e o site pune a conta (ex.:
// LinkedIn). Neles o agente faz no máximo UMA navegação por pedido (a página que a pessoa pediu,
// igual ela digitar o endereço) + leitura; clique/digitação/scroll/paginação ficam com a pessoa.
// Lista curta de política (não é lista de "todos os sites") + os que a pessoa acrescentar.
const DEFAULT_CAREFUL = ['linkedin.com'];

export function carefulHosts(): string[] {
  let extra: string[] = [];
  try { extra = JSON.parse(localStorage.getItem('carefulSites') || '[]'); } catch {}
  return [...DEFAULT_CAREFUL, ...extra.filter(x => typeof x === 'string')].map(h => h.toLowerCase().replace(/^www\./, ''));
}

export function isCarefulHost(host: string, list = carefulHosts()): boolean {
  const h = (host || '').toLowerCase().replace(/^www\./, '');
  return !!h && list.some(d => h === d || h.endsWith('.' + d));
}

/** Ações permitidas num site cuidadoso (além da 1ª navegação): só ler/relatar/organizar. */
export const CAREFUL_ALLOWED = new Set(['extract_text', 'look_at', 'report', 'done', 'render_view', 'store', 'plan', 'wait', 'web_search', 'list_downloads']);
