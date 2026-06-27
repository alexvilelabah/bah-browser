// Media downloader — baixa vídeos (YouTube etc.) com yt-dlp, gerenciado pelo
// próprio navegador. yt-dlp é um binário standalone; baixamos sob demanda em
// userData/bin e usamos o ffmpeg do sistema (se houver) para mesclar alta resolução.
//
// Nota: download de mídia é função comum de navegador (uso pessoal / direitos
// autorais por conta do usuário). O usuário dirige; nós só executamos a ferramenta.
import { app } from 'electron';
import { spawn, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
// Build estático do ffmpeg (Windows). Vem num .zip → descompactamos com o Expand-Archive
// nativo do Windows (sem dependência nova). Usado pra mesclar 1080p+ e extrair mp3.
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';

function binDir(): string {
  const d = path.join(app.getPath('userData'), 'bin');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function ytDlpPath(): string {
  return path.join(binDir(), 'yt-dlp.exe');
}

// Follow redirects (GitHub releases redirect to a CDN) and stream to disk.
function downloadToFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'bah-browser' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadToFile(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const tmp = dest + '.part';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch (e) { reject(e); } }));
      file.on('error', reject);
    }).on('error', reject);
  });
}

// ── Auto-update silencioso do yt-dlp (foge das quebras de extrator das plataformas) ──
// Throttle: no máximo 1×/dia. yt-dlp é binário standalone → `-U` se auto-atualiza.
// Aguardamos (com timeout curto) ANTES da extração pra evitar colisão de "exe em uso".
const updateStampPath = () => path.join(binDir(), '.ytdlp-last-update');
function updateDueToday(): boolean {
  try {
    const s = updateStampPath();
    if (!fs.existsSync(s)) return true;
    return Date.now() - fs.statSync(s).mtimeMs > 24 * 3600 * 1000;
  } catch { return false; }
}
async function maybeAutoUpdate(bin: string, onStatus?: (msg: string) => void): Promise<void> {
  if (!updateDueToday()) return;
  try { fs.writeFileSync(updateStampPath(), String(Date.now())); } catch {} // marca já: falha não re-tenta a cada download
  onStatus?.('Updating the download engine (quick)…');
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const child = spawn(bin, ['-U'], { windowsHide: true });
      child.on('error', finish);
      child.on('close', finish);
      setTimeout(finish, 12_000); // rede lenta não pode travar o download
    } catch { finish(); }
  });
}

// Valida o yt-dlp recém-baixado: precisa RODAR e imprimir uma versão (yyyy.mm.dd) e ter
// tamanho mínimo — pega download corrompido/parcial. NÃO fixamos checksum/hash: o yt-dlp se
// auto-atualiza (`-U`), então um hash fixo quebraria sozinho a cada release.
function validateYtDlp(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try { if (!fs.existsSync(bin) || fs.statSync(bin).size < 1_000_000) return resolve(false); }
    catch { return resolve(false); }
    let out = '';
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn(bin, ['--version'], { windowsHide: true });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0 && /\d{4}\.\d{2}\.\d{2}/.test(out)));
      setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 10_000);
    } catch { finish(false); }
  });
}

let ensurePromise: Promise<string> | null = null;
export async function ensureYtDlp(onStatus?: (msg: string) => void): Promise<string> {
  const p = ytDlpPath();
  if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) {
    await maybeAutoUpdate(p, onStatus); // já instalado → checa atualização (throttled)
    return p;
  }
  if (ensurePromise) return ensurePromise;
  onStatus?.('Preparing the video download engine (first time)…');
  ensurePromise = downloadToFile(YTDLP_URL, p)
    .then(async () => {
      // recém-baixado = última versão; confere que NÃO veio corrompido antes de confiar
      if (!(await validateYtDlp(p))) {
        try { fs.unlinkSync(p); } catch {}
        throw new Error('The downloaded yt-dlp looks invalid/corrupted — try again.');
      }
      onStatus?.('Download engine ready.');
      return p;
    })
    .catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

