// task-deadline.ts - a clock that can be paused.
//
// The deadline used to be compared only between steps, so one slow step could run far
// past the limit the user set. This fires DURING the step, and sleeps while a human is
// being asked for help: time spent by a person is not the model being slow.
// Budget is MACHINE time only (elapsed minus suspended spans).

export interface TaskDeadline {
  signal: AbortSignal;
  remainingMs(): number;
  spentMs(): number;
  suspended(): boolean;
  suspend(): void;
  resume(): void;
  fired(): boolean;
  clear(): void;
}

export function createDeadline(startedAt: number, limitMs: number): TaskDeadline {
  const ac = new AbortController();
  const finite = Number.isFinite(limitMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suspendedSince: number | null = null;
  let suspendedTotalMs = 0;
  let done = false;

  const spentMs = () => {
    const live = suspendedSince !== null ? Date.now() - suspendedSince : 0;
    return Math.max(0, Date.now() - startedAt - suspendedTotalMs - live);
  };
  const remainingMs = () => (finite ? Math.max(0, limitMs - spentMs()) : Infinity);
  const fire = () => {
    if (done) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try { ac.abort(new Error('TASK_DEADLINE')); } catch { try { ac.abort(); } catch {} }
  };
  const arm = () => {
    if (timer) clearTimeout(timer);
    if (!finite || done) return;
    const left = remainingMs();
    if (left <= 0) { fire(); return; }
    timer = setTimeout(fire, left);
  };
  arm();

  return {
    signal: ac.signal,
    remainingMs,
    spentMs,
    suspended: () => suspendedSince !== null,
    fired: () => done,
    suspend: () => {
      if (suspendedSince !== null || done) return;
      suspendedSince = Date.now();
      if (timer) { clearTimeout(timer); timer = null; }
    },
    resume: () => {
      if (suspendedSince === null || done) return;
      suspendedTotalMs += Date.now() - suspendedSince;
      suspendedSince = null;
      arm();
    },
    clear: () => { if (timer) clearTimeout(timer); timer = null; },
  };
}
