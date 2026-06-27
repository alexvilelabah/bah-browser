// Gerenciador de download NATIVO (Fase A) — usa o que o Electron já dá
// (DownloadItem.pause/resume/cancel/canResume) pra entregar um gerenciador estilo
// IDM SEM multi-conexão: pausar/continuar/cancelar/retomar, velocidade+ETA, fila
// com limite e tentar de novo. O DownloadItem é guardado num registry por id pra
// poder ser controlado pela UI depois que o handler do will-download retorna.
// (Multi-conexão/aceleração via aria2c = Fase B, fora daqui.)
import { ipcMain, shell, app } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { isInsideAllowedRoot } from './validate';

interface Deps {
  getMainWindow: () => Electron.BrowserWindow | null;
  uniqueDownloadPath: (base: string) => string;
  blockedExtensions: RegExp;
}

interface Tracked {
  id: string;
  item: Electron.DownloadItem;
  url: string;
  filename: string;
  path: string;
  lastBytes: number;
  lastTime: number;
  speedBps: number;
  lastEmit: number;
  queued: boolean;        // segurando pela fila (pausado até abrir vaga)
}

const MAX_CONCURRENT = 5;

export function setupDownloadManager(deps: Deps) {
  const reg = new Map<string, Tracked>();
  let seq = 0;

  const send = (payload: any) => {
    try { deps.getMainWindow()?.webContents.send('agent:download-event', payload); } catch {}
  };
  // Quantos estão de fato baixando (não os segurados pela fila).
  const activeCount = () => {
    let n = 0;
    for (const t of reg.values()) if (!t.queued) n++;
    return n;
  };
  // Quando um termina, solta o próximo da fila.
  const startNextQueued = () => {
    for (const t of reg.values()) {
      if (activeCount() >= MAX_CONCURRENT) break;
      if (t.queued) {
        t.queued = false;
        t.lastTime = Date.now();
        t.lastBytes = t.item.getReceivedBytes();
        try { t.item.resume(); } catch {}
        send({ id: t.id, state: 'progress', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: false });
      }
    }
  };

  const attach = (sess: Electron.Session) => {
    sess.on('will-download', (event, item) => {
      const filename = item.getFilename() || 'download.bin';
      const url = item.getURL();
      if (deps.blockedExtensions.test(filename) || deps.blockedExtensions.test(url)) {
        event.preventDefault();
        console.warn(`[Download] BLOCKED executable: ${filename}`);
        send({ state: 'blocked', filename, reason: 'executable/script blocked' });
        return;
      }
      const target = deps.uniqueDownloadPath(filename);
      item.setSavePath(target);   // suprime o "Salvar como" nativo
      const id = `dl_${++seq}`;
      const now = Date.now();
      const willQueue = activeCount() >= MAX_CONCURRENT;
      const t: Tracked = { id, item, url, filename: path.basename(target), path: target, lastBytes: 0, lastTime: now, speedBps: 0, lastEmit: 0, queued: willQueue };
      reg.set(id, t);
      if (willQueue) { try { item.pause(); } catch {} }
      send({ id, state: willQueue ? 'queued' : 'started', filename: t.filename, path: target, totalBytes: item.getTotalBytes(), url, paused: willQueue });

      item.on('updated', (_e, st) => {
        if (st !== 'progressing') {
          send({ id, state: 'progress', filename: t.filename, path: target, bytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), paused: item.isPaused(), speedBps: 0 });
          return;
        }
        const tnow = Date.now();
        const dt = (tnow - t.lastTime) / 1000;
        if (dt >= 0.5) {
          const received = item.getReceivedBytes();
          t.speedBps = dt > 0 ? Math.max(0, (received - t.lastBytes) / dt) : 0;
          t.lastBytes = received;
          t.lastTime = tnow;
        }
        if (tnow - t.lastEmit >= 450) {   // throttle ~500ms pra não floodar o IPC
          t.lastEmit = tnow;
          const total = item.getTotalBytes();
          const received = item.getReceivedBytes();
          const etaSec = (t.speedBps > 0 && total > 0) ? Math.max(0, Math.round((total - received) / t.speedBps)) : undefined;
          send({ id, state: 'progress', filename: t.filename, path: target, bytes: received, totalBytes: total, speedBps: Math.round(t.speedBps), etaSec, paused: item.isPaused() });
        }
      });

      item.once('done', (_e, state) => {
        reg.delete(id);
        console.log(`[Download] ${state}: ${target}`);
        send({
          id,
          state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed',
          filename: t.filename, path: target, bytes: item.getReceivedBytes(),
        });
        startNextQueued();
      });
    });
  };

  ipcMain.handle('download:pause', (_e, id: string) => {
    const t = reg.get(id);
    if (t) {
      try { t.item.pause(); } catch {}
      send({ id, state: 'progress', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: true, speedBps: 0 });
    }
    return { ok: !!t };
  });
  ipcMain.handle('download:resume', (_e, id: string) => {
    const t = reg.get(id);
    if (t) {
      t.queued = false;
      t.lastTime = Date.now();
      t.lastBytes = t.item.getReceivedBytes();
      try { t.item.resume(); } catch {}
      send({ id, state: 'progress', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: false });
    }
    return { ok: !!t };
  });
  ipcMain.handle('download:cancel', (_e, id: string) => {
    const t = reg.get(id);
    if (t) { try { t.item.cancel(); } catch {} }
    return { ok: !!t };
  });
  // Retry: re-dispara o download pela sessão do navegador (re-aciona o will-download).
  // Nota: usa a sessão padrão da janela — perde cookies de sessão; ok pra falha
  // transitória de arquivo público.
  ipcMain.handle('download:retry', (_e, id: string, url?: string) => {
    const u = url || reg.get(id)?.url;
    if (!u) return { ok: false };
    try { deps.getMainWindow()?.webContents.downloadURL(u); return { ok: true }; }
    catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle('download:open-file', (_e, p: string) => {
    // GUARD: só abre arquivo DENTRO das pastas que o app de fato usa (Downloads/userData/temp),
    // mesma regra do shell:reveal — nunca abre um caminho arbitrário do sistema.
    const roots = [app.getPath('downloads'), app.getPath('userData'), os.tmpdir()];
    if (!isInsideAllowedRoot(p, roots)) {
      console.warn('[download:open-file] bloqueado (fora das pastas permitidas):', p);
      return { ok: false, error: 'Path outside the allowed folders.' };
    }
    try { shell.openPath(p); } catch {}
    return { ok: true };
  });

  return { attach };
}
