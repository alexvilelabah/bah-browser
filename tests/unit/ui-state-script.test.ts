// O script de estado da tela (diálogo, EULA, seletor de SO, sugestões, calendário, abas, cartões, login)
// roda na página como texto de um template literal. Uma barra invertida faltando ("/\/(login…" virou
// "//(login…" — um comentário) quebrou o script INTEIRO em silêncio: o .catch devolvia null e nenhum
// estado era detectado. Este teste monta o texto como o App manda pra página e exige que compile.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('the uiState page script is valid JavaScript once the template literal is evaluated', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/renderer/App.tsx'), 'utf8');
  const start = src.indexOf('const uiState = await withTimeout(wv.executeJavaScript(`');
  assert.ok(start > 0, 'uiState script not found');
  const a = src.indexOf('`', start) + 1;
  const b = src.indexOf('`).catch(() => null)', a);
  const body = src.slice(a, b);
  assert.ok(!body.includes('${'), 'script has interpolations: this test must be extended');
  const js = eval('`' + body + '`') as string;
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /\/\\\/\(login\|signin/, 'login path regex keeps its escapes');
  assert.match(js, /split\(\/\\s\+\/\)/, 'cards split keeps \\s');
});
