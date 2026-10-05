// Gerenciador de downloads do Bah.
// Fase A (Chromium): DownloadItem com pausar/continuar/cancelar, velocidade+ETA, fila
// com limite e tentar de novo — guardado num registry por id pra a UI controlar.
// Fase B (várias conexões): o motor do "IDM Caseiro" (multi-download.ts). No will-download
// o item do Chromium fica SEGURADO enquanto o motor sonda o servidor; se aceita fatias e o
// arquivo é grande, o Chromium cancela e o motor assume com o MESMO id (a linha da lista
// continua a mesma); se não, o Chromium segue como sempre. Dá pra desligar em Downloads → ⚙.
import { ipcMain, shell, app, dialog } from 'electron';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs';
import { isInsideAllowedRoot } from './validate';
import { MultiDownload, probeDownload, partPathFor, DEFAULT_ENGINE_CONFIG, MAX_CONNECTIONS, type EngineConfig } from './multi-download';
import { downloadRoots, getDownloadDir, setDownloadDir } from './download-dir';

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
  probing?: boolean;      // segurado enquanto o motor de várias conexões sonda o servidor
  handedOff?: boolean;    // o motor assumiu: o 'done' (cancelado) do Chromium não conta
}

/** Download tocado pelo motor de várias conexões. */
interface EngineJob {
  id: string;
  dl: MultiDownload;
  url: string;
  filename: string;
  timer: ReturnType<typeof setInterval> | null;
}

/** Preferências do gerenciador (Downloads → ⚙), espelhando as do IDM Caseiro. */
export interface DownloadEngineSettings {
  enabled: boolean;
  connections: number;
  maxRetries: number;
  minSegmentMB: number;
  connectTimeoutS: number;
  readTimeoutS: number;
}
export const DEFAULT_DOWNLOAD_ENGINE_SETTINGS: DownloadEngineSettings = {
  enabled: true,
  connections: DEFAULT_ENGINE_CONFIG.connections,
  maxRetries: DEFAULT_ENGINE_CONFIG.maxRetries,
  minSegmentMB: DEFAULT_ENGINE_CONFIG.minSegmentBytes / (1024 * 1024),
  connectTimeoutS: DEFAULT_ENGINE_CONFIG.connectTimeoutMs / 1000,
  readTimeoutS: DEFAULT_ENGINE_CONFIG.readTimeoutMs / 1000,
};
const clampNum = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
export function sanitizeEngineSettings(raw: any): DownloadEngineSettings {
  const d = DEFAULT_DOWNLOAD_ENGINE_SETTINGS;
  return {
    enabled: raw?.enabled === undefined ? d.enabled : !!raw.enabled,
    connections: Math.round(clampNum(raw?.connections, 1, MAX_CONNECTIONS, d.connections)),
    maxRetries: Math.round(clampNum(raw?.maxRetries, 0, 30, d.maxRetries)),
    minSegmentMB: clampNum(raw?.minSegmentMB, 0.25, 64, d.minSegmentMB),
    connectTimeoutS: clampNum(raw?.connectTimeoutS, 3, 120, d.connectTimeoutS),
    readTimeoutS: clampNum(raw?.readTimeoutS, 5, 300, d.readTimeoutS),
  };
}

const MAX_CONCURRENT = 5;
// Abaixo disso várias conexões não ajudam (cada fatia teria < 1 MB): fica com o Chromium.
const ENGINE_MIN_BYTES = 2 * 1024 * 1024;

