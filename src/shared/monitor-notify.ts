// monitor-notify.ts — which events a monitor may post a notification for.
// Pure (no electron, no fs): monitor-manager.ts imports this, tests import this,
// and nothing else has to boot Electron to check the rule.

export type MonitorNotifyKind = 'trigger' | 'change' | 'error';

/**
 * Only the three known kinds survive. An empty or invalid selection falls back to
 * ['trigger'] on purpose: a monitor that never notifies is not what somebody meant
 * when they added it, and a checkbox that silently does nothing is worse than no
 * checkbox. Unknown values are dropped rather than trusted - a typo ('triger') would
 * otherwise disable notifications for a monitor the user believes is armed.
 */
export function normalizeNotifyKinds(kinds?: unknown): MonitorNotifyKind[] {
  const ok = Array.isArray(kinds)
    ? kinds.filter((k): k is MonitorNotifyKind => k === 'trigger' || k === 'change' || k === 'error')
    : [];
  return ok.length ? Array.from(new Set(ok)) : ['trigger'];
}

/**
 * Should this run post a notification?
 * - trigger: fires on the EDGE (was not met, now met) - a level trigger spams every cycle.
 * - change:  fires when the read value moved, even without the target being hit.
 * - error:   fires when the check itself failed. Silent failure is the worst outcome:
 *            the user believes the page is still being watched.
 */
export function shouldNotify(
  wants: MonitorNotifyKind[],
  ev: { met: boolean; prevMet: boolean; value: string; prevValue: string; failed: boolean },
): MonitorNotifyKind | null {
  const kinds = normalizeNotifyKinds(wants);
  if (ev.failed) return kinds.includes('error') ? 'error' : null;
  if (kinds.includes('trigger') && ev.met && !ev.prevMet) return 'trigger';
  if (kinds.includes('change') && ev.value !== ev.prevValue) return 'change';
  return null;
}
