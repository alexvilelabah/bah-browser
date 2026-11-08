// chat-history.ts — regras PURAS do que das conversas vai pro disco. Sem React, sem DOM, sem
// electron: o renderer (renderer/threads.ts), o main (main/chat-store.ts) e os testes
// (tests/unit/chat-history.test.ts) usam a MESMA conta.
// Duas coisas diferentes, como no navegador:
//  • a conversa VIVA (threads + nome/cor/abas das sessões): volta ao abrir o Bah SÓ com ⋮ → Ao abrir
//    o Bah = "Continuar de onde parou" (startupMode 'restore'), presa às abas que voltam;
//  • o 🕘 HISTÓRICO de conversas: as sessões passadas (nome, cor, data, sites, 1º pedido), guardado
//    com qualquer escolha, como o histórico de navegação; sai no "Limpar dados de navegação".
// Aba anônima nunca entra em nenhum dos dois. Tetos de quantidade e de tamanho nos dois.

import type { AgentSession } from './agent-sessions.ts';
import { isSessionColor } from './agent-sessions.ts';
import { firstRequest, isEmptyThread, sanitizeThread, type Thread } from './thread-store.ts';
import type { StartupMode } from './session-restore.ts';

export const MAX_HISTORY = 100;
export const MAX_HISTORY_BYTES = 2_000_000;
export const MAX_LIVE_THREADS = 60;
export const MAX_LIVE_BYTES = 1_500_000;
export const MAX_HISTORY_SITES = 8;
export const MAX_HISTORY_TABS = 20;

/** O que interessa de uma aba viva. */
export interface LiveTab { id: string; url: string; title?: string; sessionId?: string; incognito?: boolean; hidden?: boolean }

export interface LiveState { sessions: AgentSession[]; threads: Thread[] }

export interface ChatHistoryEntry {
  id: string;            // o id da sessão
  name: string;
  color: string;
  startedAt: number;
  endedAt: number;       // última atividade
  sites: string[];
  firstRequest: string;
  tabs: Array<{ url: string; title: string }>;
  thread: Thread;
}
/** Linha da lista (sem a conversa inteira). */
export type ChatHistoryRow = Omit<ChatHistoryEntry, 'thread'> & { turns: number };

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isWeb = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 4096;

/** Sessões com alguma aba anônima: nada delas vai pro disco. */
function incognitoKeys(tabs: readonly LiveTab[]): Set<string> {
  const out = new Set<string>();
  for (const t of tabs) if (t.incognito) { out.add(t.id); if (t.sessionId) out.add(t.sessionId); }
  return out;
}

/**
 * A conversa viva que vai pro disco: as threads das abas da barra (sessão ou aba sem sessão) e as
 * sessões que ainda têm aba. Nada anônimo, nada de aba escondida (trabalho do agente), sem thread vazia.
 */
export function liveToSave(threads: readonly Thread[], sessions: readonly AgentSession[], tabs: readonly LiveTab[]): LiveState {
  const secret = incognitoKeys(tabs);
  const visible = tabs.filter(t => !t.hidden && !t.incognito);
  const keys = new Set(visible.map(t => t.sessionId || t.id));
  const liveSessions = sessions.filter(s => keys.has(s.id) && !secret.has(s.id));
  const kept = threads
    .filter(t => keys.has(t.key) && !secret.has(t.key) && !isEmptyThread(t))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_LIVE_THREADS);
  // Teto de tamanho: sai a conversa parada há mais tempo.
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_LIVE_BYTES) kept.pop();
  return { sessions: liveSessions, threads: kept };
}

/** O que veio do disco → só o que presta. */
export function sanitizeLive(raw: unknown): LiveState {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const sessions: AgentSession[] = Array.isArray(r.sessions)
    ? r.sessions.map((s: any) => (s && typeof s.id === 'string' && s.id.length <= 64 && typeof s.name === 'string' && isSessionColor(s.color)
      ? { id: s.id, name: s.name.slice(0, 40), color: s.color, createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0 } : null))
      .filter((s): s is AgentSession => !!s)
    : [];
  const threads = Array.isArray(r.threads) ? r.threads.slice(0, MAX_LIVE_THREADS).map(sanitizeThread).filter((t): t is Thread => !!t) : [];
  return { sessions, threads };
}

