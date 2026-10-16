// Importar/exportar favoritos (⋮ → Favoritos → Importar e exportar). O main só mexe em arquivo:
// acha o Chrome/Edge, lê o "Bookmarks"/"AccountBookmarks" do perfil, abre/salva o HTML. A lista de favoritos em si
// continua no renderer (localStorage 'favorites.v1') — quem junta e salva é ele.
// Os arquivos do outro navegador são SÓ LIDOS (nunca escritos, nunca travados): o Chrome grava o
// Bookmarks por troca atômica (arquivo novo + renomear), então ler com ele aberto é seguro.
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseChromeProfile, CHROME_BM_FILES, parseNetscapeHtml, decodeBookmarkHtml, flattenBookmarks, serializeNetscapeHtml,
  favoritesToExportTree, exportFileName, sanitizeFavorites, BookmarkParseError, MAX_SOURCE_BYTES,
  type FlatBookmark,
} from '../shared/bookmarks';

type BrowserId = 'chrome' | 'edge';
type ImportError = 'canceled' | 'not-found' | 'empty' | 'too-big' | 'bad-format' | 'read-failed';
export type ImportResult = { ok: true; items: FlatBookmark[]; profile?: string } | { ok: false; error: ImportError };

const BROWSERS: Record<BrowserId, { name: string; win: string[]; mac: string[]; linux: string[] }> = {
  chrome: { name: 'Chrome', win: ['Google', 'Chrome', 'User Data'], mac: ['Google', 'Chrome'], linux: ['google-chrome'] },
  edge: { name: 'Edge', win: ['Microsoft', 'Edge', 'User Data'], mac: ['Microsoft Edge'], linux: ['microsoft-edge'] },
};

function userDataDir(id: BrowserId): string {
  const b = BROWSERS[id];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, ...b.win);
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...b.mac);
  return path.join(os.homedir(), '.config', ...b.linux);
}

// Perfis do Chromium: "Default" e "Profile N" (os outros diretórios são caches/sistema).
function profileDirs(base: string): string[] {
  let names: string[] = [];
  try { names = fs.readdirSync(base); } catch { return []; }
  return names
    .filter(n => n === 'Default' || /^Profile \d+$/.test(n))
    .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10)))
    .filter(n => profileFiles(base, n).length > 0);
}

// Arquivos de favoritos que existem no perfil (conta primeiro — ver CHROME_BM_FILES).
function profileFiles(base: string, dir: string): string[] {
  return CHROME_BM_FILES.map(f => path.join(base, dir, f))
    .filter(p => { try { const s = fs.statSync(p); return s.isFile() && s.size > 0; } catch { return false; } });
}

