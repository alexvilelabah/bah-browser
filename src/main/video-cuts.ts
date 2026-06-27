// ─────────────────────────────────────────────────────────────────────────────
// VIDEO CUTS (supercut helper) — acha vídeos do YouTube onde uma FRASE É DITA
// e o segundo exato em que ela aparece. Guerrilha pura, zero API paga:
//   1ª via: Filmot (filmot.com) — indexa as legendas do YouTube inteiro. O fetch
//           usa a MESMA sessão do webview (persist:browser), então os cookies do
//           usuário valem; se o Filmot pedir hCaptcha (sessão fria), desistimos.
//   2ª via (sempre funciona): yt-dlp busca candidatos no YouTube, baixa só as
//           legendas automáticas (.vtt, sem vídeo) e nós achamos a frase + o
//           timestamp localmente. Sem captcha, sem chave, sem custo.
// ─────────────────────────────────────────────────────────────────────────────
import { app, session } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ACCEPT_LANGUAGE } from './site-locale';
import { ensureYtDlp } from './media-downloader';

export interface VideoCut {
  videoId: string;
  seconds: number;
  title?: string;
}

export interface VideoCutsResult {
  success: boolean;
  cuts: VideoCut[];
  source?: 'filmot' | 'legendas';
  error?: string;
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Remove acentos + caixa baixa, pra casar "inteligência" com "inteligencia". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(new RegExp('\\s+', 'g'), ' ')
    .trim();
}

// ── 1ª via: Filmot ───────────────────────────────────────────────────────────
async function tryFilmot(phrase: string, count: number): Promise<VideoCut[] | null> {
  try {
    const ses = session.fromPartition('persist:browser');
    const url = `https://filmot.com/search/%22${encodeURIComponent(phrase)}%22/1`;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 12_000);
    const res = await ses.fetch(url, {
      headers: { 'User-Agent': CHROME_UA, 'Accept-Language': ACCEPT_LANGUAGE },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tm));
    if (!res.ok) return null;
    const html = await res.text();
    // Sessão fria cai no hCaptcha — sem briga, vamos pro plano B.
    if (res.url.includes('captcha') || /hcaptcha|cf-challenge/i.test(html)) return null;
    // Tolerante a mudanças de markup: qualquer link com um id de vídeo + t=segundos.
    const re = /(?:youtube\.com\/watch\?v=|youtu\.be\/|\/video\/)([A-Za-z0-9_-]{11})[^"'<>\s]*?[?&#]t=(\d+)/g;
    const cuts: VideoCut[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && cuts.length < count) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        cuts.push({ videoId: m[1], seconds: parseInt(m[2], 10) });
      }
    }
    return cuts.length > 0 ? cuts : null;
  } catch {
    return null;
  }
}

// ── 2ª via: legendas automáticas via yt-dlp ──────────────────────────────────
function runYtDlp(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(out); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

/** Acha a frase num .vtt e devolve o segundo do cue onde ela começa. */
function findPhraseInVtt(vtt: string, phrase: string): number | null {
  const want = fold(phrase);
  // Quebra em cues: linha "hh:mm:ss.mmm --> ..." seguida do texto.
  const cueRe = /(\d{2}):(\d{2}):(\d{2})\.\d{3}\s*-->[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{2}:|$)/g;
  const cues: Array<{ t: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(vtt))) {
    const t = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    const text = fold(m[4].replace(/<[^>]+>/g, ' ').replace(/&gt;|&lt;|&amp;/g, ' '));
    if (text) cues.push({ t, text });
  }
  for (let i = 0; i < cues.length; i++) {
    // A frase pode atravessar a fronteira de dois cues — testa o par concatenado.
    const joined = i + 1 < cues.length ? `${cues[i].text} ${cues[i + 1].text}` : cues[i].text;
    if (joined.includes(want)) return Math.max(0, cues[i].t - 1); // 1s antes, pra dar contexto
  }
  return null;
}

async function trySubtitles(phrase: string, count: number): Promise<VideoCut[]> {
  const bin = await ensureYtDlp();
  // 1. Candidatos: vídeos que o YouTube acha pra frase. Frases curtas/comuns
  //    ("até amanhã", "bom dia") retornam muita MÚSICA sem legenda — por isso
  //    varremos um pool largo e, se preciso, uma 2ª leva com viés de fala
  //    (entrevistas/podcasts têm legenda automática quase sempre).
  const listOnce = async (q: string, n: number) => {
    const out = await runYtDlp(bin, [`ytsearch${n}:${q}`, '--flat-playlist', '--print', '%(id)s|%(title).80s'], 30_000);
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => { const i = l.indexOf('|'); return { id: l.slice(0, i), title: l.slice(i + 1) }; })
      .filter((c) => /^[A-Za-z0-9_-]{11}$/.test(c.id));
  };
  // 2. Pra cada candidato, baixa SÓ a legenda e procura a frase localmente.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcuts-'));
  const cuts: VideoCut[] = [];
  const scanned = new Set<string>();
  const scan = async (cands: Array<{ id: string; title: string }>) => {
    for (const cand of cands) {
      if (cuts.length >= count || scanned.has(cand.id)) continue;
      scanned.add(cand.id);
      await runYtDlp(bin, [
        `https://www.youtube.com/watch?v=${cand.id}`,
        '--skip-download', '--write-auto-subs', '--write-subs',
        '--sub-langs', 'pt,pt-orig,en', '--sub-format', 'vtt',
        '-o', path.join(tmpDir, cand.id),
      ], 25_000);
      const vttFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith(cand.id) && f.endsWith('.vtt'));
      for (const f of vttFiles) {
        const seconds = findPhraseInVtt(fs.readFileSync(path.join(tmpDir, f), 'utf8'), phrase);
        if (seconds != null) { cuts.push({ videoId: cand.id, seconds, title: cand.title }); break; }
      }
      vttFiles.forEach((f) => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
    }
  };
  try {
    await scan(await listOnce(phrase, Math.min(count * 6, 20)));
    if (cuts.length < count) {
      // 2ª leva com viés de FALA: frases curtas/comuns retornam música (sem
      // legenda) na busca normal; entrevistas/podcasts/aulas quase sempre têm.
      await scan(await listOnce(`"${phrase}" entrevista OR podcast OR aula`, 12));
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  return cuts;
}

// ── Entrada única ────────────────────────────────────────────────────────────
export async function searchVideoCuts(phrase: string, count: number): Promise<VideoCutsResult> {
  const n = Math.min(Math.max(count || 4, 1), 8);
  const clean = (phrase || '').trim();
  if (clean.length < 2) return { success: false, cuts: [], error: 'Phrase too short.' };

  const viaFilmot = await tryFilmot(clean, n);
  if (viaFilmot && viaFilmot.length > 0) return { success: true, cuts: viaFilmot, source: 'filmot' };

  const viaSubs = await trySubtitles(clean, n);
  if (viaSubs.length > 0) return { success: true, cuts: viaSubs, source: 'legendas' };

  return { success: false, cuts: [], error: `Could not find videos where "${clean}" is said (tried Filmot and YouTube captions).` };
}
