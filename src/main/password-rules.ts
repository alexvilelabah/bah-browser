// Senhas salvas — as regras PURAS do lado do main (testadas em tests/unit/password-rules.test.ts):
// endereço → "site" (origem), o que mostrar, o que guardar ou atualizar, CSV do Chrome/Edge (ler e
// escrever), juntar uma importação sem duplicar, e o prazo pra limpar a área de transferência.
// Quem mexe no Electron (cofre do sistema, arquivo, IPC, diálogos) é o password-manager.ts.

export interface SavedEntry {
  id: string;
  origin: string;             // esquema + host + porta (https://site.com) — o preencher só casa a MESMA origem
  host: string;               // o que a tela mostra (site.com, ou site.com:8443)
  username: string;
  encryptedPassword: string;  // base64 do safeStorage (DPAPI no Windows, Keychain no Mac); nunca texto puro
  created: number;
  lastUsed: number;
}

export interface PasswordFile {
  version: 1;
  offerToSave: boolean;       // "Oferecer para salvar senhas" (padrão ligado)
  entries: SavedEntry[];
  never: string[];            // origens do "Nunca"
}

/**
 * Marca que vai DENTRO do texto cifrado de toda senha guardada. O cofre (safeStorage) é o mesmo da
 * chave de API, e a tela do Bah tem o 'secure:decrypt-sync' pra decifrar a chave — com a marca, esse
 * caminho recusa senha (main.ts): ler o passwords.json pelo DevTools e decifrar não passa da confirmação.
 */
export const PW_TAG = '\u0000bah-pw1\u0000';
export const tagSecret = (password: string): string => PW_TAG + password;
export const isTaggedSecret = (plain: unknown): boolean => typeof plain === 'string' && plain.startsWith(PW_TAG);
/** Sem a marca não é senha do Bah (nada foi lançado antes dela: não há formato antigo pra migrar). */
export function untagSecret(plain: string): string | null {
  return plain.startsWith(PW_TAG) ? plain.slice(PW_TAG.length) : null;
}

export const MAX_USERNAME = 512;
export const MAX_PASSWORD = 1024;
export const MAX_ENTRIES = 20000;
export const MAX_IMPORT_ROWS = 10000;
export const CLIPBOARD_CLEAR_MS = 30_000;

/** Origem de um endereço http/https (https://site.com:8443); '' pra qualquer outra coisa. */
export function originOf(url: unknown): string {
  if (typeof url !== 'string' || !url || url.length > 4096) return '';
  try {
    const u = new URL(url);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) return '';
    return u.origin;
  } catch { return ''; }
}

/** Como o site aparece na tela: sem esquema e sem "www.", com a porta se não for a padrão. */
export function displayHost(origin: string): string {
  try { return new URL(origin).host.replace(/^www\./, ''); } catch { return origin; }
}

/** https (ou o próprio computador) — em http puro a senha viaja sem proteção. */
export function isSecureOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:') return true;
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}

export function emptyFile(): PasswordFile {
  return { version: 1, offerToSave: true, entries: [], never: [] };
}

const finite = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback);

/**
 * O arquivo lido do disco → só o que é válido. Origem inválida ou sem senha cifrada cai fora;
 * mesmo site + mesmo usuário repetido fica só o usado por último.
 */
export function sanitizeFile(raw: unknown, makeId: () => string, now = Date.now()): PasswordFile {
  const out = emptyFile();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.offerToSave === 'boolean') out.offerToSave = r.offerToSave;
  const byKey = new Map<string, SavedEntry>();
  const ids = new Set<string>();
  const list = Array.isArray(r.entries) ? r.entries.slice(0, MAX_ENTRIES) : [];
  for (const e of list as Array<Record<string, unknown>>) {
    if (!e || typeof e !== 'object') continue;
    const origin = originOf(e.origin);
    const enc = typeof e.encryptedPassword === 'string' ? e.encryptedPassword : '';
    const username = typeof e.username === 'string' ? e.username.slice(0, MAX_USERNAME) : null;
    if (!origin || !enc || !/^[A-Za-z0-9+/=]+$/.test(enc) || username === null) continue;
    let id = typeof e.id === 'string' && /^[\w-]{1,64}$/.test(e.id) ? e.id : '';
    if (!id || ids.has(id)) id = makeId();
    const entry: SavedEntry = {
      id, origin, host: displayHost(origin), username, encryptedPassword: enc,
      created: finite(e.created, now), lastUsed: finite(e.lastUsed, finite(e.created, now)),
    };
    const key = `${origin}\n${username}`;
    const prev = byKey.get(key);
    if (prev && prev.lastUsed >= entry.lastUsed) continue;
    if (prev) ids.delete(prev.id);
    byKey.set(key, entry);
    ids.add(id);
  }
  out.entries = [...byKey.values()];
  if (Array.isArray(r.never)) out.never = [...new Set(r.never.map(originOf).filter(Boolean))];
  return out;
}