export function setupDownloadManager(deps: Deps) {
  const reg = new Map<string, Tracked>();
  const engineJobs = new Map<string, EngineJob>();
  // URLs que o motor devolveu pro Chromium (não suportou): o próximo will-download passa direto.
  const bypass = new Set<string>();
  let settings: DownloadEngineSettings = { ...DEFAULT_DOWNLOAD_ENGINE_SETTINGS };
  let seq = 0;
  const engineConfig = (): Partial<EngineConfig> => ({
    connections: settings.connections,
    maxRetries: settings.maxRetries,
    minSegmentBytes: Math.round(settings.minSegmentMB * 1024 * 1024),
    minSplitBytes: Math.round(settings.minSegmentMB * 2 * 1024 * 1024),
    connectTimeoutMs: settings.connectTimeoutS * 1000,
    readTimeoutMs: settings.readTimeoutS * 1000,
  });

  const send = (payload: any) => {
    try { deps.getMainWindow()?.webContents.send('agent:download-event', payload); } catch {}
  };
  // Quantos estão DE FATO baixando: nem os segurados pela fila, nem os pausados
  // pelo usuário. (Pausado contava como ativo → pausar 5 travava o 6º pra sempre.)
  const activeCount = () => {
    let n = 0;
    for (const t of reg.values()) { let p = false; try { p = t.item.isPaused(); } catch {} if (!t.queued && !p) n++; }
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

  // ── Motor de várias conexões ──
  // Downloads devolvidos pelo motor reaparecem no Chromium com o MESMO id (mesma linha).
  const reuseIds = new Map<string, string>();
  const sessions: Electron.Session[] = [];

  const engineEmit = (job: EngineJob) => {
    const s = job.dl.snapshot();
    send({
      id: job.id,
      engine: true,
      state: s.state === 'completed' ? 'completed' : s.state === 'failed' ? 'failed' : s.state === 'cancelled' ? 'cancelled' : 'progress',
      filename: path.basename(job.dl.target), path: job.dl.target, url: job.url,
      bytes: s.done, totalBytes: s.total, speedBps: Math.round(s.speedBps), etaSec: s.etaSec,
      paused: s.state === 'paused',
      connections: s.connections.length,
      map: s.map.slice(0, 64).map(([a, b, w]) => [+a.toFixed(4), +b.toFixed(4), +w.toFixed(4)]),
      reason: s.error,
    });
  };
  const startEngine = (job: EngineJob) => {
    if (job.timer) clearInterval(job.timer);
    job.timer = setInterval(() => engineEmit(job), 450);
    job.dl.start().then(() => {
      if (job.timer) { clearInterval(job.timer); job.timer = null; }
      const st = job.dl.state;
      if (st === 'failed' && job.dl.snapshot().done === 0 && sessions[0]) {
        // Motor não conseguiu nem começar (cookie/servidor chato): devolve pro Chromium,
        // na mesma linha, e ele baixa do jeito de sempre.
        engineJobs.delete(job.id);
        reuseIds.set(job.url, job.id);
        bypass.add(job.url);
        try { fs.unlinkSync(partPathFor(job.dl.target)); } catch {}
        try { sessions[0].downloadURL(job.url); return; } catch {}
      }
      engineEmit(job);
      if (st !== 'paused') engineJobs.delete(job.id);
    }).catch(() => {});
  };

  /** Segura o item do Chromium, sonda, e decide quem baixa. */
  const tryEngine = async (t: Tracked, sess: Electron.Session, wc?: Electron.WebContents) => {
    let chain: string[] = [];
    try { chain = t.item.getURLChain(); } catch {}
    // O Chromium já seguiu os redirecionamentos: usa o endereço FINAL, com os cookies DELE.
    const finalUrl = chain[chain.length - 1] || t.url;
    const headers: Record<string, string> = {};
    try { headers['User-Agent'] = (wc && !wc.isDestroyed() ? wc.getUserAgent() : '') || sess.getUserAgent(); } catch {}
    try { const ref = wc && !wc.isDestroyed() ? wc.getURL() : ''; if (/^https?:/i.test(ref)) headers.Referer = ref; } catch {}
    try {
      const cookies = await sess.cookies.get({ url: finalUrl });
      if (cookies.length) headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch {}
    let probe: Awaited<ReturnType<typeof probeDownload>> | null = null;
    // redirect 'error': com cookie no cabeçalho, nunca segue pra OUTRO site (vazaria o cookie).
    try { probe = await probeDownload(finalUrl, headers, settings.connectTimeoutS * 1000, undefined, 'error'); } catch { probe = null; }
    if (!reg.has(t.id)) return;   // a pessoa cancelou enquanto sondava
    const fits = !!probe && probe.resumable && (probe.size ?? 0) >= ENGINE_MIN_BYTES && !/text\/html/i.test(probe.mime || '');
    if (!fits || !probe) {
      t.probing = false;
      try { t.item.resume(); } catch {}
      return;
    }
    // O motor assume: o Chromium cancela (o 'done' dele é ignorado) e o motor grava no
    // MESMO caminho que o Chromium ia usar, com o MESMO id na lista.
    t.handedOff = true;
    reg.delete(t.id);
    try { t.item.cancel(); } catch {}
    const job: EngineJob = {
      id: t.id,
      dl: new MultiDownload(probe, t.path, headers, { ...engineConfig(), redirect: 'error' }),
      url: t.url,
      filename: t.filename,
      timer: null,
    };
    engineJobs.set(t.id, job);
    startEngine(job);
    startNextQueued();
  };

  const attach = (sess: Electron.Session) => {
    sessions.push(sess);
    sess.on('will-download', (event, item, wc) => {
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
      const reused = reuseIds.get(url);
      if (reused) reuseIds.delete(url);
      const id = reused || `dl_${++seq}`;
      const now = Date.now();
      const willQueue = activeCount() >= MAX_CONCURRENT;
      const t: Tracked = { id, item, url, filename: path.basename(target), path: target, lastBytes: 0, lastTime: now, speedBps: 0, lastEmit: 0, queued: willQueue };
      reg.set(id, t);
      if (willQueue) { try { item.pause(); } catch {} }
      send({ id, state: willQueue ? 'queued' : 'started', filename: t.filename, path: target, totalBytes: item.getTotalBytes(), url, paused: willQueue });
      // Várias conexões (ligado em Downloads → ⚙): só arquivo http(s) grande (ou de tamanho
      // ainda desconhecido) que não está na fila nem voltou do motor agora há pouco.
      const total = item.getTotalBytes();
      const skip = bypass.delete(url);
      if (settings.enabled && !skip && !willQueue && /^https?:/i.test(url) && (total === 0 || total >= ENGINE_MIN_BYTES)) {
        t.probing = true;
        try { item.pause(); } catch {}
        tryEngine(t, sess, wc || undefined).catch(() => {
          t.probing = false;
          if (reg.has(t.id)) { try { item.resume(); } catch {} }
        });
      }

      item.on('updated', (_e, st) => {
        if (t.probing || t.handedOff) return;   // segurado só pra sondar: não é "pausado" pra quem olha
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
        if (t.handedOff) return;   // cancelado de propósito: o motor de várias conexões assumiu
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

  // ── Ações da lista: primeiro os do motor de várias conexões, depois os do Chromium ──
  const engineAction = (id: string, act: 'pause' | 'resume' | 'cancel'): boolean => {
    const job = engineJobs.get(id);
    if (!job) return false;
    if (act === 'pause') { job.dl.pause(); engineEmit(job); }
    else if (act === 'resume') { if (job.dl.state === 'paused') startEngine(job); engineEmit(job); }
    else { job.dl.cancel().then(() => { if (job.timer) { clearInterval(job.timer); job.timer = null; } engineEmit(job); engineJobs.delete(id); }); }
    return true;
  };

  ipcMain.handle('download:set-engine', (_e, raw: unknown) => {
    settings = sanitizeEngineSettings(raw);
    return settings;
  });
  ipcMain.handle('download:get-engine', () => settings);

  // Pedaços (.bahpart) de um download que o Bah não terminou (fechou no meio, caiu): não dá
  // pra continuar depois de reiniciar, então são lixo — limpa ao saber qual é a pasta.
  const sweepParts = (dir: string) => {
    try {
      const busy = new Set(Array.from(engineJobs.values()).map(j => path.resolve(partPathFor(j.dl.target))));
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.bahpart')) continue;
        const full = path.resolve(path.join(dir, f));
        if (!busy.has(full)) { try { fs.unlinkSync(full); } catch {} }
      }
    } catch {}
  };
  sweepParts(getDownloadDir());
  ipcMain.handle('download:set-dir', (_e, dir: unknown) => {
    const now = setDownloadDir(typeof dir === 'string' ? dir : null);
    sweepParts(now);
    return now;
  });
  ipcMain.handle('download:choose-dir', async () => {
    const win = deps.getMainWindow();
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: getDownloadDir() };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    return setDownloadDir(r.filePaths[0]);
  });

  ipcMain.handle('download:pause', (_e, id: string) => {
    if (engineAction(id, 'pause')) return { ok: true };
    const t = reg.get(id);
    if (t) {
      try { t.item.pause(); } catch {}
      send({ id, state: 'progress', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: true, speedBps: 0 });
      startNextQueued();   // pausar LIBERA a vaga → um da fila pode começar agora
    }
    return { ok: !!t };
  });
  ipcMain.handle('download:resume', (_e, id: string) => {
    if (engineAction(id, 'resume')) return { ok: true };
    const t = reg.get(id);
    if (t) {
      let paused = false; try { paused = t.item.isPaused(); } catch {}
      // Já baixando (clique-duplo no ▶ antes do estado atualizar)? Não faz nada — senão o
      // teto contaria o próprio item e mandaria de volta pra fila quem acabou de retomar.
      if (!t.queued && !paused) return { ok: true };
      // Respeita o teto: com 5 já baixando, "continuar" entra na FILA (não fura pra 6+).
      if (activeCount() >= MAX_CONCURRENT) {
        t.queued = true;
        try { t.item.pause(); } catch {}
        send({ id, state: 'queued', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: true });
      } else {
        t.queued = false;
        t.lastTime = Date.now();
        t.lastBytes = t.item.getReceivedBytes();
        try { t.item.resume(); } catch {}
        send({ id, state: 'progress', filename: t.filename, path: t.path, bytes: t.item.getReceivedBytes(), totalBytes: t.item.getTotalBytes(), paused: false });
      }
    }
    return { ok: !!t };
  });
  ipcMain.handle('download:cancel', (_e, id: string) => {
    if (engineAction(id, 'cancel')) return { ok: true };
    const t = reg.get(id);
    if (t) { try { t.item.cancel(); } catch {} }
    return { ok: !!t };
  });
  // Retry: re-dispara o download pela sessão das ABAS (com os cookies delas) — re-aciona o
  // will-download, que decide de novo entre o motor de várias conexões e o Chromium.
  ipcMain.handle('download:retry', (_e, id: string, url?: string) => {
    const u = url || reg.get(id)?.url;
    if (!u) return { ok: false };
    try {
      if (sessions[0]) sessions[0].downloadURL(u);
      else deps.getMainWindow()?.webContents.downloadURL(u);
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle('download:open-file', (_e, p: string) => {
    // GUARD: só abre arquivo DENTRO das pastas que o app de fato usa (Downloads/userData/temp),
    // mesma regra do shell:reveal — nunca abre um caminho arbitrário do sistema.
    const roots = [...downloadRoots(), app.getPath('userData'), os.tmpdir()];
    if (!isInsideAllowedRoot(p, roots)) {
      console.warn('[download:open-file] bloqueado (fora das pastas permitidas):', p);
      return { ok: false, error: 'Path outside the allowed folders.' };
    }
    try { shell.openPath(p); } catch {}
    return { ok: true };
  });

  // Fechando o Bah no meio: os parciais (.bahpart) não têm como continuar depois — some com eles.
  app.on('before-quit', () => {
    for (const job of engineJobs.values()) {
      if (job.dl.state === 'downloading' || job.dl.state === 'paused') job.dl.cancel().catch(() => {});
    }
  });

  return { attach };
}
