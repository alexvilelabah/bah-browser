// ─────────────────────────────────────────────────────────────────────────────
// MONTADOR DO TEASER — pega _demo_raw.mp4 + _demo_markers.json e corta um vídeo
// curto (~20-30s) com os "momentos UAU", legendas em fade, card de abertura/fecho,
// e (opcional) trilha musical. Saída: Downloads/teaser-navegador.mp4.
//
// Roda tudo com cwd = tools/ pra usar caminhos RELATIVOS no filtergraph (evita o
// inferno de escapar "C:" em fontfile/textfile do ffmpeg no Windows).
//
// Uso:  node tools/make-teaser.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const downloads = path.join(os.homedir(), 'Downloads');
const markersPath = path.join(__dirname, '_demo_markers.json');
const finalOut = path.join(downloads, 'teaser-navegador.mp4');

const W = 1920, H = 1080, FPS = 30;
const PRE = 1.0, DUR = 5.0;   // janela: 1s antes do marcador + 4s depois (pega o auge)

function run(args, cwd = __dirname) {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, windowsHide: true });
    let err = '';
    ff.stderr.on('data', d => { err += d.toString(); });
    ff.on('close', (code) => resolve({ code, err }));
    ff.on('error', (e) => resolve({ code: -1, err: String(e?.message || e) }));
  });
}
const exists = (p) => { try { return fs.statSync(p).size > 1000; } catch { return false; } };

