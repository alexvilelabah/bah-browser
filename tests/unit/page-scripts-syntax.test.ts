// Os scripts que App.tsx injeta nas páginas são TEXTO dentro de template literal: um "\/" ou "\b"
// com uma barra só vira outra coisa ("//" = comentário) e o script inteiro deixa de rodar sem erro
// visível (o .catch devolve null). Foi o que matou a detecção de diálogo/EULA/seletor de SO.
// Aqui cada template sem interpolação é avaliado como o JS o veria e precisa ser JS válido.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.join(import.meta.dirname, '../../src/renderer/App.tsx');

function pageScripts(src: string): Array<{ line: number; code: string }> {
  const out: Array<{ line: number; code: string }> = [];
  const re = /executeJavaScript\(`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    // fim do template: o próximo ` não escapado
    let i = start;
    while (i < src.length && !(src[i] === '`' && src[i - 1] !== '\\')) i++;
    const tpl = src.slice(start, i);
    if (tpl.includes('${')) continue;   // com interpolação: valores de runtime, fora deste teste
    out.push({ line: src.slice(0, m.index).split('\n').length, code: eval('`' + tpl + '`') });
  }
  return out;
}

test('every interpolation-free page script in App.tsx is valid JavaScript', () => {
  const scripts = pageScripts(fs.readFileSync(APP, 'utf8'));
  assert.ok(scripts.length >= 3, 'found the page scripts');
  for (const s of scripts) {
    try { new Function(s.code); } catch (e: any) { assert.fail(`App.tsx:${s.line} page script does not parse: ${e.message}`); }
  }
});
