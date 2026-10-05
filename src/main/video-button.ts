// Botão "Baixar" do YouTube — a parte do processo principal: injeta o script nas abas
// do YouTube, responde às mensagens dele (lista de resoluções / baixar / mostrar na
// pasta) e põe cada download na lista de Downloads do Bah (kind: 'video'), com barra,
// velocidade, cancelar e tentar de novo.
import { ipcMain, shell, webContents, type BrowserWindow, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { downloadVideo, fetchVideoInfo, type VideoDownloadProgress } from './media-downloader';
import { buildVideoChoices, formatBytes, PartsProgress, youtubeVideoId, youtubeWatchUrl, type VideoChoice } from './video-formats';
import { buildVideoButtonScript, DEFAULT_VIDEO_BUTTON_LABELS, sanitizeVideoButtonLabels, type VideoButtonLabels } from './video-button-script';

interface Deps {
  getMainWindow: () => BrowserWindow | null;
  /** ms desde o último clique/tecla DE VERDADE naquela aba (trava contra script da página). */
  msSinceGesture: (wcId: number) => number;
}

interface Choices { ok: boolean; title?: string; choices?: VideoChoice[]; live?: boolean; error?: string }

interface Job {
  id: string;
  v: string;
  choice: VideoChoice;
  title: string;
  wcId: number;
  abort: AbortController;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  path?: string;
}

const INFO_TTL_MS = 10 * 60 * 1000;
const GESTURE_WINDOW_MS = 5000;

const isYoutubePage = (url: string) => /^https:\/\/(www\.|m\.)?youtube\.com\//i.test(url || '');

export function setupVideoButton(deps: Deps) {
  let enabled = true;
  let labels: VideoButtonLabels = DEFAULT_VIDEO_BUTTON_LABELS;
  let script = buildVideoButtonScript(labels);
  const infoCache = new Map<string, { at: number; p: Promise<Choices> }>();
  const jobs = new Map<string, Job>();
  let seq = 0;

  const toRenderer = (payload: Record<string, unknown>) => {
    try { deps.getMainWindow()?.webContents.send('agent:download-event', { kind: 'video', ...payload }); } catch {}
  };
  const toPage = (wc: WebContents | undefined, fn: 'onFormats' | 'onJob', payload: unknown) => {
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript(`window.__bahDl&&window.__bahDl.${fn}(${JSON.stringify(payload)})`, false).catch(() => {});
  };
  const pageOf = (job: Job) => {
    const wc = webContents.fromId(job.wcId);
    // Só fala com a aba se ela ainda mostra AQUELE vídeo.
    return wc && !wc.isDestroyed() && youtubeVideoId(wc.getURL()) === job.v ? wc : undefined;
  };

  const getChoices = (v: string): Promise<Choices> => {
    const hit = infoCache.get(v);
    if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.p;
    const p = fetchVideoInfo(youtubeWatchUrl(v)).then((r): Choices => {
      if (!r.ok) return { ok: false, error: r.error };
      const live = r.info?.is_live === true || r.info?.live_status === 'is_live' || r.info?.live_status === 'is_upcoming';
      if (live) return { ok: false, live: true };
      const c = buildVideoChoices(r.info);
      return c.choices.length ? { ok: true, title: c.title, choices: c.choices } : { ok: false, error: 'no formats' };
    });
    infoCache.set(v, { at: Date.now(), p });
    // Erro não fica em cache: "Tentar de novo" tem que tentar de verdade.
    p.then((r) => { if (!r.ok && !r.live) infoCache.delete(v); });
    return p;
  };

  const presentable = (c: Choices) => c.ok
    ? { ok: true, choices: (c.choices || []).map(x => ({ key: x.key, kind: x.kind, label: x.label, hint: x.hint, size: formatBytes(x.approxBytes, labels.dec) })) }
    : { ok: false, live: !!c.live };

  // Pedaços de um download cancelado/falho. O Windows pode segurar o arquivo por um
  // instante depois que o processo morre — tenta de novo algumas vezes.
  const removePartials = async (files: string[] | undefined) => {
    for (const f of files || []) {
      for (let i = 0; i < 6; i++) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); break; }
        catch { await new Promise(r => setTimeout(r, 500)); }
      }
    }
  };

  const run = (job: Job) => {
    const { id, v, choice } = job;
    const ext = choice.kind === 'audio' ? 'mp3' : 'mp4';
    // Mesmo nome que o arquivo vai ter (o yt-dlp grava "Título (1080p) [id].mp4").
    const filename = choice.kind === 'audio' ? `${job.title}.${ext}` : `${job.title} (${choice.res}p).${ext}`;
    toRenderer({ id, state: 'started', filename, url: youtubeWatchUrl(v), bytes: 0, totalBytes: choice.approxBytes });
    toPage(pageOf(job), 'onJob', { v, key: choice.key, state: 'started' });

    // MP3: o que desce é o áudio original (menor que o MP3 final) — a estimativa do MP3
    // seguraria a barra em ~50% até a conversão. Ali vale o total real do download.
    const agg = new PartsProgress(choice.kind === 'audio' ? 0 : choice.approxBytes || 0);
    let lastRenderer = 0, lastPage = 0, lastPageState = '';
    const onProgress = (p: VideoDownloadProgress) => {
      if (job.abort.signal.aborted) return;   // cancelado: a barra não volta a andar
      const now = Date.now();
      if (p.state === 'preparing') {
        toRenderer({ id, state: 'progress', bytes: 0, totalBytes: choice.approxBytes });
        // Só com recado (baixando o yt-dlp/ffmpeg/Deno) é a "1ª vez"; o 'preparing' que todo
        // download manda no começo não deve dizer "Preparando (só na primeira vez)".
        if (p.title && lastPageState !== 'preparing') { lastPageState = 'preparing'; toPage(pageOf(job), 'onJob', { v, state: 'preparing' }); }
        return;
      }
      if (p.state === 'downloading') {
        agg.update(p.part || 'main', p.bytes, p.totalBytes);
        const s = agg.snapshot();
        if (now - lastRenderer > 300) {
          lastRenderer = now;
          const eta = p.speedBps && p.speedBps > 0 ? Math.round((s.totalBytes - s.bytes) / p.speedBps) : undefined;
          toRenderer({ id, state: 'progress', bytes: s.bytes, totalBytes: s.totalBytes, speedBps: p.speedBps, etaSec: eta });
        }
        if (now - lastPage > 1000) {
          lastPage = now; lastPageState = 'downloading';
          toPage(pageOf(job), 'onJob', { v, state: 'downloading', pct: s.percent });
        }
        return;
      }
      if (p.state === 'merging') {
        const s = agg.snapshot();
        toRenderer({ id, state: 'progress', bytes: s.totalBytes, totalBytes: s.totalBytes, speedBps: 0 });
        lastPageState = 'merging';
        toPage(pageOf(job), 'onJob', { v, state: 'merging' });
      }
    };

    downloadVideo(youtubeWatchUrl(v), {
      audioOnly: choice.kind === 'audio',
      resolution: choice.kind === 'video' ? choice.res : undefined,
      niceNames: true,
      signal: job.abort.signal,
    }, onProgress).then(async (r) => {
      if (r.success && r.path) {
        job.state = 'done'; job.path = r.path;
        let size = 0;
        try { size = fs.statSync(r.path).size; } catch {}
        toRenderer({ id, state: 'completed', path: r.path, filename: path.basename(r.path), bytes: size, totalBytes: size, speedBps: 0 });
        toPage(pageOf(job), 'onJob', { v, state: 'done' });
        return;
      }
      await removePartials(r.partials);
      if (r.cancelled || job.abort.signal.aborted) {
        job.state = 'cancelled';
        toRenderer({ id, state: 'cancelled' });
        toPage(pageOf(job), 'onJob', { v, state: 'cancelled' });
      } else {
        job.state = 'failed';
        toRenderer({ id, state: 'failed', reason: r.error });
        toPage(pageOf(job), 'onJob', { v, state: 'failed' });
      }
    }).catch((e) => {
      job.state = 'failed';
      toRenderer({ id, state: 'failed', reason: String(e?.message ?? e) });
      toPage(pageOf(job), 'onJob', { v, state: 'failed' });
    });
  };

  const startDownload = async (wc: WebContents, v: string, key: string) => {
    const c = await getChoices(v);
    const choice = c.ok ? c.choices?.find(x => x.key === key) : undefined;
    if (!choice) return;   // escolha que não está na lista que NÓS montamos → ignora
    // Mesmo vídeo + mesma escolha já baixando: não dispara outro igual (clique duplo).
    for (const j of jobs.values()) if (j.v === v && j.choice.key === key && j.state === 'running') return;
    const job: Job = {
      id: `yt_${++seq}`, v, choice, title: (c.title || v).trim() || v,
      wcId: wc.id, abort: new AbortController(), state: 'running',
    };
    jobs.set(job.id, job);
    run(job);
  };

  /** Mensagem 'BAHDL:{...}' do script da página. */
  const onPageMessage = (wc: WebContents, raw: string) => {
    if (!enabled) return;
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    const v = youtubeVideoId(wc.getURL());
    if (!v || msg?.v !== v) return;   // só vale pro vídeo que está aberto NESTA aba
    if (msg.op === 'formats') {
      getChoices(v).then(c => toPage(wc, 'onFormats', { v, ...presentable(c) }));
    } else if (msg.op === 'download') {
      if (deps.msSinceGesture(wc.id) > GESTURE_WINDOW_MS) return;
      startDownload(wc, v, String(msg.key || '')).catch(() => {});
    } else if (msg.op === 'reveal') {
      if (deps.msSinceGesture(wc.id) > GESTURE_WINDOW_MS) return;
      const done = Array.from(jobs.values()).reverse().find(j => j.v === v && j.state === 'done' && j.path);
      if (done?.path && fs.existsSync(done.path)) shell.showItemInFolder(done.path);
    }
  };

  const inject = (wc: WebContents) => {
    if (!enabled || wc.isDestroyed() || !isYoutubePage(wc.getURL())) return;
    wc.executeJavaScript(script, false).catch(() => {});
  };

  const youtubeTabs = () => webContents.getAllWebContents()
    .filter(w => !w.isDestroyed() && w.getType() === 'webview' && isYoutubePage(w.getURL()));

  ipcMain.handle('youtube:set-dl-button', (_e, on: boolean, rawLabels?: unknown) => {
    const wasOn = enabled;
    enabled = !!on;
    const nextLabels = rawLabels ? sanitizeVideoButtonLabels(rawLabels) : labels;
    const labelsChanged = JSON.stringify(nextLabels) !== JSON.stringify(labels);
    labels = nextLabels;
    script = buildVideoButtonScript(labels);
    // Aplica nas abas do YouTube já abertas: tira (desligou / idioma mudou) e põe de novo.
    if (wasOn !== enabled || labelsChanged) {
      for (const wc of youtubeTabs()) {
        wc.executeJavaScript('window.__bahDl&&window.__bahDl.remove()', false)
          .then(() => inject(wc)).catch(() => {});
      }
    }
    return { ok: true, enabled };
  });
  ipcMain.handle('media:cancel-video', (_e, id: string) => {
    const job = jobs.get(String(id));
    if (job && job.state === 'running' && !job.abort.signal.aborted) {
      job.abort.abort();
      // Resposta na hora na lista; a limpeza dos pedaços termina logo depois (run().then).
      toRenderer({ id: job.id, state: 'cancelled' });
      toPage(pageOf(job), 'onJob', { v: job.v, state: 'cancelled' });
    }
    return { ok: !!job };
  });
  ipcMain.handle('media:retry-video', (_e, id: string) => {
    const job = jobs.get(String(id));
    if (!job || job.state === 'running' || job.state === 'done') return { ok: false };
    job.abort = new AbortController();
    job.state = 'running';
    run(job);
    return { ok: true };
  });

  return { inject, onPageMessage };
}
