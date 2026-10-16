// Aba anônima no main: a sessão só na memória que todas as abas anônimas dividem, o "zerar tudo"
// quando a última delas fecha, e a chave "a IA está trabalhando numa aba anônima" (aí o agent.log
// não recebe os passos dela e a tabela de resultado não vai pro disco). As regras ficam em
// shared/incognito.ts; aqui só o que mexe no Electron.
import { session, webContents, type Session, type WebContents } from 'electron';
import { INCOGNITO_PARTITION } from '../shared/incognito';

/** A sessão das abas anônimas (partição sem "persist:" → nada vai pro disco). */
export function incognitoSession(): Session {
  return session.fromPartition(INCOGNITO_PARTITION);
}

/** Esta página é de uma aba anônima (ou de uma janela aberta por ela)? */
export function isIncognitoWc(wc: WebContents | null | undefined): boolean {
  try { return !!wc && !wc.isDestroyed() && wc.session === incognitoSession(); } catch { return false; }
}

const WAIT_PAGES_MS = 3000;

/**
 * A última aba anônima fechou: zera a sessão anônima inteira (cookies, dados dos sites, service
 * workers, cache, senhas de site digitadas, conexões abertas) — a próxima aba anônima começa limpa.
 * Antes, espera as páginas que estão fechando sumirem de vez (até 3 s): uma resposta atrasada ainda
 * poderia gravar um cookie DEPOIS da limpeza. Os downloads em andamento continuam.
 */
export async function wipeIncognitoSession(): Promise<void> {
  const ses = incognitoSession();
  const alive = () => webContents.getAllWebContents().some(w => { try { return !w.isDestroyed() && w.session === ses; } catch { return false; } });
  const t0 = Date.now();
  while (alive() && Date.now() - t0 < WAIT_PAGES_MS) await new Promise(r => setTimeout(r, 50));
  const steps: Array<() => Promise<unknown>> = [
    // Tudo menos a lista de downloads (download que ainda está baixando não pode sumir do painel).
    () => ses.clearData({ dataTypes: ['backgroundFetch', 'cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'] }),
    () => ses.clearStorageData(),
    () => ses.clearCache(),
    () => ses.clearAuthCache(),
    () => ses.clearCodeCaches({}),
    () => ses.clearHostResolverCache(),
    () => ses.closeAllConnections(),
  ];
  for (const step of steps) { try { await step(); } catch {} }
}

// A IA está trabalhando numa aba anônima agora (o renderer liga no começo da tarefa e desliga no fim).
// Desligar espera um pouco: as últimas linhas de log da tarefa (console da tela) chegam por outro
// caminho e podem vir DEPOIS do aviso de fim — não podem cair no agent.log.
const OFF_DELAY_MS = 2000;
let privateAi = false;
let offTimer: ReturnType<typeof setTimeout> | null = null;
export function setPrivateAi(on: boolean): void {
  if (offTimer) { clearTimeout(offTimer); offTimer = null; }
  if (on) { privateAi = true; return; }
  offTimer = setTimeout(() => { offTimer = null; privateAi = false; }, OFF_DELAY_MS);
}
export function isPrivateAi(): boolean { return privateAi; }