async function main() {
  if (!fs.existsSync(markersPath)) { console.error('faltou _demo_markers.json (rode o gravador primeiro)'); process.exit(1); }
  const { raw, markers } = JSON.parse(fs.readFileSync(markersPath, 'utf-8'));
  if (!fs.existsSync(raw)) { console.error('faltou o vídeo bruto:', raw); process.exit(1); }
  if (!markers?.length) { console.error('sem marcadores — nada pra cortar'); process.exit(1); }
  console.log(`[teaser] ${markers.length} marcadores, bruto: ${raw}`);

  // fonte: copia a Segoe UI pra um nome relativo (sem "C:" no filtergraph)
  const fontRel = '_font.ttf';
  const fontSrc = ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'].find(p => fs.existsSync(p));
  if (fontSrc) fs.copyFileSync(fontSrc, path.join(__dirname, fontRel));
  const useFont = fontSrc ? `fontfile=${fontRel}:` : '';

  const parts = [];   // arquivos (relativos a tools/) na ordem do concat

  // helper: drawtext com legenda vinda de textfile (sem escaping), em fade
  const captionFilter = (capRel, clipDur) => {
    const fadeIn = 0.4, fadeOut = 0.5;
    const a = `if(lt(t\\,${fadeIn})\\,t/${fadeIn}\\,if(lt(t\\,${clipDur - fadeOut})\\,1\\,max(0\\,(${clipDur}-t)/${fadeOut})))`;
    return `drawtext=${useFont}textfile=${capRel}:fontsize=58:fontcolor=white:borderw=2:bordercolor=black@0.85:`
      + `box=1:boxcolor=black@0.45:boxborderw=26:x=(w-tw)/2:y=h-180:alpha='${a}'`;
  };

  // 1) CARD DE ABERTURA (1.6s) — fundo escuro + título, fade in
  {
    const cap = '_cap_intro.txt';
    fs.writeFileSync(path.join(__dirname, cap), 'Navegador Inteligente');
    const sub = '_cap_intro2.txt';
    fs.writeFileSync(path.join(__dirname, sub), 'o navegador que faz por você');
    const d = 1.8;
    const out = '_part_intro.mp4';
    const vf = [
      `drawtext=${useFont}textfile=${cap}:fontsize=92:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40`,
      `drawtext=${useFont}textfile=${sub}:fontsize=42:fontcolor=0xbfc6d4:x=(w-tw)/2:y=(h/2)+50`,
      `fade=t=in:st=0:d=0.5,fade=t=out:st=${d - 0.4}:d=0.4`,
      'format=yuv420p',
    ].join(',');
    const r = await run(['-f', 'lavfi', '-i', `color=c=0x0d0d12:s=${W}x${H}:r=${FPS}:d=${d}`, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
    if (exists(path.join(__dirname, out))) { parts.push(out); console.log('[teaser] intro ok'); }
    else console.log('[teaser] intro FALHOU:', r.err.split('\n').pop());
  }

  // 2) CLIPES dos momentos UAU
  let i = 0;
  for (const m of markers) {
    const start = Math.max(0, (m.t || 0) - PRE);
    const cap = `_cap_${i}.txt`;
    fs.writeFileSync(path.join(__dirname, cap), m.caption || '');
    const out = `_part_${i}.mp4`;
    const vf = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      captionFilter(cap, DUR),
      'format=yuv420p',
    ].join(',');
    const r = await run(['-ss', String(start), '-i', raw, '-t', String(DUR), '-an', '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
    if (exists(path.join(__dirname, out))) { parts.push(out); console.log(`[teaser] clipe "${m.label}" ok (@${m.t}s)`); }
    else console.log(`[teaser] clipe "${m.label}" FALHOU:`, r.err.split('\n').pop());
    i++;
  }

  // 3) CARD DE FECHO (2.0s) — chamada, fade out
  {
    const cap = '_cap_outro.txt';
    fs.writeFileSync(path.join(__dirname, cap), 'Tudo isso. Num só navegador.');
    const d = 2.0;
    const out = '_part_outro.mp4';
    const vf = [
      `drawtext=${useFont}textfile=${cap}:fontsize=66:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`,
      `fade=t=in:st=0:d=0.4,fade=t=out:st=${d - 0.7}:d=0.7`,
      'format=yuv420p',
    ].join(',');
    const r = await run(['-f', 'lavfi', '-i', `color=c=0x0d0d12:s=${W}x${H}:r=${FPS}:d=${d}`, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
    if (exists(path.join(__dirname, out))) { parts.push(out); console.log('[teaser] outro ok'); }
    else console.log('[teaser] outro FALHOU:', r.err.split('\n').pop());
  }

  if (parts.length < 2) { console.error('[teaser] partes insuficientes, abortando'); process.exit(1); }

  // 4) CONCAT (todas as partes têm o mesmo codec → copy)
  const listRel = '_concat.txt';
  fs.writeFileSync(path.join(__dirname, listRel), parts.map(p => `file '${p}'`).join('\n'));
  const silentVideo = '_teaser_mute.mp4';
  let r = await run(['-f', 'concat', '-safe', '0', '-i', listRel, '-c', 'copy', silentVideo]);
  if (!exists(path.join(__dirname, silentVideo))) {
    // fallback: concat re-encodando (se o copy reclamar de timestamps)
    r = await run(['-f', 'concat', '-safe', '0', '-i', listRel, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', silentVideo]);
  }
  if (!exists(path.join(__dirname, silentVideo))) { console.error('[teaser] concat falhou:', r.err.split('\n').pop()); process.exit(1); }
  console.log('[teaser] concat ok');

  // 5) TRILHA opcional: qualquer .mp3 em tools/ (que não seja artefato nosso)
  const music = fs.readdirSync(__dirname).find(f => /\.mp3$/i.test(f) && !f.startsWith('_'));
  const silentAbs = path.join(__dirname, silentVideo);
  if (music) {
    console.log('[teaser] mixando trilha:', music);
    const dur = await probeDur(silentAbs);
    const r2 = await run(['-i', silentVideo, '-stream_loop', '-1', '-i', music,
      '-filter_complex', `[1:a]volume=0.55,afade=t=out:st=${Math.max(0, dur - 1.2)}:d=1.2[a]`,
      '-map', '0:v', '-map', '[a]', '-t', String(dur),
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', finalOut]);
    if (!exists(finalOut)) { fs.copyFileSync(silentAbs, finalOut); console.log('[teaser] (trilha falhou, ficou sem música)'); }
  } else {
    fs.copyFileSync(silentAbs, finalOut);
    console.log('[teaser] (sem .mp3 em tools/ → teaser sem trilha; é só largar um .mp3 lá e rodar de novo)');
  }

  // limpa partes intermediárias (mantém o final)
  for (const f of fs.readdirSync(__dirname)) {
    if (/^_(part_|cap_|concat|teaser_mute|font)/.test(f)) { try { fs.unlinkSync(path.join(__dirname, f)); } catch {} }
  }

  console.log(`\n[teaser] PRONTO → ${finalOut} (${exists(finalOut) ? Math.round(fs.statSync(finalOut).size / 1024) + ' KB' : 'FALHOU'})`);
}

function probeDur(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
    let o = '';
    p.stdout.on('data', d => { o += d.toString(); });
    p.on('close', () => resolve(parseFloat(o.trim()) || 25));
    p.on('error', () => resolve(25));
  });
}

main().catch((e) => { console.error('[teaser] ERRO FATAL:', e); process.exit(1); });
