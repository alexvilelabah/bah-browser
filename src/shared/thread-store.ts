// thread-store.ts — regras PURAS da conversa (thread) de uma sessão do assistente. Sem React, sem
// DOM, sem electron: o renderer (renderer/threads.ts), o main (main/chat-store.ts) e os testes
// (tests/unit/thread-store.test.ts) usam a MESMA conta.
// Antes a memória de uma sessão estava em três lugares (o histórico de chat do main, os 5 pedidos
// recentes do agente e o feed do painel), cada um com o seu teto, e nenhum sabia dos outros. Agora é
// UMA thread por chave (id da sessão, ou da aba sem sessão), e tanto o chat quanto o agente leem e
// escrevem nela:
//  • turnos: o que a pessoa pediu e o que o chat respondeu (os recentes, palavra por palavra);
//  • tarefas do agente: objetivo, passos-chave, achados, desfecho, o último alvo — nunca cada passo;
//  • fatos: coisas soltas que valem lembrar (site em que entrou, vaga vista…) e os 📌 fixados.
// Um modelo local pequeno (8B no llama.cpp, janela de 8k–32k) não aguenta conversa sem fim: a thread
// tem um ORÇAMENTO fixo de tokens por prompt, e a página atual nunca perde espaço pra ela. Passou do
// orçamento → os turnos mais velhos viram um resumo, e isso aparece no feed (nunca em silêncio).
// 📌 fixado nunca é resumido.

export type ThreadEntry =
  | { id: string; kind: 'user'; text: string; at: number; pinned?: boolean }
  | { id: string; kind: 'assistant'; text: string; at: number; pinned?: boolean }
  | {
      id: string; kind: 'task'; goal: string; status: string; outcome: string;
      steps?: string[]; findings?: string; target?: string; at: number; pinned?: boolean;
    };

export interface ThreadFact { key: string; text: string; at: number; pinned?: boolean }

export interface Thread {
  key: string;
  /** Resumo corrido do que já foi compactado (o texto que substituiu os turnos velhos). */
  summary: string;
  entries: ThreadEntry[];
  facts: ThreadFact[];
  /** Quantos itens já foram dobrados no resumo, no total. */
  folded: number;
  updatedAt: number;
}

// Tetos por item: o recente vai "palavra por palavra", mas uma resposta de 5 páginas não.
export const MAX_USER_CHARS = 500;
export const MAX_ASSISTANT_CHARS = 800;
export const MAX_GOAL_CHARS = 300;
export const MAX_OUTCOME_CHARS = 300;
export const MAX_STEP_CHARS = 100;
export const MAX_STEPS = 4;
export const MAX_TARGET_CHARS = 160;
export const MAX_FACT_CHARS = 200;
export const MAX_FACTS = 30;
export const MAX_ENTRIES = 80;          // teto duro (a compactação costuma agir bem antes)
export const MAX_SUMMARY_CHARS = 6000;
/** Os N itens mais recentes nunca são dobrados no resumo. */
export const KEEP_RECENT = 2;
/** Fração do orçamento a partir da qual o feed avisa. */
export const WARN_RATIO = 0.8;
/** Depois de compactar, a thread fica em no máximo esta fração do orçamento. */
const COMPACT_TARGET = 0.5;
/** O resumo em si não passa desta fração do orçamento (as linhas mais velhas dele saem). */
const SUMMARY_SHARE = 0.35;

/** Mesma conta do main (local-providers.ts estimateTokens): ~4 caracteres por token. Estimativa. */
export function estimateTokens(text: string): number {
  return Math.ceil(String(text || '').length / 4);
}

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

let seq = 0;
const newId = (now: number) => `e${now.toString(36)}${(seq++).toString(36)}`;

export function emptyThread(key: string, now = Date.now()): Thread {
  return { key, summary: '', entries: [], facts: [], folded: 0, updatedAt: now };
}

export function isEmptyThread(t: Thread | null | undefined): boolean {
  return !t || (!t.entries.length && !t.summary && !t.facts.length);
}

