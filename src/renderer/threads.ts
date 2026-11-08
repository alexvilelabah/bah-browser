// A conversa (thread) de cada sessão do assistente, na tela. Regras puras em shared/thread-store.ts
// (o que guardar, orçamento, compactação) e shared/chat-history.ts (o que vai pro disco).
//  • Uma thread por chave (sessão, ou aba sem sessão). O chat (AgentCommandBar) e o agente (App.tsx,
//    no fim de cada tarefa) escrevem aqui; os dois leem daqui o bloco que vai no prompt.
//  • Orçamento fixo por prompt (~15% da janela do modelo). Nos 80% o feed avisa (com 📌 pra fixar);
//    passou → os itens mais velhos viram resumo e o feed diz quantos e mostra o texto que ficou no
//    lugar. Nada é cortado em silêncio. "/compact" e o 🗑 fazem o mesmo, avisando igual.
//  • Os avisos vão pro feed por evento ('bah:thread-notice'); o uso da última chamada vai pro
//    medidor de contexto ('bah:context-usage').
//  • Disco: a cada mudança (no máximo a cada 1,5 s) e na hora de fechar a janela, o estado vivo vai
//    pro main (main/chat-store.ts), que cifra e guarda; o histórico de conversas sai daí.
import {
  emptyThread, addTurn, addTask, setFact, pinEntry, renderThread, threadTokens, threadBudgetFor, budgetLevel,
  compactThread, clearThread, mergeThreads, foldCandidates, entryText, estimateTokens, isEmptyThread,
  type Thread, type TaskInput,
} from '../shared/thread-store';
import type { AgentSession } from '../shared/agent-sessions';
import type { LiveTab } from '../shared/chat-history';
import type { ContextUsage } from '../shared/context-meter';
import { onSessionClose } from './session';

const threads = new Map<string, Thread>();
const warned = new Set<string>();
let windowTokens: number | undefined;

export type ThreadNotice =
  | { key: string; kind: 'warn'; tokens: number; budget: number; candidates: Array<{ id: string; text: string }> }
  | { key: string; kind: 'compacted'; folded: number; text: string; dropped: number; manual: boolean }
  | { key: string; kind: 'cleared'; removed: number; text: string }
  | { key: string; kind: 'trimmed' }
  | { key: string; kind: 'pinned'; text: string };

function emit(n: ThreadNotice): void {
  try { window.dispatchEvent(new CustomEvent('bah:thread-notice', { detail: n })); } catch {}
}

/** Janela do modelo (detecção do engine) → orçamento da thread. */
export function setContextWindow(n: number | undefined | null): void {
  windowTokens = typeof n === 'number' && n > 0 ? n : undefined;
  try { window.dispatchEvent(new CustomEvent('bah:context-window', { detail: windowTokens ?? 0 })); } catch {}
}
export function contextWindow(): number { return windowTokens ?? 0; }

/** Orçamento da thread por prompt. Gancho de teste: window.__bahThreadBudget (e2e força um orçamento minúsculo). */
export function threadBudget(): number {
  const o = (window as any).__bahThreadBudget;
  return typeof o === 'number' && o > 0 ? o : threadBudgetFor(windowTokens);
}

export function getThread(key: string): Thread | undefined { return threads.get(key); }

function put(key: string, t: Thread): void {
  threads.set(key, t);
  try { window.dispatchEvent(new CustomEvent('bah:thread-changed', { detail: { key } })); } catch {}
  scheduleSave();
}

/** Depois de escrever: passou do orçamento → compacta (avisando); nos 80% → avisa uma vez. */
function fit(key: string): void {
  const t = threads.get(key);
  if (!t) return;
  const budget = threadBudget();
  const level = budgetLevel(threadTokens(t), budget);
  if (level === 'over') {
    const r = compactThread(t, budget);
    if (r.folded) {
      put(key, r.thread);
      warned.delete(key);
      emit({ key, kind: 'compacted', folded: r.folded, text: r.added, dropped: r.dropped, manual: false });
    }
    return;
  }
  if (level === 'warn' && !warned.has(key)) {
    const candidates = foldCandidates(t).map(e => ({ id: e.id, text: entryText(e).replace(/^- /, '').slice(0, 160) }));
    if (!candidates.length) return;
    warned.add(key);
    emit({ key, kind: 'warn', tokens: threadTokens(t), budget, candidates });
  } else if (level === 'ok') warned.delete(key);
}

const cur = (key: string) => threads.get(key) ?? emptyThread(key);

/** Uma troca do chat (pergunta + resposta). Resposta vazia (erro) → só a pergunta. */
export function noteExchange(key: string, user: string, reply?: string): void {
  let t = addTurn(cur(key), 'user', user);
  if (reply) t = addTurn(t, 'assistant', reply);
  put(key, t);
  fit(key);
}

/** Fim de uma tarefa do agente: o resumo dela (não cada passo). */
export function noteTask(key: string, task: TaskInput): void {
  put(key, addTask(cur(key), task));
  fit(key);
}

/** Fato solto (entrou no site, vaga vista…). Mesma chave substitui. */
export function noteFact(key: string, factKey: string, text: string, pinned?: boolean): void {
  const before = threads.get(key)?.facts.find(f => f.key === factKey);
  if (before && before.text === text && (pinned === undefined || !!before.pinned === pinned)) return;
  put(key, setFact(cur(key), factKey, text, { pinned }));
  fit(key);
}

