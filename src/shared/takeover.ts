// Watch / Takeover: who drives a tab when a page wants a PERSON (bot check / CAPTCHA / sign-in wall).
//
//   AGENT ──detected──▶ HANDOFF ──user input on the page──▶ TAKEOVER
//     ▲                   │  │                                  │
//     │                   │  └──────── page cleared (poll) ─────┤──▶ AGENT (cleared — re-observe, same step)
//     │                   └── [Hand back] / [Skip] / timeout / Stop ──▶ AGENT (handed_back | skipped | timeout | stopped)
//     └── detected in an UNATTENDED (scheduled) run: never waits ─▶ AGENT (unattended: "couldn't read — human check")
//
// HANDOFF: agent loop paused, card in the feed ([Hand back] [Skip this site]), the tab comes to the front.
// TAKEOVER: the person is operating the page ("You're driving"); the agent's action queue stays locked.
// Several pages can wait at once (price compare: one card for every store that showed a check); each one
// clears on its own and the state goes back to AGENT when none is left waiting.
//
// HARD RULE (enforced by guardAgentAction below, and by the renderer before every agent action): while a
// page is classified as a human check, the agent never clicks, presses, holds, types into, scrolls or
// otherwise operates it. Only the person does. Pure; tests in tests/unit/takeover.test.ts.
import type { HumanCheckKind } from './human-check';

/** Default wait for the person before the site is skipped. Counted from the hand-off or the person's last input on the page. */
export const TAKEOVER_TIMEOUT_MS = 3 * 60_000;
/** How often the waiting pages are re-classified. */
export const TAKEOVER_POLL_MS = 1_500;

export type TakeoverMode = 'agent' | 'handoff' | 'takeover';
export type ItemStatus = 'waiting' | 'cleared' | 'handed_back' | 'skipped' | 'timeout' | 'unattended' | 'stopped';
export type TakeoverOutcome = 'cleared' | 'handed_back' | 'skipped' | 'timeout' | 'unattended' | 'stopped';

export interface TakeoverItem { id: string; site: string; status: ItemStatus }

export interface TakeoverState {
  mode: TakeoverMode;
  kind?: HumanCheckKind;
  items: TakeoverItem[];
  /** When the hand-off started (ms). */
  since: number;
  /** Last time the person touched one of the waiting pages (ms; 0 = never). */
  lastInputAt: number;
  timeoutMs: number;
  /** How the last hand-off ended (set when mode goes back to 'agent'). */
  outcome?: TakeoverOutcome;
}

export type TakeoverEvent =
  | { type: 'detected'; kind: HumanCheckKind; items: Array<{ id: string; site: string }>; now: number; unattended?: boolean; timeoutMs?: number }
  | { type: 'user_input'; now: number; id?: string }
  | { type: 'poll'; id: string; blocked: boolean; now: number }
  | { type: 'tick'; now: number }
  | { type: 'hand_back' }
  | { type: 'skip' }
  | { type: 'stop' };

export const initialTakeover = (timeoutMs = TAKEOVER_TIMEOUT_MS): TakeoverState => ({ mode: 'agent', items: [], since: 0, lastInputAt: 0, timeoutMs });

const settle = (s: TakeoverState, outcome: TakeoverOutcome, waitingBecomes: ItemStatus): TakeoverState => ({
  ...s,
  mode: 'agent',
  outcome,
  items: s.items.map(i => (i.status === 'waiting' ? { ...i, status: waitingBecomes } : i)),
});

export function takeoverReducer(s: TakeoverState, e: TakeoverEvent): TakeoverState {
  // Stop/cancel from the person exits any state.
  if (e.type === 'stop') return s.mode === 'agent' ? s : settle(s, 'stopped', 'stopped');

  if (s.mode === 'agent') {
    if (e.type !== 'detected' || !e.items.length) return s;
    const timeoutMs = e.timeoutMs ?? s.timeoutMs;
    // Nobody is watching (scheduled run): never wait — every page is "couldn't read — human check" now.
    if (e.unattended) {
      return { mode: 'agent', kind: e.kind, items: e.items.map(i => ({ ...i, status: 'unattended' })), since: e.now, lastInputAt: 0, timeoutMs, outcome: 'unattended' };
    }
    return { mode: 'handoff', kind: e.kind, items: e.items.map(i => ({ ...i, status: 'waiting' })), since: e.now, lastInputAt: 0, timeoutMs, outcome: undefined };
  }

  // HANDOFF / TAKEOVER
  switch (e.type) {
    case 'detected': return s;   // already waiting for the person; the driver adds nothing mid-hand-off
    case 'user_input':
      return { ...s, mode: 'takeover', lastInputAt: Math.max(s.lastInputAt, e.now) };
    case 'poll': {
      if (e.blocked) return expire(s, e.now);
      const items = s.items.map(i => (i.id === e.id && i.status === 'waiting' ? { ...i, status: 'cleared' as const } : i));
      const next = { ...s, items };
      return items.some(i => i.status === 'waiting') ? expire(next, e.now) : { ...next, mode: 'agent', outcome: 'cleared' };
    }
    case 'tick': return expire(s, e.now);
    case 'hand_back': return settle(s, 'handed_back', 'handed_back');
    case 'skip': return settle(s, 'skipped', 'skipped');
  }
  return s;
}

function expire(s: TakeoverState, now: number): TakeoverState {
  if (s.mode === 'agent') return s;
  const from = Math.max(s.since, s.lastInputAt);
  return now - from >= s.timeoutMs ? settle(s, 'timeout', 'timeout') : s;
}

/** The agent may act (its loop / action queue run) only in AGENT mode. */
export const agentMayAct = (s: TakeoverState): boolean => s.mode === 'agent';
/** Pages still waiting for the person. */
export const waitingItems = (s: TakeoverState): TakeoverItem[] => s.items.filter(i => i.status === 'waiting');

// ── Action guard ────────────────────────────────────────────────────────────────────────────────
// On a page classified as a human check, the agent may only READ it passively (screenshot, text) or
// LEAVE it (navigate elsewhere, back, other tab, web search, finish). Everything that touches the page
// (click, press, hold, type, scroll, hover, focus, drag, select, upload, reload, dialogs…) is refused.
// Allowlist, not denylist: a new action type is refused here until someone decides it is passive.
const ALLOWED_ON_HUMAN_CHECK = new Set<string>([
  // passive reads of the page / screenshots
  'screenshot', 'extract_text', 'extract_images', 'get', 'get_html', 'wait',
  // leaving the page (never operating it)
  'navigate', 'back', 'new_tab', 'switch_tab', 'close_tab', 'web_search',
  // agent bookkeeping that never touches the page
  'done', 'report', 'store', 'plan', 'list_downloads', 'list_files', 'read_file', 'history_search', 'ask_ai', 'render_view', 'summarize_tabs',
]);

/** null = allowed; otherwise the refusal reason (goes in the agent history and the feed). */
export function guardAgentAction(actionType: string, check: { kind: HumanCheckKind; why?: string } | null | undefined, site = 'this site'): string | null {
  if (!check || check.kind !== 'captcha') return null;
  if (ALLOWED_ON_HUMAN_CHECK.has(String(actionType || ''))) return null;
  return `"${actionType}" refused: ${site} is showing a human check${check.why ? ` (${check.why})` : ''}. Bah never operates a human check — only the person does. Read the page, go somewhere else, or finish and say you couldn't read ${site} — human check.`;
}
