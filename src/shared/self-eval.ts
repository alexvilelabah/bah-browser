// self-eval.ts - classify the model's judgement of its own previous action.
// Pure, so the loop rule is testable without Electron.

export type SelfEvalVerdict = 'success' | 'failed' | 'unclear';

/**
 * The model writes free text ("failed - the modal is still open"). Only the FIRST word
 * decides, because models start the sentence with the verdict when asked plainly, and
 * prose that mentions "fail" later ("success, no error") must not read as a failure.
 * Words that only exist inside longer words are excluded by the ^ anchor plus boundary.
 */
export function classifySelfEval(text: string): SelfEvalVerdict {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 'unclear';
  // A shrug is not a failure: it must not inflate the stuck counter.
  if (t.startsWith('unclear')) return 'unclear';
  if (/^(fail|failed|false|no|non|nao|não|wrong|error|blocked|stuck)/.test(t)) return 'failed';
  if (/^(success|successful|ok|okay|okay\.|yes|sim|done|met|completed|worked)/.test(t)) return 'success';
  return 'unclear';
}

/**
 * Consecutive self-reported failures. 'unclear' does NOT reset the counter: a model
 * that keeps shrugging is not evidence that things are working.
 */
export function nextSelfFailCount(prev: number, verdict: SelfEvalVerdict): number {
  if (verdict === 'failed') return prev + 1;
  if (verdict === 'success') return 0;
  return prev;
}
