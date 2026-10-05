// Botão "Baixar" do YouTube — a parte PURA (sem electron, roda nos testes):
// - descobre o id do vídeo pela URL da aba;
// - transforma o JSON do yt-dlp (-J) na lista de resoluções que a pessoa vê, com o
//   tamanho aproximado do arquivo final (vídeo + áudio), estimado com a MESMA
//   preferência de formato que o download usa (selectorArgs);
// - soma o progresso das partes (o yt-dlp baixa vídeo e áudio separados e depois junta).

export interface VideoChoice {
  key: string;              // 'r1080' | 'mp3' — o que a página manda de volta ao escolher
  kind: 'video' | 'audio';
  res?: number;             // lado MENOR do quadro (1080 tanto em 1920x1080 quanto num Short 1080x1920)
  label: string;            // '1080p60', 'MP3'
  hint?: string;            // 'Full HD', '4K'… (ajuda quem não sabe o que é "1080p")
  approxBytes?: number;
}

export interface VideoChoices {
  id: string;
  title: string;
  duration?: number;
  choices: VideoChoice[];
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Id do vídeo de uma página do YouTube (watch, shorts, live, embed, youtu.be) — ou null. */
export function youtubeVideoId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || null;
  } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'www.youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      // /embed/ é o player do YouTube dentro de outro site (iframe de notícia, blog…).
      const m = /^\/(shorts|live|embed)\/([^/?#]+)/.exec(u.pathname);
      if (m) id = m[2];
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/**
 * Post com vários vídeos (carrossel do Instagram, tweet com 2 vídeos) vem como "playlist":
 * usa a primeira mídia que tem formatos — a mesma que o download pega (--playlist-items 1).
 */
export function pickMediaEntry(info: any): any {
  if (info && !Array.isArray(info.formats) && Array.isArray(info.entries)) {
    return info.entries.find((e: any) => e && Array.isArray(e.formats) && e.formats.length) || info.entries[0] || info;
  }
  return info;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Argumentos de formato do yt-dlp pra baixar NA resolução escolhida. `res:R` pega a maior
 * resolução que não passa de R; `+codec:avc:m4a` prefere H.264 + AAC (o MP4 que abre em
 * qualquer player) e só cai pra VP9/AV1 quando não há H.264 naquela resolução (1440p/4K).
 */
export function selectorArgs(res: number, hasFfmpeg: boolean): string[] {
  const sort = ['-S', `res:${res},+codec:avc:m4a`];
  return hasFfmpeg
    ? ['-f', 'bv*+ba/b', ...sort, '--merge-output-format', 'mp4']
    : ['-f', 'b', ...sort];   // sem ffmpeg não dá pra juntar: melhor arquivo único (com áudio)
}

// Mesma ordem que o `+codec:avc:m4a` impõe: h264 > h265 > vp9 > vp9.2 > av01 > resto.
function vcodecRank(vcodec: string): number {
  const c = vcodec.toLowerCase();
  if (c.startsWith('avc') || c.startsWith('h264')) return 6;
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 5;
  if (c.startsWith('vp09.02') || c.startsWith('vp9.2')) return 3;
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 4;
  if (c.startsWith('av01')) return 2;
  return 1;
}
// mp4a/aac > vorbis/opus > mp3 > resto
function acodecRank(acodec: string): number {
  const c = acodec.toLowerCase();
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 4;
  if (c.startsWith('vorbis') || c.startsWith('opus')) return 3;
  if (c.startsWith('mp3')) return 2;
  return 1;
}
const protoRank = (p: unknown) => (p === 'https' || p === 'http' ? 2 : 1);
// Tamanho informado; sem ele (HLS da Globo, por exemplo), estima pela taxa × duração —
// a mesma conta do "~44 MiB" que o yt-dlp mostra.
const sizeOf = (f: any, duration?: number): number | undefined => {
  const n = Number(f?.filesize ?? f?.filesize_approx);
  if (Number.isFinite(n) && n > 0) return n;
  const tbr = Number(f?.tbr);
  return Number.isFinite(tbr) && tbr > 0 && duration && duration > 0 ? Math.round(tbr * 125 * duration) : undefined;   // kbit/s → bytes
};
const hasCodec = (c: unknown) => typeof c === 'string' && c !== 'none';

function resHint(res: number): string | undefined {
  if (res >= 4320) return '8K';
  if (res >= 2160) return '4K';
  if (res >= 1440) return '2K';
  if (res >= 1080) return 'Full HD';
  if (res >= 720) return 'HD';
  return undefined;
}

// MP3 no -x --audio-quality 0 (VBR V0) fica em ~245 kbps.
const MP3_BYTES_PER_SEC = 245_000 / 8;

/** Lista de escolhas (maior resolução primeiro, MP3 no fim) a partir do JSON do yt-dlp. */
export function buildVideoChoices(rawInfo: any): VideoChoices {
  const info = pickMediaEntry(rawInfo);
  const duration = Number(info?.duration);
  const secs = Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const formats: any[] = Array.isArray(info?.formats) ? info.formats : [];

  // Áudio que entra junto no MP4: a faixa padrão (language_preference mais alta), sem a
  // versão "DRC" (volume comprimido), preferindo AAC e o maior bitrate.
  const audios = formats.filter(f => hasCodec(f.acodec) && !hasCodec(f.vcodec) && !/-drc$/i.test(String(f.format_id || '')));
  const topLang = Math.max(...audios.map(f => Number(f.language_preference ?? 0)), -Infinity);
  const bestAudio = audios
    .filter(f => Number(f.language_preference ?? 0) === topLang)
    .sort((a, b) => acodecRank(b.acodec) - acodecRank(a.acodec)
      || Number(b.abr ?? b.tbr ?? 0) - Number(a.abr ?? a.tbr ?? 0))[0];
  const audioBytes = bestAudio ? sizeOf(bestAudio, secs) : undefined;

  // Vídeo: agrupa por lado menor e escolhe, em cada altura, o formato que o yt-dlp vai baixar.
  const byRes = new Map<number, any[]>();
  for (const f of formats) {
    // vcodec 'none' = só áudio. Codec desconhecido (null, comum fora do YouTube) com
    // largura/altura ainda é vídeo.
    if (f.vcodec === 'none') continue;
    const w = Number(f.width), h = Number(f.height);
    if (!(w > 0 && h > 0)) continue;
    const res = Math.min(w, h);
    if (res < 144) continue;
    if (!byRes.has(res)) byRes.set(res, []);
    byRes.get(res)!.push(f);
  }

  const choices: VideoChoice[] = [];
  for (const res of Array.from(byRes.keys()).sort((a, b) => b - a)) {
    const pick = byRes.get(res)!.sort((a, b) => vcodecRank(String(b.vcodec ?? '')) - vcodecRank(String(a.vcodec ?? ''))
      || protoRank(b.protocol) - protoRank(a.protocol)
      || Number(b.fps ?? 0) - Number(a.fps ?? 0)
      || Number(b.tbr ?? 0) - Number(a.tbr ?? 0))[0];
    const fps = Math.round(Number(pick.fps ?? 0));
    const vBytes = sizeOf(pick, secs);
    // Formato que já traz áudio não ganha outra faixa de áudio na soma.
    const total = vBytes === undefined ? undefined
      : vBytes + (hasCodec(pick.acodec) ? 0 : (audioBytes ?? 0));
    choices.push({
      key: `r${res}`,
      kind: 'video',
      res,
      label: `${res}p${fps > 30 ? fps : ''}`,
      hint: resHint(res),
      approxBytes: total,
    });
  }

  // Formatos sem largura/altura (link direto, stream genérico): uma opção só, "Vídeo" na
  // melhor qualidade (o download usa o padrão bv*+ba/b).
  if (choices.length === 0) {
    const videos = formats.filter(f => f && f.vcodec !== 'none');
    if (videos.length > 0) {
      const sizes = videos.map(f => sizeOf(f, secs)).filter((n): n is number => n !== undefined);
      choices.push({ key: 'best', kind: 'video', label: '', approxBytes: sizes.length ? Math.max(...sizes) : undefined });
    }
  }

  if (audios.length > 0 || choices.length > 0) {
    choices.push({
      key: 'mp3',
      kind: 'audio',
      label: 'MP3',
      approxBytes: Number.isFinite(duration) && duration > 0 ? Math.round(duration * MP3_BYTES_PER_SEC) : undefined,
    });
  }

  return {
    id: String(info?.id ?? ''),
    title: String(info?.title ?? rawInfo?.title ?? ''),
    duration: Number.isFinite(duration) ? duration : undefined,
    choices,
  };
}

/** "268 MB", "1,4 GB" (separador decimal do idioma da interface). */
export function formatBytes(n: number | undefined, decimalSep = ','): string {
  if (!n || !Number.isFinite(n) || n <= 0) return '';
  const MB = 1024 * 1024, GB = MB * 1024;
  if (n >= GB) return `${(n / GB).toFixed(1).replace('.', decimalSep)} GB`;
  if (n >= 100 * MB) return `${Math.round(n / MB)} MB`;
  if (n >= MB) return `${(n / MB).toFixed(1).replace('.', decimalSep)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * O yt-dlp manda o progresso de UMA parte por vez (o vídeo, depois o áudio), cada uma
 * recomeçando do zero. Pra a barra de Downloads andar uma vez só de 0 a 100%, somamos
 * as partes. `expected` (a estimativa da lista) segura o total enquanto a 2ª parte
 * ainda não começou — senão a barra chegaria a 100% no fim do vídeo e voltaria.
 */
export class PartsProgress {
  // Sem `private`/parameter property: os testes rodam este arquivo direto no Node
  // (type stripping), que não aceita sintaxe de TS que gera código.
  parts = new Map<string, { done: number; total: number }>();
  expected: number;
  constructor(expected = 0) { this.expected = expected; }

  update(part: string, done?: number, total?: number): void {
    const prev = this.parts.get(part) ?? { done: 0, total: 0 };
    this.parts.set(part, {
      done: Number.isFinite(done) && (done as number) >= 0 ? (done as number) : prev.done,
      total: Number.isFinite(total) && (total as number) > 0 ? (total as number) : prev.total,
    });
  }

  snapshot(): { bytes: number; totalBytes: number; percent: number } {
    let bytes = 0, known = 0;
    for (const p of this.parts.values()) { bytes += p.done; known += Math.max(p.total, p.done); }
    const totalBytes = Math.max(known, this.expected, bytes);
    return { bytes, totalBytes, percent: totalBytes > 0 ? Math.min(100, (bytes / totalBytes) * 100) : 0 };
  }
}
