// Mecanismo de pesquisa escolhido (⋮ → Mecanismo de pesquisa). Fica no localStorage como os
// outros ajustes da interface; quem não tem a chave (todo mundo até aqui) continua no Google.
// O main recebe uma cópia pro "Pesquisar no … por" do clique direito — empurrada ao abrir e
// a cada troca (de mecanismo ou de idioma). A regra pura está em shared/search-engines.ts.
import {
  normalizeSearchSetting, buildSearchUrl, engineHome, engineName, isEngineHome,
  type SearchEngineSetting,
} from '../shared/search-engines';
import { getLang, googleLocaleParams, onLangChange } from './i18n';

const KEY = 'searchEngine';

function load(): SearchEngineSetting {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeSearchSetting(raw ? JSON.parse(raw) : null);
  } catch { return normalizeSearchSetting(null); }
}

let current: SearchEngineSetting = load();
const listeners = new Set<() => void>();

function pushToMain(): void {
  try { (window as any).electronAPI?.setSearchEngine?.(current, googleLocaleParams()); } catch {}
}

export function getSearchEngine(): SearchEngineSetting { return current; }

/** Troca o mecanismo: vale na hora (barra, sugestões, clique direito, novas abas). */
export function setSearchEngine(next: SearchEngineSetting): void {
  current = normalizeSearchSetting(next);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  pushToMain();
  listeners.forEach(fn => { try { fn(); } catch {} });
}

export function onSearchEngineChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** O main fica sabendo do mecanismo ao abrir; o Google do clique direito segue o idioma. */
export function syncSearchEngineToMain(): void { pushToMain(); }
onLangChange(pushToMain);

/** Endereço da busca do que a pessoa digitou. */
export function searchUrlFor(query: string): string {
  return buildSearchUrl(current, query, { googleLocale: googleLocaleParams() });
}

/** Página da nova aba (a inicial do mecanismo, no idioma da interface). */
export function newTabUrl(): string { return engineHome(current, getLang()); }

export function searchEngineName(): string { return engineName(current); }

/** Página inicial de um mecanismo pronto = "nova aba" (a barra mostra o placeholder). */
export function isNewTabPage(url?: string): boolean { return isEngineHome(url); }