// Lê sem travar: arquivo de outro programa pode estar no meio de uma troca → tenta de novo.
async function readShared(file: string): Promise<Buffer> {
  for (let i = 0; ; i++) {
    try {
      const st = await fs.promises.stat(file);
      if (st.size > MAX_SOURCE_BYTES) throw new BookmarkParseError('too-big');
      return await fs.promises.readFile(file, { flag: 'r' });
    } catch (e: any) {
      if (e instanceof BookmarkParseError || i >= 3 || !['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(e?.code)) throw e;
      await new Promise(r => setTimeout(r, 150 * (i + 1)));
    }
  }
}

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
}

// Nome amigável do perfil ("Pessoa 1", "Trabalho") vem do "Local State" do navegador.
async function profileNames(base: string): Promise<Record<string, string>> {
  try {
    const ls = JSON.parse(decodeText(await readShared(path.join(base, 'Local State'))));
    const cache = ls?.profile?.info_cache;
    const out: Record<string, string> = {};
    if (cache && typeof cache === 'object') {
      for (const [dir, info] of Object.entries<any>(cache)) {
        const n = String(info?.name || info?.gaia_name || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 60);
        if (n) out[dir] = n;
      }
    }
    return out;
  } catch { return {}; }
}

const errCode = (e: unknown): ImportError => (e instanceof BookmarkParseError ? e.code : 'read-failed');

export function setupBookmarksIO(deps: { getMainWindow: () => BrowserWindow | null; t: (key: string, vars?: Record<string, string>) => string; lang?: () => string }): void {
  const fromMainWindow = (e: IpcMainInvokeEvent) => {
    const mw = deps.getMainWindow();
    return !!mw && !mw.isDestroyed() && e.sender === mw.webContents;
  };
  const win = () => { const mw = deps.getMainWindow(); return mw && !mw.isDestroyed() ? mw : null; };
  let lastHtmlDir: string | undefined;

  // Quais navegadores dá pra importar (o menu só mostra os que existem neste computador).
  ipcMain.handle('bookmarks:sources', (e) => {
    if (!fromMainWindow(e)) return [];
    return (Object.keys(BROWSERS) as BrowserId[])
      .filter(id => profileDirs(userDataDir(id)).length > 0)
      .map(id => ({ id, name: BROWSERS[id].name }));
  });

  ipcMain.handle('bookmarks:import-browser', async (e, id: unknown): Promise<ImportResult> => {
    if (!fromMainWindow(e) || (id !== 'chrome' && id !== 'edge')) return { ok: false, error: 'not-found' };
    const base = userDataDir(id);
    const dirs = profileDirs(base);
    if (!dirs.length) return { ok: false, error: 'not-found' };
    // Lê todos os perfis; só oferece os que têm pelo menos um favorito.
    const found: Array<{ dir: string; items: FlatBookmark[] }> = [];
    let lastErr: ImportError = 'empty';
    for (const dir of dirs) {
      // Chrome logado guarda os favoritos da conta em "AccountBookmarks"; lê os dois e junta.
      const files: Array<{ text: string } | { error: unknown }> = [];
      for (const file of profileFiles(base, dir)) {
        try { files.push({ text: decodeText(await readShared(file)) }); } catch (error) { files.push({ error }); }
      }
      try {
        const items = parseChromeProfile(files);
        if (items.length) found.push({ dir, items });
      } catch (err) { lastErr = errCode(err); }
    }
    if (!found.length) return { ok: false, error: lastErr };
    let pick = found[0];
    const names = await profileNames(base);
    if (found.length > 1) {
      // Mais de um perfil com favoritos: a pessoa escolhe (igual ao seletor de perfil do Chrome).
      const shown = found.slice(0, 8);
      const opts: Electron.MessageBoxOptions = {
        type: 'question', noLink: true,
        title: deps.t('bm.pick.title', { browser: BROWSERS[id].name }),
        message: deps.t('bm.pick.message', { browser: BROWSERS[id].name }),
        buttons: [...shown.map(f => {
          const name = names[f.dir] || f.dir;
          if (f.items.length === 1) return deps.t('bm.pick.optionOne', { name });
          // Número no jeito do idioma do diálogo (1.234 / 1,234), igual à interface.
          let n = String(f.items.length);
          try { n = f.items.length.toLocaleString(deps.lang?.()); } catch {}
          return deps.t('bm.pick.option', { name, n });
        }), deps.t('bm.pick.cancel')],
        cancelId: shown.length, defaultId: 0,
      };
      const mw = win();
      const r = mw ? await dialog.showMessageBox(mw, opts) : await dialog.showMessageBox(opts);
      if (r.response >= shown.length) return { ok: false, error: 'canceled' };
      pick = shown[r.response];
    }
    return { ok: true, items: pick.items, profile: names[pick.dir] || pick.dir };
  });

  ipcMain.handle('bookmarks:import-html', async (e): Promise<ImportResult> => {
    if (!fromMainWindow(e)) return { ok: false, error: 'canceled' };
    const opts: Electron.OpenDialogOptions = {
      title: deps.t('bm.dlg.import'),
      defaultPath: lastHtmlDir,
      properties: ['openFile'],
      filters: [{ name: deps.t('bm.dlg.filter'), extensions: ['html', 'htm'] }, { name: deps.t('bm.dlg.all'), extensions: ['*'] }],
    };
    const mw = win();
    const r = mw ? await dialog.showOpenDialog(mw, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'canceled' };
    lastHtmlDir = path.dirname(r.filePaths[0]);
    try {
      // HTML pode vir em charset antigo (windows-1252); o JSON do Chrome é sempre UTF-8.
      const items = flattenBookmarks(parseNetscapeHtml(decodeBookmarkHtml(await readShared(r.filePaths[0]))));
      return items.length ? { ok: true, items } : { ok: false, error: 'empty' };
    } catch (err) { return { ok: false, error: errCode(err) }; }
  });

  ipcMain.handle('bookmarks:export', async (e, favs: unknown): Promise<{ ok: true; count: number; file: string } | { ok: false; error: 'canceled' | 'empty' | 'write-failed' }> => {
    if (!fromMainWindow(e)) return { ok: false, error: 'canceled' };
    const list = sanitizeFavorites(favs);
    if (!list.length) return { ok: false, error: 'empty' };
    let docs: string | undefined;
    try { docs = app.getPath('documents'); } catch {}
    const opts: Electron.SaveDialogOptions = {
      title: deps.t('bm.dlg.export'),
      defaultPath: path.join(lastHtmlDir || docs || os.homedir(), exportFileName(new Date())),
      filters: [{ name: deps.t('bm.dlg.filter'), extensions: ['html'] }],
    };
    const mw = win();
    const r = mw ? await dialog.showSaveDialog(mw, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false, error: 'canceled' };
    lastHtmlDir = path.dirname(r.filePath);
    try {
      const html = serializeNetscapeHtml(favoritesToExportTree(list, deps.t('bm.export.toolbar')), { title: deps.t('bm.export.title') });
      await fs.promises.writeFile(r.filePath, html, 'utf8');
      return { ok: true, count: list.length, file: path.basename(r.filePath) };
    } catch { return { ok: false, error: 'write-failed' }; }
  });
}