// ── ffmpeg: detecta (baixado por nós OU do sistema) e, se faltar, baixa+descompacta ──
// Necessário pra mesclar 1080p+ (vídeo+áudio separados) e pra extrair mp3.
const ffmpegExePath = () => path.join(binDir(), 'ffmpeg.exe');
let ffmpegDirCache: string | null | undefined;

export function findFfmpegDir(): Promise<string | null> {
  if (ffmpegDirCache !== undefined) return Promise.resolve(ffmpegDirCache);
  // 1) já baixamos antes? (userData/bin/ffmpeg.exe)
  try { if (fs.existsSync(ffmpegExePath())) { ffmpegDirCache = binDir(); return Promise.resolve(ffmpegDirCache); } } catch {}
  // 2) ffmpeg do sistema (PATH)?
  return new Promise((resolve) => {
    execFile('where', ['ffmpeg'], { windowsHide: true }, (err, stdout) => {
      if (!err && stdout) {
        const first = stdout.split(/\r?\n/).find(Boolean);
        if (first) { ffmpegDirCache = path.dirname(first.trim()); return resolve(ffmpegDirCache); }
      }
      ffmpegDirCache = null;
      resolve(null);
    });
  });
}

// Acha um arquivo por nome na árvore extraída (o zip do BtbN põe em .../bin/ffmpeg.exe).
function findFileRecursive(dir: string, name: string): string | null {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = findFileRecursive(p, name); if (r) return r; }
      else if (e.name.toLowerCase() === name.toLowerCase()) return p;
    }
  } catch {}
  return null;
}

function validateFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try { if (!fs.existsSync(bin) || fs.statSync(bin).size < 1_000_000) return resolve(false); }
    catch { return resolve(false); }
    let out = ''; let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn(bin, ['-version'], { windowsHide: true });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0 && /ffmpeg version/i.test(out)));
      setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 10_000);
    } catch { finish(false); }
  });
}

// Descompacta o .zip com o Expand-Archive nativo do Windows (sem lib nova).
function expandZipWindows(zip: string, outDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    const ps = `Expand-Archive -LiteralPath ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(outDir)} -Force`;
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
      setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 120_000);
    } catch { finish(false); }
  });
}