/** As contas guardadas pra ESTA origem exata (nada de subdomínio nem http↔https), a usada por último primeiro. */
export function entriesFor<T extends { origin: string; lastUsed: number }>(entries: T[], origin: string): T[] {
  return entries.filter(e => e.origin === origin).sort((a, b) => b.lastUsed - a.lastUsed);
}

/** Uma conta já guardada pra origem, com a senha decifrada (null = o cofre não abriu). */
export interface Known { id: string; username: string; password: string | null }

export type SaveDecision =
  | { action: 'none' }
  | { action: 'touch'; entryId: string }                       // igual à guardada: só marca "usada agora"
  | { action: 'save'; username: string }                       // conta nova → "Salvar senha?"
  | { action: 'update'; entryId: string; username: string };   // mesma conta, senha nova → "Atualizar senha?"

/**
 * Login enviado → o que fazer. Sem usuário (o site não tinha campo): se a senha bate com uma
 * guardada, é ela; se o site tem UMA conta só, é a atualização dela. `exact` = o usuário foi
 * escrito pela pessoa no balão: vale só ele (apagar o nome nunca troca a senha de outra conta).
 */
export function decideSave(known: Known[], username: string, password: string, exact = false): SaveDecision {
  if (!password || password.length > MAX_PASSWORD || username.length > MAX_USERNAME) return { action: 'none' };
  const same = known.find(k => k.username === username);
  if (same) {
    return same.password === password
      ? { action: 'touch', entryId: same.id }
      : { action: 'update', entryId: same.id, username: same.username };
  }
  if (!username && !exact) {
    const byPassword = known.find(k => k.password === password);
    if (byPassword) return { action: 'touch', entryId: byPassword.id };
    if (known.length === 1) return { action: 'update', entryId: known[0].id, username: known[0].username };
  }
  return { action: 'save', username };
}

/** Grava (ou troca a senha de) origem + usuário. Devolve a entrada que ficou. */
export function upsertEntry(
  entries: SavedEntry[], origin: string, username: string, encryptedPassword: string, now: number, makeId: () => string,
): SavedEntry {
  const hit = entries.find(e => e.origin === origin && e.username === username);
  if (hit) { hit.encryptedPassword = encryptedPassword; hit.lastUsed = now; return hit; }
  const entry: SavedEntry = { id: makeId(), origin, host: displayHost(origin), username, encryptedPassword, created: now, lastUsed: now };
  entries.push(entry);
  return entry;
}

// ── CSV (o formato que o Chrome e o Edge exportam: name,url,username,password,note) ──────────

/** CSV → linhas (RFC 4180: aspas, "" dentro de aspas, vírgula/quebra de linha dentro de aspas, CRLF ou LF). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;   // o campo atual já teve algum caractere (aspas só abrem no começo)
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !started) { quoted = true; started = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; started = false; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = ''; started = false;
      continue;
    }
    field += c;
    started = true;
  }
  if (started || field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));   // linha em branco
}

const needsQuotes = (v: string) => /[",;\r\n]/.test(v) || /^\s|\s$/.test(v);

export function serializeCsv(rows: string[][]): string {
  return rows.map(r => r.map(v => (needsQuotes(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
}

export interface ImportRow { origin: string; username: string; password: string }

const URL_COLS = ['url', 'origin', 'origin_url', 'login_uri', 'login url', 'website', 'web site', 'site'];
const USER_COLS = ['username', 'login_username', 'username_value', 'user name', 'user', 'login', 'email'];
const PASS_COLS = ['password', 'login_password', 'password_value'];

/** Endereço da planilha → origem. Aceita "site.com" sem esquema (alguns gerenciadores exportam assim). */
function importOrigin(raw: string): string {
  const v = raw.trim();
  const o = originOf(v);
  if (o) return o;
  return /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(v) ? originOf(`https://${v}`) : '';
}

/**
 * Texto do CSV exportado (Chrome, Edge, Firefox, Bitwarden, 1Password…) → contas http/https.
 * As colunas são achadas pelo cabeçalho. Excel em português grava com ponto e vírgula — também vale.
 * `invalid` = linhas puladas (sem site http/https, sem senha, grandes demais ou além do limite).
 */
