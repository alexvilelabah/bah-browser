// Regras PURAS do "Bah como navegador padrão" (sem Electron, sem disco, sem registro do
// Windows) — testadas em tests/unit/default-browser.test.ts. Quem liga isso no Electron, no
// reg.exe e na tela é default-browser.ts.
//  • O que veio de fora: outro app (e-mail, Explorer, atalho, a 2ª abertura do Bah) chama o Bah
//    com um link ou um arquivo. Só passa http/https e arquivo do computador que o Bah sabe mostrar.
//    javascript:, data:, file: de pasta de rede, programas, atalhos e opções do Chromium ficam de fora.
//  • O registro do Windows como DADO (lista de {chave, valor, conteúdo}): o que o clique em
//    "Tornar o Bah padrão" grava — e o que o desinstalador (build/installer.nsh) apaga.
//  • Ler a resposta do `reg query`: quem a pessoa escolheu pra abrir links (UserChoice).

import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── O que veio de fora ─────────────────────────────────────────────────────────────

/** Arquivos do computador que o Bah mostra numa aba (o PDF no leitor do Chromium). */
export const LOCAL_FILE_TYPES: readonly string[] = ['.html', '.htm', '.xhtml', '.svg', '.pdf', '.webp'];
// Desses, os que rodariam o JavaScript da PRÓPRIA página. No Electron, página file:// lê qualquer
// outro arquivo do computador (fetch em file://; o fuse GrantFileProtocolExtraPrivileges tem que
// ficar ligado pela assinatura da castLabs) — no Chrome não. Um .html baixado de um e-mail leria
// e mandaria embora os seus documentos. Por isso esses abrem com o JavaScript DESLIGADO.
const SCRIPTED_TYPES = new Set(['.html', '.htm', '.xhtml', '.svg']);

export const MAX_LAUNCH_TARGETS = 20;   // linha de comando estranha não vira bombardeio de abas
export const MAX_LAUNCH_ARG = 32768;    // o teto da linha de comando do Windows

/** url: http(s) ou file:// pronto pra aba. noScript: página do computador, abre sem JavaScript. */
export interface LaunchTarget { url: string; noScript: boolean }

export interface LaunchEnv {
  cwd: string;                       // pasta de quem chamou (caminho relativo vale a partir dela)
  platform: string;                  // process.platform
  isFile: (absPath: string) => boolean;   // existe e é arquivo comum (não pasta)
}

// Opção do Chromium/Electron (--x, -x; no Windows o Chromium também aceita /x).
function isSwitch(arg: string, platform: string): boolean {
  return arg.startsWith('-') || (platform === 'win32' && arg.startsWith('/'));
}

function webTarget(s: string): LaunchTarget | null {
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  // "https://banco.com.br@golpe.com" abre golpe.com — sem o disfarce do usuário:senha na frente.
  u.username = '';
  u.password = '';
  return { url: u.href, noScript: false };
}

function fileTarget(p: string, env: LaunchEnv): LaunchTarget | null {
  const win = env.platform === 'win32';
  const P = win ? path.win32 : path.posix;
  // Pasta de rede (\\servidor\…) e caminho de dispositivo (\\?\, \\.\) nunca: só de olhar o arquivo
  // o Windows já se conectaria no servidor (mandando o login da pessoa pra ele).
  const unc = (s: string) => win && /^[\\/]{2}/.test(s);
  if (unc(p)) return null;
  const abs = P.resolve(env.cwd, p);
  if (unc(abs)) return null;
  const ext = P.extname(abs).toLowerCase();   // "x.html:fluxo" e "x.html." não casam (ficam de fora)
  if (!LOCAL_FILE_TYPES.includes(ext)) return null;
  if (!env.isFile(abs)) return null;
  return { url: pathToFileURL(abs, { windows: win }).href, noScript: SCRIPTED_TYPES.has(ext) };
}

/** Um argumento (ou o endereço do open-url/open-file do macOS) → o que abrir, ou null. */
export function launchTarget(raw: string, env: LaunchEnv): LaunchTarget | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_LAUNCH_ARG || s.includes('\0')) return null;
  if (/^https?:/i.test(s)) return webTarget(s);
  if (/^file:/i.test(s)) {
    let p: string;
    try { p = fileURLToPath(s, { windows: env.platform === 'win32' }); } catch { return null; }   // file://servidor/… também cai aqui
    return fileTarget(p, env);
  }
  const drive = env.platform === 'win32' && /^[a-z]:/i.test(s);   // "C:\…" parece esquema "c:"
  if (!drive && /^[a-z][a-z0-9+.-]*:/i.test(s)) return null;      // javascript:, data:, mailto:, ms-…:
  return fileTarget(s, env);
}

