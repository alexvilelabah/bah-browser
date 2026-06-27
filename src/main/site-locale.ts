// ── Idioma que os SITES recebem (Accept-Language, navigator.languages, --lang) ──
// FONTE ÚNICA: segue a escolha da pessoa (ui-lang.flag, escrito pelo handler
// 'ai:set-lang' quando ela troca de idioma na UI); padrão = inglês. Lido no BOOT →
// trocar o idioma aplica nos sites no próximo restart (igual ao Chrome).
//
// Centralizado AQUI de propósito: ANTES o pt-BR estava cravado em vários lugares
// (Accept-Language do webview, navigator.languages, --lang, fetch do Filmot), e quem
// usava a UI em inglês/espanhol recebia tudo em português — o bug do tarkam, em que o
// Reddit traduzia os títulos pelo navigator.languages. Qualquer fetch NOVO a um site
// deve importar ACCEPT_LANGUAGE daqui, nunca cravar idioma de novo.
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

// Locale do Chromium (switch de boot --lang).
export const LANG_SWITCH = UI_LANG === 'pt' ? 'pt-BR' : UI_LANG === 'es' ? 'es' : 'en';

// navigator.languages injetado nas páginas (o Reddit e outros leem ISTO pra traduzir).
export const NAV_LANGUAGES = UI_LANG === 'pt' ? ['pt-BR', 'pt', 'en-US', 'en']
  : UI_LANG === 'es' ? ['es-ES', 'es', 'en-US', 'en']
  : ['en-US', 'en'];

// Header HTTP Accept-Language enviado em toda requisição (mantém igual ao navigator).
export const ACCEPT_LANGUAGE = UI_LANG === 'pt' ? 'pt-BR,pt;q=0.9,en;q=0.8'
  : UI_LANG === 'es' ? 'es-ES,es;q=0.9,en;q=0.8'
  : 'en-US,en;q=0.9';
