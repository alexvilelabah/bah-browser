// "Is this page asking for a PERSON?" — one generic classifier for bot checks / CAPTCHAs of any style
// (press & hold, checkbox, image puzzle, "verify you are human", Cloudflare interstitial) and sign-in walls.
//
// The point is NOT to evade anything. When a page wants a human, Bah hands control to the person
// (renderer: takeover state machine in shared/takeover.ts), the person does it themselves, and the agent
// resumes when the page is back to normal. The agent never clicks, holds, types into or scrolls inside
// the check, and never tries to look human.
//
// Signals are DATA collected by a passive read script (HUMAN_CHECK_SIGNALS_JS: reads the top document
// only — iframe src attributes, ids/classes, title, visible text; it changes nothing). Classification is
// the pure function classifyHumanCheck, unit-tested with fixtures in tests/unit/human-check.test.ts.

export type HumanCheckKind = 'captcha' | 'signin';

export interface HumanCheckSignals {
  url: string;
  title?: string;
  /** Visible text of the page (document.body.innerText, may be truncated). */
  text?: string;
  /** src of the VISIBLE iframes (≥ 20×20 px). */
  frames?: string[];
  /** ids/classes of visible elements that match a challenge marker (see MARKER_SELECTOR). */
  markers?: string[];
  /** A visible <input type=password>. */
  passwordField?: boolean;
}

export interface HumanCheckVerdict {
  kind: HumanCheckKind;
  /** Which signal fired (for the history / diagnostics): "provider frame challenges.cloudflare.com", … */
  why: string;
  /** Known challenge provider, when one was recognised. */
  provider?: string;
}

