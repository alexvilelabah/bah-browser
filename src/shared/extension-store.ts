// Página de uma extensão na Chrome Web Store → o ID dela. Puro (main e renderer usam): o main pega o
// ID do endereço da aba pra instalar; a barra mostra "Adicionar ao Bah" só nessas páginas.

export const STORE_ORIGIN = 'https://chromewebstore.google.com';

/** ID da extensão se o endereço é a página dela na loja (origem EXATA); senão ''. */
export function storeDetailId(url: unknown): string {
  if (typeof url !== 'string') return '';
  let u: URL;
  try { u = new URL(url); } catch { return ''; }
  if (u.origin !== STORE_ORIGIN) return '';
  const m = /^\/detail\/(?:[^/]+\/)?([a-p]{32})(?:\/|$)/.exec(u.pathname);
  return m ? m[1] : '';
}
