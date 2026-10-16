// Senhas salvas — regras puras do main (main/password-rules.ts): origem, arquivo, salvar/atualizar,
// CSV do Chrome/Edge, juntar importação e limpar a área de transferência. Só senhas FALSAS aqui.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  originOf, displayHost, isSecureOrigin, sanitizeFile, entriesFor, decideSave, upsertEntry,
  parseCsv, serializeCsv, csvToCredentials, credentialsToCsv, mergeImport, createClipboardGuard,
  MAX_IMPORT_ROWS, PW_TAG, tagSecret, untagSecret, isTaggedSecret, toCsvCell, fromCsvCell, type SavedEntry,
} from '../../src/main/password-rules.ts';

test('marca das senhas: ida e volta; sem marca não é senha do Bah; o decifrador da tela reconhece', () => {
  const tagged = tagSecret('S3nha-falsa');
  assert.ok(tagged.startsWith(PW_TAG));
  assert.strictEqual(untagSecret(tagged), 'S3nha-falsa');
  assert.strictEqual(untagSecret('S3nha-falsa'), null);          // texto cifrado sem a marca (chave de API, lixo)
  assert.strictEqual(untagSecret(tagSecret('')), '');
  assert.strictEqual(isTaggedSecret(tagged), true);
  assert.strictEqual(isTaggedSecret('sk-chave-de-api-falsa'), false);
  assert.strictEqual(isTaggedSecret(undefined), false);
  assert.strictEqual(isTaggedSecret('bah-pw1' + 'x'), false);    // precisa dos \0 em volta
});

test('CSV: célula que vira fórmula no Excel ganha apóstrofo ao exportar e perde ao importar (ida e volta igual)', () => {
  for (const v of ['=1+1', '+55 11 9999', '-abc', '@soma', '\tx', '\rx', "'=x", "''=x"]) {
    assert.ok(toCsvCell(v).startsWith("'"), v);
    assert.strictEqual(fromCsvCell(toCsvCell(v)), v, v);
  }
  for (const v of ['normal', "'a", "''b", 'a=b', 'senha@1', '']) {
    assert.strictEqual(toCsvCell(v), v, v);
    assert.strictEqual(fromCsvCell(v), v, v);
  }
  const csv = credentialsToCsv([{ origin: 'https://x.com', username: '@ana', password: '=HYPERLINK("http://mal")' }]);
  assert.ok(csv.includes(`'@ana,"'=HYPERLINK(""http://mal"")"`));
  assert.deepStrictEqual(csvToCredentials(csv).rows, [{ origin: 'https://x.com', username: '@ana', password: '=HYPERLINK("http://mal")' }]);
});

let n = 0;
const makeId = () => `id${++n}`;
const entry = (origin: string, username: string, lastUsed = 1, id = makeId()): SavedEntry =>
  ({ id, origin, host: displayHost(origin), username, encryptedPassword: 'QUJD', created: 1, lastUsed });

test('originOf: só http/https, com porta, sem caminho; o resto vira ""', () => {
  assert.strictEqual(originOf('https://Accounts.Example.com/login?next=/x#y'), 'https://accounts.example.com');
  assert.strictEqual(originOf('http://localhost:8080/a'), 'http://localhost:8080');
  assert.strictEqual(originOf('https://example.com:443/'), 'https://example.com');
  for (const bad of ['chrome-extension://abc/popup.html', 'file:///C:/x.html', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'android://h@com.app/', 'nada', '', 42, null]) {
    assert.strictEqual(originOf(bad), '', String(bad));
  }
});

test('displayHost tira o www e mantém a porta; isSecureOrigin', () => {
  assert.strictEqual(displayHost('https://www.example.com'), 'example.com');
  assert.strictEqual(displayHost('https://example.com:8443'), 'example.com:8443');
  assert.strictEqual(isSecureOrigin('https://x.com'), true);
  assert.strictEqual(isSecureOrigin('http://x.com'), false);
  assert.strictEqual(isSecureOrigin('http://localhost:3000'), true);
  assert.strictEqual(isSecureOrigin('lixo'), false);
});

