// monitor-notify.ts - which events a monitor may notify for. Pure (no electron, no fs)
// so the manager and the tests can share one copy of the rule.

export type MonitorNotifyKind = 'trigger' | 'change' | 'error';

/**
 * Unknown kinds are dropped and an empty selection falls back to ['trigger']: a typo
 * ('triger') must not silently disarm a monitor the user believes is armed.
 */
export function normalizeNotifyKinds(kinds?: unknown): MonitorNotifyKind[] {
  const ok = Array.isArray(kinds)
    ? kinds.filter((k): k is MonitorNotifyKind => k === 'trigger' || k === 'change' || k === 'error')
    : [];
  return ok.length ? Array.from(new Set(ok)) : ['trigger'];
}

/**
 * trigger fires on the EDGE (was not met, now met) - a level trigger spams every cycle.
 * change fires when the value moved without the target being hit.
 * error fires when the check itself failed; a silent broken monitor is worse than none.
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
