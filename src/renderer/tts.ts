// Text-to-speech via the browser's built-in voices (window.speechSynthesis).
// FREE, offline, no API — uses the OS voices (e.g. "Microsoft Maria - pt-BR" on
// Windows). Confirmed working in this Electron. Shared by the per-answer 🔊 button
// (AgentCommandBar) and the "read this page" menu item (App). The voice follows the
// UI language (pt/en/es). Only one utterance plays at a time (speechSynthesis is global).
import { getLang } from './i18n';

// Voices populate LATE in Electron (getVoices() is empty on the first call, fills in
// after 'voiceschanged'). Warm a cache on load so clicks have a voice ready.
let cachedVoices: SpeechSynthesisVoice[] = [];
function refreshVoices() {
  try { cachedVoices = window.speechSynthesis?.getVoices() ?? []; } catch {}
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch {}
}

const LANG_MATCH: Record<string, RegExp> = { pt: /^pt/i, en: /^en/i, es: /^es/i };
const LANG_TAG: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = cachedVoices.length ? cachedVoices : (() => { refreshVoices(); return cachedVoices; })();
  const re = LANG_MATCH[lang] ?? LANG_MATCH.en;
  // Prefer an exact regional match; otherwise any voice for that language.
  return voices.find(v => re.test(v.lang));
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isSpeaking(): boolean {
  try { return !!window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending); }
  catch { return false; }
}

// Chromium cuts utterances off around ~15s. The classic fix: pause+resume on a timer
// so long articles read to the end. Cleared when speech ends/stops.
let keepAlive: ReturnType<typeof setInterval> | null = null;
function clearKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }

export function stopSpeaking(): void {
  clearKeepAlive();
  try { window.speechSynthesis?.cancel(); } catch {}
}

// Speaks `text`. Calls onDone() when it finishes, errors, or is stopped. Returns false
// if unsupported or there's nothing to say (onDone still fires).
export function speak(text: string, onDone?: () => void): boolean {
  if (!ttsSupported()) { onDone?.(); return false; }
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!clean) { onDone?.(); return false; }
  try {
    window.speechSynthesis.cancel();
    clearKeepAlive();
    const lang = getLang();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.lang = v?.lang || LANG_TAG[lang] || 'en-US';
    u.rate = 1.0;
    const finish = () => { clearKeepAlive(); onDone?.(); };
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    keepAlive = setInterval(() => {
      try {
        const ss = window.speechSynthesis;
        if (ss.speaking) { ss.pause(); ss.resume(); } else { clearKeepAlive(); }
      } catch { clearKeepAlive(); }
    }, 10000);
    return true;
  } catch { clearKeepAlive(); onDone?.(); return false; }
}