// ── Providers ───────────────────────────────────────────────────────────────────────────────────
// A challenge provider's own frame. "gate" frames only exist while a check is being shown (the image
// puzzle of reCAPTCHA/hCaptcha, Arkose, DataDome, PerimeterX, GeeTest, AWS WAF). "widget" frames are
// also embedded in ordinary forms (newsletter, contact, comment) — they count only on a near-empty page
// or together with a challenge phrase.
const GATE_FRAMES: Array<[RegExp, string]> = [
  [/(?:google\.com|recaptcha\.net)\/recaptcha\/(?:api2|enterprise)\/bframe/i, 'recaptcha'],
  [/hcaptcha\.com\/.*frame=challenge/i, 'hcaptcha'],
  [/arkoselabs\.com|funcaptcha\.com/i, 'arkose'],
  [/captcha-delivery\.com|geo\.captcha-delivery|datadome/i, 'datadome'],
  [/perimeterx\.net|px-cdn\.net|px-cloud\.net|px-captcha|captcha\.px-/i, 'perimeterx'],
  [/geetest\.com/i, 'geetest'],
  [/captcha\.awswaf\.com|awswaf\.com\/.*captcha|token\.awswaf\.com.*captcha/i, 'awswaf'],
  [/challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\/.*\/(?:managed|interactive|jsch)/i, 'cloudflare'],
];
const WIDGET_FRAMES: Array<[RegExp, string]> = [
  [/(?:google\.com|recaptcha\.net)\/recaptcha\/(?:api2|enterprise)\/anchor(?![^#]*size=invisible)/i, 'recaptcha'],
  [/hcaptcha\.com\/.*frame=checkbox/i, 'hcaptcha'],
  [/challenges\.cloudflare\.com/i, 'cloudflare'],
];

// ── Markers (ids / classes) ─────────────────────────────────────────────────────────────────────
const GATE_MARKERS: Array<[RegExp, string]> = [
  [/^px-captcha$/i, 'perimeterx'],
  [/^(?:cf-challenge|cf-challenge-running|challenge-running|challenge-stage|challenge-form|cf-chl-widget.*|cf-please-wait)$/i, 'cloudflare'],
  [/^(?:captcha-container|captcha__frame|ddv1-captcha.*|dd-captcha)$/i, 'datadome'],
  [/^(?:funcaptcha|arkose.*|fc-iframe-wrap)$/i, 'arkose'],
  [/^geetest_(?:panel|box|holder|widget).*$/i, 'geetest'],
  [/^(?:aws-?waf-captcha|amzn-captcha-modal|captcha-modal)$/i, 'awswaf'],
];
const WIDGET_MARKERS: Array<[RegExp, string]> = [
  [/^g-recaptcha$/i, 'recaptcha'],
  [/^h-captcha$/i, 'hcaptcha'],
  [/^cf-turnstile$/i, 'cloudflare'],
];
/** CSS used by the read script to find candidate markers (wide on purpose; the regexes above decide). */
export const MARKER_SELECTOR = '[id*="captcha" i],[class*="captcha" i],[id*="challenge" i],[class*="challenge" i],[class*="cf-turnstile"],[id^="cf-"],[class*="geetest"],[id*="arkose" i],[class*="arkose" i],[id*="funcaptcha" i]';

// ── Text ────────────────────────────────────────────────────────────────────────────────────────
// Phrases that only a human check says — they count anywhere, even on a long page (Target draws the
// "Quick verification / Press & hold" box OVER the product page, whose text stays underneath).
const STRONG_TEXT = /\b(?:quick\s+verification|press\s+(?:&|and)\s+hold(?:\s+the\s+button)?\s+(?:to\s+confirm|button)|activate\s+and\s+hold\s+the\s+button|verify(?:ing)?\s+(?:that\s+)?you(?:'re|’re|\s+are)\s+(?:a\s+)?human|confirm\s+(?:that\s+)?you(?:'re|’re|\s+are)\s+(?:a\s+)?human|robot\s+or\s+human\??|are\s+you\s+a\s+(?:robot|human)\?|i(?:'m|’m|\s+am)\s+not\s+a\s+robot|checking\s+(?:if\s+the\s+site\s+connection\s+is\s+secure|your\s+browser\s+before)|our\s+systems\s+have\s+detected\s+unusual\s+traffic|enter\s+the\s+characters\s+you\s+see\s+below|n[aã]o\s+sou\s+um\s+rob[oô]|confirme\s+que\s+voc[eê]\s+[eé]\s+humano|verifique\s+que\s+(?:eres|voc[eê]\s+[eé])\s+humano|no\s+soy\s+un\s+robot)/i;
// Ambiguous on their own ("captcha" in an article, "just a moment" in a recipe): only on a near-empty
// page, or in the title.
const WEAK_TEXT = /\b(?:captcha|recaptcha|hcaptcha|press\s+(?:&|and)\s+hold|just\s+a\s+moment|one\s+more\s+step|attention\s+required|security\s+check|human\s+verification|bot\s+(?:check|detection)|unusual\s+traffic|automated\s+(?:access|queries|requests)|pardon\s+our\s+interruption|access\s+to\s+this\s+page\s+has\s+been\s+denied|please\s+verify|um\s+momento|verifica[cç][aã]o\s+de\s+seguran[cç]a|un\s+momento)\b/i;
const TITLE_GATE = /^\s*(?:just\s+a\s+moment|attention\s+required|one\s+more\s+step|security\s+check|robot\s+check|robot\s+or\s+human|are\s+you\s+a\s+(?:robot|human)|human\s+verification|verify(?:ing)?\s+you\s+are\s+human|captcha|access\s+to\s+this\s+page\s+has\s+been\s+denied|pardon\s+our\s+interruption|um\s+momento|verifica[cç][aã]o\s+de\s+seguran[cç]a|un\s+momento)/i;

// ── Sign-in wall ────────────────────────────────────────────────────────────────────────────────
const SIGNIN_PATH = /\/(?:ap\/signin|signin|sign-in|sign_in|login|log-in|logon|uas\/login|account\/login|accounts\/login|identity\/(?:login|signin)|auth\/login|entrar)\b/i;
const SIGNIN_TEXT = /\b(?:sign\s+in\s+to\s+continue|log\s+in\s+to\s+continue|please\s+(?:sign|log)\s+in|sign\s+in\s+required|login\s+required|you\s+must\s+(?:be\s+)?(?:signed|logged)\s+in|fa[cç]a\s+login\s+para\s+continuar|entre\s+na\s+sua\s+conta\s+para|inicia\s+sesi[oó]n\s+para\s+continuar)\b/i;

/** A page this short is a gate, not content (same scale price-compare used). */
export const SHORT_PAGE_CHARS = 2500;

function match<T extends string>(list: Array<[RegExp, T]>, values: string[]): { value: string; provider: T } | null {
  for (const v of values) for (const [re, p] of list) if (re.test(v)) return { value: v, provider: p };
  return null;
}
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
const clip = (s: string, n = 40) => s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * The page is a human check (captcha), a sign-in wall, or neither (null). Pure.
 * Rules: a challenge provider's GATE frame/marker → captcha. A WIDGET frame/marker → captcha only on a
 * near-empty page or with a challenge phrase. Strong phrase anywhere / gate title → captcha. Weak phrase
 * → captcha only on a near-empty page. Sign-in: login URL, or a password field / "sign in to continue"
 * on a near-empty page.
 */
export function classifyHumanCheck(s: HumanCheckSignals): HumanCheckVerdict | null {
  const url = s.url || '';
  if (!/^https?:/i.test(url)) return null;
  const title = String(s.title || '').trim();
  const text = String(s.text || '').replace(/\s+/g, ' ').trim();
  const frames = (s.frames || []).filter(Boolean);
  const markers = (s.markers || []).filter(Boolean);
  const short = text.length < SHORT_PAGE_CHARS;
  const strong = STRONG_TEXT.exec(`${title} ${text}`);

  const gateFrame = match(GATE_FRAMES, frames);
  if (gateFrame) return { kind: 'captcha', provider: gateFrame.provider, why: `challenge frame ${hostOf(gateFrame.value) || gateFrame.provider}` };
  const gateMarker = match(GATE_MARKERS, markers);
  if (gateMarker) return { kind: 'captcha', provider: gateMarker.provider, why: `challenge element #${gateMarker.value}` };
  if (TITLE_GATE.test(title)) return { kind: 'captcha', why: `title "${clip(title)}"` };
  if (strong) return { kind: 'captcha', why: `page says "${clip(strong[0])}"` };
  const widget = match(WIDGET_FRAMES, frames) || match(WIDGET_MARKERS, markers);
  const weak = WEAK_TEXT.exec(`${title} ${text}`);
  if (widget && short && (weak || text.length < 600)) return { kind: 'captcha', provider: widget.provider, why: `${widget.provider} widget on a near-empty page` };
  if (weak && short && text.length < 1200) return { kind: 'captcha', why: `near-empty page says "${clip(weak[0])}"` };

  let path = '';
  try { path = new URL(url).pathname; } catch {}
  if (SIGNIN_PATH.test(path)) return { kind: 'signin', why: `sign-in address ${clip(path, 30)}` };
  if (short && SIGNIN_TEXT.test(`${title} ${text}`)) return { kind: 'signin', why: 'page asks to sign in to continue' };
  if (s.passwordField && short) return { kind: 'signin', why: 'password field on a near-empty page' };
  return null;
}

/**
 * Back to normal? Used while the person is handling the page (poll ~1.5 s).
 * - entry was classified (captcha/sign-in) → cleared when the classifier no longer sees it;
 * - entry was NOT classified (another detector paused, e.g. the login policy) → cleared only when the
 *   address changed and the classifier sees nothing — otherwise only the person's [Hand back] resumes.
 * A page with no readable text yet (still loading) is never "cleared".
 */
export function humanCheckCleared(entry: { url: string; verdict: HumanCheckVerdict | null }, now: HumanCheckSignals): boolean {
  const text = String(now.text || '').trim();
  if (!/^https?:/i.test(now.url || '') || text.length < 40) return false;
  if (classifyHumanCheck(now)) return false;
  if (entry.verdict) return true;
  return stripHash(now.url) !== stripHash(entry.url);
}
const stripHash = (u: string) => String(u || '').replace(/#.*$/, '');

/**
 * Passive read of the top document: title, visible text, visible iframe srcs and challenge-ish
 * ids/classes. Reads attributes and layout boxes only — no clicks, no focus, no scrolling, no events.
 * Returns HumanCheckSignals.
 */
export const HUMAN_CHECK_SIGNALS_JS = `(function(){
  try {
    var vis = function(el){ try { var r = el.getBoundingClientRect(); if (r.width < 20 || r.height < 20) return false; var cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0.05; } catch (e) { return false; } };
    var frames = [];
    var fs = document.querySelectorAll('iframe');
    for (var i = 0; i < fs.length && frames.length < 40; i++) { var f = fs[i]; var src = f.src || f.getAttribute('src') || ''; if (src && vis(f)) frames.push(src.slice(0, 300)); }
    var markers = [], seen = {};
    var ms = document.querySelectorAll(${JSON.stringify(MARKER_SELECTOR)});
    for (var j = 0; j < ms.length && markers.length < 40; j++) {
      var el = ms[j]; if (!vis(el)) continue;
      var names = [el.id || ''].concat(String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '').split(/\\s+/));
      for (var k = 0; k < names.length; k++) { var n = names[k]; if (n && !seen[n] && /captcha|challenge|turnstile|geetest|arkose|^cf-/i.test(n)) { seen[n] = 1; markers.push(n.slice(0, 60)); } }
    }
    var pw = false, ps = document.querySelectorAll('input[type=password]');
    for (var p = 0; p < ps.length; p++) { var b = ps[p].getBoundingClientRect(); if (b.width > 0 && b.height > 0) { pw = true; break; } }
    var text = (document.body && document.body.innerText) || '';
    return { url: location.href, title: document.title || '', text: text.slice(0, 30000), frames: frames, markers: markers, passwordField: pw };
  } catch (e) { return { url: location.href, title: document.title || '', text: '', frames: [], markers: [], passwordField: false }; }
})()`;
