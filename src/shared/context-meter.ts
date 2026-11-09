// context-meter.ts — a conta do medidor de contexto do painel (ao lado do nome do modelo). PURA:
// o AgentCommandBar desenha e os testes (tests/unit/context-meter.test.ts) conferem a mesma conta.
// Mostra quanto da janela do modelo a última chamada usou e quanto disso é a conversa (thread):
// "context 6.1k / 16k · thread 2.3k". A janela vem da detecção do engine (/props no llama.cpp, ou o
// tamanho configurado); os tokens vêm do que o provedor informou, senão de uma estimativa — e aí
// o rótulo diz que é estimativa. Âmbar/vermelho dizem QUEM está ocupando a janela.

export type MeterPart = 'instructions' | 'skills' | 'thread' | 'page';
export const METER_PARTS: readonly MeterPart[] = ['instructions', 'skills', 'thread', 'page'];

export interface ContextUsage {
  /** Janela do modelo; 0/undefined = desconhecida (nuvem). */
  window?: number;
  /** Partes da última chamada (estimadas). */
  parts: Partial<Record<MeterPart, number>>;
  /** Total que o provedor informou (prompt_tokens). Sem isso, a soma das partes (estimativa). */
  reported?: number;
}

export type MeterLevel = 'ok' | 'amber' | 'red';

export interface MeterState {
  used: number;
  window: number;          // 0 = desconhecida
  ratio: number;           // 0..1 (0 sem janela)
  level: MeterLevel;
  estimated: boolean;
  thread: number;
  /** A parte que mais ocupa (só em âmbar/vermelho). */
  crowding?: MeterPart;
}

export const AMBER_AT = 0.7;
export const RED_AT = 0.9;

const pos = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export function meterState(u: ContextUsage): MeterState {
  const sum = METER_PARTS.reduce((s, p) => s + pos(u.parts[p]), 0);
  const reported = pos(u.reported);
  const used = reported || sum;
  const window = pos(u.window);
  const ratio = window ? Math.min(1, used / window) : 0;
  const level: MeterLevel = ratio >= RED_AT ? 'red' : ratio >= AMBER_AT ? 'amber' : 'ok';
  let crowding: MeterPart | undefined;
  if (level !== 'ok') {
    let best = 0;
    for (const p of METER_PARTS) { const v = pos(u.parts[p]); if (v > best) { best = v; crowding = p; } }
  }
  return { used, window, ratio, level, estimated: !reported, thread: pos(u.parts.thread), crowding };
}

/** 6100 → "6.1k", 16384 → "16k", 950 → "950". */
export function fmtTokens(n: number): string {
  const v = Math.max(0, Math.round(n || 0));
  if (v < 1000) return String(v);
  const k = v / 1000;
  if (k >= 10) return `${Math.round(k)}k`;
  const r = Math.round(k * 10) / 10;
  return Number.isInteger(r) ? `${r}k` : `${r.toFixed(1)}k`;
}

/** Rótulo curto: "context 6.1k / 16k · thread 2.3k" ("~" na frente quando é estimativa). */
export function meterLabel(s: MeterState, words: { context: string; thread: string } = { context: 'context', thread: 'thread' }): string {
  const used = `${s.estimated ? '~' : ''}${fmtTokens(s.used)}`;
  return `${words.context} ${used}${s.window ? ` / ${fmtTokens(s.window)}` : ''} · ${words.thread} ${fmtTokens(s.thread)}`;
}

/** Fatia de cada parte na barra do detalhe (0..1 do total usado). */
export function partShares(u: ContextUsage): Record<MeterPart, number> {
  const sum = METER_PARTS.reduce((s, p) => s + pos(u.parts[p]), 0) || 1;
  return Object.fromEntries(METER_PARTS.map(p => [p, pos(u.parts[p]) / sum])) as Record<MeterPart, number>;
}
