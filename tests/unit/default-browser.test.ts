// Bah como navegador padrão: o que entra de fora (linha de comando / macOS), o que o clique grava
// no registro do Windows, o que o desinstalador apaga e como se lê o `reg query`. Nada aqui toca no
// registro nem no disco de verdade (o "existe esse arquivo?" é de mentira).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  launchTargets, launchTarget, windowsRegistrationPlan, regAddArgs, regQueryValue, userChoiceKeys,
  isBahDefault, exeMark, openCommand, isRegistrableExe, UNINSTALL_KEYS, UNINSTALL_VALUES, MAX_LAUNCH_TARGETS,
  PROG_ID_URL, EXE_MARK_VALUE, WINDOWS_SETTINGS_URIS, type LaunchEnv,
} from '../../src/main/default-browser-rules.ts';

// Arquivos que "existem" no PC de mentira (Windows).
const FILES = new Set([
  'C:\\Users\\Ana\\Downloads\\a b.html', 'C:\\Users\\Ana\\Downloads\\boleto.pdf', 'C:\\Users\\Ana\\Docs\\rel\\p.PDF',
  'C:\\Users\\Ana\\Downloads\\x.svg', 'C:\\Users\\Ana\\Downloads\\foto.webp', 'C:\\Users\\Ana\\Downloads\\pagina.xhtml',
  'C:\\Users\\Ana\\Downloads\\virus.exe', 'C:\\Users\\Ana\\Downloads\\atalho.lnk', 'C:\\Users\\Ana\\Downloads\\nota.txt',
  'C:\\Users\\Ana\\Downloads\\evil.html',
]);
const seen: string[] = [];
const win: LaunchEnv = { cwd: 'C:\\Users\\Ana\\Docs', platform: 'win32', isFile: (p) => { seen.push(p); return FILES.has(p); } };
const urls = (args: string[], env: LaunchEnv = win) => launchTargets(args, env).map(t => t.url);

test('registrado ("Bah.exe" -- "%1"): o link vira UMA aba http(s)', () => {
  assert.deepStrictEqual(launchTargets(['--', 'https://example.com/a?b=1#c'], win), [{ url: 'https://example.com/a?b=1#c', noScript: false }]);
  assert.deepStrictEqual(urls(['--', 'HTTP://Example.COM']), ['http://example.com/']);
  assert.deepStrictEqual(urls(['--', '  https://ex.com/a b  ']), ['https://ex.com/a%20b']);
  assert.deepStrictEqual(urls(['--']), []);
  assert.deepStrictEqual(urls([]), []);
});

test('link com aspas partido em pedaços depois do "--": continua UM endereço só (nunca um arquivo escondido)', () => {
  // %1 = https://a.com/x" "C:\Users\Ana\Downloads\evil.html → o Windows entrega 2 argumentos
  const got = launchTargets(['--', 'https://a.com/x', 'C:\\Users\\Ana\\Downloads\\evil.html'], win);
  assert.strictEqual(got.length, 1);
  assert.ok(got[0].url.startsWith('https://a.com/'), got[0].url);
  assert.ok(!got.some(t => t.url.startsWith('file:')));
  // nem opção do Chromium escondida depois do "--"
  assert.deepStrictEqual(urls(['--', '--renderer-cmd-prefix=calc.exe']), []);
  assert.deepStrictEqual(urls(['--', 'https://a.com/', '--gpu-launcher=calc']).length, 1);
});

test('opções do Chromium/Electron e do atualizador são ignoradas', () => {
  assert.deepStrictEqual(urls(['--updated', '--allow-file-access-from-files', '/prefetch:1', '-x', '--user-data-dir=C:\\perfil']), []);
  assert.deepStrictEqual(urls(['--force-run', 'https://ex.com/']), ['https://ex.com/']);
});

test('esquemas perigosos ou de outros apps ficam de fora', () => {
  for (const s of [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'mailto:a@b.c',
    'chrome://settings', 'about:blank', 'ms-settings:defaultapps', 'magnet:?xt=urn:btih:abc', 'ftp://ex.com/a',
    'file://servidor/share/a.html', 'https://', 'www.google.com',
  ]) assert.deepStrictEqual(urls([s]), [], s);
});

test('usuário:senha no link sai (o disfarce "banco.com.br@golpe.com")', () => {
  assert.deepStrictEqual(urls(['--', 'https://www.banco.com.br:senha@golpe.com/entrar']), ['https://golpe.com/entrar']);
});