test('sanitizeFile: descarta o inválido, junta repetidos (fica o usado por último), refaz id repetido', () => {
  const raw = {
    offerToSave: false,
    entries: [
      { id: 'a', origin: 'https://x.com/login', username: 'ana', encryptedPassword: 'QUJD', created: 5, lastUsed: 10 },
      { id: 'b', origin: 'https://x.com', username: 'ana', encryptedPassword: 'REVG', created: 5, lastUsed: 20 },   // mesma conta, mais nova
      { id: 'a', origin: 'https://y.com', username: 'bia', encryptedPassword: 'R0hJ', created: 1, lastUsed: 1 },    // o 'a' ficou livre
      { id: 'b', origin: 'https://w.com', username: 'wil', encryptedPassword: 'SktM', created: 1, lastUsed: 1 },    // id repetido → id novo
      { id: 'c', origin: 'file:///x', username: 'z', encryptedPassword: 'QUJD' },
      { id: 'd', origin: 'https://z.com', username: 'z', encryptedPassword: '' },
      { id: 'e', origin: 'https://z.com', username: 'z', encryptedPassword: 'não é base64!' },
      { id: 'f', origin: 'https://z.com', username: 42, encryptedPassword: 'QUJD' },
      null, 'lixo',
    ],
    never: ['https://n.com/path', 'chrome://settings', 'https://n.com'],
  };
  const out = sanitizeFile(raw, makeId, 100);
  assert.strictEqual(out.offerToSave, false);
  assert.strictEqual(out.entries.length, 3);
  const ana = out.entries.find(e => e.username === 'ana')!;
  assert.strictEqual(ana.encryptedPassword, 'REVG');
  assert.strictEqual(ana.origin, 'https://x.com');
  assert.strictEqual(ana.id, 'b');
  assert.strictEqual(out.entries.find(e => e.username === 'bia')!.id, 'a');
  const wil = out.entries.find(e => e.username === 'wil')!;
  assert.ok(wil.id !== 'a' && wil.id !== 'b');
  assert.strictEqual(new Set(out.entries.map(e => e.id)).size, 3);
  assert.deepStrictEqual(out.never, ['https://n.com']);
  assert.deepStrictEqual(sanitizeFile('lixo', makeId), { version: 1, offerToSave: true, entries: [], never: [] });
  assert.deepStrictEqual(sanitizeFile(null, makeId).entries, []);
});

test('entriesFor: só a MESMA origem (nada de http↔https, subdomínio ou outra porta), a usada por último primeiro', () => {
  const list = [
    entry('https://x.com', 'velha', 1), entry('https://x.com', 'nova', 9),
    entry('http://x.com', 'h', 5), entry('https://www.x.com', 'w', 5), entry('https://x.com:8443', 'p', 5),
  ];
  assert.deepStrictEqual(entriesFor(list, 'https://x.com').map(e => e.username), ['nova', 'velha']);
  assert.deepStrictEqual(entriesFor(list, 'https://evil.com'), []);
});

test('decideSave: igual → só marca; senha nova → atualizar; conta nova → salvar', () => {
  const known = [{ id: '1', username: 'ana', password: 'S3nha-falsa' }, { id: '2', username: 'bia', password: null }];
  assert.deepStrictEqual(decideSave(known, 'ana', 'S3nha-falsa'), { action: 'touch', entryId: '1' });
  assert.deepStrictEqual(decideSave(known, 'ana', 'outra'), { action: 'update', entryId: '1', username: 'ana' });
  assert.deepStrictEqual(decideSave(known, 'bia', 'x'), { action: 'update', entryId: '2', username: 'bia' });   // cofre não abriu: regrava
  assert.deepStrictEqual(decideSave(known, 'cris', 'x'), { action: 'save', username: 'cris' });
  assert.deepStrictEqual(decideSave(known, 'ana', ''), { action: 'none' });
  assert.deepStrictEqual(decideSave(known, 'ana', 'x'.repeat(2000)), { action: 'none' });
});

