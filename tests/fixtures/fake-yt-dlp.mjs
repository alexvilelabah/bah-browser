// yt-dlp FALSO pros testes do merge (media-merge.spec.ts). Não acessa rede: copia os arquivos
// minúsculos de FAKE_FIX_DIR (gerados com ffmpeg pelo teste) imitando a saída do yt-dlp de
// verdade com --no-quiet (linhas "Destination:", "[Merger] Merging formats into", o --print
// after_move:filepath e o progresso DLPROG). O cenário vem de FAKE_YTDLP_MODE:
//   video-only-fail  grava só o .f313.webm (vídeo sem som) e sai com erro 1
//   video-only-exit0 grava só o .f313.webm pela metade e sai 0 sem juntar
//   parts-exit0      grava .f313.webm + .f140.m4a completos e sai 0 SEM juntar (o Bah junta)
//   good             junta de verdade com o ffmpeg e imprime o caminho final
//   silent-then-good 1ª vez entrega um MP4 sem som; com o seletor que garante áudio, entrega o bom
//   hang             grava metade do .f313.webm e fica parado (o Bah fecha no meio)
// Uso: o teste cria um executável com shebang pro node e aponta BAH_TEST_YTDLP pra ele.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
const mode = process.env.FAKE_YTDLP_MODE || 'good';
const fix = process.env.FAKE_FIX_DIR;
const out = (s) => process.stdout.write(s + '\n');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--version')) { out('2026.10.26'); process.exit(0); }
// FAKE_YTDLP_LOG=<arquivo>: guarda os argumentos de cada chamada (uma linha JSON) → o teste confere as buscas.
if (process.env.FAKE_YTDLP_LOG) fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + '\n');
const tmpl = arg('-o');
const ffdir = arg('--ffmpeg-location') || '/usr/local/bin';
const sel = arg('-f') || '';
const base = tmpl.replace(/%\(title\)\.\d+B/g, 'Fake Clip').replace(/%\(id\)s/g, 'fake123').replace(/\.%\(ext\)s$/, '');
const prog = (pct, fid, done, total) => out(`DLPROG:${pct.toFixed(1)}%|1.00MiB/s|00:00|${done}|${total}|1048576|0|${fid}`);

function part(fid, src, ext, frac = 1) {
  const dest = `${base}.f${fid}.${ext}`;
  out(`[download] Destination: ${dest}`);
  const buf = fs.readFileSync(path.join(fix, src));
  const n = Math.floor(buf.length * frac);
  fs.writeFileSync(dest, buf.subarray(0, n));
  prog(100 * frac, fid, n, buf.length);
  return dest;
}
function finish(file) {
  out(`\x1b[K${file}`);
  out(`BAHSRC\thttps://example.com/watch/fake\t${file}`);
}
function merge(v, a, dest) {
  out(`[Merger] Merging formats into "${dest}"`);
  const tmp = dest.replace(/\.mp4$/, '.temp.mp4');
  const r = spawnSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', '-i', v, '-i', a, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-f', 'mp4', tmp]);
  if (r.status !== 0) { process.stderr.write('ERROR: Postprocessing: merge failed\n'); process.exit(1); }
  fs.renameSync(tmp, dest);
  fs.unlinkSync(v); fs.unlinkSync(a);
  out(`Deleting original file ${v} (pass -k to keep)`);
}

if (mode === 'video-only-fail') {
  part('313', 'video.webm', 'webm');
  process.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n');
  process.exit(1);
}
if (mode === 'video-only-exit0') {
  part('313', 'video.webm', 'webm', 0.5);
  process.exit(0);
}
if (mode === 'parts-exit0') {
  part('313', 'video.webm', 'webm');
  part('140', 'audio.m4a', 'm4a');
  process.exit(0);
}
if (mode === 'hang') {
  part('313', 'video.webm', 'webm', 0.4);
  setInterval(() => prog(40, '313', 1, 2), 1000);   // segue "baixando" até o Bah matar
} else if (mode === 'good' || (mode === 'silent-then-good' && sel.includes('[acodec!=none]'))) {
  const v = part('313', 'video.webm', 'webm');
  const a = part('140', 'audio.m4a', 'm4a');
  const dest = `${base}.mp4`;
  merge(v, a, dest);
  finish(dest);
  process.exit(0);
} else if (mode === 'silent-then-good') {
  const dest = `${base}.mp4`;
  out(`[download] Destination: ${dest}`);
  fs.copyFileSync(path.join(fix, 'silent.mp4'), dest);
  prog(100, '18', 10, 10);
  finish(dest);
  process.exit(0);
} else {
  process.stderr.write(`ERROR: unknown FAKE_YTDLP_MODE ${mode}\n`);
  process.exit(2);
}
