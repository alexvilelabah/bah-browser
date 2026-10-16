// incognito.ts — regras PURAS da "aba anônima" (a janela anônima do Chrome, só que em ABAS dentro
// da janela única do Bah). Sem React, sem DOM, sem electron: o main, o renderer e os testes
// (tests/unit/incognito.test.ts) usam a MESMA conta.
//  • Sessão: todas as abas anônimas dividem UMA sessão só na memória. O nome da partição não
//    começa com "persist:" — é isso que faz o Electron não gravar cookie, cache nem dado de site
//    nenhum em disco. As abas normais seguem na 'persist:browser'.
//  • A ÚLTIMA aba anônima fechou (as escondidas, de trabalho da IA, contam) → a sessão é zerada
//    (cookies, cache, logins): a próxima aba anônima começa limpa, igual ao Chrome. Fechar o Bah
//    apaga tudo de qualquer jeito (memória).
//  • De onde nasce aba anônima: Ctrl+Shift+N, ⋮ → Nova aba anônima e "Abrir link em aba anônima"
//    sempre; o que é aberto A PARTIR de uma aba (popup, link, Duplicar, a IA trabalhando nela)
//    herda dela. Ctrl+T / "+" é sempre aba normal; extensão, monitor e "Continuar de onde parou"
//    também (extensão não roda em aba anônima, igual ao Chrome).
//  • Nada que vem de aba anônima entra no que fica guardado (histórico, sessão salva, abas
//    fechadas, ícones, o que a IA aprende…). Downloads e favoritos continuam salvos (o Chrome
//    também guarda os dois).
//  • Memory Saver nunca põe aba anônima pra dormir.

export const BROWSER_PARTITION = 'persist:browser';
export const INCOGNITO_PARTITION = 'bah-anonima';

/** Partição da <webview> da aba. */
export function partitionFor(incognito?: boolean): string {
  return incognito ? INCOGNITO_PARTITION : BROWSER_PARTITION;
}

/** A partição mora só na memória? (o Electron só grava em disco as "persist:") */
export function isInMemoryPartition(partition: string): boolean {
  return !/^persist:/i.test(partition);
}

export interface PrivacyTab { incognito?: boolean }

/** Quantas abas anônimas existem (as escondidas, de trabalho da IA, também). */
export function incognitoCount(tabs: readonly PrivacyTab[]): number {
  let n = 0;
  for (const t of tabs) if (t.incognito) n++;
  return n;
}

/** A última aba anônima acabou de fechar: hora de zerar a sessão anônima. */
export function lastIncognitoClosed(before: number, after: number): boolean {
  return before > 0 && after === 0;
}

/** De onde vem o pedido de aba nova. */
export type TabSource =
  | 'new-tab'     // Ctrl+T, "+", aba nova quando a última fecha
  | 'incognito'   // Ctrl+Shift+N, ⋮ → Nova aba anônima, "Abrir link em aba anônima"
  | 'from-tab'    // popup, link, Duplicar, Nova aba à direita, favorito em aba nova, a IA
  | 'extension'   // chrome.tabs.create
  | 'monitor'     // clique no aviso de um monitor
  | 'restore';    // Continuar de onde parou / fixadas da última vez

/** A aba nova nasce anônima? openerIncognito = a aba de onde ela saiu é anônima. */
export function opensIncognito(source: TabSource, openerIncognito = false): boolean {
  if (source === 'incognito') return true;
  if (source === 'from-tab') return openerIncognito;
  return false;
}

/** Tudo o que o Bah guarda e que poderia receber algo de uma aba anônima. */
export type TraceStore =
  | 'history'          // histórico (Ctrl+H) — também é o que a barra de endereço "aprende"
  | 'session'          // Continuar de onde parou (session.v1)
  | 'closedTabs'       // Ctrl+Shift+T
  | 'favicons'         // favicons.json (ícones dos favoritos)
  | 'siteKnowledge'    // o que a IA aprende de cada site
  | 'macro'            // a última sequência da IA ("repetir")
  | 'agentRuns'        // registro das tarefas da IA (e o dataset opcional)
  | 'agentLog'         // agent.log (diagnóstico) com os passos da IA
  | 'resultPages'      // tabelas/páginas de resultado da IA gravadas em userData/views
  | 'sitePermissions'  // site-permissions.json (Permitir/Bloquear)
  | 'siteMute'         // Desativar som do site
  | 'downloads'        // os arquivos baixados
  | 'favorites';       // os favoritos

// true = continua guardando mesmo vindo de aba anônima (igual ao Chrome).
const KEPT_FROM_INCOGNITO: Record<TraceStore, boolean> = {
  history: false, session: false, closedTabs: false, favicons: false,
  siteKnowledge: false, macro: false, agentRuns: false, agentLog: false, resultPages: false,
  sitePermissions: false, siteMute: false,
  downloads: true, favorites: true,
};

/** Pode gravar isto? incognito = veio de aba anônima (ou a IA está trabalhando numa). */
export function mayRecord(store: TraceStore, incognito: boolean | undefined): boolean {
  return !incognito || KEPT_FROM_INCOGNITO[store] === true;
}

/** Memory Saver: aba anônima nunca dorme (acordar recarrega a página e perde o que só ela tinha). */
export function canDiscard(tab: PrivacyTab & { hidden?: boolean }): boolean {
  return !tab.incognito && !tab.hidden;
}

/** Aba anônima ainda na página de explicação (nada aberto nela ainda). */
export function isIncognitoBlank(url: string | undefined | null): boolean {
  return !url || url === 'about:blank';
}