test('decideSave sem usuário: senha conhecida → ela; uma conta só → atualizar ela; várias → salvar sem usuário', () => {
  assert.deepStrictEqual(decideSave([{ id: '1', username: 'ana', password: 'p1' }], '', 'p1'), { action: 'touch', entryId: '1' });
  assert.deepStrictEqual(decideSave([{ id: '1', username: 'ana', password: 'p1' }], '', 'p2'), { action: 'update', entryId: '1', username: 'ana' });
  assert.deepStrictEqual(decideSave([{ id: '1', username: 'ana', password: 'p1' }, { id: '2', username: 'bia', password: 'p3' }], '', 'p2'), { action: 'save', username: '' });
  assert.deepStrictEqual(decideSave([], '', 'p2'), { action: 'save', username: '' });
  // Nome apagado pela pessoa no balão (exact): nunca troca a senha da conta que já existe.
  assert.deepStrictEqual(decideSave([{ id: '1', username: 'ana', password: 'p1' }], '', 'p2', true), { action: 'save', username: '' });
  assert.deepStrictEqual(decideSave([{ id: '1', username: 'ana', password: 'p1' }], 'ana', 'p2', true), { action: 'update', entryId: '1', username: 'ana' });
});

test('upsertEntry: troca a senha da conta que existe; senão cria', () => {
  const list = [entry('https://x.com', 'ana', 1, 'fixo')];
  const same = upsertEntry(list, 'https://x.com', 'ana', 'Tk9WQQ==', 50, makeId);
  assert.strictEqual(same.id, 'fixo');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].encryptedPassword, 'Tk9WQQ==');
  assert.strictEqual(list[0].lastUsed, 50);
  upsertEntry(list, 'https://x.com', 'bia', 'QQ==', 60, makeId);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual({ ...list[1], id: '' }, { id: '', origin: 'https://x.com', host: 'x.com', username: 'bia', encryptedPassword: 'QQ==', created: 60, lastUsed: 60 });
});

test('parseCsv: aspas, "" dentro, vírgula e quebra de linha dentro das aspas, CRLF, linha em branco', () => {
  const csv = 'a,b,c\r\n"x,1","diz ""oi""","linha1\nlinha2"\r\n\r\n,,\nfim';
  assert.deepStrictEqual(parseCsv(csv), [['a', 'b', 'c'], ['x,1', 'diz "oi"', 'linha1\nlinha2'], ['', '', ''], ['fim']]);
  assert.deepStrictEqual(parseCsv('a;b\n1;"2;3"\n', ';'), [['a', 'b'], ['1', '2;3']]);
  assert.deepStrictEqual(parseCsv(''), []);
  assert.deepStrictEqual(parseCsv('"",x'), [['', 'x']]);
});

test('serializeCsv ↔ parseCsv: valores chatos voltam iguais', () => {
  const rows = [['name', 'url', 'username', 'password', 'note'], ['x.com', 'https://x.com/', ' ana ', 'a,b"c\nd;e', 'ção ✓']];
  assert.deepStrictEqual(parseCsv(serializeCsv(rows)), rows);
});

test('csvToCredentials: formato do Chrome, com BOM; linhas ruins puladas', () => {
  const csv = '\uFEFFname,url,username,password,note\n' +
    'x.com,https://x.com/login,ana,S3nha-falsa,\n' +
    'app,android://hash@com.app/,bia,p,\n' +          // app do celular: não é site
    'js,javascript:alert(1),c,p,\n' +
    'vazio,https://y.com/,d,,\n' +                     // sem senha
    'semesquema,y.com/entrar,e,p2,\n';                 // alguns gerenciadores exportam sem https://
  const r = csvToCredentials(csv);
  assert.strictEqual(r.recognized, true);
  assert.deepStrictEqual(r.rows, [
    { origin: 'https://x.com', username: 'ana', password: 'S3nha-falsa' },
    { origin: 'https://y.com', username: 'e', password: 'p2' },
  ]);
  assert.strictEqual(r.invalid, 3);
});

test('csvToCredentials: Firefox (aspas), Bitwarden (login_uri), Excel em português (;) e cabeçalho desconhecido', () => {
  const ff = '"url","username","password","httpRealm"\n"https://a.com","u1","p1",""\n';
  assert.deepStrictEqual(csvToCredentials(ff).rows, [{ origin: 'https://a.com', username: 'u1', password: 'p1' }]);
  const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,A,,,0,https://b.com/x,u2,p2,\n';
  assert.deepStrictEqual(csvToCredentials(bw).rows, [{ origin: 'https://b.com', username: 'u2', password: 'p2' }]);
  const excel = 'name;url;username;password\nc;https://c.com;u3;"p;3"\n';
  assert.deepStrictEqual(csvToCredentials(excel).rows, [{ origin: 'https://c.com', username: 'u3', password: 'p;3' }]);
  assert.deepStrictEqual(csvToCredentials('titulo,link\nx,y\n'), { rows: [], invalid: 0, recognized: false });
  assert.deepStrictEqual(csvToCredentials('url,password\nhttps://d.com,p4\n').rows, [{ origin: 'https://d.com', username: '', password: 'p4' }]);
});

