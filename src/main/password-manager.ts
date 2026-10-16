// Senhas salvas (o "Gerenciador de senhas" do Chrome, só local) — o lado do main.
//
// Quem vê a senha em texto puro, e quando:
//  • a PÁGINA do site (é dela: a pessoa digitou ali, ou o Bah preencheu depois de um clique na lista);
//  • o preload das senhas, no mundo isolado da aba (o JavaScript do site não enxerga);
//  • este processo (main), na memória: a senha recém-digitada até a pessoa responder o balão, e a
//    guardada só na hora de preencher/mostrar/copiar/exportar. No disco ela fica SEMPRE cifrada pelo
//    cofre do sistema (safeStorage: DPAPI no Windows, Keychain no Mac). Sem cofre → função desligada;
//  • a TELA do Bah só quando a pessoa pede: o olho do balão (a senha que ela acabou de digitar) ou
//    "mostrar" no gerenciador (depois da confirmação do main, ou do Touch ID no Mac).
// A IA nunca: não existe ferramenta, IPC nem leitura de página que chegue neste cofre.
//
// As regras puras (origem, decidir salvar/atualizar, CSV, juntar importação, área de transferência)
// ficam em password-rules.ts; a heurística do formulário, em shared/login-form.ts (roda na página).
import {
  app, clipboard, dialog, ipcMain, safeStorage, shell, systemPreferences, webContents,
  type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type MessageBoxOptions,
  type Session, type WebContents, type WebFrameMain,
} from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as R from './password-rules';
import type { PwError, PwOffer, PwState, PwSuggest } from '../shared/password-types';

interface Deps {
  getMainWindow: () => BrowserWindow | null;
  t: (key: string, vars?: Record<string, string>) => string;
  browserSession: Session;   // persist:browser — pergunta se salva e preenche
  privateSession: Session;   // aba anônima — só preenche (nunca pergunta, nunca marca "usada agora")
}

interface Guest { wc: WebContents; frame: WebFrameMain; origin: string; incognito: boolean }
interface Provisional {
  origin: string; username: string; password: string; at: number;
  navigating: boolean;              // a página trocou depois do envio (falta saber se voltou pro formulário)
  timer?: NodeJS.Timeout; expiry?: NodeJS.Timeout;
}
interface Offer { id: string; wcId: number; origin: string; username: string; password: string; timer: NodeJS.Timeout }
interface Suggest { id: string; wcId: number; frame: WebFrameMain; origin: string; token: string; at: number; incognito: boolean }

const PRELOAD_ID = 'bah-passwords';
const LOGIN_WINDOW_MS = 15_000;     // envio → a página precisa trocar (ou o formulário sumir) em até 15 s
const PROVISIONAL_MS = 60_000;      // trocou de página: tempo máximo pra página nova responder
const NAV_GRACE_MS = 1500;          // até quanto antes do aviso de envio uma troca de página ainda conta
const PAGE_REPORT_WAIT_MS = 2500;   // a página nova não disse se tem formulário → pergunta assim mesmo
const OFFER_TTL_MS = 5 * 60_000;    // balão sem resposta some (e a senha sai da memória)
const SUGGEST_TTL_MS = 2 * 60_000;
const HINT_MS = 10 * 60_000;        // usuário da 1ª etapa (e-mail antes da senha)
const UNLOCK_MS = 60_000;           // depois de confirmar, mostrar/copiar/editar AQUELA senha vale 1 minuto
const AGENT_QUIET_MS = 20_000;      // depois da última tecla da IA numa aba, nada dela vira pergunta
const QUIT_CLIPBOARD_WAIT_MS = 500; // fechando com senha copiada: espera a limpeza até isto
const CSV_MAX_BYTES = 5 * 1024 * 1024;

const fail = (error: PwError) => ({ ok: false as const, error });

/** CSV pode vir em UTF-8 (com ou sem BOM), UTF-16 (Excel "Unicode") ou windows-1252 (Excel antigo). */
function decodeCsv(buf: Buffer): string {
  try {
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  } catch {}
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
  try { return new TextDecoder('windows-1252').decode(buf); } catch { return buf.toString('latin1'); }
}

/**
 * O preload das abas é SANDBOX (só aceita require('electron')): junta a heurística pura compilada
 * (shared/login-form.js) com o preload num arquivo só, em userData — o mesmo jeito do preload da loja
 * de extensões. Gerado de novo a cada início, a partir dos arquivos do próprio Bah.
 */