test('arquivo do computador: só os tipos que o Bah mostra, só se existir; .html/.svg/.xhtml sem JavaScript', () => {
  assert.deepStrictEqual(launchTargets(['--', 'C:\\Users\\Ana\\Downloads\\a b.html'], win),
    [{ url: 'file:///C:/Users/Ana/Downloads/a%20b.html', noScript: true }]);
  assert.deepStrictEqual(launchTargets(['C:\\Users\\Ana\\Downloads\\boleto.pdf'], win),
    [{ url: 'file:///C:/Users/Ana/Downloads/boleto.pdf', noScript: false }]);
  assert.deepStrictEqual(launchTargets(['C:\\Users\\Ana\\Downloads\\foto.webp'], win)[0].noScript, false);
  assert.deepStrictEqual(launchTargets(['C:\\Users\\Ana\\Downloads\\x.svg'], win)[0].noScript, true);
  assert.deepStrictEqual(launchTargets(['C:\\Users\\Ana\\Downloads\\pagina.xhtml'], win)[0].noScript, true);
  // relativo à pasta de quem chamou; extensão sem diferenciar maiúscula
  assert.deepStrictEqual(urls(['rel\\p.PDF']), ['file:///C:/Users/Ana/Docs/rel/p.PDF']);
  // programa, atalho, texto, inexistente, pasta: nada
  for (const p of ['C:\\Users\\Ana\\Downloads\\virus.exe', 'C:\\Users\\Ana\\Downloads\\atalho.lnk', 'C:\\Users\\Ana\\Downloads\\nota.txt',
    'C:\\Users\\Ana\\Downloads\\sumiu.html', 'C:\\Users\\Ana\\Downloads']) assert.deepStrictEqual(urls([p]), [], p);
  // fluxo alternativo do NTFS e ponto no fim não passam pela extensão
  assert.deepStrictEqual(urls(['C:\\Users\\Ana\\Downloads\\a b.html:fluxo']), []);
  assert.deepStrictEqual(urls(['C:\\Users\\Ana\\Downloads\\a b.html.']), []);
  // file:// local vale com as mesmas regras
  assert.deepStrictEqual(launchTargets(['--', 'file:///C:/Users/Ana/Downloads/boleto.pdf'], win),
    [{ url: 'file:///C:/Users/Ana/Downloads/boleto.pdf', noScript: false }]);
});

test('pasta de rede e caminho de dispositivo: recusados ANTES de olhar o disco (não conecta no servidor)', () => {
  seen.length = 0;
  for (const p of ['\\\\servidor\\share\\a.html', '//servidor/share/a.html', '\\\\?\\C:\\Users\\Ana\\Downloads\\a b.html', '\\\\.\\pipe\\x.html']) {
    assert.deepStrictEqual(urls(['--', p]), [], p);
  }
  assert.deepStrictEqual(urls(['a.html'], { ...win, cwd: '\\\\servidor\\share' }), []);
  assert.deepStrictEqual(seen, []);
});

test('sem "--" (arrastar pro ícone): cada argumento; repetido conta uma vez; teto de abas', () => {
  assert.deepStrictEqual(urls(['https://a.com/', 'C:\\Users\\Ana\\Downloads\\boleto.pdf', 'https://a.com/']),
    ['https://a.com/', 'file:///C:/Users/Ana/Downloads/boleto.pdf']);
  const many = Array.from({ length: 60 }, (_, i) => `https://a.com/${i}`);
  assert.strictEqual(urls(many).length, MAX_LAUNCH_TARGETS);
  assert.deepStrictEqual(urls(['https://a.com/' + 'x'.repeat(40000)]), []);
  assert.deepStrictEqual(urls(['https://a.com/\0x']), []);
});

test('macOS: caminho absoluto não é opção; open-url/open-file passam pelas mesmas regras', () => {
  const mac: LaunchEnv = { cwd: '/Users/ana', platform: 'darwin', isFile: (p) => p === '/Users/ana/Downloads/a.html' };
  assert.deepStrictEqual(launchTargets(['/Users/ana/Downloads/a.html'], mac), [{ url: 'file:///Users/ana/Downloads/a.html', noScript: true }]);
  assert.deepStrictEqual(launchTarget('https://ex.com', mac), { url: 'https://ex.com/', noScript: false });
  assert.strictEqual(launchTarget('javascript:alert(1)', mac), null);
  // no Windows, "/x" é opção do Chromium
  assert.deepStrictEqual(urls(['/Users/ana/Downloads/a.html']), []);
});

const EXE = 'C:\\Users\\Ana Paula\\AppData\\Local\\Programs\\Bah\\Bah.exe';

test('comando registrado: exe entre aspas (caminho com espaço), "--" ANTES do "%1"', () => {
  assert.strictEqual(openCommand(EXE), '"C:\\Users\\Ana Paula\\AppData\\Local\\Programs\\Bah\\Bah.exe" -- "%1"');
  // O que o Windows entrega com esse comando para um link qualquer (aspas já tiradas): 1 aba.
  assert.deepStrictEqual(urls(['--', 'https://ex.com/a b']), ['https://ex.com/a%20b']);
});

