// "A página não carregou": Access Denied / 403 (Akamai — errors.edgesuite.net), "page not found",
// página de erro do Chromium, página em branco, ou cliques que não mudam nada. Genérico (qualquer
// site); numa tarefa de suporte o Bah usa isto pra mandar o agente BUSCAR na web a página que não
// abriu e voltar ao domínio oficial por um resultado — sem insistir no mesmo endereço e sem tentar
// contornar bloqueio. Puro; testado em tests/unit/page-load.test.ts.

export type PageLoadKind = 'access_denied' | 'not_found' | 'error' | 'blank' | 'no_change';
export interface PageLoadProblem { kind: PageLoadKind; detail: string }

export interface PageLoadInput {
  url: string;
  title?: string;
  text?: string;
  elementCount: number;
  /** Última ação (click_ref, navigate…) e se a URL mudou com ela. */
  lastAction?: string;
  urlChanged?: boolean;
  /** Ações seguidas sem efeito visível. */
  noEffectCount?: number;
}

const DENIED = /errors\.edgesuite\.net|\baccess denied\b|you don'?t have permission to access|\b403 forbidden\b|\b(error|http|status) 403\b|^\s*403\s*$|\bforbidden\b|request (was )?blocked|acesso negado|acceso denegado/i;
const NOT_FOUND_TITLE = /\b404\b|page not found|not found|page (does not|doesn'?t|no longer) exist|p[aá]gina n[aã]o encontrada|p[aá]gina no encontrada|we can'?t find (that|the|this) page/i;
const BROWSER_ERROR = /^chrome-error:|this site can.?t be reached|\bERR_[A-Z_]+\b|n[aã]o [eé] poss[ií]vel acessar esse site/i;

/** O que deu errado ao carregar a página, ou null. */
export function pageLoadProblem(i: PageLoadInput): PageLoadProblem | null {
  const title = String(i.title || '').trim();
  const text = String(i.text || '').replace(/\s+/g, ' ').trim();
  const short = text.length < 1500 && i.elementCount < 25;
  if (BROWSER_ERROR.test(i.url) || BROWSER_ERROR.test(title) || (short && BROWSER_ERROR.test(text))) return { kind: 'error', detail: (/\bERR_[A-Z_]+\b/.exec(`${title} ${text}`) || ['the browser could not open it'])[0] };
  // Página de bloqueio É a página inteira (pouco texto); uma notícia que cita "access denied" não é.
  if (DENIED.test(title) || (short && DENIED.test(text))) return { kind: 'access_denied', detail: /edgesuite/i.test(text) ? 'Access Denied (errors.edgesuite.net)' : 'Access Denied / 403' };
  if (NOT_FOUND_TITLE.test(title) || (short && text.length < 600 && NOT_FOUND_TITLE.test(text))) return { kind: 'not_found', detail: 'page not found' };
  if (!/^about:blank/.test(i.url) && text.length < 30 && i.elementCount < 3) return { kind: 'blank', detail: 'blank page' };
  if (/^click/.test(i.lastAction || '') && !i.urlChanged && (i.noEffectCount || 0) >= 2) return { kind: 'no_change', detail: 'the clicks did not change the page' };
  return null;
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

/** Palavras da página que se queria abrir: o texto do link clicado, senão o caminho da URL ("lp/contact-us" → "contact us"). */
export function wantedPageWords(url: string, target?: string): string {
  const t = String(target || '').replace(/^"|"\s+on\s+.*$|"$/g, '').replace(/["“”]/g, '').trim();
  if (t) return t.slice(0, 60);
  let path = '';
  try { path = new URL(url).pathname; } catch {}
  return path.split('/').filter(p => p && !/^[a-z]{2}(-[a-z]{2})?$/i.test(p) && !/^(lp|en|us|home|index\.\w+)$/i.test(p))
    .join(' ').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Linha pro prompt: a página X não carregou → buscar na web e abrir um resultado do domínio oficial.
 * site = o fabricante da tarefa de suporte (quando conhecido).
 */
export function pageLoadHint(p: PageLoadProblem, o: { url: string; target?: string; vendor?: string; domains?: string[]; product?: string }): string {
  const words = wantedPageWords(o.url, o.target) || 'the page you were opening';
  const query = [o.vendor, words, o.product].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const where = o.domains?.length ? `a result on ${o.domains.join(' / ')} (the official site — never another domain)` : 'the result from the official site';
  return `PAGE DID NOT LOAD: ${o.url || hostOf(o.url) || 'the page'} — ${p.detail}${o.target ? ` (you were opening ${o.target})` : ''}. Do not reload it or click the same link again, and never try to get around a block. Find that page another way: { "action": "web_search", "query": "${query}" }, then navigate to ${where} and continue the task from there.`;
}
