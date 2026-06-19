// ─────────────────────────────────────────────────────────────────────────────
// SUPERCUT — acha onde uma frase é DITA (legendas, via video-cuts) e baixa o
// TRECHO de cada vídeo como um arquivo SEPARADO, na MELHOR qualidade do vídeo.
// NÃO cola mais (a colagem mutilava a fala) — entrega os clipes prontos numa
// subpasta, o usuário monta/usa como quiser. Guerrilha: legendas grátis +
// trechos minúsculos + yt-dlp/ffmpeg local. Custo: R$ 0,00.
// ─────────────────────────────────────────────────────────────────────────────
import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ensureYtDlp, findFfmpegDir } from './media-downloader';
import { searchVideoCuts, type VideoCut } from './video-cuts';

export interface SupercutProgress {
  stage: 'searching' | 'clipping' | 'done' | 'failed';
  message: string;
  current?: number;  // clipe atual
  total?: number;
}

export interface SupercutResult {
  success: boolean;
  dir?: string;        // pasta com os trechos
  paths?: string[];    // arquivos de trecho baixados
  clipCount?: number;
  clips?: Array<{ title?: string; videoId: string; seconds: number }>;
  error?: string;
}

// Janela generosa pra capturar a frase INTEIRA mesmo se for rápida ou lenta
// (não sabemos o fim exato da fala pela legenda; melhor sobrar contexto do que cortar).
const PRE_ROLL = 3;    // segundos antes da frase
const POST_ROLL = 10;  // segundos depois (cobre frases longas/pausadas)

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let tail = '';
    const sink = (d: Buffer) => { tail = (tail + d.toString()).slice(-1200); };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, tail }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, tail }); });
  });
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'supercut';

export async function makeSupercut(
  phrase: string,
  count: number,
  onProgress: (p: SupercutProgress) => void,
): Promise<SupercutResult> {
  const want = Math.min(Math.max(count || 6, 1), 15);
  const clean = (phrase || '').trim();
  if (clean.length < 2) return { success: false, error: 'Frase muito curta pro supercut.' };

  // 1. Onde a frase é dita (reusa todo o pipeline de legendas do video-cuts).
  onProgress({ stage: 'searching', message: `Procurando ${want} vídeos onde "${clean}" é dita…` });
  const found = await searchVideoCuts(clean, want);
  if (!found.success || found.cuts.length < 1) {
    return { success: false, error: found.error || `Não achei vídeo onde "${clean}" é dita. Tente uma frase mais comum.` };
  }
  const cuts: VideoCut[] = found.cuts;

  const bin = await ensureYtDlp();
  const ffDir = await findFfmpegDir();

  // Salva os trechos numa subpasta temática do Downloads (não cola — arquivos separados).
  const outDir = path.join(app.getPath('downloads'), `trechos-${slugify(clean)}`);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e: any) {
    return { success: false, error: `Não consegui criar a pasta: ${e?.message ?? e}` };
  }
  const clipPaths: string[] = [];
  const usedCuts: VideoCut[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');

  // Baixa o TRECHO de cada vídeo como arquivo separado, na MELHOR qualidade do vídeo.
  // --downloader ffmpeg dá SEEK no stream (baixa só os segundos). Formato sem cap de
  // altura (bv*+ba/b) = melhor disponível; --merge-output-format mp4. NÃO pula de vídeo
  // por causa de resolução — pega o melhor do vídeo que a legenda apontou.
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    const start = Math.max(0, c.seconds - PRE_ROLL);
    const end = c.seconds + POST_ROLL;
    onProgress({ stage: 'clipping', current: i + 1, total: cuts.length, message: `Baixando trecho ${i + 1}/${cuts.length} (melhor qualidade): "${(c.title || c.videoId).slice(0, 50)}" @${c.seconds}s` });
    const out = path.join(outDir, `${pad(i + 1)}-%(title).60B.%(ext)s`);
    const fmt = ffDir ? 'bv*+ba/b' : 'b';   // melhor v+a (merge); sem ffmpeg, melhor progressivo
    const args = [
      `https://www.youtube.com/watch?v=${c.videoId}`,
      '--no-playlist', '--no-part', '--no-color', '--restrict-filenames',
      '--download-sections', `*${start}-${end}`,
      '--downloader', 'ffmpeg',
      '--downloader-args', `ffmpeg_i:-ss ${start} -to ${end}`,
      '-f', fmt,
      '--print', 'after_move:filepath',
      '-o', out,
    ];
    if (ffDir) args.push('--merge-output-format', 'mp4', '--ffmpeg-location', ffDir);
    const r = await run(bin, args, 180_000);
    // pega o caminho final impresso; senão, o arquivo mais novo da pasta
    let saved = (r.tail.split(/\r?\n/).map(s => s.trim()).filter(l => /^[A-Za-z]:[\\/].+\.\w{2,4}$/.test(l)).pop()) || '';
    if (!saved) {
      try {
        const newest = fs.readdirSync(outDir).map(f => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)[0];
        if (newest && !clipPaths.includes(newest.p)) saved = newest.p;
      } catch {}
    }
    if ((r.code === 0 || r.code === 101) && saved && fs.existsSync(saved) && fs.statSync(saved).size > 10_000) {
      clipPaths.push(saved);
      usedCuts.push(c);
    }
    // Clipe que falhou não derruba o resto.
  }

  if (clipPaths.length === 0) {
    return { success: false, error: `Não consegui baixar nenhum trecho de "${clean}" — o YouTube pode estar limitando. Tente de novo em alguns minutos.` };
  }

  onProgress({ stage: 'done', message: `${clipPaths.length} trechos baixados em ${outDir}` });
  return { success: true, dir: outDir, paths: clipPaths, clipCount: clipPaths.length, clips: usedCuts.map((c) => ({ title: c.title, videoId: c.videoId, seconds: c.seconds })) };
}