test('isRegistrableExe: só caminho absoluto de .exe, sem aspas nem %', () => {
  assert.ok(isRegistrableExe(EXE));
  assert.ok(isRegistrableExe('C:\\Program Files\\Bah\\Bah.exe'));
  for (const bad of ['Bah.exe', 'C:\\x\\Bah.cmd', 'C:\\x"\\Bah.exe', 'C:\\100%\\Bah.exe', 'C:\\x\nBah.exe', '', '/Applications/Bah.app']) {
    assert.ok(!isRegistrableExe(bad), bad);
    assert.throws(() => windowsRegistrationPlan(bad, 'x'));
  }
});

test('plano do registro: exatamente isto, tudo em HKCU', () => {
  const icon = `${EXE},0`;
  const cmd = openCommand(EXE);
  const C = 'HKCU\\Software\\Clients\\StartMenuInternet\\Bah';
  const app = (k: string) => [
    { key: `${k}\\Application`, name: 'ApplicationName', data: 'Bah' },
    { key: `${k}\\Application`, name: 'ApplicationDescription', data: 'Navegador com IA' },
    { key: `${k}\\Application`, name: 'ApplicationIcon', data: icon },
    { key: `${k}\\Application`, name: 'AppUserModelId', data: 'com.vilelalab.bah' },
    { key: `${k}\\DefaultIcon`, name: null, data: icon },
    { key: `${k}\\shell\\open\\command`, name: null, data: cmd },
  ];
  assert.deepStrictEqual(windowsRegistrationPlan(EXE, 'Navegador com IA'), [
    { key: C, name: null, data: 'Bah' },
    { key: `${C}\\Capabilities`, name: 'ApplicationName', data: 'Bah' },
    { key: `${C}\\Capabilities`, name: 'ApplicationDescription', data: 'Navegador com IA' },
    { key: `${C}\\Capabilities`, name: 'ApplicationIcon', data: icon },
    ...['.htm', '.html', '.xhtml', '.svg', '.webp', '.pdf'].map(ext => ({ key: `${C}\\Capabilities\\FileAssociations`, name: ext, data: 'BahHTML' })),
    { key: `${C}\\Capabilities\\URLAssociations`, name: 'http', data: 'BahURL' },
    { key: `${C}\\Capabilities\\URLAssociations`, name: 'https', data: 'BahURL' },
    { key: `${C}\\Capabilities\\StartMenu`, name: 'StartMenuInternet', data: 'Bah' },
    { key: `${C}\\DefaultIcon`, name: null, data: icon },
    { key: `${C}\\shell\\open\\command`, name: null, data: `"${EXE}"` },
    { key: 'HKCU\\Software\\RegisteredApplications', name: 'Bah', data: 'Software\\Clients\\StartMenuInternet\\Bah\\Capabilities' },
    { key: 'HKCU\\Software\\Classes\\BahURL', name: null, data: 'Bah URL' },
    { key: 'HKCU\\Software\\Classes\\BahURL', name: EXE_MARK_VALUE, data: exeMark(EXE) },
    ...app('HKCU\\Software\\Classes\\BahURL'),
    { key: 'HKCU\\Software\\Classes\\BahHTML', name: null, data: 'Bah HTML Document' },
    ...app('HKCU\\Software\\Classes\\BahHTML'),
  ]);
});

test('plano do registro: nada fora das chaves que o desinstalador apaga; nada que o reg.exe leia torto', () => {
  const plan = windowsRegistrationPlan(EXE, 'linha1\nlinha2');
  // sem "URL Protocol": o BahURL não vira um protocolo "bahurl:" que qualquer página chamaria
  assert.ok(!plan.some(v => v.name === 'URL Protocol'));
  for (const v of plan) {
    assert.ok(v.key.startsWith('HKCU\\Software\\'), v.key);
    const rel = v.key.slice('HKCU\\'.length);
    const underKey = UNINSTALL_KEYS.some(k => rel === k || rel.startsWith(k + '\\'));
    const isValue = UNINSTALL_VALUES.some(u => u.key === rel && u.name === v.name);
    assert.ok(underKey || isValue, `${v.key} ${v.name}`);
    assert.ok(!/\\$/.test(v.data), `termina em barra: ${v.data}`);   // o reg.exe leria \" como aspas
    assert.ok(!/[\r\n\0]/.test(v.data), `quebra de linha: ${v.key}`);
  }
});

