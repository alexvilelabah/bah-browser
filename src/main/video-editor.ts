// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DE VÍDEO — o navegador EDITA um vídeo que o usuário ENVIA (arrasta/escolhe).
// Mesmo motor do download/supercut: FFMPEG NATIVO (rápido). Faz o que o fastcut.cc
// faz, mas com a versão forte do ffmpeg (não a "de site"/wasm). 100% local,
// determinístico, 0 token de IA, R$ 0,00.
//   • cortarTrecho   → recorta de A até B (lossless quando dá, senão re-encoda)
//   • removerSilencio→ silencedetect + concat dos trechos com fala
//   • extrairAudio   → tira só o áudio (mp3)
// ─────────────────────────────────────────────────────────────────────────────
import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findFfmpegDir } from './media-downloader';

export interface VideoEditProgress {
  stage: 'preparing' | 'analyzing' | 'processing' | 'done' | 'failed';
  message: string;
  percent?: number;   // 0–100 quando dá pra medir
}

export interface VideoEditResult {
  success: boolean;
  path?: string;       // arquivo gerado
  error?: string;
  info?: any;          // metadados (ex.: trechos removidos)
}

type Bins = { ffmpeg: string; ffprobe: string };
let binCache: Bins | null = null;

// Resolve os binários. Prioriza o ffmpeg do sistema (PATH); cai pra chamada nua
// (deixa o SO achar) se não localizar a pasta. ffprobe vive ao lado do ffmpeg.
async function resolveBins(): Promise<Bins> {
  if (binCache) return binCache;
  const dir = await findFfmpegDir();
  const exe = (name: string) => (dir ? path.join(dir, `${name}.exe`) : name);
  binCache = { ffmpeg: exe('ffmpeg'), ffprobe: exe('ffprobe') };
  return binCache;
}

// Roda um binário; acumula stderr (ffmpeg fala tudo por stderr) e entrega cada
// linha pro onLine (pra progresso/parse). Mata no timeout pra nunca travar.
function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e: any) {
      return resolve({ code: -1, stderr: String(e?.message ?? e) });
    }
    let stderr = '';
    let buf = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-8000);
      if (onLine) {
        buf += s;
        let m;
        while ((m = buf.match(/[\r\n]/))) {
          onLine(buf.slice(0, m.index));
          buf = buf.slice((m.index as number) + 1);
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => { try { child!.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stderr: stderr + String(e?.message ?? e) }); });
    child.on('close', (code) => { clearTimeout(timer); if (onLine && buf) onLine(buf); resolve({ code, stderr }); });
  });
}

// Duração total do vídeo em segundos (via ffprobe). 0 se não conseguir.
async function probeDuration(ffprobe: string, input: string): Promise<number> {
  const r = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', input,
  ], 30_000);
  const v = parseFloat((r.stderr || '').trim().split(/\r?\n/).pop() || '');
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// O vídeo tem faixa de áudio? (evita mensagem confusa em screen-recording mudo etc.)
async function hasAudioStream(ffprobe: string, input: string): Promise<boolean> {
  const r = await run(ffprobe, [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type',
    '-of', 'csv=p=0', input,
  ], 30_000);
  return /audio/i.test(r.stderr || '');
}

const fmtClock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

// Nome de saída único no Downloads: "<nome><sufixo>.<ext>", sem sobrescrever.
function outPath(input: string, suffix: string, ext: string): string {
  const dir = app.getPath('downloads');
  const base = (path.basename(input, path.extname(input)) || 'video')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  let target = path.join(dir, `${base}${suffix}${ext}`);
  for (let i = 1; fs.existsSync(target) && i < 200; i++) {
    target = path.join(dir, `${base}${suffix} (${i})${ext}`);
  }
  return target;
}

// Lê o "time=HH:MM:SS.xx" do progresso do ffmpeg → segundos processados.
function parseFfmpegTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):([\d.]+)/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