/**
 * Os argumentos da linha de comando (SEM o programa — e, rodando do código-fonte, sem a pasta do
 * app) → o que abrir em abas. Com "--" (é assim que o Bah se registra: "Bah.exe" -- "%1"), tudo o
 * que vem depois é UM endereço só, mesmo que um link com aspas tenha sido partido em pedaços —
 * igual ao --single-argument do Chrome: nada dali vira opção do Chromium nem um 2º alvo escondido.
 * Sem "--" (arrastar arquivos pro ícone, linha de comando): cada argumento que não é opção.
 */
export function launchTargets(args: readonly string[], env: LaunchEnv): LaunchTarget[] {
  const dd = args.indexOf('--');
  const raw = dd >= 0 ? [args.slice(dd + 1).join(' ')] : args.filter(a => !isSwitch(String(a), env.platform));
  const out: LaunchTarget[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = launchTarget(r, env);
    if (!t || seen.has(t.url)) continue;
    seen.add(t.url);
    out.push(t);
    if (out.length >= MAX_LAUNCH_TARGETS) break;
  }
  return out;
}

// ── Registro do Windows (por usuário, HKCU) ────────────────────────────────────────

export const PROG_ID_URL = 'BahURL';     // links http/https
export const PROG_ID_HTML = 'BahHTML';   // arquivos .html/.pdf/…
export const REGISTERED_APP = 'Bah';     // nome em RegisteredApplications (e no ms-settings:)
export const APP_USER_MODEL_ID = 'com.vilelalab.bah';   // o mesmo do app.setAppUserModelId do empacotado
export const URL_SCHEMES: readonly string[] = ['http', 'https'];
export const FILE_ASSOCIATIONS: readonly string[] = ['.htm', '.html', '.xhtml', '.svg', '.webp', '.pdf'];
const CLIENT_KEY = 'Software\\Clients\\StartMenuInternet\\Bah';
export const CAPABILITIES_PATH = `${CLIENT_KEY}\\Capabilities`;
// Valor só nosso na chave do BahURL: a impressão digital do Bah.exe registrado (só letras e
// números). Diz se o registro aponta pro Bah DESTE caminho sem ler o caminho de volta — a saída
// do reg.exe vem na página de código do console e estragaria nomes com acento (C:\Users\João).
export const EXE_MARK_VALUE = 'BahExeId';

/** name null = o valor padrão da chave. Tudo REG_SZ. */
export interface RegValue { key: string; name: string | null; data: string }