function buildPagePreload(): string | null {
  try {
    const strip = (s: string) => s.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    const lib = strip(fs.readFileSync(path.join(__dirname, '..', 'shared', 'login-form.js'), 'utf8'));
    const body = strip(fs.readFileSync(path.join(__dirname, '..', 'preload', 'password-preload.js'), 'utf8'));
    const code = ['(function () {', '"use strict";', 'var exports = {};', lib, 'var BAH_LOGIN = exports;', body, '})();', ''].join('\n');
    const out = path.join(app.getPath('userData'), 'password-preload.js');
    fs.writeFileSync(out + '.tmp', code);
    try { fs.renameSync(out + '.tmp', out); return out; } catch { return out + '.tmp'; }
  } catch (e: any) {
    console.error('[Senhas] o preload das abas não montou — salvar/preencher senhas fica desligado nesta sessão:', e?.code || e?.message || e);
    return null;
  }
}

export function setupPasswordManager(deps: Deps): { noteAgentInput: (wcId: number) => void } {
  const { t } = deps;
  const file = path.join(app.getPath('userData'), 'passwords.json');
  const makeId = () => crypto.randomUUID();

  // ── Arquivo ──────────────────────────────────────────────────────────────────────────
  // O arquivo existe mas não abriu (antivírus segurando, permissão): nada é gravado nesta sessão —
  // começar vazio e gravar por cima apagaria as senhas de verdade. O gerenciador avisa.
  let readOnly = false;
  const load = (): R.PasswordFile => {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        readOnly = true;
        console.warn('[Senhas] o arquivo de senhas não abriu (' + (e?.code || 'erro') + ') — nada é gravado até reiniciar o Bah.');
      }
      return R.emptyFile();
    }
    try { return R.sanitizeFile(JSON.parse(raw), makeId); } catch {
      // Arquivo estragado: guarda uma cópia antes de recomeçar; sem cópia, não grava por cima.
      try { fs.copyFileSync(file, file.replace(/\.json$/, `.corrupt-${Date.now()}.json`)); } catch { readOnly = true; }
      return R.emptyFile();
    }
  };
  let data = load();
  // Grava num arquivo ao lado e troca: se o PC desligar no meio, o arquivo antigo fica inteiro.
  const save = (): boolean => {
    if (readOnly) return false;
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      return true;
    } catch (e: any) {
      console.warn('[Senhas] não deu pra gravar o arquivo:', e?.code || 'erro');   // nunca o conteúdo
      return false;
    }
  };

  // ── Cofre do sistema ─────────────────────────────────────────────────────────────────
  const vault = (): 'ok' | 'unavailable' => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
      // Linux sem chaveiro: o "basic_text" do Electron é só disfarce, não cifra de verdade.
      if (process.platform === 'linux') {
        const b = safeStorage.getSelectedStorageBackend();
        if (b === 'basic_text' || b === 'unknown') return 'unavailable';
      }
      return 'ok';
    } catch { return 'unavailable'; }
  };
  // A senha vai cifrada COM a marca (R.PW_TAG): o decifrador da tela (main.ts) recusa o que tem a marca.
  const encrypt = (pw: string) => safeStorage.encryptString(R.tagSecret(pw)).toString('base64');
  const decrypt = (e: R.SavedEntry): string | null => {
    try { return R.untagSecret(safeStorage.decryptString(Buffer.from(e.encryptedPassword, 'base64'))); } catch { return null; }
  };
  const known = (origin: string): R.Known[] =>
    R.entriesFor(data.entries, origin).map(e => ({ id: e.id, username: e.username, password: decrypt(e) }));
  // A IA digitou nesta aba há pouco (input:type / input:key no main.ts): o que ela digitou nunca vira
  // "Salvar senha?" — a tecla dela chega à página como tecla de verdade, igual à da pessoa.
  const agentInputAt = new Map<number, number>();
  const agentTyping = (wcId: number) => Date.now() - (agentInputAt.get(wcId) ?? -1e9) < AGENT_QUIET_MS;
  const captureOn = (origin: string) => !readOnly && data.offerToSave && vault() === 'ok' && !data.never.includes(origin);

  // ── Tela do Bah ──────────────────────────────────────────────────────────────────────
  const mainWin = () => { const mw = deps.getMainWindow(); return mw && !mw.isDestroyed() ? mw : null; };
  const send = (channel: string, payload?: unknown) => { try { mainWin()?.webContents.send(channel, payload); } catch {} };
  const changed = () => send('passwords:changed');
  const fromMainWindow = (e: IpcMainInvokeEvent | IpcMainEvent) => { const mw = mainWin(); return !!mw && e.sender === mw.webContents; };
  const box = (opts: MessageBoxOptions) => { const mw = mainWin(); return mw ? dialog.showMessageBox(mw, opts) : dialog.showMessageBox(opts); };

  /**
   * Quem mandou é a página de cima de uma ABA do Bah (<webview> da janela principal), num site
   * http/https, na sessão normal ou na anônima? A origem vem do frame visto pelo main — nunca do que
   * a página disse; `claimed` (a origem que o preload viu) só serve pra descartar mensagem atrasada.
   */
  const guest = (e: IpcMainEvent | IpcMainInvokeEvent, claimed?: unknown): Guest | null => {
    try {
      const mw = mainWin();
      const wc = e.sender;
      if (!mw || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents?.id !== mw.webContents.id) return null;
      const frame = e.senderFrame;
      if (!frame || frame.isDestroyed() || frame.detached || frame.parent) return null;
      const origin = R.originOf(frame.url);
      if (!origin || frame.origin !== origin) return null;
      if (claimed !== undefined && claimed !== origin) return null;
      const incognito = wc.session === deps.privateSession;
      if (!incognito && wc.session !== deps.browserSession) return null;
      return { wc, frame, origin, incognito };
    } catch { return null; }
  };

  // ── Captura: envio → "deu certo?" → balão ────────────────────────────────────────────
  let seq = 0;
  const provisional = new Map<number, Provisional>();
  const offers = new Map<string, Offer>();
  const offerOfWc = new Map<number, string>();
  const suggests = new Map<number, Suggest>();
  const hints = new Map<number, { origin: string; username: string; at: number }>();
  const navStart = new Map<number, number>();
  const watched = new WeakSet<WebContents>();

  const touch = (entryId: string, incognito = false) => {
    if (incognito) return;   // anônima não deixa rastro ("usada agora" iria pro disco)
    const e = data.entries.find(x => x.id === entryId);
    if (e) { e.lastUsed = Date.now(); save(); }
  };
  const dropProvisional = (wcId: number) => {
    const p = provisional.get(wcId);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    if (p.expiry) clearTimeout(p.expiry);
    provisional.delete(wcId);
  };
  const dropOffer = (id: string, notify: boolean) => {
    const o = offers.get(id);
    if (!o) return;
    clearTimeout(o.timer);
    offers.delete(id);
    if (offerOfWc.get(o.wcId) === id) offerOfWc.delete(o.wcId);
    if (notify) send('passwords:offer-cancel', id);
  };
  /** O login deu certo: decide de novo (pode ter salvado por outra aba nesse meio-tempo) e abre o balão. */
  const promote = (wcId: number) => {
    const p = provisional.get(wcId);
    if (!p) return;
    dropProvisional(wcId);
    if (!captureOn(p.origin)) return;
    const d = R.decideSave(known(p.origin), p.username, p.password);
    if (d.action === 'none') return;
    if (d.action === 'touch') { touch(d.entryId); return; }
    const prev = offerOfWc.get(wcId);
    if (prev) dropOffer(prev, true);
    const id = `pwo_${++seq}`;
    const timer = setTimeout(() => dropOffer(id, true), OFFER_TTL_MS);
    offers.set(id, { id, wcId, origin: p.origin, username: d.username, password: p.password, timer });
    offerOfWc.set(wcId, id);
    const view: PwOffer = { id, wcId, host: R.displayHost(p.origin), username: d.username, length: [...p.password].length, update: d.action === 'update' };
    send('passwords:offer', view);
  };

  const watchWc = (wc: WebContents) => {
    if (watched.has(wc)) return;
    watched.add(wc);
    const id = wc.id;
    wc.on('did-start-navigation', (d: any) => {
      if (!d?.isMainFrame || d.isSameDocument) return;
      navStart.set(id, Date.now());
      const p = provisional.get(id);
      // Troca de página MUITO depois do envio (o login falhou e a pessoa clicou em outra coisa, tipo
      // "Esqueci a senha") não é o resultado do login: esquece a senha digitada.
      if (p && !p.navigating) { if (Date.now() - p.at < LOGIN_WINDOW_MS) p.navigating = true; else dropProvisional(id); }
      if (suggests.delete(id)) send('passwords:suggest-hide', { wcId: id });
    });
    wc.on('did-stop-loading', () => {
      const p = provisional.get(id);
      if (!p || !p.navigating) return;
      if (p.timer) clearTimeout(p.timer);
      p.timer = setTimeout(() => { if (provisional.get(id) === p) promote(id); }, PAGE_REPORT_WAIT_MS);
    });
    // Falhou a troca de página (sem internet, endereço errado): o login não aconteceu. -3 = abortada
    // (outra navegação tomou o lugar, download) — essa não decide nada.
    wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      const p = provisional.get(id);
      if (p && p.navigating && isMainFrame && code !== -3) dropProvisional(id);
    });
    wc.once('destroyed', () => {
      dropProvisional(id);
      navStart.delete(id); hints.delete(id); suggests.delete(id); agentInputAt.delete(id);
      const o = offerOfWc.get(id);
      if (o) dropOffer(o, true);
    });
  };

  ipcMain.handle('pw:hello', (e) => {
    const g = guest(e);
    if (!g) return { capture: false };
    watchWc(g.wc);
    const p = provisional.get(g.wc.id);
    return { capture: !g.incognito && captureOn(g.origin), report: !!(p && p.navigating) };
  });

  ipcMain.on('pw:candidate', (e, m: any) => {
    const g = guest(e, m?.origin);
    if (!g || g.incognito || !captureOn(g.origin) || agentTyping(g.wc.id)) return;
    const password = typeof m?.password === 'string' ? m.password : '';
    let username = typeof m?.username === 'string' ? m.username.trim() : '';
    if (!password || password.length > R.MAX_PASSWORD || username.length > R.MAX_USERNAME) return;
    if (!username) {
      const h = hints.get(g.wc.id);
      if (h && h.origin === g.origin && Date.now() - h.at < HINT_MS) username = h.username;
    }
    const d = R.decideSave(known(g.origin), username, password);
    if (d.action === 'none') return;
    if (d.action === 'touch') { touch(d.entryId); return; }
    watchWc(g.wc);
    dropProvisional(g.wc.id);
    const id = g.wc.id;
    // A troca de página e este aviso vêm por canais diferentes: o envio do formulário pode chegar
    // aqui DEPOIS do 'did-start-navigation'. Conta como "trocou depois do envio" a navegação que
    // começou a partir do instante em que a página mandou o aviso (mesmo relógio, mesmo computador).
    const now = Date.now();
    const sentAt = typeof m?.at === 'number' && Number.isFinite(m.at) ? Math.min(now, Math.max(now - NAV_GRACE_MS, m.at)) : now;
    const p: Provisional = {
      origin: g.origin, username, password, at: now,
      navigating: (navStart.get(id) ?? -1e9) >= sentAt - 20,
    };
    p.expiry = setTimeout(() => { if (provisional.get(id) === p) dropProvisional(id); }, PROVISIONAL_MS + 30_000);
    provisional.set(id, p);
  });

  // O campo de senha sumiu e não voltou (login de site moderno, sem trocar de página).
  ipcMain.on('pw:gone', (e, m: any) => {
    const g = guest(e, m?.origin);
    if (!g) return;
    const p = provisional.get(g.wc.id);
    if (p && !p.navigating && p.origin === g.origin && Date.now() - p.at < LOGIN_WINDOW_MS) promote(g.wc.id);
  });

  // A página nova (depois do envio) carregou: com formulário de senha do MESMO site = login errado.
  ipcMain.on('pw:page', (e, m: any) => {
    const g = guest(e, m?.origin);
    if (!g) return;
    const p = provisional.get(g.wc.id);
    if (!p || !p.navigating) return;
    if (m?.pw === true && g.origin === p.origin) { dropProvisional(g.wc.id); return; }
    promote(g.wc.id);
  });

  ipcMain.on('pw:user-hint', (e, m: any) => {
    const g = guest(e, m?.origin);
    if (!g || g.incognito || !captureOn(g.origin) || agentTyping(g.wc.id)) return;
    const username = typeof m?.username === 'string' ? m.username.trim().slice(0, R.MAX_USERNAME) : '';
    if (username) hints.set(g.wc.id, { origin: g.origin, username, at: Date.now() });
  });

  // ── Balão (a tela responde) ──────────────────────────────────────────────────────────
  ipcMain.handle('passwords:offer-answer', (e, id: unknown, answer: unknown, username: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const o = offers.get(String(id));
    if (!o) return fail('not-found');
    if (answer === 'never') {
      dropOffer(o.id, false);
      if (!data.never.includes(o.origin)) data.never.push(o.origin);
      save(); pushConfig(); changed();
      return { ok: true };
    }
    if (answer !== 'save') { dropOffer(o.id, false); return { ok: true }; }
    if (vault() !== 'ok') { dropOffer(o.id, false); return fail('vault'); }
    const user = typeof username === 'string' ? username.trim().slice(0, R.MAX_USERNAME) : o.username;
    // A pessoa pode ter trocado o usuário no balão: decide de novo com o que ficou (o nome que
    // ela escreveu vale exatamente — apagar o nome não vira "atualizar a única conta do site").
    const d = R.decideSave(known(o.origin), user, o.password, user !== o.username);
    if (d.action === 'save' || d.action === 'update') R.upsertEntry(data.entries, o.origin, d.username, encrypt(o.password), Date.now(), makeId);
    else if (d.action === 'touch') { const e2 = data.entries.find(x => x.id === d.entryId); if (e2) e2.lastUsed = Date.now(); }
    // Não gravou no disco: o balão continua (com o aviso) e "Salvar" tenta de novo.
    if (d.action !== 'none' && !save()) return fail('write-failed');
    dropOffer(o.id, false);
    changed();
    return { ok: true };
  });

  // O olho do balão: a senha que a própria pessoa acabou de digitar (igual ao Chrome, sem confirmação).
  ipcMain.handle('passwords:offer-reveal', (e, id: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const o = offers.get(String(id));
    return o ? { ok: true, password: o.password } : fail('not-found');
  });

  // ── Preencher ────────────────────────────────────────────────────────────────────────
  const cleanRect = (r: any) => {
    const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NaN);
    const rect = { x: n(r?.x, -20000, 20000), y: n(r?.y, -20000, 20000), w: n(r?.w, 0, 10000), h: n(r?.h, 0, 10000) };
    return Object.values(rect).some(Number.isNaN) ? null : rect;
  };

  // Clique num campo de login: se o site tem conta guardada, a tela desenha a lista em cima do campo.
  ipcMain.on('pw:focus', (e, m: any) => {
    const g = guest(e);
    if (!g || vault() !== 'ok') return;
    const list = R.entriesFor(data.entries, g.origin);
    if (!list.length) return;
    const token = typeof m?.token === 'string' && /^[a-z0-9]{4,64}$/.test(m.token) ? m.token : '';
    const rect = cleanRect(m?.rect);
    if (!token || !rect) return;
    watchWc(g.wc);
    const prev = suggests.get(g.wc.id);
    const id = prev && prev.token === token ? prev.id : `pws_${++seq}`;   // mesmo campo: só reposiciona
    suggests.set(g.wc.id, { id, wcId: g.wc.id, frame: g.frame, origin: g.origin, token, at: Date.now(), incognito: g.incognito });
    const view: PwSuggest = {
      id, wcId: g.wc.id, host: R.displayHost(g.origin), insecure: !R.isSecureOrigin(g.origin),
      role: m?.role === 'username' ? 'username' : 'password', rect,
      accounts: list.slice(0, 30).map(x => ({ id: x.id, username: x.username })),
    };
    send('passwords:suggest', view);
  });
  ipcMain.on('pw:blur', (e) => {
    const g = guest(e);
    if (g && suggests.has(g.wc.id)) send('passwords:suggest-hide', { wcId: g.wc.id });
  });

  // A pessoa escolheu a conta na lista: usuário + senha vão SÓ pro frame que pediu, se ele ainda
  // está no mesmo site (origem exata). Nunca pra outra aba, iframe ou página que trocou de site.
  ipcMain.handle('passwords:fill', (e, suggestId: unknown, entryId: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    let s: Suggest | undefined;
    for (const x of suggests.values()) if (x.id === suggestId) s = x;
    if (!s || Date.now() - s.at > SUGGEST_TTL_MS) return fail('not-found');
    suggests.delete(s.wcId);
    const wc = webContents.fromId(s.wcId);
    const frame = s.frame;
    try {
      if (!wc || wc.isDestroyed() || frame.isDestroyed() || frame.detached || frame.parent) return fail('not-found');
      const origin = R.originOf(frame.url);
      if (origin !== s.origin || frame.origin !== origin) return fail('not-found');
      const entry = data.entries.find(x => x.id === entryId && x.origin === origin);
      if (!entry) return fail('not-found');
      const password = decrypt(entry);
      if (password === null) return fail('decrypt');
      frame.send('pw:fill', { token: s.token, username: entry.username, password });
      touch(entry.id, s.incognito);
      return { ok: true };
    } catch { return fail('not-found'); }
  });

  // ── Gerenciador (⋮ → Senhas) ─────────────────────────────────────────────────────────
  const state = (): PwState => ({
    vault: vault(),
    readOnly,
    offerToSave: data.offerToSave,
    entries: data.entries
      .map(x => ({ id: x.id, origin: x.origin, host: x.host, username: x.username, created: x.created, lastUsed: x.lastUsed }))
      .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username)),
    never: data.never.map(origin => ({ origin, host: R.displayHost(origin) })),
  });
  const byId = (id: unknown) => data.entries.find(x => x.id === id);

  /** Avisa as abas abertas se elas podem perguntar (o interruptor ou o "Nunca" mudaram). */
  const pushConfig = () => {
    const mw = mainWin();
    if (!mw) return;
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents?.id !== mw.webContents.id) continue;
        const incognito = wc.session === deps.privateSession;
        if (!incognito && wc.session !== deps.browserSession) continue;
        const origin = R.originOf(wc.mainFrame.url);
        if (origin) wc.mainFrame.send('pw:config', { capture: !incognito && captureOn(origin) });
      } catch {}
    }
  };

  // Mostrar/copiar/editar senha GUARDADA: o Chrome pede a senha do sistema. O Electron não tem o
  // Windows Hello (fica de fora) — no Windows é uma confirmação explícita do main, que a tela do Bah
  // não consegue responder; no Mac com Touch ID, o Touch ID. Cada confirmação diz o site e o usuário
  // e vale só pra AQUELA senha, por 1 minuto. Exportar tem a confirmação dela (exportAuth).
  let unlocked: { entryId: string; until: number } | null = null;
  let asking = false;
  const unlock = async (entry: R.SavedEntry, action: 'show' | 'copy' | 'edit'): Promise<boolean> => {
    if (unlocked && unlocked.entryId === entry.id && Date.now() < unlocked.until) return true;
    if (asking) return false;   // já tem uma confirmação aberta: um pedido de cada vez
    asking = true;
    let ok = false;
    try {
      const vars = { user: entry.username || t('pw.auth.noUser'), site: entry.host };
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        try { await systemPreferences.promptTouchID(t(`pw.auth.touchid.${action}`, vars)); ok = true; } catch { ok = false; }
      } else {
        const r = await box({
          type: 'warning', title: t('pw.auth.title'), message: t(`pw.auth.${action}`, vars), detail: t('pw.auth.detail'),
          buttons: [t('pw.auth.ok'), t('pw.cancel')], defaultId: 1, cancelId: 1, noLink: true,
        });
        ok = r.response === 0;
      }
    } catch { ok = false; } finally { asking = false; }
    unlocked = ok ? { entryId: entry.id, until: Date.now() + UNLOCK_MS } : unlocked;
    return ok;
  };
  /** Exportar: o aviso forte já é a confirmação; no Mac ainda passa pelo Touch ID. Não destrava nada. */
  const exportAuth = async (): Promise<boolean> => {
    if (asking) return false;
    asking = true;
    try {
      const warn = await box({
        type: 'warning', title: t('pw.export.title'), message: t('pw.export.message'), detail: t('pw.export.detail'),
        buttons: [t('pw.export.go'), t('pw.cancel')], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (warn.response !== 0) return false;
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        try { await systemPreferences.promptTouchID(t('pw.auth.touchid.export')); } catch { return false; }
      }
      return true;
    } catch { return false; } finally { asking = false; }
  };

  const guard = R.createClipboardGuard({
    readText: () => clipboard.readText(),
    clear: () => clipboard.clear(),
    digest: (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  // Fechando o Bah com a senha ainda copiada: segura o fechamento até limpar (no máximo 0,5 s) e manda
  // fechar de novo. Só entra em cena com senha copiada há menos de 30 s; nos outros fechamentos não
  // mexe em nada. Convive com o flush dos cookies do main.ts (ele também segura e chama app.quit de
  // novo): cada um só segura enquanto o SEU trabalho não terminou — "Sair" da bandeja e a
  // atualização (quitAndInstall) passam pelo mesmo app.quit e seguem iguais.
  let quitClip: 'idle' | 'running' | 'done' = 'idle';
  app.on('before-quit', (e) => {
    if (quitClip === 'done' || (quitClip === 'idle' && !guard.pending)) return;
    e.preventDefault();
    if (quitClip === 'running') return;
    quitClip = 'running';
    Promise.race([guard.flush(), new Promise(r => setTimeout(r, QUIT_CLIPBOARD_WAIT_MS))])
      .catch(() => {})
      .then(() => { quitClip = 'done'; app.quit(); });
  });

  ipcMain.handle('passwords:state', (e) => (fromMainWindow(e) ? state() : null));

  ipcMain.handle('passwords:set-offer', (e, on: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    data.offerToSave = on === true;
    if (!save()) return fail('write-failed');
    pushConfig(); changed();
    return { ok: true };
  });

  ipcMain.handle('passwords:reveal', async (e, id: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const entry = byId(id);
    if (!entry) return fail('not-found');
    if (!(await unlock(entry, 'show'))) return fail('canceled');
    const password = decrypt(entry);
    return password === null ? fail('decrypt') : { ok: true, password };
  });

  ipcMain.handle('passwords:copy', async (e, id: unknown, what: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const entry = byId(id);
    if (!entry) return fail('not-found');
    try {
      if (what === 'username') { await clipboard.writeText(entry.username); return { ok: true }; }
      if (!(await unlock(entry, 'copy'))) return fail('canceled');
      const password = decrypt(entry);
      if (password === null) return fail('decrypt');
      await clipboard.writeText(password);
      guard.copied(password);
      return { ok: true, clearsInSec: Math.round(R.CLIPBOARD_CLEAR_MS / 1000) };
    } catch { return fail('write-failed'); }
  });

  ipcMain.handle('passwords:update', async (e, id: unknown, patch: any) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const entry = byId(id);
    if (!entry) return fail('not-found');
    const username = typeof patch?.username === 'string' ? patch.username.trim() : entry.username;
    if (username.length > R.MAX_USERNAME) return fail('invalid');
    if (data.entries.some(x => x !== entry && x.origin === entry.origin && x.username === username)) return fail('duplicate');
    let enc = entry.encryptedPassword;
    if (typeof patch?.password === 'string') {
      if (!patch.password || patch.password.length > R.MAX_PASSWORD) return fail('empty');
      if (vault() !== 'ok') return fail('vault');
      if (!(await unlock(entry, 'edit'))) return fail('canceled');
      enc = encrypt(patch.password);
    }
    const before = { username: entry.username, enc: entry.encryptedPassword };
    entry.username = username;
    entry.encryptedPassword = enc;
    if (!save()) { entry.username = before.username; entry.encryptedPassword = before.enc; return fail('write-failed'); }
    changed();
    return { ok: true };
  });

  ipcMain.handle('passwords:delete', (e, id: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    const before = data.entries;
    data.entries = before.filter(x => x.id !== id);
    if (data.entries.length === before.length) return fail('not-found');
    if (!save()) { data.entries = before; return fail('write-failed'); }
    changed();
    return { ok: true };
  });

  ipcMain.handle('passwords:never-remove', (e, origin: unknown) => {
    if (!fromMainWindow(e)) return fail('canceled');
    data.never = data.never.filter(o => o !== origin);
    save(); pushConfig(); changed();
    return { ok: true };
  });

  ipcMain.on('passwords:lock', (e) => { if (fromMainWindow(e)) unlocked = null; });

  // Importar: só por clique da pessoa. Arquivo do Chrome/Edge (name,url,username,password,note),
  // até 5 MB, só sites http/https. Depois oferece mandar o CSV pra Lixeira (tem as senhas em texto puro).
  ipcMain.handle('passwords:import', async (e) => {
    if (!fromMainWindow(e)) return fail('canceled');
    if (vault() !== 'ok') return fail('vault');
    const opts: Electron.OpenDialogOptions = {
      title: t('pw.import.dlg'), properties: ['openFile'],
      filters: [{ name: t('pw.csv.filter'), extensions: ['csv'] }, { name: t('bm.dlg.all'), extensions: ['*'] }],
    };
    const mw = mainWin();
    const r = mw ? await dialog.showOpenDialog(mw, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return fail('canceled');
    const source = r.filePaths[0];
    let text = '';
    try {
      if ((await fs.promises.stat(source)).size > CSV_MAX_BYTES) {
        await box({ type: 'warning', title: t('pw.import.title'), message: t('pw.import.tooBig'), buttons: ['OK'], noLink: true });
        return fail('too-big');
      }
      text = decodeCsv(await fs.promises.readFile(source));
    } catch { return fail('read-failed'); }
    const parsed = R.csvToCredentials(text);
    text = '';
    if (!parsed.recognized || !parsed.rows.length) {
      await box({ type: 'info', title: t('pw.import.title'), message: t('pw.import.none'), buttons: ['OK'], noLink: true });
      return fail('empty');
    }
    const merged = R.mergeImport(data.entries.map(x => ({ origin: x.origin, username: x.username, password: decrypt(x) })), parsed.rows);
    const now = Date.now();
    let added = 0;
    for (const row of merged.add) {
      if (data.entries.length >= R.MAX_ENTRIES) break;
      R.upsertEntry(data.entries, row.origin, row.username, encrypt(row.password), now, makeId);
      added++;
    }
    if (added && !save()) return fail('write-failed');
    changed();
    const res = await box({
      type: 'info', title: t('pw.import.title'),
      message: t('pw.import.done', { added: String(added), dup: String(merged.duplicates), conflicts: String(merged.conflicts), invalid: String(parsed.invalid + merged.add.length - added) }),
      detail: t('pw.import.deleteCsv'),
      buttons: [t('pw.import.trash'), t('pw.import.keep')], defaultId: 0, cancelId: 1, noLink: true,
    });
    let trashed = false;
    if (res.response === 0) { try { await shell.trashItem(source); trashed = true; } catch {} }
    return { ok: true, added, duplicates: merged.duplicates, conflicts: merged.conflicts, invalid: parsed.invalid, trashed };
  });

  // Exportar: aviso forte + confirmação (Touch ID no Mac) + onde salvar. Senha que o cofre não abre fica de fora.
  ipcMain.handle('passwords:export', async (e) => {
    if (!fromMainWindow(e)) return fail('canceled');
    if (!data.entries.length) return fail('empty');
    if (!(await exportAuth())) return fail('canceled');
    // Downloads (não Documentos): pasta que a pessoa costuma olhar e limpar.
    let docs = '';
    try { docs = app.getPath('downloads'); } catch {}
    const opts: Electron.SaveDialogOptions = {
      title: t('pw.export.dlg'),
      defaultPath: path.join(docs || app.getPath('home'), t('pw.export.file')),
      filters: [{ name: t('pw.csv.filter'), extensions: ['csv'] }],
    };
    const mw = mainWin();
    const r = mw ? await dialog.showSaveDialog(mw, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return fail('canceled');
    const list: R.ImportRow[] = [];
    for (const x of data.entries) {
      const password = decrypt(x);
      if (password !== null) list.push({ origin: x.origin, username: x.username, password });
    }
    try { await fs.promises.writeFile(r.filePath, R.credentialsToCsv(list), { encoding: 'utf8', mode: 0o600 }); }
    catch { return fail('write-failed'); }
    return { ok: true, count: list.length, file: path.basename(r.filePath) };
  });

  // ── Preload das abas ─────────────────────────────────────────────────────────────────
  const preload = buildPagePreload();
  if (preload) {
    for (const ses of [deps.browserSession, deps.privateSession]) {
      try { ses.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath: preload }); }
      catch (e: any) { console.error('[Senhas] não registrou o preload das abas:', e?.message || e); }
    }
  }

  // O main.ts avisa quando a IA digita/aperta tecla numa aba (input:type, input:key).
  return { noteAgentInput: (wcId: number) => { if (Number.isInteger(wcId)) agentInputAt.set(wcId, Date.now()); } };
}
