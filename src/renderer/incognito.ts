// Aba anônima no renderer (as regras ficam em shared/incognito.ts):
//  • Zerar a sessão anônima quando a última aba anônima fecha (o main apaga cookies, cache e
//    logins) e segurar a PRÓXIMA aba anônima até isso terminar — senão ela nasceria na sessão
//    velha, no meio da limpeza.
//  • A "sonda" que diz se a IA está trabalhando numa aba anônima agora: aí nada do que ela vê ou
//    faz vai pros guardados dela (o que aprende dos sites, a sequência do "repetir", o registro
//    das tarefas). Quem liga a sonda é o App, que sabe qual aba a IA está usando.
import { mayRecord, type TraceStore } from '../shared/incognito';

let wiping: Promise<void> | null = null;

/** A última aba anônima fechou: pede pro main zerar a sessão anônima. */
export function wipeIncognitoSession(): void {
  const api = (window as any).electronAPI;
  const p: Promise<void> = Promise.resolve()
    .then(() => api?.incognitoWipe?.())
    .then(() => {}, () => {});
  wiping = p;
  void p.then(() => { if (wiping === p) wiping = null; });
}

/** Resolve quando a sessão anônima está pronta pra uma aba nova (limpeza terminada). */
export function incognitoReady(): Promise<void> {
  return wiping ?? Promise.resolve();
}

let aiOnIncognito: () => boolean = () => false;

/** O App diz como saber se a IA está numa aba anônima agora. */
export function setAiIncognitoProbe(fn: () => boolean): void {
  aiOnIncognito = fn;
}

/** A IA pode guardar isto agora? (não, se ela está trabalhando numa aba anônima) */
export function aiMayRecord(store: TraceStore): boolean {
  let incognito = false;
  try { incognito = aiOnIncognito(); } catch {}
  return mayRecord(store, incognito);
}
