// Runs the Watch/Takeover state machine (shared/takeover.ts) against real tabs: hands one or more pages
// to the person, polls them (passive read only), notices the person's input, and returns when every page
// is back to normal, skipped, timed out, handed back or the task is stopped.
//
// The agent NEVER operates a human check: this module only reads (HUMAN_CHECK_SIGNALS_JS) and waits.
// While a webview is flagged as a human check, executeBrowserAction refuses page actions on it
// (humanCheckFlag + guardAgentAction).
import { takeoverReducer, initialTakeover, waitingItems, TAKEOVER_POLL_MS, TAKEOVER_TIMEOUT_MS, type TakeoverState, type TakeoverEvent, type TakeoverItem } from '../shared/takeover.ts';
import { classifyHumanCheck, humanCheckCleared, HUMAN_CHECK_SIGNALS_JS, type HumanCheckKind, type HumanCheckSignals, type HumanCheckVerdict } from '../shared/human-check.ts';

type Wv = { executeJavaScript: (code: string, userGesture?: boolean) => Promise<any>; getWebContentsId?: () => number };

/** Passive read of the page's human-check signals (null if the page doesn't answer in time). */
export async function readHumanCheckSignals(wv: Wv | null | undefined, timeoutMs = 3000): Promise<HumanCheckSignals | null> {
  if (!wv) return null;
  try {
    const r = await Promise.race([
      Promise.resolve(wv.executeJavaScript(HUMAN_CHECK_SIGNALS_JS, false)),
      new Promise<null>(res => setTimeout(() => res(null), timeoutMs)),
    ]);
    return r && typeof r === 'object' && typeof (r as any).url === 'string' ? r as HumanCheckSignals : null;
  } catch { return null; }
}

export async function classifyWebview(wv: Wv | null | undefined): Promise<{ signals: HumanCheckSignals | null; verdict: HumanCheckVerdict | null }> {
  const signals = await readHumanCheckSignals(wv);
  return { signals, verdict: signals ? classifyHumanCheck(signals) : null };
}

// ── Guard registry: webviews currently showing a human check ───────────────────────────────────
const flagged = new WeakMap<object, HumanCheckVerdict>();
/** Mark (verdict.kind === 'captcha') or clear the human-check flag of a webview. */
export function setHumanCheckFlag(wv: object | null | undefined, verdict: HumanCheckVerdict | null | undefined): void {
  if (!wv) return;
  if (verdict && verdict.kind === 'captcha') flagged.set(wv, verdict); else flagged.delete(wv);
}
export function humanCheckFlag(wv: object | null | undefined): HumanCheckVerdict | null {
  return (wv && flagged.get(wv)) || null;
}

export interface HandoffItem {
  id: string;
  site: string;
  wv: Wv;
  /** What the page was when the hand-off started (auto-resume rule in humanCheckCleared). */
  entry: { url: string; verdict: HumanCheckVerdict | null };
}

export interface HandoffControls { handBack: () => void; skip: () => void }

export interface HandoffOptions {
  kind: HumanCheckKind;
  items: HandoffItem[];
  unattended: boolean;
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  /** UI: every state change (card, "You're driving", result). */
  onState: (s: TakeoverState, controls: HandoffControls) => void;
  /** A page came back to normal (the price loop reads the store here). */
  onCleared?: (item: HandoffItem, s: TakeoverState) => Promise<void> | void;
  /** Subscribe to the person's real input on these webContents; returns unsubscribe. */
  watchInput?: (wcIds: number[], cb: (wcId: number) => void) => () => void;
  read?: (wv: Wv) => Promise<HumanCheckSignals | null>;
  now?: () => number;
}

/** Hand the pages to the person and wait. Resolves with the final state (mode 'agent', outcome set). */
export async function runHandoff(o: HandoffOptions): Promise<TakeoverState> {
  const now = o.now || Date.now;
  const read = o.read || readHumanCheckSignals;
  const pollMs = o.pollMs ?? TAKEOVER_POLL_MS;
  let s = takeoverReducer(initialTakeover(o.timeoutMs ?? TAKEOVER_TIMEOUT_MS), {
    type: 'detected', kind: o.kind, items: o.items.map(i => ({ id: i.id, site: i.site })), now: now(), unattended: o.unattended, timeoutMs: o.timeoutMs,
  });
  let wake: (() => void) | null = null;
  const done = () => s.mode === 'agent';   // lido sempre ao vivo (dispatch muda s fora do laço)
  const controls: HandoffControls = { handBack: () => dispatch({ type: 'hand_back' }), skip: () => dispatch({ type: 'skip' }) };
  function dispatch(e: TakeoverEvent) {
    const prev = s;
    s = takeoverReducer(s, e);
    if (s !== prev && (s.mode !== prev.mode || e.type !== 'user_input')) o.onState(s, controls);
    if (s.mode === 'agent') wake?.();
  }
  o.onState(s, controls);
  if (s.mode === 'agent') return s;   // unattended: never waits

  const onAbort = () => dispatch({ type: 'stop' });
  if (o.signal?.aborted) onAbort(); else o.signal?.addEventListener('abort', onAbort, { once: true });
  const byWc = new Map<number, string>();
  for (const it of o.items) { try { const id = it.wv.getWebContentsId?.(); if (typeof id === 'number') byWc.set(id, it.id); } catch {} }
  const unwatch = o.watchInput?.([...byWc.keys()], (wcId) => { if (byWc.has(wcId)) dispatch({ type: 'user_input', now: now(), id: byWc.get(wcId) }); });
  try {
    while (!done()) {
      await new Promise<void>(res => { wake = res; setTimeout(res, pollMs); });
      wake = null;
      if (done()) break;
      for (const id of waitingItems(s).map((i: TakeoverItem) => i.id)) {
        const it = o.items.find(x => x.id === id)!;
        const sig = await read(it.wv);
        if (done()) break;
        const cleared = !!sig && humanCheckCleared(it.entry, sig);
        dispatch({ type: 'poll', id, blocked: !cleared, now: now() });
        if (cleared) await o.onCleared?.(it, s);
      }
      if (!done()) dispatch({ type: 'tick', now: now() });
    }
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
    try { unwatch?.(); } catch {}
  }
  return s;
}
