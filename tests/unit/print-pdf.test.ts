import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfFileName, paperSizeFor, isPdfUrl, printableKind, MAX_NAME_CHARS } from '../../src/shared/print-pdf.ts';

// "Salvar como PDF…": nome do arquivo vem do título da página e precisa abrir em qualquer sistema.

test('nome do PDF: título normal vira "titulo.pdf"', () => {
  assert.equal(pdfFileName('Notícias de hoje - G1'), 'Notícias de hoje - G1.pdf');
});

test('nome do PDF: caracteres proibidos no Windows viram espaço, sem espaço repetido', () => {
  assert.equal(pdfFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j.pdf');
  assert.equal(pdfFileName('  muito    espaço \t\n aqui  '), 'muito espaço aqui.pdf');
  assert.equal(pdfFileName('linha\u0000nula\u001Fcontrole'), 'linha nula controle.pdf');
});

test('nome do PDF: sem ponto/espaço no fim nem ponto no começo', () => {
  assert.equal(pdfFileName('Fim com pontos...'), 'Fim com pontos.pdf');
  assert.equal(pdfFileName('.oculto'), 'oculto.pdf');
});

test('nome do PDF: título que já é ".pdf" não vira ".pdf.pdf"', () => {
  assert.equal(pdfFileName('relatorio.PDF'), 'relatorio.pdf');
});

test('nome do PDF: nomes reservados do Windows ganham "_"', () => {
  assert.equal(pdfFileName('CON'), '_CON.pdf');
  assert.equal(pdfFileName('nul.txt'), '_nul.txt.pdf');
  assert.equal(pdfFileName('Console'), 'Console.pdf');
});

test('nome do PDF: marcas invisíveis de direção do texto somem', () => {
  assert.equal(pdfFileName('fatura\u202Efdp.exe'), 'faturafdp.exe.pdf');
});

test('nome do PDF: título enorme é cortado sem quebrar emoji', () => {
  const long = '😀'.repeat(MAX_NAME_CHARS + 50);
  const out = pdfFileName(long);
  assert.equal(Array.from(out.replace(/\.pdf$/, '')).length, MAX_NAME_CHARS);
  assert.ok(!out.includes('\uFFFD'));
  assert.equal(Array.from(out.replace(/\.pdf$/, '')).every(c => c === '😀'), true);
});

test('nome do PDF: sem título usa o site, depois o arquivo local, depois o padrão', () => {
  assert.equal(pdfFileName('', 'https://www.exemplo.com.br/a/b?c=1'), 'exemplo.com.br.pdf');
  assert.equal(pdfFileName('   ', 'file:///C:/Users/ana/Meu%20Doc.html'), 'Meu Doc.pdf');
  assert.equal(pdfFileName(undefined, 'about:blank'), 'pagina.pdf');
  assert.equal(pdfFileName('???', 'nao é url'), 'pagina.pdf');
  assert.equal(pdfFileName(null, undefined, 'page'), 'page.pdf');
});

// Papel: Carta só nos países que usam Carta; A4 no resto (Brasil, Portugal, Espanha…).

test('papel: Brasil, Portugal e Espanha usam A4', () => {
  assert.equal(paperSizeFor('BR'), 'A4');
  assert.equal(paperSizeFor('pt-BR'), 'A4');
  assert.equal(paperSizeFor('pt-PT'), 'A4');
  assert.equal(paperSizeFor('es-ES'), 'A4');
  assert.equal(paperSizeFor('en-GB'), 'A4');
});

test('papel: EUA, Canadá, México e vizinhos usam Carta', () => {
  assert.equal(paperSizeFor('US'), 'Letter');
  assert.equal(paperSizeFor('en-US'), 'Letter');
  assert.equal(paperSizeFor('en_US.UTF-8'), 'Letter');
  assert.equal(paperSizeFor('es-MX'), 'Letter');
  assert.equal(paperSizeFor('fr-CA'), 'Letter');
  assert.equal(paperSizeFor('zh-Hant-PH'), 'Letter');
});

test('papel: a primeira dica com país decide; sem país → A4', () => {
  assert.equal(paperSizeFor('', 'en', 'en-US'), 'Letter');
  assert.equal(paperSizeFor('BR', 'en-US'), 'A4');
  assert.equal(paperSizeFor('en'), 'A4');
  assert.equal(paperSizeFor('us'), 'A4');   // minúsculo = idioma, não país
  assert.equal(paperSizeFor('es-419'), 'A4');
  assert.equal(paperSizeFor(), 'A4');
  assert.equal(paperSizeFor(null, undefined), 'A4');
});

// Quais abas dá pra imprimir.

test('imprimível: sites, arquivos locais, data: e blob: sim', () => {
  assert.equal(printableKind('https://g1.globo.com/'), 'ok');
  assert.equal(printableKind('http://localhost:3000/x'), 'ok');
  assert.equal(printableKind('file:///C:/x.html'), 'ok');
  assert.equal(printableKind('data:text/html,oi'), 'ok');
  assert.equal(printableKind('blob:https://a.com/123'), 'ok');
});

test('imprimível: aba vazia e páginas internas não', () => {
  assert.equal(printableKind(''), 'empty');
  assert.equal(printableKind(undefined), 'empty');
  assert.equal(printableKind('about:blank'), 'empty');
  assert.equal(printableKind('chrome://gpu'), 'internal');
  assert.equal(printableKind('devtools://devtools/bundled/x.html'), 'internal');
  assert.equal(printableKind('chrome-extension://abc/popup.html'), 'internal');
  assert.equal(printableKind('nao é url'), 'internal');
});

test('PDF: reconhece endereço de arquivo .pdf (com ou sem query)', () => {
  assert.equal(isPdfUrl('https://a.com/docs/Manual.PDF'), true);
  assert.equal(isPdfUrl('https://a.com/x.pdf?download=0#page=2'), true);
  assert.equal(isPdfUrl('file:///C:/Users/ana/meu%20arquivo.pdf'), true);
  assert.equal(isPdfUrl('https://a.com/pdf'), false);
  assert.equal(isPdfUrl('https://a.com/?f=x.pdf'), false);
  assert.equal(isPdfUrl(''), false);
  assert.equal(isPdfUrl(42), false);
});