test('reg.exe: argumentos em array (sem shell), /ve no valor padrão', () => {
  assert.deepStrictEqual(regAddArgs({ key: 'HKCU\\Software\\Classes\\BahURL\\shell\\open\\command', name: null, data: openCommand(EXE) }),
    ['add', 'HKCU\\Software\\Classes\\BahURL\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', openCommand(EXE), '/f']);
  assert.deepStrictEqual(regAddArgs({ key: 'HKCU\\Software\\Classes\\BahURL', name: 'URL Protocol', data: '' }),
    ['add', 'HKCU\\Software\\Classes\\BahURL', '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f']);
});

test('desinstalador (build/installer.nsh): apaga exatamente as chaves do Bah, e não na atualização', () => {
  const raw = readFileSync(new URL('../../build/installer.nsh', import.meta.url));
  assert.ok(raw.every(b => b < 0x80), 'installer.nsh tem que ser ASCII');
  const nsh = raw.toString('utf8');
  const code = nsh.split(/\r?\n/).filter(l => !/^\s*;/.test(l)).join('\n');
  const keys = [...code.matchAll(/DeleteRegKey\s+HKCU\s+"([^"]+)"/g)].map(m => m[1]);
  const values = [...code.matchAll(/DeleteRegValue\s+HKCU\s+"([^"]+)"\s+"([^"]+)"/g)].map(m => ({ key: m[1], name: m[2] }));
  assert.deepStrictEqual(keys.sort(), [...UNINSTALL_KEYS].sort());
  assert.deepStrictEqual(values, [...UNINSTALL_VALUES]);
  assert.strictEqual((code.match(/Delete\w*/g) || []).length, keys.length + values.length, 'nenhum outro Delete*');
  assert.ok(!/HKLM|HKCR|SHELL_CONTEXT/.test(code), 'só HKCU');
  assert.match(code, /!macro customUnInstall\s+\$\{ifNot\} \$\{isUpdated\}[\s\S]*\$\{endIf\}\s+!macroend/);
});

test('electron-builder.yml: protocolos e associações de arquivo só no Mac (o instalador do Windows não muda)', () => {
  const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mac = yml.slice(yml.indexOf('\nmac:\n'), yml.indexOf('\ndmg:\n'));
  assert.match(mac, /\n {2}protocols:\n {4}- name: Web\n {6}schemes: \[http, https\]/);
  assert.match(mac, /\n {2}fileAssociations:\n/);
  const outside = yml.replace(mac, '');
  assert.ok(!/protocols:|fileAssociations:/.test(outside));
});

test('reg query: lê o ProgId (UserChoice e UserChoiceLatest), vazio e ausente', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n    Hash    REG_SZ    R3C7wWGd7zQ=\r\n\r\n';
  assert.strictEqual(regQueryValue(out, 'ProgId'), 'ChromeHTML');
  assert.strictEqual(regQueryValue(out, 'progid'), 'ChromeHTML');
  assert.strictEqual(regQueryValue(out, 'Hash'), 'R3C7wWGd7zQ=');
  assert.strictEqual(regQueryValue(out, 'Nada'), null);
  assert.strictEqual(regQueryValue('    URL Protocol    REG_SZ    \r\n', 'URL Protocol'), '');
  assert.strictEqual(regQueryValue('    URL Protocol    REG_SZ\r\n', 'URL Protocol'), '');
  assert.strictEqual(regQueryValue('', 'ProgId'), null);
  assert.strictEqual(regQueryValue(`    ${EXE_MARK_VALUE}    REG_SZ    ${exeMark(EXE)}`, EXE_MARK_VALUE), exeMark(EXE));
});

test('UserChoiceLatest primeiro (Windows 11 recente), depois UserChoice', () => {
  assert.deepStrictEqual(userChoiceKeys('https'), [
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId',
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
  ]);
});

test('é o padrão só com http E https no BahURL e o registro deste Bah.exe', () => {
  assert.ok(isBahDefault({ http: PROG_ID_URL, https: PROG_ID_URL, markOk: true }));
  assert.ok(!isBahDefault({ http: PROG_ID_URL, https: 'ChromeHTML', markOk: true }));
  assert.ok(!isBahDefault({ http: null, https: PROG_ID_URL, markOk: true }));
  assert.ok(!isBahDefault({ http: PROG_ID_URL, https: PROG_ID_URL, markOk: false }));   // Bah.exe mudou de pasta
  assert.strictEqual(exeMark(EXE), exeMark(EXE.toUpperCase()));
  assert.match(exeMark(EXE), /^[0-9a-f]{32}$/);
  assert.notStrictEqual(exeMark(EXE), exeMark('C:\\Program Files\\Bah\\Bah.exe'));
});

test('Configurações do Windows: direto no Bah, com a página geral de reserva', () => {
  assert.deepStrictEqual(WINDOWS_SETTINGS_URIS, ['ms-settings:defaultapps?registeredAppUser=Bah', 'ms-settings:defaultapps']);
});
