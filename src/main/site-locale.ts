// ── Language the SITES receive (Accept-Language, navigator.languages, --lang) ──
// SINGLE SOURCE: follows the user's choice (ui-lang.flag, written by the 'ai:set-lang'
// handler when they switch language in the UI); default = English. Read at BOOT →
// changing the language applies to sites on the next restart (like Chrome).
//
// Centralized HERE on purpose: BEFORE, pt-BR was hardcoded in several places
// (webview Accept-Language, navigator.languages, --lang, the Filmot fetch), and anyone
// using the UI in English/Spanish got everything in Portuguese — a bug where some sites
// (e.g. Reddit) translated titles based on navigator.languages. Any NEW fetch to a site
// must import ACCEPT_LANGUAGE from here, never hardcode a language again.
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export const UI_LANG: 'en' | 'pt' | 'es' = (() => {
  try {
    const f = path.join(app.getPath('userData'), 'ui-lang.flag');
    if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); if (v === 'pt' || v === 'es') return v; }
  } catch {}
  return 'en';
})();

// Chromium locale (boot switch --lang).
export const LANG_SWITCH = UI_LANG === 'pt' ? 'pt-BR' : UI_LANG === 'es' ? 'es' : 'en';

// navigator.languages injected into pages (Reddit and others read THIS to translate).
export const NAV_LANGUAGES = UI_LANG === 'pt' ? ['pt-BR', 'pt', 'en-US', 'en']
  : UI_LANG === 'es' ? ['es-ES', 'es', 'en-US', 'en']
  : ['en-US', 'en'];

// Accept-Language HTTP header sent on every request (kept in sync with navigator).
export const ACCEPT_LANGUAGE = UI_LANG === 'pt' ? 'pt-BR,pt;q=0.9,en;q=0.8'
  : UI_LANG === 'es' ? 'es-ES,es;q=0.9,en;q=0.8'
  : 'en-US,en;q=0.9';