/** 📌 Fixa um item: nunca vai pro resumo. */
export function pin(key: string, entryId: string): void {
  const t = threads.get(key);
  const e = t?.entries.find(x => x.id === entryId);
  if (!t || !e || e.pinned) return;
  put(key, pinEntry(t, entryId));
  emit({ key, kind: 'pinned', text: entryText(e).replace(/^- /, '').slice(0, 160) });
}

/** "/compact": dobra agora tudo o que pode (avisando no feed, como a automática). */
export function compactNow(key: string): number {
  const t = threads.get(key);
  if (!t) { emit({ key, kind: 'compacted', folded: 0, text: '', dropped: 0, manual: true }); return 0; }
  const r = compactThread(t, threadBudget(), { force: true });
  if (r.folded) { put(key, r.thread); warned.delete(key); }
  emit({ key, kind: 'compacted', folded: r.folded, text: r.added, dropped: r.dropped, manual: true });
  return r.folded;
}

/** 🗑: tudo sai, menos o 📌 fixado — e o feed diz o que saiu. */
export function clear(key: string): void {
  const t = threads.get(key);
  if (!t || isEmptyThread(t)) return;
  const r = clearThread(t);
  if (isEmptyThread(r.thread)) threads.delete(key); else threads.set(key, r.thread);
  warned.delete(key);
  scheduleSave();
  try { window.dispatchEvent(new CustomEvent('bah:thread-changed', { detail: { key } })); } catch {}
  if (r.removed) emit({ key, kind: 'cleared', removed: r.removed, text: r.text });
}

/** O bloco que vai no prompt (já dentro do orçamento). '' sem conversa. */
export function promptBlock(key: string): string {
  fit(key);
  return renderThread(threads.get(key));
}

export function threadTokensOf(key: string): number { return threadTokens(threads.get(key)); }

/** A página foi cortada pra caber (a thread nunca é). Um aviso por conversa + motivo (a tarefa, ou o
 *  endereço no chat): página longa não vira um ✂️ a cada pergunta. */
const trimmedSeen = new Set<string>();
export function noteTrimmed(key: string, tag = ''): void {
  const k = `${key}|${tag}`;
  if (trimmedSeen.has(k)) return;
  trimmedSeen.add(k);
  if (trimmedSeen.size > 500) trimmedSeen.clear();
  emit({ key, kind: 'trimmed' });
}

// ── Medidor de contexto: o uso da última chamada por conversa ──
const usage = new Map<string, ContextUsage>();
export function noteUsage(key: string, u: ContextUsage): void {
  usage.set(key, u);
  try { window.dispatchEvent(new CustomEvent('bah:context-usage', { detail: { key } })); } catch {}
}
export function usageOf(key: string): ContextUsage | undefined { return usage.get(key); }
export { estimateTokens };

// ── Chave nova / conversa que sai ──
// A aba ganhou sessão ou entrou em outra (store.ts → 'bah:move-thread'): a conversa vai junto.
window.addEventListener('bah:move-thread', (e: Event) => {
  const { from, to } = (e as CustomEvent).detail || {};
  if (!from || !to || from === to) return;
  const a = threads.get(from);
  threads.delete(from);
  const u = usage.get(from); usage.delete(from); if (u && !usage.has(to)) usage.set(to, u);
  warned.delete(from);
  if (!a) return;
  const b = threads.get(to);
  put(to, b ? mergeThreads(b, a) : { ...a, key: to });
});

/** Conversa sem aba nenhuma: grava o que tiver (vai pro histórico) e solta da memória. */
export function dropThread(key: string): void {
  if (!threads.has(key)) return;
  flushSave();
  threads.delete(key);
  usage.delete(key);
  warned.delete(key);
}

/** Conversas que voltaram (Continuar de onde parou, ou Retomar do histórico). */
export function hydrate(list: readonly Thread[]): void {
  for (const t of list) if (!isEmptyThread(t)) threads.set(t.key, t);
  try { window.dispatchEvent(new CustomEvent('bah:thread-hydrated', { detail: { keys: list.map(t => t.key) } })); } catch {}
}
export function hydratedKeys(): string[] { return [...threads.keys()]; }

// ── Disco ──
let liveSource: (() => { sessions: AgentSession[]; tabs: readonly LiveTab[] }) | null = null;
export function setLiveSource(fn: () => { sessions: AgentSession[]; tabs: readonly LiveTab[] }): void { liveSource = fn; }

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(flushSave, 1500);
}

/** Manda o estado vivo pro main agora. Aba anônima vai sem endereço nem nome (o main só precisa saber
 *  que ela existe, pra deixar a sessão dela fora do disco). */
export function flushSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!liveSource) return;
  try {
    const { sessions, tabs } = liveSource();
    const slim = tabs.map(t => (t.incognito
      ? { id: t.id, url: '', sessionId: t.sessionId, incognito: true }
      : { id: t.id, url: t.url, title: t.title, sessionId: t.sessionId, hidden: t.hidden }));
    const secret = new Set(tabs.filter(t => t.incognito).flatMap(t => [t.id, t.sessionId].filter(Boolean) as string[]));
    const list = [...threads.values()].filter(t => !secret.has(t.key));
    window.electronAPI?.threadsSaveLive?.({ sessions, threads: list, tabs: slim });
  } catch {}
}

// Ao fechar a janela: grava junto com a sessão de abas, ANTES do "gravei" dela (renderer/session.ts).
onSessionClose(flushSave);