test('csvToCredentials: limite de linhas', () => {
  const body = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `n,https://s${i}.com,u,p`).join('\n');
  const r = csvToCredentials('name,url,username,password\n' + body);
  assert.strictEqual(r.rows.length, MAX_IMPORT_ROWS);
  assert.strictEqual(r.invalid, 5);
});

test('credentialsToCsv → csvToCredentials: exporta no formato do Chrome e volta igual', () => {
  const list = [{ origin: 'https://www.x.com', username: 'ana', password: 'a"b,c' }, { origin: 'http://localhost:8080', username: '', password: 'p' }];
  const csv = credentialsToCsv(list);
  assert.ok(csv.startsWith('name,url,username,password,note\n'));
  assert.ok(csv.includes('x.com,https://www.x.com/,ana,"a""b,c",'));
  assert.deepStrictEqual(csvToCredentials(csv).rows, list);
});

test('mergeImport: não duplica; mesma conta com outra senha mantém a guardada; repetida no arquivo vale a 1ª', () => {
  const known = [{ origin: 'https://x.com', username: 'ana', password: 'p1' }, { origin: 'https://y.com', username: 'bia', password: null }];
  const incoming = [
    { origin: 'https://x.com', username: 'ana', password: 'p1' },    // já tinha
    { origin: 'https://x.com', username: 'ana', password: 'p9' },    // conflito
    { origin: 'https://y.com', username: 'bia', password: 'p2' },    // conflito (a guardada não abre, mas existe)
    { origin: 'https://z.com', username: 'cris', password: 'p3' },   // nova
    { origin: 'https://z.com', username: 'cris', password: 'p3' },   // repetida no arquivo
    { origin: 'https://z.com', username: 'cris', password: 'p4' },   // repetida com outra senha
  ];
  const m = mergeImport(known, incoming);
  assert.deepStrictEqual(m.add, [{ origin: 'https://z.com', username: 'cris', password: 'p3' }]);
  assert.strictEqual(m.duplicates, 2);
  assert.strictEqual(m.conflicts, 3);
});

test('createClipboardGuard: limpa em 30 s se ainda for a senha; não mexe se a pessoa copiou outra coisa', async () => {
  let clip = '';
  let cleared = 0;
  let pending: (() => void) | null = null;
  let pendingMs = 0;
  const tick = () => new Promise(r => setImmediate(r));
  const g = createClipboardGuard({
    readText: async () => clip,   // Electron 44: leitura assíncrona
    clear: () => { clip = ''; cleared++; },
    digest: (s) => `h:${s.length}:${s}`,
    setTimer: (fn, ms) => { pending = fn; pendingMs = ms; return 1; },
    clearTimer: () => { pending = null; },
  });
  clip = 'S3nha-falsa'; g.copied(clip);
  assert.strictEqual(pendingMs, 30_000);
  assert.strictEqual(g.pending, true);
  pending!(); await tick();
  assert.strictEqual(cleared, 1);
  assert.strictEqual(clip, '');
  assert.strictEqual(g.pending, false);

  clip = 'S3nha-falsa'; g.copied(clip);
  clip = 'texto que a pessoa copiou depois';
  pending!(); await tick();
  assert.strictEqual(cleared, 1);
  assert.strictEqual(clip, 'texto que a pessoa copiou depois');

  // Copiou a senha de novo enquanto a checagem lia: quem decide é a contagem nova.
  clip = 'S3nha-falsa'; g.copied(clip);
  const fire = pending!;
  fire(); g.copied(clip); await tick();
  assert.strictEqual(cleared, 1);
  assert.strictEqual(g.pending, true);

  // Bah fechando: limpa na hora (e o cronômetro some)
  await g.flush();
  assert.strictEqual(cleared, 2);
  assert.strictEqual(pending, null);
  await g.flush();   // nada pendente: não faz nada
  assert.strictEqual(cleared, 2);
});