// Garante o ffmpeg: usa o existente (baixado/sistema) ou baixa+descompacta (só Windows).
// FAIL-SAFE: qualquer erro → retorna null e o download segue sem ffmpeg (qualidade menor),
// exatamente como era antes. Nunca quebra o fluxo principal.
let ffmpegEnsurePromise: Promise<string | null> | null = null;
export async function ensureFfmpeg(onStatus?: (msg: string) => void): Promise<string | null> {
  const existing = await findFfmpegDir();
  if (existing) return existing;
  if (process.platform !== 'win32') return null; // outros SO: usa o do sistema (já tentado)
  if (ffmpegEnsurePromise) return ffmpegEnsurePromise;
  ffmpegEnsurePromise = (async () => {
    const zip = path.join(binDir(), 'ffmpeg-dl.zip');
    const extractDir = path.join(binDir(), 'ffmpeg-extract');
    try {
      onStatus?.('Preparing the video/audio converter (first time, ~80MB)…');
      await downloadToFile(FFMPEG_URL, zip);
      onStatus?.('Extracting ffmpeg…');
      if (!(await expandZipWindows(zip, extractDir))) throw new Error('failed to unzip');
      const exe = findFileRecursive(extractDir, 'ffmpeg.exe');
      if (!exe) throw new Error('ffmpeg.exe not found in the package');
      fs.copyFileSync(exe, ffmpegExePath());
      const probe = path.join(path.dirname(exe), 'ffprobe.exe');     // yt-dlp também usa ffprobe
      if (fs.existsSync(probe)) { try { fs.copyFileSync(probe, path.join(binDir(), 'ffprobe.exe')); } catch {} }
      try { fs.rmSync(zip, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      if (!(await validateFfmpeg(ffmpegExePath()))) { try { fs.unlinkSync(ffmpegExePath()); } catch {} throw new Error('downloaded ffmpeg is invalid'); }
      ffmpegDirCache = binDir();
      onStatus?.('Converter ready.');
      return binDir();
    } catch {
      try { fs.rmSync(zip, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      ffmpegEnsurePromise = null;
      return null; // segue sem ffmpeg — não quebra o download
    }
  })();
  return ffmpegEnsurePromise;
}

/**
 * Resolve uma busca → o 1º VÍDEO DE VERDADE (pula Shorts via filtro de duração) SEM
 * baixar nada. Usado pelo "open_video": "mostre um vídeo de X" → abre esse vídeo tocando.
 * Pega os primeiros resultados, deixa o yt-dlp checar a duração de cada um (Short < 60s
 * é rejeitado), imprime id+título do primeiro que passa e encerra. ~2-4s.
 */
export async function resolveTopVideo(query: string): Promise<{ ok: boolean; url?: string; id?: string; title?: string; error?: string }> {
  const q = (query || '').trim();
  if (!q) return { ok: false, error: 'empty search' };
  let bin: string;
  try { bin = await ensureYtDlp(); } catch (e: any) { return { ok: false, error: `yt-dlp unavailable: ${e?.message ?? e}` }; }
  const DURATION = 'duration >= 60 & duration <= 2400';   // pula Shorts (<1min); teto 40min (evita mixes/lives)
  return new Promise((resolve) => {
    const args = [
      `ytsearch8:${q}`,
      '--match-filter', DURATION,
      '--no-download', '--no-warnings', '--no-color', '--ignore-errors',
      '--print', '%(id)s\t%(title)s',
    ];
    let buf = '';
    let done = false;
    const child = spawn(bin, args, { windowsHide: true });
    const finish = (r: { ok: boolean; url?: string; id?: string; title?: string; error?: string }) => {
      if (done) return; done = true;
      try { child.kill(); } catch {}
      resolve(r);
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const line = buf.split(/\r?\n/).map(l => l.trim()).find(l => /^[A-Za-z0-9_-]{6,}\t/.test(l));
      if (line) {
        const tab = line.indexOf('\t');
        const id = line.slice(0, tab);
        const title = line.slice(tab + 1);
        finish({ ok: true, id, title, url: `https://www.youtube.com/watch?v=${id}` });
      }
    });
    child.on('error', (e) => finish({ ok: false, error: String((e as any)?.message ?? e) }));
    child.on('close', () => finish({ ok: false, error: 'no suitable video found' }));
    setTimeout(() => finish({ ok: false, error: 'timeout resolving the video' }), 15_000);
  });
}

/**
 * Resolve N vídeos DISTINTOS de UMA busca (ex.: "2pac" → 3 clipes diferentes), pulando
 * Shorts. Uma chamada yt-dlp (ytsearch com pool maior pra descartar Shorts). Pro
 * "open_videos": abrir N abas, cada uma com um vídeo real — determinístico, sem IA.
 */
export async function resolveTopNVideos(
  query: string,
  n: number,
): Promise<{ ok: boolean; videos: Array<{ id: string; title: string; url: string }>; error?: string }> {
  const q = (query || '').trim();
  const count = Math.min(Math.max(n || 1, 1), 12);
  if (!q) return { ok: false, videos: [], error: 'empty search' };
  let bin: string;
  try { bin = await ensureYtDlp(); } catch (e: any) { return { ok: false, videos: [], error: `yt-dlp unavailable: ${e?.message ?? e}` }; }
  const DURATION = 'duration >= 60 & duration <= 2400';   // pula Shorts (<1min); teto 40min
  const pool = Math.min(count * 3 + 4, 40);               // oversample pra descartar Shorts/inválidos
  return new Promise((resolve) => {
    const args = [
      `ytsearch${pool}:${q}`,
      '--match-filter', DURATION,
      '--no-download', '--no-warnings', '--no-color', '--ignore-errors',
      '--print', '%(id)s\t%(title)s',
    ];
    let buf = '';
    let done = false;
    const seen = new Set<string>();
    const videos: Array<{ id: string; title: string; url: string }> = [];
    const child = spawn(bin, args, { windowsHide: true });
    const finish = () => {
      if (done) return; done = true;
      try { child.kill(); } catch {}
      resolve({ ok: videos.length > 0, videos, error: videos.length ? undefined : 'no suitable video found' });
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        const m = /^([A-Za-z0-9_-]{6,})\t(.*)$/.exec(line);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          videos.push({ id: m[1], title: m[2], url: `https://www.youtube.com/watch?v=${m[1]}` });
          if (videos.length >= count) finish();
        }
      }
    });
    child.on('error', () => finish());
    child.on('close', () => finish());
    setTimeout(() => finish(), 25_000);
  });
}

