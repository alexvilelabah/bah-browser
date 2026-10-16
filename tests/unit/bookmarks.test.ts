import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChromeBookmarks, parseNetscapeHtml, flattenBookmarks, mergeFavorites, serializeNetscapeHtml,
  favoritesToExportTree, exportFileName, cleanUrl, cleanTitle, escapeHtml, sanitizeFavorites, countUrls,
  parseChromeProfile, decodeBookmarkHtml, CHROME_BM_FILES,
  BookmarkParseError, MAX_DEPTH, MAX_SOURCE_BYTES, type BookmarkNode,
} from '../../src/shared/bookmarks.ts';

// Importar favoritos do Chrome/Edge/HTML: entrada não confiável, lista plana do Bah, sem repetir URL.

const chromeJson = JSON.stringify({
  checksum: 'x', version: 1,
  roots: {
    bookmark_bar: { type: 'folder', name: 'Barra de favoritos', date_added: '13300000000000000', children: [
      { type: 'url', name: 'Google', url: 'https://www.google.com/', date_added: '13300000000000000' },
      { type: 'folder', name: 'Notícias', children: [
        { type: 'url', name: 'G1', url: 'https://g1.globo.com' },
        { type: 'url', name: 'Mau', url: 'javascript:alert(1)' },
      ] },
    ] },
    other: { type: 'folder', name: 'Outros favoritos', children: [
      { type: 'url', name: 'Arquivo', url: 'file:///C:/x.txt' },
      { type: 'url', name: '  Wiki\u202E  \n', url: 'https://pt.wikipedia.org/wiki/Brasil' },
    ] },
    synced: { type: 'folder', name: 'Favoritos de dispositivos móveis', children: [
      { type: 'url', name: 'Celular', url: 'http://m.example.com/a?b=1&c=2' },
    ] },
  },
});

test('Chrome JSON: bookmark_bar, other e synced, na ordem, só http/https', () => {
  const roots = parseChromeBookmarks(chromeJson);
  assert.deepEqual(roots.map(r => r.title), ['Barra de favoritos', 'Outros favoritos', 'Favoritos de dispositivos móveis']);
  assert.equal(roots[0].kind === 'folder' && roots[0].toolbar, true, 'a barra vira a pasta da barra');
  const flat = flattenBookmarks(roots);
  assert.deepEqual(flat.map(f => f.url), [
    'https://www.google.com/', 'https://g1.globo.com/', 'https://pt.wikipedia.org/wiki/Brasil', 'http://m.example.com/a?b=1&c=2',
  ]);
  assert.equal(flat[2].title, 'Wiki', 'controles/bidi/espaços limpos');
  const news = (roots[0] as any).children[1];
  assert.equal(news.kind, 'folder');
  assert.equal(news.title, 'Notícias', 'estrutura de pastas preservada');
  // date_added (µs desde 1601) → segundos unix
  assert.equal((roots[0] as any).children[0].addDate, 13300000000 - 11644473600);
});

test('Chrome JSON: raiz vazia some, formato errado e lixo dão erro claro', () => {
  const roots = parseChromeBookmarks({ roots: { bookmark_bar: { type: 'folder', children: [] }, other: { type: 'folder', children: [{ type: 'url', url: 'https://a.com' }] } } });
  assert.equal(roots.length, 1);
  assert.throws(() => parseChromeBookmarks('{not json'), (e: any) => e instanceof BookmarkParseError && e.code === 'bad-format');
  assert.throws(() => parseChromeBookmarks('{"foo":1}'), (e: any) => e.code === 'bad-format');
  assert.throws(() => parseChromeBookmarks(' '.repeat(MAX_SOURCE_BYTES + 1)), (e: any) => e.code === 'too-big');
});

test('Chrome JSON: pastas fundas demais viram planas sem perder links', () => {
  let node: any = { type: 'url', name: 'Fundo', url: 'https://deep.example/' };
  for (let i = 0; i < MAX_DEPTH + 20; i++) node = { type: 'folder', name: `n${i}`, children: [node] };
  const roots = parseChromeBookmarks({ roots: { bookmark_bar: node } });
  assert.equal(countUrls(roots), 1);
  let depth = 0;
  let cur: BookmarkNode | undefined = roots[0];
  while (cur && cur.kind === 'folder') { depth++; cur = cur.children[0]; }
  assert.ok(depth <= MAX_DEPTH + 1, `profundidade ${depth}`);
  assert.equal(cur?.kind === 'url' && cur.url, 'https://deep.example/');
});

const firefoxHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://www.mozilla.org/pt-BR/" ADD_DATE="1700000001" ICON="data:image/png;base64,AAAA">Mozilla &amp; amigos</A>
        <DT><H3>Pasta &lt;dentro&gt;</H3>
        <DD>descrição ignorada
        <DL><p>
            <dt><a href='https://exemplo.com.br/busca?q=a&amp;b=c'>Busca <b>negrito</b></a>
            <DT><A HREF="place:sort=8&maxResults=10">Recentes</A>
            <DT><A HREF="javascript:alert(document.cookie)">XSS</A>
            <DT><A HREF="data:text/html,<script>alert(1)</script>">Data</A>
        </DL><p>
        <DT><H3>Vazia</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://solto.example/">&#8220;Aspas&#8221; &#x41;</A>
</DL>
`;

test('HTML Netscape: pastas, entidades, tags no título e só http/https', () => {
  const nodes = parseNetscapeHtml(firefoxHtml);
  assert.equal(nodes.length, 2);
  const tb = nodes[0];
  assert.ok(tb.kind === 'folder' && tb.toolbar && tb.title === 'Bookmarks Toolbar');
  const flat = flattenBookmarks(nodes);
  assert.deepEqual(flat, [
    { url: 'https://www.mozilla.org/pt-BR/', title: 'Mozilla & amigos' },
    { url: 'https://exemplo.com.br/busca?q=a&b=c', title: 'Busca negrito' },
    { url: 'https://solto.example/', title: '“Aspas” A' },
  ]);
  const inner = (tb as any).children[1];
  assert.equal(inner.title, 'Pasta <dentro>');
  assert.equal((tb as any).children.length, 2, 'pasta vazia some');
  assert.equal((tb as any).children[0].addDate, 1700000001);
});

test('HTML Netscape: torto ou gigante não quebra nem trava', () => {
  assert.throws(() => parseNetscapeHtml(''), (e: any) => e instanceof BookmarkParseError && e.code === 'bad-format');
  assert.throws(() => parseNetscapeHtml('<html><body>oi</body></html>'), (e: any) => e.code === 'bad-format');
  // </DL> sobrando e <A> sem fechar
  const flat = flattenBookmarks(parseNetscapeHtml('</DL></DL><DL><DT><A HREF="https://a.com/">A<DT><A HREF="https://b.com/">B</A></DL>'));
  assert.equal(flat.length, 2);
  assert.throws(() => parseNetscapeHtml('x'.repeat(MAX_SOURCE_BYTES + 1)), (e: any) => e.code === 'too-big');
  // aninhamento absurdo: limita a profundidade
  const deep = '<DL><p>' + '<DT><H3>p</H3><DL><p>'.repeat(200) + '<DT><A HREF="https://fundo.com/">F</A>' + '</DL><p>'.repeat(201);
  const nodes = parseNetscapeHtml(deep);
  assert.equal(countUrls(nodes), 1);
  let depth = 0; let cur: BookmarkNode | undefined = nodes[0];
  while (cur && cur.kind === 'folder') { depth++; cur = cur.children[0]; }
  assert.ok(depth <= MAX_DEPTH, `profundidade ${depth}`);
  // 20k links: rápido (linear)
  const big = '<DL><p>' + Array.from({ length: 20000 }, (_, i) => `<DT><A HREF="https://s${i}.example/">Site ${i}</A>`).join('\n') + '</DL>';
  const t0 = Date.now();
  assert.equal(flattenBookmarks(parseNetscapeHtml(big)).length, 20000);
  assert.ok(Date.now() - t0 < 2000, 'parse de 20k em menos de 2 s');
});

test('exportar → reimportar dá a mesma árvore (round-trip)', () => {
  const tree: BookmarkNode[] = [
    { kind: 'folder', title: 'Barra de favoritos', toolbar: true, addDate: 1700000000, children: [
      { kind: 'url', title: 'A & B <c> "d" \'e\'', url: 'https://a.example/?x=1&y=2', addDate: 1700000001 },
      { kind: 'folder', title: 'Sub', addDate: 1700000002, children: [
        { kind: 'url', title: 'Ç ã é 🙂', url: 'https://b.example/caminho%20com%20espa%C3%A7o', addDate: 1700000003 },
      ] },
    ] },
    { kind: 'url', title: 'Fora', url: 'http://c.example/', addDate: 1700000004 },
  ];
  const html = serializeNetscapeHtml(tree, { title: 'Favoritos', now: 1800000000 });
  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.match(html, /charset=UTF-8/);
  assert.match(html, /PERSONAL_TOOLBAR_FOLDER="true"/);
  assert.ok(!html.includes('<c>'), 'título escapado');
  assert.match(html, /HREF="https:\/\/a\.example\/\?x=1&amp;y=2"/);
  assert.deepEqual(parseNetscapeHtml(html), tree);
});

test('export nunca grava link perigoso nem título que quebra o HTML', () => {
  const html = serializeNetscapeHtml([
    { kind: 'url', title: '</A><script>alert(1)</script>', url: 'https://ok.example/' },
    { kind: 'url', title: 'mau', url: 'javascript:alert(1)' },
  ], { now: 1 });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.equal(flattenBookmarks(parseNetscapeHtml(html))[0].title, '</A><script>alert(1)</script>');
});

test('juntar: pula URL repetida (já existente e dentro do import), mantém títulos, respeita o teto', () => {
  const existing = [{ url: 'https://www.google.com/', title: 'Meu Google' }, { url: 'https://g1.globo.com', title: 'G1' }];
  const incoming = [
    { url: 'https://www.google.com/', title: 'Google' },          // já tinha
    { url: 'https://g1.globo.com/', title: 'G1 de novo' },        // já tinha (sem a barra final)
    { url: 'https://novo.example/', title: 'Novo' },
    { url: 'https://novo.example/', title: 'Novo repetido' },     // repetido no próprio arquivo
    { url: 'https://semtitulo.example/', title: '' },
    { url: 'ftp://x.example/', title: 'ftp' },                    // ignorado
  ];
  const m = mergeFavorites(existing, incoming);
  assert.equal(m.added, 2);
  assert.equal(m.duplicates, 3);
  assert.deepEqual(m.list.slice(0, 2), existing, 'os que já existiam continuam na frente, intactos');
  assert.deepEqual(m.list.slice(2), [{ url: 'https://novo.example/', title: 'Novo' }, { url: 'https://semtitulo.example/', title: 'https://semtitulo.example/' }]);
  const capped = mergeFavorites([], [{ url: 'https://a.com', title: 'a' }, { url: 'https://b.com', title: 'b' }, { url: 'https://c.com', title: 'c' }], 2);
  assert.equal(capped.added, 2);
  assert.equal(capped.overLimit, 1);
});

test('URL e título: filtros', () => {
  assert.equal(cleanUrl('https://Exemplo.COM'), 'https://exemplo.com/');
  assert.equal(cleanUrl('  http://a.b/c  '), 'http://a.b/c');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', 'file:///etc/passwd', 'chrome://settings', 'place:x', 'about:blank', '', 'nada', 42, null, 'https://' + 'a'.repeat(5000) + '.com'])
    assert.equal(cleanUrl(bad), null, String(bad).slice(0, 30));
  assert.equal(cleanTitle('a\u0000b\tc\u200Bd'), 'a b c d');
  assert.equal(cleanTitle('x'.repeat(1000)).length, 300);
  assert.equal(cleanTitle(undefined), '');
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('export da lista do Bah: tudo na barra, lixo vindo do IPC é descartado, nome com data', () => {
  const tree = favoritesToExportTree([{ url: 'https://a.com', title: 'A' }, { url: 'javascript:x', title: 'mau' }, null as any, { url: 'https://a.com/', title: 'dup' }], 'Barra de favoritos');
  assert.equal(tree.length, 1);
  assert.ok(tree[0].kind === 'folder' && tree[0].toolbar && tree[0].children.length === 1);
  assert.deepEqual(sanitizeFavorites('nope'), []);
  assert.equal(exportFileName(new Date(2026, 9, 5)), 'bah-favoritos-2026-10-05.html');
});

test('Chrome logado: lê AccountBookmarks (conta primeiro), junta com Bookmarks sem repetir', () => {
  assert.deepEqual([...CHROME_BM_FILES], ['AccountBookmarks', 'Bookmarks']);
  const acct = JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [
    { type: 'url', name: 'Conta A', url: 'https://a.example/' },
    { type: 'url', name: 'Conta B', url: 'https://b.example' },
  ] } } });
  const local = JSON.stringify({ roots: { other: { type: 'folder', children: [
    { type: 'url', name: 'Local B', url: 'https://b.example/' },      // mesma URL da conta (normalizada)
    { type: 'url', name: 'Local C', url: 'https://c.example/' },
  ] } } });
  // Perfil só com AccountBookmarks (o "Bookmarks" nem existe).
  assert.deepEqual(parseChromeProfile([{ text: acct }]).map(f => f.title), ['Conta A', 'Conta B']);
  // Os dois arquivos: conta primeiro, URL repetida conta uma vez só.
  const both = parseChromeProfile([{ text: acct }, { text: local }]);
  assert.deepEqual(both.map(f => f.title), ['Conta A', 'Conta B', 'Local C']);
  // "Bookmarks" vazio do Chrome logado (0 favoritos) não esconde os da conta.
  const emptyLocal = JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [] } } });
  assert.equal(parseChromeProfile([{ text: acct }, { text: emptyLocal }]).length, 2);
  // Um arquivo quebrado não estraga o outro; os dois quebrados → erro.
  assert.equal(parseChromeProfile([{ text: '{lixo' }, { text: local }]).length, 2);
  assert.equal(parseChromeProfile([{ error: new Error('EBUSY') }, { text: acct }]).length, 2);
  assert.throws(() => parseChromeProfile([{ text: '{lixo' }, { text: '{x' }]), (e: any) => e.code === 'bad-format');
  assert.deepEqual(parseChromeProfile([]), []);
});

test('HTML Netscape: títulos com İ (export turco) não deslocam nem perdem favoritos', () => {
  const T = 'İİİİİİİİİİ';
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n' +
    Array.from({ length: 6 }, (_, i) => `<DT><A HREF="https://e${i}.com/">${T} ${i}</A>`).join('\n') + '\n</DL><p>';
  const flat = flattenBookmarks(parseNetscapeHtml(html));
  assert.deepEqual(flat, Array.from({ length: 6 }, (_, i) => ({ url: `https://e${i}.com/`, title: `${T} ${i}` })));
});

