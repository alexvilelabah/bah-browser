// ─────────────────────────────────────────────────────────────────────────────
// MACROS (automação gravada) — guerrilha pura: a IA resolve a tarefa UMA vez
// (custa centavos), nós gravamos a sequência de ações em forma DURÁVEL, e o
// usuário repete quantas vezes quiser ("repete 1000 vezes", "a cada 5 minutos")
// com ZERO chamadas de modelo. Replay determinístico não "fica burro" no meio.
//
// Forma durável: click_ref/fill_ref dependem de ids da observação daquele passo;
// na gravação viram click_text/fill(label) — âncoras que sobrevivem a reload.
// ─────────────────────────────────────────────────────────────────────────────
import type { BrowserAction, ObservedState } from './page-executor';

export interface Macro {
  command: string;          // o pedido original que gerou a sequência
  steps: BrowserAction[];   // ações duráveis, na ordem
  savedAt: number;
}

export interface RepeatIntent {
  times: number;            // quantas repetições (cap aplicado no executor)
  intervalMs?: number;      // pausa entre repetições ("a cada 5 minutos")
}

const STORAGE_KEY = 'agentLastMacro';

/** Ações que o replay sabe executar direto na página (via executeBrowserAction). */
const REPLAYABLE = new Set(['navigate', 'click_text', 'click_at', 'fill', 'type', 'press', 'scroll', 'wait']);

/**
 * Converte a ação executada em forma durável pra replay. Retorna null quando a
 * ação não é replayável (report/done/extract/downloads — one-shot por natureza).
 */
export function toDurableAction(a: BrowserAction, obs: ObservedState): BrowserAction | null {
  if (a.type === 'click_ref') {
    const el = obs.interactive_elements.find(e => e.id === a.ref);
    if (!el) return null;
    const text = (el.text || el.aria || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (text) return { type: 'click_text', text };
    return { type: 'click_at', x: Math.round(el.x + el.w / 2), y: Math.round(el.y + el.h / 2) };
  }
  if (a.type === 'fill_ref') {
    const el = obs.interactive_elements.find(e => e.id === a.ref);
    const label = (el?.placeholder || el?.aria || el?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { type: 'fill', label: label || undefined, value: a.value };
  }
  if (REPLAYABLE.has(a.type)) return a;
  return null;
}

export function saveLastMacro(m: Macro): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...m, steps: m.steps.slice(-40) })); } catch {}
}

export function loadLastMacro(): Macro | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (m && Array.isArray(m.steps) && m.steps.length > 0) return m;
  } catch {}
  return null;
}

const NUM_WORDS: Record<string, number> = {
  uma: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, vinte: 20, trinta: 30, cinquenta: 50, cem: 100, mil: 1000,
};

const strip = (s: string) => s.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase();

/**
 * "repete", "faz de novo", "repete 50 vezes", "faça isso mil vezes",
 * "repete a cada 5 minutos", "repete sem parar" → intenção de replay.
 * null = não é pedido de repetição (segue o fluxo normal).
 */
export function parseRepeatIntent(command: string): RepeatIntent | null {
  const n = strip(command).trim();
  if (n.length > 90) return null; // pedido longo = tarefa nova, não replay
  // "repet*" é inequívoco; "de novo"/"novamente" só vale em comando CURTO
  // ("faz de novo") — numa frase longa é só conversa, não pedido de replay.
  const base = /\brepet\w*\b/.test(n)
    || /\bfa\w*\s+isso\b.*\b(vezes|x)\b/.test(n)
    || (n.length <= 40 && /\b(de\s*novo|denovo|novamente|outra\s+vez|mais\s+uma\s+vez)\b/.test(n));
  if (!base) return null;
  // não confundir "repete a música X" (replay de mídia) com replay de macro
  if (/\b(musica|video|clipe|cancao|playlist)\b/.test(n)) return null;

  let times = 1;
  const tm = n.match(/\b(\d{1,6}|uma|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|cinquenta|cem|mil)\s*(?:x|vez(?:es)?)\b/);
  if (tm) times = NUM_WORDS[tm[1]] ?? parseInt(tm[1], 10) ?? 1;
  if (/\b(sem\s+parar|tempo\s+indeterminado|infinit\w*|continuamente|direto|o\s+dia\s+(?:todo|inteiro))\b/.test(n)) times = 100000;

  let intervalMs: number | undefined;
  const iv = n.match(/\ba\s+cada\s+(\d{1,4})\s*(segundos?|seg|s|minutos?|min|m|horas?|h)\b/);
  if (iv) {
    const v = parseInt(iv[1], 10);
    const unit = iv[2][0] === 'h' ? 3600_000 : iv[2][0] === 'm' ? 60_000 : 1000;
    intervalMs = v * unit;
    if (times === 1) times = 100000; // "a cada 5 min" sem contagem = até mandar parar
  }
  return { times: Math.min(Math.max(times, 1), 100000), intervalMs };
}
