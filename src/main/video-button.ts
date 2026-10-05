// Botão "Baixar" em cima dos vídeos — a parte do processo principal. Injeta o script certo
// em cada página e iframe (o do YouTube, que mora dentro do player; o genérico, que flutua
// sobre qualquer <video>), responde às mensagens dele (lista / baixar / mostrar na pasta)
// e põe cada download na lista de Downloads do Bah (kind: 'video').
//
// De onde vem a lista de um vídeo:
//  1. YouTube → yt-dlp pelo id.
//  2. Outros sites → yt-dlp pelo link do post/página, com os cookies do Bah daquele site
//     (Instagram/Facebook pedem login).
//  3. yt-dlp não conhece o site → o vídeo que a própria aba carregou (truque do IDM):
//     a "lista de pedaços" HLS/DASH vira resoluções pelo yt-dlp; arquivo direto vai pra
//     lista de Downloads normal.
import { app, ipcMain, shell, webContents, webFrameMain, type BrowserWindow, type Session, type WebContents, type WebFrameMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { downloadVideo, fetchVideoInfo, type VideoDownloadProgress } from './media-downloader';
import { buildVideoChoices, formatBytes, PartsProgress, youtubeVideoId, youtubeWatchUrl, type VideoChoice } from './video-formats';
import { buildVideoButtonScript, DEFAULT_VIDEO_BUTTON_LABELS, sanitizeVideoButtonLabels, type VideoButtonLabels } from './video-button-script';
import { buildGenericVideoButtonScript } from './generic-video-button-script';
import { classifyMediaResponse, MediaLog, sameSite, siteOf, toNetscapeCookies, type SniffedMedia } from './media-sniff';

interface Deps {
  getMainWindow: () => BrowserWindow | null;
  /** ms desde o último clique/tecla DE VERDADE naquela aba (trava contra script da página). */
  msSinceGesture: (wcId: number) => number;
}

/** O vídeo que a página pediu, já conferido. */
interface Target {
  kind: 'youtube' | 'web';
  key: string;       // o que a página usa pra casar a resposta (id do YouTube ou link)
  url: string;       // o que o yt-dlp recebe
  pageUrl: string;   // página/iframe de onde veio (Referer, cookies)
  src?: string;      // arquivo que o <video> toca (só vale se a aba carregou ele mesmo)
}

/** Escolha da lista + de onde baixar (yt-dlp num link/stream, ou arquivo direto). */
interface Choice extends VideoChoice {
  src?: string;            // stream HLS/DASH achado na aba (o yt-dlp baixa ele)
  file?: SniffedMedia;     // arquivo direto achado na aba (vai pra lista de Downloads normal)
}

interface Choices { ok: boolean; title?: string; choices?: Choice[]; live?: boolean; drm?: boolean; error?: string }

interface Job {
  id: string;
  target: Target;
  choice: Choice;
  title: string;
  wcId: number;
  frame?: { processId: number; routingId: number };
  abort: AbortController;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  path?: string;
}

const INFO_TTL_MS = 10 * 60 * 1000;
const LIST_DEADLINE_MS = 90 * 1000;
const GESTURE_WINDOW_MS = 5000;

const isHttp = (url: string) => /^https?:\/\//i.test(url || '');
// YouTube (fora o Music): script próprio, que mora dentro do player.
const isYoutubeHost = (url: string) => /^https?:\/\/(www\.|m\.)?youtube(-nocookie)?\.com\//i.test(url || '');
// Onde nunca injetar: login, captcha e pagamento (mexer no DOM ali só traz risco).
const SKIP_HOST = /(^|\.)(accounts\.google\.com|recaptcha\.net|gstatic\.com|hcaptcha\.com|challenges\.cloudflare\.com|stripe\.com|paypal\.com|pagseguro\.uol\.com\.br|mercadopago\.com(\.br)?)$|^(accounts|login|auth|signin)\./i;
const skipUrl = (url: string) => { try { return SKIP_HOST.test(new URL(url).hostname); } catch { return true; } };
const looksDrm = (err?: string) => /\bDRM\b/i.test(err || '');
const fileExt = (m: SniffedMedia): string => {
  let e: string | undefined;
  try { e = /\.(mp4|webm|mov|m4v|mkv)$/i.exec(new URL(m.url).pathname)?.[1]; } catch {}
  if (e) return e.toUpperCase();
  return m.mime.includes('webm') ? 'WEBM' : m.mime.includes('quicktime') ? 'MOV' : m.mime.includes('matroska') ? 'MKV' : 'MP4';
};

export function setupVideoButton(deps: Deps) {
  let enabled = true;
  let labels: VideoButtonLabels = DEFAULT_VIDEO_BUTTON_LABELS;
  let ytScript = buildVideoButtonScript(labels);
  let webScript = buildGenericVideoButtonScript(labels);
  const infoCache = new Map<string, { at: number; p: Promise<Choices> }>();
  const jobs = new Map<string, Job>();
  const mediaLog = new MediaLog();
  const tracked = new WeakSet<WebContents>();
  let seq = 0;

  // Arquivos de cookie de uma execução anterior que caiu no meio (nunca deveriam sobrar).
  const tmpDir = path.join(app.getPath('userData'), 'tmp');
  try {
    for (const f of fs.readdirSync(tmpDir)) if (/^ck-.*\.txt$/.test(f)) { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} }
  } catch {}

  const toRenderer = (payload: Record<string, unknown>) => {
    try { deps.getMainWindow()?.webContents.send('agent:download-event', { kind: 'video', ...payload }); } catch {}
  };
  const frameOf = (ids?: { processId: number; routingId: number }): WebFrameMain | undefined => {
    if (!ids) return undefined;
    try { const f = webFrameMain.fromId(ids.processId, ids.routingId); return f && !f.isDestroyed() ? f : undefined; } catch { return undefined; }
  };
  const callPage = (frame: WebFrameMain | undefined | null, fn: 'onFormats' | 'onJob', payload: unknown) => {
    if (!frame) return;
    try { if (frame.isDestroyed()) return; } catch { return; }
    frame.executeJavaScript(`window.__bahDl&&window.__bahDl.${fn}(${JSON.stringify(payload)})`).catch(() => {});
  };
  const jobPage = (job: Job, payload: Record<string, unknown>) => callPage(frameOf(job.frame), 'onJob', { v: job.target.key, ...payload });

  // Cookies do Bah SÓ do site do vídeo, num arquivo que vive o tempo de uma chamada do yt-dlp.
  const cookiesFileFor = async (ses: Session, url: string): Promise<string | undefined> => {
    try {
      const list = await ses.cookies.get({ domain: siteOf(new URL(url).hostname) });
      if (!list.length) return undefined;
      fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `ck-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      fs.writeFileSync(file, toNetscapeCookies(list), { mode: 0o600 });
      return file;
    } catch { return undefined; }
  };
  const dropFile = (f?: string) => { if (f) { try { fs.unlinkSync(f); } catch {} } };

  // ── Lista de um vídeo ──
  const listYoutube = (t: Target): Promise<Choices> => fetchVideoInfo(t.url).then((r): Choices => {
    if (!r.ok) return { ok: false, error: r.error, drm: looksDrm(r.error) };
    if (r.info?.is_live === true || r.info?.live_status === 'is_live' || r.info?.live_status === 'is_upcoming') return { ok: false, live: true };
    const c = buildVideoChoices(r.info);
    return c.choices.length ? { ok: true, title: c.title, choices: c.choices } : { ok: false, error: 'no formats' };
  });

  const listWeb = async (t: Target, wc: WebContents): Promise<Choices> => {
    const ua = wc.getUserAgent();
    const ytdlp = async (url: string, referer: string) => {
      const cookies = await cookiesFileFor(wc.session, url);
      try { return await fetchVideoInfo(url, { cookiesFile: cookies, referer, userAgent: ua, firstOnly: true }); }
      finally { dropFile(cookies); }
    };
    const withRes = (cs: VideoChoice[]) => cs.filter(x => x.kind === 'video' && x.res).length;
    // 1) yt-dlp conhece o site (Instagram, TikTok, X, Facebook, Vimeo, Globo…)
    const r = await ytdlp(t.url, t.pageUrl);
    let page: Choice[] | null = null;
    let pageTitle = wc.getTitle();
    if (r.ok) {
      if (r.info?.is_live === true || r.info?.live_status === 'is_live') return { ok: false, live: true };
      const c = buildVideoChoices(r.info);
      if (withRes(c.choices)) return { ok: true, title: c.title, choices: c.choices };
      if (c.choices.some(x => x.kind === 'video')) { page = c.choices; pageTitle = c.title || pageTitle; }
    }
    if (looksDrm(r.error)) return { ok: false, drm: true };
    // 2) O stream que a aba carregou. A lista PRINCIPAL (todas as resoluções) é a primeira
    //    que o player baixa; as de cada qualidade vêm depois — testa na ordem de chegada e
    //    fica com a que tem mais resoluções.
    const seen = mediaLog.list(wc.id, wc.getURL());
    const streams = seen.filter(m => m.kind === 'hls' || m.kind === 'dash').sort((a, b) => a.at - b.at).slice(0, 3);
    let stream: { url: string; choices: Choice[] } | null = null;
    for (const st of streams) {
      const s = await ytdlp(st.url, t.pageUrl);
      if (looksDrm(s.error)) return { ok: false, drm: true };
      if (!s.ok) continue;
      const cs = buildVideoChoices(s.info).choices;
      if (!cs.some(x => x.kind === 'video')) continue;
      if (!stream || withRes(cs) > withRes(stream.choices)) stream = { url: st.url, choices: cs };
      if (withRes(cs) >= 2) break;
    }
    if (stream && withRes(stream.choices)) return { ok: true, title: wc.getTitle(), choices: stream.choices.map(x => ({ ...x, src: stream!.url })) };
    // 3) Sem resolução em lugar nenhum: o "Vídeo" do yt-dlp na página, ou o do stream.
    if (page) return { ok: true, title: pageTitle, choices: page };
    if (stream) return { ok: true, title: wc.getTitle(), choices: stream.choices.map(x => ({ ...x, src: stream!.url })) };
    // 4) Arquivo de vídeo direto que a aba carregou. Se o <video> disse qual toca (e a aba
    //    carregou mesmo esse), é só ele; senão os mais recentes, sem repetir o mesmo arquivo
    //    (mesmo tamanho = mesmo vídeo com outro endereço).
    const exact = t.src ? seen.find(m => m.kind === 'file' && m.url === t.src) : undefined;
    const sizes = new Set<number>();
    const files = exact ? [exact] : seen.filter(m => {
      if (m.kind !== 'file') return false;
      if (m.size) { if (sizes.has(m.size)) return false; sizes.add(m.size); }
      return true;
    }).slice(0, 3);
    if (files.length) {
      return {
        ok: true,
        title: wc.getTitle(),
        choices: files.map((m, i): Choice => ({
          key: `f${i}`,
          kind: 'video',
          label: files.length > 1 ? `${labels.video} ${i + 1}` : '',
          hint: fileExt(m),
          approxBytes: m.size,
          file: m,
        })),
      };
    }
    return { ok: false, error: r.error || 'nothing found' };
  };

  const getChoices = (t: Target, wc: WebContents): Promise<Choices> => {
    const cacheKey = t.kind === 'youtube' ? `yt:${t.url}` : `web:${t.url}`;
    const hit = infoCache.get(cacheKey);
    if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.p;
    // Teto de 90 s pra lista inteira (página + streams): passou disso, a página mostra
    // "não deu" com "Tentar de novo" em vez de "Procurando…" pra sempre.
    const deadline = new Promise<Choices>(resolve => setTimeout(() => resolve({ ok: false, error: 'timeout listing formats' }), LIST_DEADLINE_MS));
    const p = Promise.race([t.kind === 'youtube' ? listYoutube(t) : listWeb(t, wc), deadline])
      .catch((e): Choices => ({ ok: false, error: String(e?.message ?? e) }));
    infoCache.set(cacheKey, { at: Date.now(), p });
    // Erro não fica em cache: "Tentar de novo" tem que tentar de verdade.
    p.then((r) => { if (!r.ok && !r.live && !r.drm) infoCache.delete(cacheKey); });
    return p;
  };

  const presentable = (c: Choices) => c.ok
    ? { ok: true, choices: (c.choices || []).map(x => ({ key: x.key, kind: x.kind, label: x.label, hint: x.hint, size: formatBytes(x.approxBytes, labels.dec) })) }
    : { ok: false, live: !!c.live, drm: !!c.drm };

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
    const { id, choice, target } = job;
    const ext = choice.kind === 'audio' ? 'mp3' : 'mp4';
    // Mesmo nome que o arquivo vai ter (o yt-dlp grava "Título (1080p) [id].mp4").
    const filename = choice.kind === 'audio' || !choice.res ? `${job.title}.${ext}` : `${job.title} (${choice.res}p).${ext}`;
    toRenderer({ id, state: 'started', filename, url: target.url, bytes: 0, totalBytes: choice.approxBytes });
    jobPage(job, { key: choice.key, state: 'started' });

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
        if (p.title && lastPageState !== 'preparing') { lastPageState = 'preparing'; jobPage(job, { state: 'preparing' }); }
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
          jobPage(job, { state: 'downloading', pct: s.percent });
        }
        return;
      }
      if (p.state === 'merging') {
        const s = agg.snapshot();
        toRenderer({ id, state: 'progress', bytes: s.totalBytes, totalBytes: s.totalBytes, speedBps: 0 });
        lastPageState = 'merging';
        jobPage(job, { state: 'merging' });
      }
    };

    (async () => {
      const wc = webContents.fromId(job.wcId);
      const web = target.kind === 'web';
      const dlUrl = choice.src || target.url;
      const cookies = web && wc && !wc.isDestroyed() ? await cookiesFileFor(wc.session, dlUrl) : undefined;
      try {
        return await downloadVideo(dlUrl, {
          audioOnly: choice.kind === 'audio',
          resolution: choice.kind === 'video' ? choice.res : undefined,
          niceNames: true,
          signal: job.abort.signal,
          cookiesFile: cookies,
          referer: web ? target.pageUrl : undefined,
          userAgent: web && wc && !wc.isDestroyed() ? wc.getUserAgent() : undefined,
          // Stream achado na aba não tem título bom ("index.m3u8") → usa o da página.
          titleOverride: choice.src ? job.title : undefined,
          firstOnly: web,
        }, onProgress);
      } finally { dropFile(cookies); }
    })().then(async (r) => {
      if (r.success && r.path) {
        job.state = 'done'; job.path = r.path;
        let size = 0;
        try { size = fs.statSync(r.path).size; } catch {}
        toRenderer({ id, state: 'completed', path: r.path, filename: path.basename(r.path), bytes: size, totalBytes: size, speedBps: 0 });
        jobPage(job, { state: 'done' });
        return;
      }
      await removePartials(r.partials);
      if (r.cancelled || job.abort.signal.aborted) {
        job.state = 'cancelled';
        toRenderer({ id, state: 'cancelled' });
        jobPage(job, { state: 'cancelled' });
      } else {
        job.state = 'failed';
        toRenderer({ id, state: 'failed', reason: r.error });
        jobPage(job, { state: 'failed' });
      }
    }).catch((e) => {
      job.state = 'failed';
      toRenderer({ id, state: 'failed', reason: String(e?.message ?? e) });
      jobPage(job, { state: 'failed' });
    });
  };

  const startDownload = async (wc: WebContents, frame: WebFrameMain | null | undefined, t: Target, key: string) => {
    const c = await getChoices(t, wc);
    const choice = c.ok ? c.choices?.find(x => x.key === key) : undefined;
    if (!choice) return;   // escolha que não está na lista que NÓS montamos → ignora
    // Arquivo direto: a lista de Downloads normal (pausar/continuar) com o Referer da página.
    if (choice.file) {
      wc.downloadURL(choice.file.url, { headers: { Referer: t.pageUrl } });
      callPage(frame, 'onJob', { v: t.key, state: 'handoff' });
      return;
    }
    // Mesmo vídeo + mesma escolha já baixando: não dispara outro igual (clique duplo).
    for (const j of jobs.values()) if (j.target.key === t.key && j.choice.key === key && j.state === 'running') return;
    const job: Job = {
      id: `yt_${++seq}`, target: t, choice,
      title: (c.title || wc.getTitle() || 'video').trim() || 'video',
      wcId: wc.id,
      frame: frame ? { processId: frame.processId, routingId: frame.routingId } : undefined,
      abort: new AbortController(), state: 'running',
    };
    jobs.set(job.id, job);
    run(job);
  };

  /** Confere o pedido da página: o vídeo tem que ser o daquele iframe/aba, do mesmo site. */
  const resolveTarget = (msg: any, frameUrl: string): Target | null => {
    const ytId = youtubeVideoId(frameUrl);
    if (ytId) return msg?.v === ytId ? { kind: 'youtube', key: ytId, url: youtubeWatchUrl(ytId), pageUrl: frameUrl } : null;
    const url = String(msg?.url || '');
    if (!isHttp(url) || url.length > 2048 || msg?.v !== url || !sameSite(url, frameUrl)) return null;
    const src = typeof msg?.src === 'string' && isHttp(msg.src) && msg.src.length <= 4096 ? msg.src : undefined;
    return { kind: 'web', key: url, url: url.split('#')[0], pageUrl: frameUrl, src };
  };

  /**
   * Clique de verdade recente. O 'input-event' da aba só vê o quadro principal; clique
   * dentro de iframe de outro site (player embutido) aparece como a ativação de usuário
   * que o próprio Chromium marca naquele quadro (dura ~5 s e script não fabrica).
   */
  const hasGesture = async (wc: WebContents, frame: WebFrameMain): Promise<boolean> => {
    if (deps.msSinceGesture(wc.id) <= GESTURE_WINDOW_MS) return true;
    let sub = false;
    try { sub = frame.processId !== wc.mainFrame.processId || frame.routingId !== wc.mainFrame.routingId; } catch {}
    if (!sub) return false;
    try { return (await frame.executeJavaScript('!!(navigator.userActivation && navigator.userActivation.isActive)')) === true; }
    catch { return false; }
  };

  /** Mensagem 'BAHDL:{...}' do script da página (frame = o iframe que mandou). */
  const onPageMessage = (wc: WebContents, raw: string, frame?: WebFrameMain | null) => {
    if (!enabled) return;
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    let frameUrl = '';
    try { frameUrl = frame && !frame.isDestroyed() ? frame.url : ''; } catch {}
    frameUrl = frameUrl || wc.getURL();
    const t = resolveTarget(msg, frameUrl);
    if (!t) return;
    const replyFrame = frame || wc.mainFrame;
    if (msg.op === 'formats') {
      getChoices(t, wc).then(c => callPage(replyFrame, 'onFormats', { v: t.key, ...presentable(c) }));
    } else if (msg.op === 'download') {
      hasGesture(wc, replyFrame).then((ok) => { if (ok) return startDownload(wc, replyFrame, t, String(msg.key || '')); }).catch(() => {});
    } else if (msg.op === 'reveal') {
      hasGesture(wc, replyFrame).then((ok) => {
        if (!ok) return;
        const done = Array.from(jobs.values()).reverse().find(j => j.target.key === t.key && j.state === 'done' && j.path);
        if (done?.path && fs.existsSync(done.path)) shell.showItemInFolder(done.path);
      }).catch(() => {});
    }
  };

  const scriptFor = (url: string): string | null => {
    if (!enabled || !isHttp(url) || skipUrl(url)) return null;
    return isYoutubeHost(url) ? ytScript : webScript;
  };
  const track = (wc: WebContents) => {
    if (tracked.has(wc)) return;
    tracked.add(wc);
    wc.once('destroyed', () => mediaLog.forget(wc.id));
  };

  /** Página principal da aba (dom-ready). */
  const inject = (wc: WebContents) => {
    if (wc.isDestroyed()) return;
    track(wc);
    const s = scriptFor(wc.getURL());
    if (s) wc.executeJavaScript(s, false).catch(() => {});
  };
  /** Iframe que terminou de carregar (player embutido em notícia, blog…). */
  const injectFrame = (wc: WebContents, processId: number, routingId: number) => {
    if (!enabled || wc.isDestroyed()) return;
    const f = frameOf({ processId, routingId });
    if (!f) return;
    const s = scriptFor(f.url);
    if (s) f.executeJavaScript(s).catch(() => {});
  };

  /** O truque do IDM: anota os vídeos/streams que cada aba carrega. */
  const attachSniffer = (ses: Session) => {
    ses.webRequest.onResponseStarted({ urls: ['<all_urls>'], types: ['media', 'xhr'] }, (d) => {
      if (!enabled || !d.webContentsId) return;
      const m = classifyMediaResponse(d);
      if (!m) return;
      const wc = webContents.fromId(d.webContentsId);
      if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return;
      mediaLog.add(wc.id, { ...m, pageUrl: wc.getURL(), at: Date.now() });
    });
  };

  const tabs = () => webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getType() === 'webview');

  ipcMain.handle('youtube:set-dl-button', (_e, on: boolean, rawLabels?: unknown) => {
    const wasOn = enabled;
    enabled = !!on;
    const nextLabels = rawLabels ? sanitizeVideoButtonLabels(rawLabels) : labels;
    const labelsChanged = JSON.stringify(nextLabels) !== JSON.stringify(labels);
    labels = nextLabels;
    ytScript = buildVideoButtonScript(labels);
    webScript = buildGenericVideoButtonScript(labels);
    // Aplica nas abas abertas (todos os iframes): tira (desligou / idioma mudou) e põe de novo.
    if (wasOn !== enabled || labelsChanged) {
      for (const wc of tabs()) {
        let frames: WebFrameMain[] = [];
        try { frames = wc.mainFrame.framesInSubtree; } catch {}
        for (const f of frames) {
          f.executeJavaScript('window.__bahDl&&window.__bahDl.remove()')
            .then(() => { const s = scriptFor(f.url); if (s && !f.isDestroyed()) return f.executeJavaScript(s); })
            .catch(() => {});
        }
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
      jobPage(job, { state: 'cancelled' });
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

  return { inject, injectFrame, onPageMessage, attachSniffer };
}
