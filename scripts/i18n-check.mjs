// Rede de segurança do i18n: garante que TODA chave existe em en, pt e es —
// tanto na UI (src/renderer/i18n.ts) quanto nos menus nativos (src/main/main.ts).
// Roda no build (prebuild): se faltar uma tradução em qualquer idioma, o build FALHA
// com a lista do que falta. Assim é impossível shipar a interface pela metade.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'pt', 'es'];

// Extrai o conjunto de chaves de um bloco de idioma (`  <lang>: { 'chave': '...', ... }`).
function blockKeys(text, lang) {
  const openOf = (l) => text.indexOf(`\n  ${l}: {`);
  const start = openOf(lang);
  if (start < 0) return null;
  let end = text.length;
  for (const other of LANGS) {
    if (other === lang) continue;
    const p = openOf(other);
    if (p > start && p < end) end = p;          // próximo bloco de idioma
  }
  const close = text.indexOf('\n};', start);
  if (close >= 0 && close < end) end = close;   // fim do objeto (último idioma)
  const seg = text.slice(start, end);
  const keys = new Set();
  const re = /'([A-Za-z][A-Za-z0-9_.]*)'\s*:/g;  // só 'chave': — valores não casam
  let m;
  while ((m = re.exec(seg))) keys.add(m[1]);
  return keys;
}

function check(label, file) {
  const text = readFileSync(join(root, file), 'utf8');
  const sets = {};
  for (const l of LANGS) {
    const k = blockKeys(text, l);
    if (!k) { console.error(`✗ ${label}: bloco do idioma "${l}" não encontrado em ${file}`); return false; }
    sets[l] = k;
  }
  const all = new Set([...sets.en, ...sets.pt, ...sets.es]);
  let ok = true;
  for (const key of [...all].sort()) {
    const missing = LANGS.filter(l => !sets[l].has(key));
    if (missing.length) { ok = false; console.error(`✗ ${label}: chave "${key}" falta em: ${missing.join(', ')}`); }
  }
  if (ok) console.log(`✓ ${label}: ${sets.en.size} chaves × ${LANGS.length} idiomas em paridade.`);
  return ok;
}

let allOk = true;
allOk = check('UI (renderer/i18n.ts)', 'src/renderer/i18n.ts') && allOk;
allOk = check('Menus nativos (main.ts)', 'src/main/main.ts') && allOk;

if (!allOk) {
  console.error('\n💡 Toda chave de texto precisa existir em en, pt E es. Adicione a(s) que falta(m) e rode de novo.');
  process.exit(1);
}
console.log('\ni18n OK — en/pt/es em paridade total. 🌐');