// ─── CORTAR TRECHO ───────────────────────────────────────────────────────────
// De startSec até endSec. Re-encoda com qualidade visualmente sem perda (crf 18)
// pra cortar EXATAMENTE nos tempos pedidos — corte por cópia "pula" pro keyframe
// e erraria por segundos (ruim quando o usuário digita o minuto certo).
export async function cortarTrecho(
  input: string, startSec: number, endSec: number,
  onProgress: (p: VideoEditProgress) => void,
): Promise<VideoEditResult> {
  if (!input || !fs.existsSync(input)) return { success: false, error: 'Video file not found.' };
  const start = Math.max(0, Number(startSec) || 0);
  const end = Number(endSec) || 0;
  if (!(end > start)) return { success: false, error: 'The end must be greater than the start (e.g., from 1:00 to 2:30).' };
  const dur = end - start;
  const { ffmpeg, ffprobe } = await resolveBins();
  // Início depois do fim do vídeo = nada pra cortar (mensagem clara em vez de erro cru).
  const total = await probeDuration(ffprobe, input);
  if (total && start >= total) {
    return { success: false, error: `The start (${fmtClock(start)}) is past the end of the video (${fmtClock(total)}).` };
  }
  const ext = /\.(mp4|mkv|mov|m4v)$/i.test(input) ? path.extname(input) : '.mp4';
  const out = outPath(input, '-corte', ext);

  onProgress({ stage: 'processing', message: `Cutting from ${fmtClock(start)} to ${fmtClock(end)}…`, percent: 0 });
  // -ss ANTES do -i = seek rápido; -t = duração exata. Re-encode = corte preciso.
  const args = ['-y', '-ss', String(start), '-i', input, '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', out];
  const r = await run(ffmpeg, args, 900_000, (line) => {
    const t = parseFfmpegTime(line);
    if (t != null && dur > 0) onProgress({ stage: 'processing', message: 'Cutting the clip…', percent: Math.min(99, Math.round((t / dur) * 100)) });
  });
  const ok = (r.code === 0) && fs.existsSync(out) && fs.statSync(out).size > 10_000;
  if (!ok) {
    const tail = (r.stderr || '').split(/\r?\n/).filter(Boolean).pop() || 'ffmpeg falhou';
    return { success: false, error: `Could not cut: ${tail}` };
  }
  onProgress({ stage: 'done', message: `Clip saved (${fmtClock(dur)}).` });
  return { success: true, path: out, info: { start, end, dur } };
}

// ─── EXTRAIR ÁUDIO ───────────────────────────────────────────────────────────
// Tira só o áudio → mp3 de boa qualidade (libmp3lame -q:a 2 ≈ 190kbps VBR).
export async function extrairAudio(
  input: string,
  onProgress: (p: VideoEditProgress) => void,
): Promise<VideoEditResult> {
  if (!input || !fs.existsSync(input)) return { success: false, error: 'Video file not found.' };
  const { ffmpeg, ffprobe } = await resolveBins();
  if (!(await hasAudioStream(ffprobe, input))) {
    return { success: false, error: 'This video has no audio track to extract.' };
  }
  const out = outPath(input, '', '.mp3');
  const total = await probeDuration(ffprobe, input);
  onProgress({ stage: 'processing', message: 'Extracting the audio (mp3)…' });
  const args = ['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', out];
  const r = await run(ffmpeg, args, 300_000, (line) => {
    const t = parseFfmpegTime(line);
    if (t != null && total > 0) onProgress({ stage: 'processing', message: 'Extracting the audio (mp3)…', percent: Math.min(99, Math.round((t / total) * 100)) });
  });
  const ok = (r.code === 0) && fs.existsSync(out) && fs.statSync(out).size > 1000;
  if (!ok) {
    const tail = (r.stderr || '').split(/\r?\n/).filter(Boolean).pop() || 'ffmpeg falhou';
    return { success: false, error: `Could not extract the audio: ${tail}` };
  }
  onProgress({ stage: 'done', message: 'Audio extracted.' });
  return { success: true, path: out };
}