test('HTML Netscape: página qualquer (não é arquivo de favoritos) dá bad-format', () => {
  const page = '<!doctype html><html><head><title>Notícia</title></head><body><nav>' +
    '<a href="https://jornal.example/">Home</a> <a href="https://jornal.example/x">aqui</a></nav>' +
    '<p>texto <a href="https://outro.example/">link</a></p></body></html>';
  assert.throws(() => parseNetscapeHtml(page), (e: any) => e instanceof BookmarkParseError && e.code === 'bad-format');
  // Sem doctype, mas com <DT><A> (export de ferramenta de terceiros): aceita.
  assert.equal(countUrls(parseNetscapeHtml('<dl><dt><a href="https://ok.example/">ok</a></dl>')), 1);
});

test('HTML: decodifica pelo charset declarado (windows-1252) e mantém UTF-8/UTF-16', () => {
  const head = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1252">\n<DL><p><DT><A HREF="https://n.example/">Not';
  const cp1252 = Uint8Array.from([...Buffer.from(head, 'latin1'), 0xed, ...Buffer.from('cias</A></DL>', 'latin1')]);
  const text = decodeBookmarkHtml(cp1252);
  assert.equal(flattenBookmarks(parseNetscapeHtml(text))[0].title, 'Notícias');
  // UTF-8 válido (com BOM) continua UTF-8.
  const utf8 = new TextEncoder().encode('\uFEFF<DL><DT><A HREF="https://u.example/">Ação 🙂</A></DL>');
  assert.equal(flattenBookmarks(parseNetscapeHtml(decodeBookmarkHtml(utf8)))[0].title, 'Ação 🙂');
  // Sem charset e sem ser UTF-8 válido → windows-1252; charset desconhecido também.
  assert.equal(decodeBookmarkHtml(Uint8Array.from([0x4e, 0xe3, 0x6f])), 'Não');
  assert.equal(decodeBookmarkHtml(Uint8Array.from([...Buffer.from('<meta charset="x-nada">', 'latin1'), 0xe9])).slice(-1), 'é');
  const u16 = Uint8Array.from([0xff, 0xfe, ...Buffer.from('<DL>ç', 'utf16le')]);
  assert.equal(decodeBookmarkHtml(u16), '<DL>ç');
});

test('juntar: teto de caracteres protege o localStorage (resto conta como "não coube")', () => {
  const long = (i: number) => ({ url: `https://s${i}.example/` + 'x'.repeat(200), title: `T${i}` });
  const incoming = Array.from({ length: 100 }, (_, i) => long(i));
  const m = mergeFavorites([], incoming, 15_000, 5_000);
  assert.ok(m.added > 0 && m.added < 100, `entraram ${m.added}`);
  assert.equal(m.added + m.overLimit, 100);
  assert.ok(JSON.stringify(m.list).length <= 5_000, 'JSON salvo cabe no teto');
  // Lista que já passou do teto: nada novo entra, mas nada do que existia some.
  const full = mergeFavorites(m.list, [{ url: 'https://novo.example/', title: 'n' }], 15_000, 100);
  assert.equal(full.added, 0);
  assert.equal(full.overLimit, 1);
  assert.equal(full.list.length, m.list.length);
  // Exportar (sanitize) nunca corta pelo teto de caracteres.
  assert.equal(sanitizeFavorites(Array.from({ length: 20_000 }, (_, i) => long(i))).length, 15_000);
});