/** No boot: a conversa salva só volta com "Continuar de onde parou". */
export function liveToRestore(mode: StartupMode, saved: LiveState | null): LiveState | null {
  if (mode !== 'restore' || !saved) return null;
  return saved.sessions.length || saved.threads.length ? saved : null;
}

/** Entrada do histórico para uma sessão viva. null = nada a guardar (vazia ou anônima). */
export function historyEntryFor(session: AgentSession, thread: Thread | undefined, tabs: readonly LiveTab[], now = Date.now()): ChatHistoryEntry | null {
  if (!thread || isEmptyThread(thread)) return null;
  const mine = tabs.filter(t => t.sessionId === session.id && !t.hidden);
  if (mine.some(t => t.incognito)) return null;
  const sites: string[] = [];
  const add = (h: string) => { if (h && !sites.includes(h) && sites.length < MAX_HISTORY_SITES) sites.push(h); };
  for (const t of mine) if (isWeb(t.url)) add(hostOf(t.url));
  for (const e of thread.entries) if (e.kind === 'task' && e.target) { const m = / on ([a-z0-9.-]+\.[a-z]{2,})\b/i.exec(e.target); if (m) add(m[1].toLowerCase()); }
  return {
    id: session.id,
    name: session.name,
    color: session.color,
    startedAt: session.createdAt || thread.entries[0]?.at || now,
    endedAt: thread.updatedAt || now,
    sites,
    firstRequest: firstRequest(thread).slice(0, 200),
    tabs: mine.filter(t => isWeb(t.url)).slice(0, MAX_HISTORY_TABS).map(t => ({ url: t.url, title: String(t.title || '').slice(0, 200) })),
    thread,
  };
}

/** Uma sessão que continua viva atualiza a mesma entrada; a mais recente primeiro; tetos. A lista de
 *  abas e de sites de quem já fechou tudo fica a que estava (fechar não apaga de onde ela andou). */
export function upsertHistory(list: readonly ChatHistoryEntry[], entry: ChatHistoryEntry): ChatHistoryEntry[] {
  const old = list.find(e => e.id === entry.id);
  const merged: ChatHistoryEntry = old ? {
    ...entry,
    startedAt: Math.min(old.startedAt || entry.startedAt, entry.startedAt || old.startedAt),
    tabs: entry.tabs.length ? entry.tabs : old.tabs,
    sites: [...new Set([...entry.sites, ...old.sites])].slice(0, MAX_HISTORY_SITES),
    firstRequest: old.firstRequest || entry.firstRequest,
  } : entry;
  return capHistory([merged, ...list.filter(e => e.id !== entry.id)]);
}

export function capHistory(list: readonly ChatHistoryEntry[]): ChatHistoryEntry[] {
  const out = [...list].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_HISTORY);
  while (out.length > 1 && JSON.stringify(out).length > MAX_HISTORY_BYTES) out.pop();
  return out;
}

export function sanitizeHistory(raw: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatHistoryEntry[] = [];
  for (const r of raw.slice(0, MAX_HISTORY * 2) as any[]) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length > 64) continue;
    const thread = sanitizeThread(r.thread);
    if (!thread) continue;
    out.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name.slice(0, 40) : 'Session',
      color: isSessionColor(r.color) ? r.color : 'grey',
      startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0,
      endedAt: typeof r.endedAt === 'number' ? r.endedAt : 0,
      sites: Array.isArray(r.sites) ? r.sites.filter((s: unknown) => typeof s === 'string').slice(0, MAX_HISTORY_SITES).map((s: string) => s.slice(0, 120)) : [],
      firstRequest: typeof r.firstRequest === 'string' ? r.firstRequest.slice(0, 200) : '',
      tabs: Array.isArray(r.tabs) ? r.tabs.filter((t: any) => t && isWeb(t.url)).slice(0, MAX_HISTORY_TABS).map((t: any) => ({ url: t.url, title: typeof t.title === 'string' ? t.title.slice(0, 200) : '' })) : [],
      thread,
    });
  }
  return capHistory(out);
}

export function historyRows(list: readonly ChatHistoryEntry[]): ChatHistoryRow[] {
  return list.map(({ thread, ...row }) => ({ ...row, turns: thread.entries.length + thread.folded }));
}

/** "Limpar dados de navegação" com período: sai o que teve atividade a partir de `since`. */
export function removeHistorySince(list: readonly ChatHistoryEntry[], since: number): ChatHistoryEntry[] {
  if (since === -Infinity) return [];
  return list.filter(e => !(e.endedAt >= since));
}
