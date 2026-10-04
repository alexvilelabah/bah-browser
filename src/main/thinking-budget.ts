// thinking-budget.ts — cut a runaway local "thinking" phase without cutting real work.
//
// Measured on oMLX/Qwen: reasoning is normally a few hundred tokens; the worst observed
// step was 2,869 output tokens in 151s. A stuck model, by contrast, thinks for minutes and
// never emits content. So the budget is soft and only bites when there is NO answer yet:
//   - reasoning tokens over the cap, still no content
//   - thinking elapsed over the cap, still no content
//   - the thinking text repeating itself
// Character counts are used mid-stream because usage (real token counts) only arrives in the
// final chunk; the per-step calibration happens from that final usage.
export const THINKING_TOKENS_SOFT = 8192;      // reasoning tokens with no content
export const THINKING_SECONDS_SOFT = 240;       // thinking elapsed with no content
const CHARS_PER_TOKEN = 3.5;                    // rough, for the mid-stream estimate

export type ThinkingCut = 'THINKING_BUDGET' | 'REPEATING';

/** Verbatim block repetition (a stuck model loops the same sentence). Cheap: only runs on a
 *  tail window, and the caller throttles it (ThinkingBudget re-checks every ~400 chars). */
export function detectRepeat(text: string): boolean {
  if (text.length < 240) return false;
  const tail = text.slice(-1200);
  // Up to 400 chars: the 1200-char tail holds three copies, so a looping paragraph counts
  // too, not only a looping sentence.
  for (let p = 8; p <= 400; p++) {
    const b = tail.slice(-p);
    if (b.trim().length < p * 0.5) continue;   // whitespace runs don't count
    if (tail.endsWith(b + b + b)) return true;
  }
  return false;
}

export class ThinkingBudget {
  private readonly maxChars: number;
  private readonly maxMs: number;
  private readonly startedAt: number;
  private lastRepeatCheck = 0;

  constructor(o: { tokensSoft?: number; secondsSoft?: number; charsPerToken?: number } = {}) {
    const cpc = o.charsPerToken ?? CHARS_PER_TOKEN;
    this.maxChars = Math.round((o.tokensSoft ?? THINKING_TOKENS_SOFT) * cpc);
    this.maxMs = (o.secondsSoft ?? THINKING_SECONDS_SOFT) * 1000;
    this.startedAt = Date.now();
  }

  /** Recalibrate after a step: the elapsed cap scales with the last step's size, the token
   *  cap stays the agreed 8192. Bounded so a huge step can't license an endless think. */
  static forStep(stepTokens: number, o: { secondsSoft?: number; secondsMax?: number } = {}): ThinkingBudget {
    const base = o.secondsSoft ?? THINKING_SECONDS_SOFT;
    const max = o.secondsMax ?? 600;
    const secs = Math.min(max, Math.max(base, Math.round(base * (1 + stepTokens / 4096))));
    return new ThinkingBudget({ secondsSoft: secs });
  }

  /** thinkingText is the reasoning accumulated so far; hasContent is whether an answer started. */
  check(thinkingText: string, hasContent: boolean): ThinkingCut | undefined {
    if (hasContent) return undefined;                       // an answer is flowing: never cut
    if (thinkingText.length - this.lastRepeatCheck >= 400) {
      this.lastRepeatCheck = thinkingText.length;
      if (detectRepeat(thinkingText)) return 'REPEATING';
    }
    if (thinkingText.length > this.maxChars) return 'THINKING_BUDGET';
    if (Date.now() - this.startedAt > this.maxMs) return 'THINKING_BUDGET';
    return undefined;
  }

  get charsCap(): number { return this.maxChars; }
  get msCap(): number { return this.maxMs; }
}