export function csvToCredentials(text: string): { rows: ImportRow[]; invalid: number; recognized: boolean } {
  const t = text.replace(/^﻿/, '');
  const nl = t.search(/\r|\n/);
  const firstLine = nl < 0 ? t : t.slice(0, nl);
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const table = parseCsv(t, delimiter);
  if (!table.length) return { rows: [], invalid: 0, recognized: false };
  const head = table[0].map(h => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex(h => names.includes(h));
  const iUrl = col(URL_COLS);
  const iUser = col(USER_COLS);
  const iPass = col(PASS_COLS);
  if (iUrl < 0 || iPass < 0) return { rows: [], invalid: 0, recognized: false };
  const rows: ImportRow[] = [];
  let invalid = 0;
  const body = table.slice(1);
  for (let n = 0; n < body.length; n++) {
    const r = body[n];
    if (n >= MAX_IMPORT_ROWS) { invalid += body.length - n; break; }
    const origin = importOrigin(fromCsvCell(String(r[iUrl] ?? '')));
    const password = fromCsvCell(String(r[iPass] ?? ''));
    const username = iUser >= 0 ? fromCsvCell(String(r[iUser] ?? '')) : '';
    if (!origin || !password || password.length > MAX_PASSWORD || username.length > MAX_USERNAME) { invalid++; continue; }
    rows.push({ origin, username, password });
  }
  return { rows, invalid, recognized: true };
}

// Fórmula de planilha: célula que começa com = + - @ (ou tab/CR) vira fórmula no Excel ao abrir o CSV.
// Exportar põe um ' na frente (o Excel mostra o texto); importar tira. Já começar com ' antes disso
// também ganha mais um, pra ida e volta dar sempre o mesmo valor.
const FORMULA_START = /^'*[=+\-@\t\r]/;
export const toCsvCell = (v: string): string => (FORMULA_START.test(v) ? `'${v}` : v);
export const fromCsvCell = (v: string): string => (/^'+[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

/** Contas → CSV no formato do Chrome (dá pra importar de volta no Chrome, Edge, Firefox…). */
export function credentialsToCsv(list: ImportRow[]): string {
  const rows = [['name', 'url', 'username', 'password', 'note']];
  for (const e of list) rows.push([displayHost(e.origin), `${e.origin}/`, e.username, e.password, ''].map(toCsvCell));
  return serializeCsv(rows);
}

/**
 * Junta a importação no que já existe, sem duplicar: mesma origem + usuário + senha → "já tinha";
 * mesma origem + usuário com OUTRA senha → mantém a guardada (conta como conflito). Repetidas
 * dentro do próprio arquivo valem a primeira.
 */
export function mergeImport(known: Array<{ origin: string; username: string; password: string | null }>, incoming: ImportRow[]):
  { add: ImportRow[]; duplicates: number; conflicts: number } {
  const key = (o: string, u: string) => `${o}\n${u}`;
  const have = new Map<string, string | null>(known.map(k => [key(k.origin, k.username), k.password]));
  const add: ImportRow[] = [];
  let duplicates = 0;
  let conflicts = 0;
  for (const r of incoming) {
    const k = key(r.origin, r.username);
    if (have.has(k)) { if (have.get(k) === r.password) duplicates++; else conflicts++; continue; }
    have.set(k, r.password);
    add.push(r);
  }
  return { add, duplicates, conflicts };
}

// ── Área de transferência ────────────────────────────────────────────────────────────────

export interface ClipboardGuardDeps {
  readText: () => string | Promise<string>;   // no Electron 44 a área de transferência é assíncrona
  clear: () => void;
  digest: (s: string) => string;   // guarda só o resumo (hash) da senha copiada, não a senha
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  delayMs?: number;
}

/**
 * Senha copiada → depois de ~30 s, se a área de transferência AINDA tem ela, limpa. Se a pessoa
 * copiou outra coisa nesse meio-tempo, não mexe. Copiar de novo recomeça a contagem.
 */
export function createClipboardGuard(d: ClipboardGuardDeps) {
  let mark: string | null = null;
  let timer: unknown = null;
  const check = async (): Promise<void> => {
    timer = null;
    const want = mark;
    if (want === null) return;
    let current = '';
    try { current = await d.readText(); } catch {}
    if (mark !== want || timer !== null) return;   // copiou de novo enquanto lia: a contagem nova decide
    if (current && d.digest(current) === want) { try { d.clear(); } catch {} }
    mark = null;
  };
  return {
    copied(value: string) {
      if (timer !== null) d.clearTimer(timer);
      mark = d.digest(value);
      timer = d.setTimer(() => { void check(); }, d.delayMs ?? CLIPBOARD_CLEAR_MS);
    },
    /** O Bah vai fechar: limpa já (se ainda for a senha). */
    flush(): Promise<void> {
      if (timer !== null) { d.clearTimer(timer); timer = null; }
      return check();
    },
    get pending() { return mark !== null; },
  };
}