/** O Bah.exe instalado pode entrar num comando do registro? (aspas e % quebrariam o "%1") */
export function isRegistrableExe(exe: string): boolean {
  return typeof exe === 'string' && /^(?:[a-z]:\\|\\\\)[^"%\0\r\n]+\.exe$/i.test(exe);
}

export function exeMark(exe: string): string {
  return createHash('sha256').update(String(exe).toLowerCase(), 'utf8').digest('hex').slice(0, 32);
}

/** O comando que o Windows roda pra abrir um link ou arquivo no Bah. */
export function openCommand(exe: string): string {
  // "--" ANTES do "%1": o que vier no link nunca vira opção do Chromium (o furo dos protocolos do
  // Electron em 2018) — e o launchTargets lê tudo depois do "--" como um endereço só.
  return `"${exe}" -- "%1"`;
}

/** Tudo o que "Tornar o Bah padrão" grava no registro, na ordem. */
export function windowsRegistrationPlan(exe: string, description: string): RegValue[] {
  if (!isRegistrableExe(exe)) throw new Error(`Bah.exe em caminho inesperado: ${exe}`);
  const icon = `${exe},0`;
  const desc = String(description || 'Bah').replace(/[\0\r\n]/g, ' ').trim() || 'Bah';
  const client = `HKCU\\${CLIENT_KEY}`;
  const plan: RegValue[] = [];
  const add = (key: string, name: string | null, data: string) => { plan.push({ key, name, data }); };
  // O "cliente navegador": é o que faz o Bah aparecer em Configurações → Aplicativos padrão.
  add(client, null, 'Bah');
  add(`${client}\\Capabilities`, 'ApplicationName', 'Bah');
  add(`${client}\\Capabilities`, 'ApplicationDescription', desc);
  add(`${client}\\Capabilities`, 'ApplicationIcon', icon);
  for (const ext of FILE_ASSOCIATIONS) add(`${client}\\Capabilities\\FileAssociations`, ext, PROG_ID_HTML);
  for (const s of URL_SCHEMES) add(`${client}\\Capabilities\\URLAssociations`, s, PROG_ID_URL);
  add(`${client}\\Capabilities\\StartMenu`, 'StartMenuInternet', 'Bah');
  add(`${client}\\DefaultIcon`, null, icon);
  add(`${client}\\shell\\open\\command`, null, `"${exe}"`);
  add('HKCU\\Software\\RegisteredApplications', REGISTERED_APP, CAPABILITIES_PATH);
  // Os dois ProgIDs: como o Windows abre um link (BahURL) ou um arquivo (BahHTML) no Bah. Sem o valor
  // "URL Protocol" (o ChromeHTML do Chrome também não tem): ele faria do próprio "bahurl:" um protocolo
  // que qualquer página poderia chamar — o URLAssociations acima já liga http/https ao BahURL.
  const progIds: Array<[string, string, boolean]> = [[PROG_ID_URL, 'Bah URL', true], [PROG_ID_HTML, 'Bah HTML Document', false]];
  for (const [id, label, isUrl] of progIds) {
    const k = `HKCU\\Software\\Classes\\${id}`;
    add(k, null, label);
    if (isUrl) add(k, EXE_MARK_VALUE, exeMark(exe));
    add(`${k}\\Application`, 'ApplicationName', 'Bah');
    add(`${k}\\Application`, 'ApplicationDescription', desc);
    add(`${k}\\Application`, 'ApplicationIcon', icon);
    add(`${k}\\Application`, 'AppUserModelId', APP_USER_MODEL_ID);
    add(`${k}\\DefaultIcon`, null, icon);
    add(`${k}\\shell\\open\\command`, null, openCommand(exe));
  }
  return plan;
}

/** O que o desinstalador apaga (build/installer.nsh tem que bater com isto — o teste confere). */
export const UNINSTALL_KEYS: readonly string[] = [
  CLIENT_KEY, `Software\\Classes\\${PROG_ID_URL}`, `Software\\Classes\\${PROG_ID_HTML}`,
];
export const UNINSTALL_VALUES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'Software\\RegisteredApplications', name: REGISTERED_APP },
];

/** Argumentos do reg.exe pra gravar um valor (vai num array: nada passa por shell). */
export function regAddArgs(v: RegValue): string[] {
  return ['add', v.key, ...(v.name === null ? ['/ve'] : ['/v', v.name]), '/t', 'REG_SZ', '/d', v.data, '/f'];
}

/** Onde o Windows guarda quem abre os links. O Windows 11 recente usa UserChoiceLatest (quando existe, vale ela). */
export function userChoiceKeys(scheme: string): string[] {
  const base = `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}`;
  return [`${base}\\UserChoiceLatest\\ProgId`, `${base}\\UserChoice`];
}

/** Um valor REG_SZ com nome, na saída do `reg query` ("    ProgId    REG_SZ    ChromeHTML"). */
export function regQueryValue(stdout: string, name: string): string | null {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_SZ|REG_EXPAND_SZ)(?: {4}(.*))?$/.exec(line);
    if (m && m[1].toLowerCase() === name.toLowerCase()) return m[3] ?? '';
  }
  return null;
}

/** O Bah é o padrão de verdade? Os dois (http e https) com o BahURL, e o registro é deste Bah.exe. */
export function isBahDefault(s: { http: string | null; https: string | null; markOk: boolean }): boolean {
  return s.http === PROG_ID_URL && s.https === PROG_ID_URL && s.markOk;
}

/** A página de Configurações onde a pessoa escolhe o Bah (Windows 11 vai direto nele; senão, a geral). */
export const WINDOWS_SETTINGS_URIS: readonly string[] = [
  `ms-settings:defaultapps?registeredAppUser=${REGISTERED_APP}`,
  'ms-settings:defaultapps',
];
