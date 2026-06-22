// Transcrição de vídeo do YouTube → texto corrido, pra IA do chat poder conversar
// sobre o que é DITO no vídeo (não só título/descrição). Reaproveita o yt-dlp que já
// baixa as legendas no supercut: --write-auto-subs --write-subs (.vtt, sem baixar o vídeo).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureYtDlp } from './media-downloader';

// Extrai o ID de um vídeo do YouTube (watch?v=, youtu.be/, /shorts/, /embed/).
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return (u.pathname.slice(1).match(/^[A-Za-z0-9_-]{11}/) || [null])[0];
    if (/youtube\.com$/.test(h)) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}/.test(v)) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function runYtDlp(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(); });
    child.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

// .vtt → texto: tira timestamps/tags e remove repetição de linha (auto-subs repetem muito).
function vttToText(vtt: string): string {
  const cueRe = /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{2}:|$)/g;
  const out: string[] = [];
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(vtt))) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&gt;|&lt;|&amp;|&nbsp;|&#39;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text !== last) { out.push(text); last = text; }
  }
  return out.join(' ');
}

export async function fetchTranscript(url: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const id = youtubeId(url);
  if (!id) return { ok: false, error: 'não é um vídeo do YouTube' };
  const bin = await ensureYtDlp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tscript-'));
  try {
    await runYtDlp(bin, [
      `https://www.youtube.com/watch?v=${id}`,
      '--skip-download', '--write-auto-subs', '--write-subs',
      '--sub-langs', 'pt,pt-orig,en,en-orig', '--sub-format', 'vtt',
      '-o', path.join(tmpDir, id),
    ], 30_000);
    const vtts = fs.readdirSync(tmpDir).filter((f) => f.startsWith(id) && f.endsWith('.vtt'));
    if (!vtts.length) return { ok: false, error: 'esse vídeo não tem legenda disponível' };
    const pick = vtts.find((f) => /\.pt(-orig)?\.vtt$/.test(f)) || vtts[0];   // prefere PT
    let text = vttToText(fs.readFileSync(path.join(tmpDir, pick), 'utf8'));
    if (!text) return { ok: false, error: 'legenda vazia' };
    if (text.length > 14000) text = text.slice(0, 14000) + ' …(transcrição truncada)';
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