/**
 * Resolve VÁRIAS buscas → ids de vídeo (em paralelo, com limite de concorrência).
 * Usado pelo "create_playlist": cada nome de música → 1 vídeo real → monta a playlist.
 */
export async function resolveTopVideos(
  queries: string[],
  concurrency = 4,
): Promise<Array<{ query: string; id?: string; title?: string }>> {
  const out: Array<{ query: string; id?: string; title?: string }> = queries.map(q => ({ query: q }));
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      const idx = next++;
      try {
        const r = await resolveTopVideo(queries[idx]);
        if (r.ok && r.id) { out[idx].id = r.id; out[idx].title = r.title; }
      } catch { /* deixa sem id; o chamador filtra */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), queries.length) }, worker));
  return out;
}

export interface VideoDownloadProgress {
  state: 'preparing' | 'downloading' | 'merging' | 'completed' | 'failed';
  percent?: number;
  title?: string;
  path?: string;
  error?: string;
  speed?: string;
  eta?: string;
}

/**
 * Baixa um vídeo. Resolve com o caminho final. Reporta progresso via onProgress.
 * audioOnly extrai mp3 (precisa de ffmpeg).
 */
export async function downloadVideo(
  url: string,
  opts: { audioOnly?: boolean; count?: number; quality?: 'best' | 'low' } ,
  onProgress: (p: VideoDownloadProgress) => void,
): Promise<{ success: boolean; path?: string; paths?: string[]; title?: string; error?: string }> {
  // Accept a real URL OR a yt-dlp search target ("ytsearch1:..."), which lets us
  // find+download the top result without touching the YouTube UI (bulletproof).
  if (!/^https?:\/\//i.test(url) && !/^ytsearch\d*:/i.test(url)) return { success: false, error: 'Invalid URL or search.' };
  let bin: string;
  try {
    onProgress({ state: 'preparing' });
    bin = await ensureYtDlp((m) => onProgress({ state: 'preparing', title: m }));
  } catch (e: any) {
    return { success: false, error: `Could not prepare yt-dlp: ${e?.message ?? e}` };
  }

  // mp3 (audioOnly) e "melhor qualidade" (merge 1080p+) PRECISAM de ffmpeg → auto-instala.
  // "low" não precisa → só detecta. ensureFfmpeg é fail-safe (null = segue sem ffmpeg).
  const needFfmpeg = opts.audioOnly || opts.quality !== 'low';
  const ffmpegDir = needFfmpeg
    ? await ensureFfmpeg((m) => onProgress({ state: 'preparing', title: m }))
    : await findFfmpegDir();
  const outDir = app.getPath('downloads');
  const outTmpl = path.join(outDir, '%(title).120B [%(id)s].%(ext)s');

  // Seleção de formato/áudio — compartilhada por TODAS as rotas.
  const fmtArgs: string[] = [];
  if (ffmpegDir) fmtArgs.push('--ffmpeg-location', ffmpegDir);
  if (opts.audioOnly) {
    fmtArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (opts.quality === 'low') {
    // Só quando o usuário PEDE baixa resolução ("use vídeos de baixa resolução").
    fmtArgs.push('-f', ffmpegDir ? 'bv*[height<=480]+ba/b[height<=480]/b' : 'w[ext=mp4]/worst');
    if (ffmpegDir) fmtArgs.push('--merge-output-format', 'mp4');
  } else if (ffmpegDir) {
    // PADRÃO = MELHOR qualidade disponível DAQUELE vídeo (sem cap de altura), mesclada em mp4.
    fmtArgs.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  } else {
    fmtArgs.push('-f', 'b[ext=mp4]/best');   // sem ffmpeg: melhor stream progressivo
  }

  // Flags base de toda rota. allowPlaylist=false adiciona --no-playlist (pega 1 vídeo mesmo
  // que a URL aponte tb pra uma playlist); a rota de playlist precisa da travessia LIGADA.
  const baseArgs = (allowPlaylist: boolean): string[] => [
    ...(allowPlaylist ? [] : ['--no-playlist']),
    '--no-part', '--restrict-filenames', '--no-color', '--progress',
    '--progress-template', 'DLPROG:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-o', outTmpl,
    '--print', 'after_move:filepath',
    ...fmtArgs,
  ];

  const count = Math.min(Math.max(opts.count || 1, 1), 50);   // quantas pegar (N músicas, teto 50)
  const isSearch = /^ytsearch\d*:/i.test(url);
  const query = isSearch ? url.replace(/^ytsearch\d*:/i, '').trim() : '';
  const DURATION = 'duration >= 60 & duration <= 1200';       // pula Shorts (<1min) e mixes (>20min)

  // ── Um disparo do yt-dlp: spawn + parse de progresso/saída → { ok, paths, title } ──
  // priorCount: quantas já vieram em disparos anteriores (só pro rótulo "i/N").
  // expect: quantas ESTE disparo deve trazer (pro fallback por filesystem).
  const runYtDlp = (
    runArgs: string[],
    priorCount: number,
    expect: number,
  ): Promise<{ ok: boolean; paths: string[]; title: string; err?: string }> =>
    new Promise((resolve) => {
      const paths: string[] = [];
      const startedAt = Date.now();
      let title = '';
      let stderrTail = '';
      let seenMerge = false;
      const child = spawn(bin, runArgs, { windowsHide: true });

      const handleLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        const m = line.match(/DLPROG:\s*([\d.]+)%\|([^|]*)\|(.*)$/);
        if (m) {
          const done = priorCount + paths.length + 1;
          const label = count > 1 ? `${title} (${Math.min(done, count)}/${count})` : title;
          onProgress({ state: 'downloading', percent: parseFloat(m[1]), speed: m[2].trim(), eta: m[3].trim(), title: label });
          return;
        }
        if (/\[Merger\]|\[ExtractAudio\]|Merging formats/i.test(line) && !seenMerge) {
          seenMerge = true;
          onProgress({ state: 'merging', percent: 99, title });
        }
        const t = line.match(/Destination: .*[\\/](.+?) \[/);
        if (t) { title = t[1]; seenMerge = false; }
        if (/^[A-Za-z]:[\\/].+\.\w{2,4}$/.test(line) && !paths.includes(line)) paths.push(line);
      };

      const leftovers: Array<() => void> = [];
      const mkSink = () => {
        let buf = '';
        leftovers.push(() => { if (buf) handleLine(buf); buf = ''; });
        return (d: Buffer) => {
          buf += d.toString();
          let mm;
          while ((mm = buf.match(/[\r\n]/))) {
            handleLine(buf.slice(0, mm.index));
            buf = buf.slice((mm.index as number) + 1);
          }
        };
      };
      child.stdout.on('data', mkSink());
      const stderrSink = mkSink();
      child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-800); stderrSink(d); });

      child.on('error', (e) => resolve({ ok: false, paths, title, err: String((e as any)?.message ?? e) }));
      child.on('close', (code) => {
        // 101 = MaxDownloadsReached (do nosso --max-downloads): isso é SUCESSO.
        if (code === 0 || code === 101) {
          leftovers.forEach(fl => { try { fl(); } catch {} });
          if (paths.length < expect) {
            // As linhas --print podem se perder entre updates \r — confia no filesystem:
            // arquivos de mídia criados depois que ESTE disparo começou são deste disparo.
            try {
              fs.readdirSync(outDir)
                .filter(f => /\.(mp3|mp4|m4a|webm|mkv|opus)$/i.test(f))
                .map(f => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
                .filter(x => x.t >= startedAt - 2000)
                .sort((a, b) => b.t - a.t)
                .slice(0, expect)
                .forEach(x => { if (!paths.includes(x.p)) paths.push(x.p); });
            } catch {}
          }
          resolve({ ok: true, paths, title });
        } else {
          const err = stderrTail.split(/\r?\n/).filter(Boolean).pop() || `yt-dlp exited with code ${code}`;
          resolve({ ok: false, paths, title, err });
        }
      });
    });

  // ── Orquestração das rotas (com rede de segurança) ───────────────────────────
  const all: string[] = [];
  const addPaths = (ps: string[]) => { for (const p of ps) if (!all.includes(p)) all.push(p); };
  let lastErr = '';
  // Histórico temporário: o fallback NÃO rebaixa a mesma música que a playlist já trouxe.
  const archive = path.join(app.getPath('userData'), `.ndl-archive-${Date.now()}.txt`);
  const usePlaylistRoute = isSearch && count > 1 && !!query;

  // ROTA 1 — só "VÁRIAS músicas por busca" (ex.: "baixe 3 hip hop", "3 do Leandro e Leonardo").
  // Busca PLAYLISTS do YouTube (filtro sp=playlist) e pega as primeiras N faixas: Short não
  // entra em playlist e mix de 1h não é "faixa" → o que resta é música de verdade.
  if (usePlaylistRoute) {
    const plUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`;
    onProgress({ state: 'preparing', title: 'Searching playlists (real music, no Shorts)…' });
    const r = await runYtDlp(
      [...baseArgs(true), '--download-archive', archive, '--match-filter', DURATION, '--max-downloads', String(count), plUrl],
      0, count,
    );
    addPaths(r.paths);
    if (!r.ok) lastErr = r.err || lastErr;
  }

  // ROTA 2 — busca de vídeos (ytsearch). É o CASO NORMAL (1 música / nomeada) e também o
  // FALLBACK automático: roda quando ainda falta música (playlist falhou ou trouxe menos).
  if (all.length < count && isSearch) {
    const need = count - all.length;
    const pool = Math.min(need * 3 + 8, 60);   // poço largo: o filtro de duração pula Shorts/mixes
    const searchArgs = [...baseArgs(false)];
    if (usePlaylistRoute) searchArgs.push('--download-archive', archive);   // não repete a faixa da playlist
    searchArgs.push('--match-filter', DURATION, '--max-downloads', String(need), url.replace(/^ytsearch\d*:/i, `ytsearch${pool}:`));
    if (all.length > 0) onProgress({ state: 'preparing', title: 'Completing via normal search…' });
    const r = await runYtDlp(searchArgs, all.length, need);
    addPaths(r.paths);
    if (!r.ok && all.length === 0) lastErr = r.err || lastErr;
  }

  // ROTA DIRETA — URL real (página de vídeo / aba atual): baixa esse vídeo (igual antes).
  if (all.length === 0 && !isSearch) {
    const r = await runYtDlp([...baseArgs(false), url], 0, count);
    addPaths(r.paths);
    if (!r.ok) lastErr = r.err || lastErr;
  }

  try { fs.unlinkSync(archive); } catch {}

  if (all.length > 0) {
    const first = all[0];
    const name = path.basename(first);
    onProgress({ state: 'completed', percent: 100, title: name, path: first });
    return { success: true, path: first, paths: all, title: name };
  }
  onProgress({ state: 'failed', error: lastErr || 'Nothing was downloaded.' });
  return { success: false, error: lastErr || 'Nothing was downloaded.' };
}