function capEntries(entries: ThreadEntry[]): ThreadEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  // Teto duro: sai o mais velho NÃO fixado (o fixado fica).
  const out = entries.slice();
  while (out.length > MAX_ENTRIES) {
    const i = out.findIndex(e => !e.pinned);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

/** Turno de conversa (pedido da pessoa ou resposta do chat). Vazio → nada muda. */
export function addTurn(t: Thread, role: 'user' | 'assistant', text: string, now = Date.now()): Thread {
  const clean = clip(text, role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS);
  if (!clean) return t;
  const e: ThreadEntry = { id: newId(now), kind: role, text: clean, at: now };
  return { ...t, entries: capEntries([...t.entries, e]), updatedAt: now };
}

export interface TaskInput { goal: string; status: string; outcome?: string; steps?: string[]; findings?: string; target?: string }

/** Resumo de uma tarefa do agente (não cada passo). */
export function addTask(t: Thread, task: TaskInput, now = Date.now()): Thread {
  const goal = clip(task.goal, MAX_GOAL_CHARS);
  if (!goal) return t;
  const steps = (task.steps || []).map(s => clip(s, MAX_STEP_CHARS)).filter(Boolean).slice(-MAX_STEPS);
  const e: ThreadEntry = {
    id: newId(now), kind: 'task', goal, status: clip(task.status, 20) || 'done',
    outcome: clip(task.outcome, MAX_OUTCOME_CHARS), at: now,
    ...(steps.length ? { steps } : {}),
    ...(task.findings ? { findings: clip(task.findings, MAX_OUTCOME_CHARS) } : {}),
    ...(task.target ? { target: clip(task.target, MAX_TARGET_CHARS) } : {}),
  };
  return { ...t, entries: capEntries([...t.entries, e]), updatedAt: now };
}

/** Fato com chave (a mesma chave substitui: "signed-in:linkedin.com"). Teto: sai o mais velho não fixado. */
export function setFact(t: Thread, key: string, text: string, opts: { pinned?: boolean; now?: number } = {}): Thread {
  const now = opts.now ?? Date.now();
  const k = clip(key, 80), v = clip(text, MAX_FACT_CHARS);
  if (!k || !v) return t;
  const old = t.facts.find(f => f.key === k);
  const pinned = opts.pinned ?? old?.pinned;
  let facts = [...t.facts.filter(f => f.key !== k), { key: k, text: v, at: now, ...(pinned ? { pinned: true } : {}) }];
  while (facts.length > MAX_FACTS) {
    const i = facts.findIndex(f => !f.pinned);
    if (i < 0) break;
    facts = [...facts.slice(0, i), ...facts.slice(i + 1)];
  }
  return { ...t, facts, updatedAt: now };
}

/** 📌 Fixa (ou solta) um item: fixado nunca vai pro resumo. */
export function pinEntry(t: Thread, id: string, pinned = true): Thread {
  if (!t.entries.some(e => e.id === id)) return t;
  return { ...t, entries: t.entries.map(e => (e.id === id ? { ...e, pinned: pinned || undefined } : e)) as ThreadEntry[] };
}

/** Uma linha (ou poucas) de um item, como o modelo vê. */
export function entryText(e: ThreadEntry): string {
  if (e.kind === 'user') return `- user: "${e.text}"`;
  if (e.kind === 'assistant') return `- you replied: "${e.text}"`;
  const bits = [`- agent task "${e.goal}" → ${e.status}${e.outcome ? `: ${e.outcome}` : ''}`];
  if (e.steps?.length) bits.push(`  key steps: ${e.steps.join('; ')}`);
  if (e.findings && e.findings !== e.outcome) bits.push(`  found: ${e.findings}`);
  if (e.target) bits.push(`  last thing acted on: ${e.target}`);
  return bits.join('\n');
}

/** A linha curta que substitui um item no resumo. */
export function summarizeEntry(e: ThreadEntry): string {
  if (e.kind === 'user') return `- asked: ${clip(e.text, 80)}`;
  if (e.kind === 'assistant') return `- replied: ${clip(e.text, 80)}`;
  return `- task "${clip(e.goal, 80)}" → ${e.status}${e.outcome ? `: ${clip(e.outcome, 80)}` : ''}${e.target ? ` (last: ${clip(e.target, 60)})` : ''}`;
}

/**
 * O bloco da thread no prompt. Ordem: 📌 fixados, fatos, resumo do que foi compactado, e os itens
 * recentes palavra por palavra (o mais novo por último). '' quando não há nada.
 */
export function renderThread(t: Thread | null | undefined): string {
  if (!t || isEmptyThread(t)) return '';
  const parts: string[] = [];
  const pinnedFacts = t.facts.filter(f => f.pinned);
  const facts = t.facts.filter(f => !f.pinned);
  const pinnedEntries = t.entries.filter(e => e.pinned);
  if (pinnedFacts.length || pinnedEntries.length) {
    parts.push('PINNED (the user asked to keep these):', ...pinnedFacts.map(f => `- ${f.text}`), ...pinnedEntries.map(entryText));
  }
  if (facts.length) parts.push('FACTS:', ...facts.map(f => `- ${f.text}`));
  if (t.summary) parts.push('EARLIER (summary of older turns):', t.summary);
  const recent = t.entries.filter(e => !e.pinned);
  if (recent.length) parts.push('RECENT (newest last):', ...recent.map(entryText));
  return parts.join('\n');
}

export function threadTokens(t: Thread | null | undefined): number {
  return estimateTokens(renderThread(t));
}

/** Orçamento da thread por prompt: ~15% da janela (entre 512 e 4096); janela desconhecida → 3000. */
export function threadBudgetFor(windowTokens?: number | null): number {
  const w = Number(windowTokens);
  if (!Number.isFinite(w) || w <= 0) return 3000;
  return Math.max(512, Math.min(4096, Math.round(w * 0.15)));
}

export type BudgetLevel = 'ok' | 'warn' | 'over';
export function budgetLevel(tokens: number, budget: number): BudgetLevel {
  if (budget <= 0) return 'ok';
  if (tokens > budget) return 'over';
  return tokens >= budget * WARN_RATIO ? 'warn' : 'ok';
}

/** Os itens que a próxima compactação dobraria (os candidatos a 📌 no aviso dos 80%). */
export function foldCandidates(t: Thread, keepRecent = KEEP_RECENT): ThreadEntry[] {
  const movable = t.entries.filter(e => !e.pinned);
  return movable.slice(0, Math.max(0, movable.length - keepRecent));
}

/** added = o texto EXATO que entrou no resumo; dropped = linhas que já nem couberam no teto do resumo. */
export interface CompactResult { thread: Thread; folded: number; added: string; dropped: number }

/**
 * Dobra os itens mais velhos (não fixados, menos os KEEP_RECENT mais novos) num resumo corrido até a
 * thread caber em ~50% do orçamento. force (o "/compact"): dobra tudo o que pode. added = o texto
 * EXATO que entrou no resumo no lugar deles (o feed mostra). folded 0 → nada mudou.
 */
export function compactThread(t: Thread, budget: number, opts: { force?: boolean; keepRecent?: number; now?: number } = {}): CompactResult {
  const keep = opts.keepRecent ?? KEEP_RECENT;
  const candidates = foldCandidates(t, keep);
  if (!candidates.length) return { thread: t, folded: 0, added: '', dropped: 0 };
  const target = Math.floor(budget * COMPACT_TARGET);
  const folding = new Set<string>();
  const lines: string[] = [];
  let cur = t;
  for (const e of candidates) {
    if (!opts.force && threadTokens(cur) <= target) break;
    folding.add(e.id);
    lines.push(summarizeEntry(e));
    cur = { ...cur, entries: cur.entries.filter(x => !folding.has(x.id)), summary: joinSummary(t.summary, lines, budget) };
  }
  if (!folding.size) return { thread: t, folded: 0, added: '', dropped: 0 };
  // O que de fato ficou no resumo (o teto dele pode já ter tirado as linhas mais velhas).
  const kept = new Set(cur.summary.split('\n'));
  const added = lines.filter(l => kept.has(l)).join('\n');
  const dropped = lines.filter(l => !kept.has(l)).length;
  return { thread: { ...cur, folded: t.folded + folding.size, updatedAt: opts.now ?? Date.now() }, folded: folding.size, added, dropped };
}

// Resumo antigo + linhas novas, no teto (as linhas mais velhas do resumo saem primeiro, com "…").
function joinSummary(old: string, lines: string[], budget: number): string {
  let all = [...(old ? old.split('\n') : []), ...lines].filter(Boolean);
  const maxChars = Math.min(MAX_SUMMARY_CHARS, Math.max(400, Math.floor(budget * SUMMARY_SHARE) * 4));
  if (all[0] === '…') all = all.slice(1);
  let dropped = false;
  while (all.length > 1 && all.join('\n').length > maxChars) { all.shift(); dropped = true; }
  return (dropped ? ['…', ...all] : all).join('\n');
}

/**
 * 🗑 Limpar: tudo sai, menos o 📌 fixado. removed = quantos itens saíram; text = o que saiu (o feed
 * mostra, como na compactação — nada some sem aviso).
 */
export function clearThread(t: Thread, now = Date.now()): { thread: Thread; removed: number; text: string } {
  const gone = t.entries.filter(e => !e.pinned);
  const goneFacts = t.facts.filter(f => !f.pinned);
  const text = [t.summary, ...gone.map(summarizeEntry), ...goneFacts.map(f => `- ${f.text}`)].filter(Boolean).join('\n');
  return {
    thread: { ...t, summary: '', entries: t.entries.filter(e => e.pinned), facts: t.facts.filter(f => f.pinned), updatedAt: now },
    removed: gone.length + goneFacts.length + (t.summary ? 1 : 0),
    text,
  };
}

/** Duas conversas viram uma (a aba entrou numa sessão): itens na ordem do tempo, fatos juntos. */
export function mergeThreads(into: Thread, from: Thread): Thread {
  const entries = capEntries([...into.entries, ...from.entries].sort((a, b) => a.at - b.at));
  let merged: Thread = { ...into, entries, summary: [into.summary, from.summary].filter(Boolean).join('\n').slice(-MAX_SUMMARY_CHARS), folded: into.folded + from.folded, updatedAt: Math.max(into.updatedAt, from.updatedAt) };
  for (const f of [...from.facts].sort((a, b) => a.at - b.at)) merged = setFact(merged, f.key, f.text, { pinned: f.pinned, now: f.at });
  return merged;
}

// ── Disco (thread salva / histórico de conversas) ──────────────────────────────────────────────
// O que vem do disco pode estar velho, estragado ou editado à mão: só passa o que tem forma.

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function sanitizeEntry(raw: unknown): ThreadEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 40) || newId(num(r.at));
  const at = num(r.at);
  const pinned = r.pinned === true ? { pinned: true as const } : {};
  if (r.kind === 'user' || r.kind === 'assistant') {
    const text = str(r.text, r.kind === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS);
    return text ? { id, kind: r.kind, text, at, ...pinned } : null;
  }
  if (r.kind === 'task') {
    const goal = str(r.goal, MAX_GOAL_CHARS);
    if (!goal) return null;
    const steps = Array.isArray(r.steps) ? r.steps.map(s => str(s, MAX_STEP_CHARS)).filter(Boolean).slice(-MAX_STEPS) : [];
    return {
      id, kind: 'task', goal, status: str(r.status, 20) || 'done', outcome: str(r.outcome, MAX_OUTCOME_CHARS), at, ...pinned,
      ...(steps.length ? { steps } : {}),
      ...(str(r.findings, MAX_OUTCOME_CHARS) ? { findings: str(r.findings, MAX_OUTCOME_CHARS) } : {}),
      ...(str(r.target, MAX_TARGET_CHARS) ? { target: str(r.target, MAX_TARGET_CHARS) } : {}),
    };
  }
  return null;
}