// ─── REMOVER SILÊNCIO ────────────────────────────────────────────────────────
// 1) silencedetect mapeia os trechos mudos. 2) calculamos os trechos COM FALA
//    (complemento), com uma folguinha pra não cortar o começo/fim das palavras.
//    3) concat só dos trechos com fala (filtro escrito num arquivo p/ não estourar
//    o limite da linha de comando). Re-encoda (concat exige).
export interface RemoveSilenceOpts {
  noiseDb?: number;     // limiar de "silêncio" (dBFS). -30 = padrão sensato.
  minSilence?: number;  // duração mínima do silêncio pra cortar (s). 0.6 padrão.
  pad?: number;         // folga mantida em volta da fala (s). 0.10 padrão.
}
export async function removerSilencio(
  input: string,
  opts: RemoveSilenceOpts,
  onProgress: (p: VideoEditProgress) => void,
): Promise<VideoEditResult> {
  if (!input || !fs.existsSync(input)) return { success: false, error: 'Video file not found.' };
  const noiseDb = Number.isFinite(opts.noiseDb as number) ? (opts.noiseDb as number) : -30;
  const minSilence = opts.minSilence && opts.minSilence > 0 ? opts.minSilence : 0.6;
  const pad = opts.pad && opts.pad >= 0 ? opts.pad : 0.10;
  const { ffmpeg, ffprobe } = await resolveBins();

  const total = await probeDuration(ffprobe, input);
  if (!total) return { success: false, error: 'Could not read the video duration.' };
  if (!(await hasAudioStream(ffprobe, input))) {
    return { success: false, error: 'This video has no audio track — there is no silence to remove.' };
  }

  // 1) DETECTAR silêncios
  onProgress({ stage: 'analyzing', message: 'Analyzing the audio to find the silences…' });
  const silences: Array<{ start: number; end: number }> = [];
  let pendingStart: number | null = null;
  const detArgs = ['-i', input, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-'];
  await run(ffmpeg, detArgs, 600_000, (line) => {
    const ms = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (ms) { pendingStart = Math.max(0, parseFloat(ms[1])); return; }
    const me = line.match(/silence_end:\s*([\d.]+)/);
    if (me && pendingStart != null) {
      silences.push({ start: pendingStart, end: parseFloat(me[1]) });
      pendingStart = null;
    }
  });

  if (silences.length === 0) {
    return { success: true, path: undefined, info: { removed: 0, message: 'No significant silence found — the video is already continuous.' } };
  }

  // 2) TRECHOS COM FALA = complemento dos silêncios, com folga (pad) e merge.
  const keeps: Array<{ a: number; b: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const a = cursor, b = s.start;
    if (b - a > 0.05) keeps.push({ a, b });
    cursor = s.end;
  }
  if (total - cursor > 0.05) keeps.push({ a: cursor, b: total });
  // aplica folga e funde trechos que passem a se sobrepor
  const padded: Array<{ a: number; b: number }> = [];
  for (const k of keeps) {
    const a = Math.max(0, k.a - pad), b = Math.min(total, k.b + pad);
    const last = padded[padded.length - 1];
    if (last && a <= last.b + 0.02) last.b = Math.max(last.b, b);
    else padded.push({ a, b });
  }

  const keptDur = padded.reduce((s, k) => s + (k.b - k.a), 0);
  const removedDur = Math.max(0, total - keptDur);
  if (padded.length === 0 || removedDur < 0.3) {
    return { success: true, path: undefined, info: { removed: 0, message: 'There was almost no silence to remove.' } };
  }

  // 3) CONCAT só dos trechos com fala. Filtro num arquivo (evita estourar a linha).
  const parts: string[] = [];
  padded.forEach((k, i) => {
    parts.push(`[0:v]trim=start=${k.a.toFixed(3)}:end=${k.b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`);
    parts.push(`[0:a]atrim=start=${k.a.toFixed(3)}:end=${k.b.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`);
  });
  const concatInputs = padded.map((_k, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${concatInputs}concat=n=${padded.length}:v=1:a=1[outv][outa]`);
  const filter = parts.join('\n');

  const filterFile = path.join(os.tmpdir(), `nav-desilence-${Date.now()}.txt`);
  try { fs.writeFileSync(filterFile, filter, 'utf-8'); }
  catch (e: any) { return { success: false, error: `Failed to prepare the filter: ${e?.message ?? e}` }; }

  const ext = path.extname(input) || '.mp4';
  const out = outPath(input, '-sem-silencio', ext);
  onProgress({ stage: 'processing', message: `Removing ${fmtClock(removedDur)} of silence (${padded.length} speech segments)…`, percent: 0 });

  const args = [
    '-y', '-i', input,
    '-filter_complex_script', filterFile,
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    out,
  ];
  const r = await run(ffmpeg, args, 1_800_000, (line) => {
    const t = parseFfmpegTime(line);
    if (t != null && keptDur > 0) onProgress({ stage: 'processing', message: `Removing silence…`, percent: Math.min(99, Math.round((t / keptDur) * 100)) });
  });
  try { fs.unlinkSync(filterFile); } catch {}

  const ok = (r.code === 0) && fs.existsSync(out) && fs.statSync(out).size > 10_000;
  if (!ok) {
    const tail = (r.stderr || '').split(/\r?\n/).filter(Boolean).pop() || 'ffmpeg falhou';
    return { success: false, error: `Could not remove the silence: ${tail}` };
  }
  onProgress({ stage: 'done', message: `Done: ${fmtClock(removedDur)} of silence removed.` });
  return { success: true, path: out, info: { removed: padded.length, removedDur: Math.round(removedDur), keptDur: Math.round(keptDur), total: Math.round(total) } };
}