export function sanitizeThread(raw: unknown): Thread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const key = str(r.key, 64);
  if (!key) return null;
  const entries = Array.isArray(r.entries) ? r.entries.slice(-MAX_ENTRIES).map(sanitizeEntry).filter((e): e is ThreadEntry => !!e) : [];
  const facts: ThreadFact[] = Array.isArray(r.facts)
    ? r.facts.slice(-MAX_FACTS).map((f: any) => (f && typeof f === 'object' && str(f.key, 80) && str(f.text, MAX_FACT_CHARS)
      ? { key: str(f.key, 80), text: str(f.text, MAX_FACT_CHARS), at: num(f.at), ...(f.pinned === true ? { pinned: true } : {}) } : null))
      .filter((f): f is ThreadFact => !!f)
    : [];
  return { key, summary: str(r.summary, MAX_SUMMARY_CHARS), entries, facts, folded: num(r.folded), updatedAt: num(r.updatedAt) };
}

/** A thread com outra chave (sessão retomada do histórico vira a chave nova). */
export function rekeyThread(t: Thread, key: string): Thread { return { ...t, key }; }

/** O primeiro pedido da conversa (pro histórico): o 1º turno da pessoa ou a 1ª tarefa. */
export function firstRequest(t: Thread): string {
  const e = t.entries.find(x => x.kind === 'user' || x.kind === 'task');
  if (e) return e.kind === 'task' ? e.goal : (e as { text: string }).text;
  const line = t.summary.split('\n').find(l => /^- (asked|task)/.test(l));
  return line ? line.replace(/^- (asked: |task )/, '').replace(/^"|".*$/g, '') : '';
}
