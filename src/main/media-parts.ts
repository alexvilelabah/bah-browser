// Partes de um download do yt-dlp — a lógica PURA (sem electron, roda nos testes):
// - reconhece os pedaços "Título.f313.webm" / "Título.f140.m4a" que o yt-dlp grava antes de
//   juntar vídeo + áudio (nunca são o resultado: o 313 é só imagem, sem som);
// - decide sucesso × falha a partir do código de saída + arquivos + o que o ffprobe viu;
// - lê a saída do ffprobe/ffmpeg e escolhe o contêiner pra juntar as partes nós mesmos;
// - o diário (journal) dos downloads em andamento, pra limpar os restos depois de fechar o
//   Bah no meio de um download.
import fs from 'fs';
import path from 'path';

// ".f313.webm", ".f0.mp4", ".fhls-1080p.mp4": o id do formato tem pelo menos um dígito —
// assim "Song.final.mp4" não passa por pedaço.
const COMPONENT_RE = /\.f([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\.([A-Za-z0-9]{2,5})$/;
// Arquivos de trabalho do yt-dlp/ffmpeg: .temp.mp4 (merge em andamento), .part, .ytdl, fragmentos.
const TEMP_RE = /(\.temp\.[A-Za-z0-9]{2,5}|\.part|\.ytdl|\.part-Frag\d+(\.part)?)$/i;
const MEDIA_RE = /\.(mp3|mp4|m4a|webm|mkv|opus|aac|ogg|flac|wav|mov|m4v)$/i;

export interface ComponentInfo { base: string; formatId: string; ext: string }

/** "dir/Título [id].f313.webm" → { base: "dir/Título [id]", formatId: "313", ext: "webm" }. */
export function componentInfo(p: string): ComponentInfo | null {
  const m = COMPONENT_RE.exec(p);
  if (!m) return null;
  return { base: p.slice(0, m.index), formatId: m[1], ext: m[2] };
}
export const isComponentFile = (p: string) => componentInfo(p) !== null;
export const isTempArtifact = (p: string) => TEMP_RE.test(p);
/** Arquivo de mídia que pode ser o resultado (não é pedaço nem arquivo de trabalho). */
export const isFinalMedia = (p: string) => MEDIA_RE.test(p) && !isComponentFile(p) && !isTempArtifact(p);

export type RunVerdict = 'ok' | 'not-merged' | 'failed' | 'cancelled';

export interface RunFacts {
  exitCode: number | null;     // null = morreu por sinal
  cancelled?: boolean;
  reported: string[];          // caminhos do --print after_move (e do fallback pela pasta)
  written: string[];           // o que ESTE download escreveu (linhas Destination/Merging)
  exists: (p: string) => boolean;
}

export interface RunOutcome {
  verdict: RunVerdict;
  finals: string[];            // resultados de verdade (existem e não são pedaços)
  components: string[];        // pedaços deste download que sobraram no disco
  cleanup: string[];           // o que apagar (sempre um subconjunto de `written`)
}

const exitOk = (code: number | null) => code === 0 || code === 101;   // 101 = --max-downloads atingido

/**
 * Sucesso só com um arquivo FINAL que existe. Pedaço .fNNN nunca conta como resultado: sem
 * o arquivo juntado (ou com saída ≠ 0) os pedaços são "não juntados" e saem do disco.
 */
export function classifyRun(f: RunFacts): RunOutcome {
  const written = Array.from(new Set(f.written));
  const leftovers = written.filter(p => f.exists(p));
  const components = leftovers.filter(isComponentFile);
  const finals = Array.from(new Set(f.reported)).filter(p => !isComponentFile(p) && !isTempArtifact(p) && f.exists(p));
  if (f.cancelled) return { verdict: 'cancelled', finals: [], components, cleanup: leftovers };
  // Arquivo de trabalho que sobrou (.temp.mp4 de um merge que caiu) nunca é resultado.
  const temps = leftovers.filter(isTempArtifact);
  if (exitOk(f.exitCode) && finals.length > 0) {
    // Pedaço cujo arquivo final saiu: o yt-dlp já devia ter apagado; se ficou, é lixo nosso.
    return { verdict: 'ok', finals, components, cleanup: [...components, ...temps] };
  }
  if (components.length > 0) {
    // O que este download escreveu e não virou resultado sai do disco (pedaços entram por
    // último: quem chamou pode tentar juntá-los antes de apagar).
    const notFinal = leftovers.filter(p => !finals.includes(p));
    return { verdict: 'not-merged', finals, components, cleanup: notFinal };
  }
  if (exitOk(f.exitCode) && finals.length === 0) return { verdict: 'failed', finals, components, cleanup: leftovers };
  // Saída ≠ 0: o que já saiu completo (playlist, item 1 de 3) continua valendo.
  return { verdict: finals.length ? 'ok' : 'failed', finals, components, cleanup: leftovers.filter(p => !finals.includes(p)) };
}

// ── ffprobe / ffmpeg ──
export interface StreamProbe { video: string | null; audio: string | null }

/** Saída de `ffprobe -show_entries stream=codec_type,codec_name -of csv=p=0` → codecs. */
export function parseFfprobeStreams(out: string): StreamProbe {
  const r: StreamProbe = { video: null, audio: null };
  for (const line of out.split(/\r?\n/)) {
    const cells = line.trim().split(',').map(s => s.trim()).filter(Boolean);
    const kind = cells.find(c => c === 'video' || c === 'audio');
    if (!kind) continue;
    const codec = cells.find(c => c !== kind) || 'unknown';
    // Capa (mjpeg/png "attached pic") também aparece como vídeo: fica só a 1ª faixa de cada tipo.
    if (kind === 'video' && !r.video) r.video = codec;
    if (kind === 'audio' && !r.audio) r.audio = codec;
  }
  return r;
}

/** Sem ffprobe: o stderr do `ffmpeg -i arquivo` ("Stream #0:1(und): Audio: aac ..."). */
export function parseFfmpegInfo(stderr: string): StreamProbe {
  const r: StreamProbe = { video: null, audio: null };
  for (const m of stderr.matchAll(/Stream #\d+:\d+[^:]*: (Video|Audio): ([A-Za-z0-9_]+)/g)) {
    if (m[1] === 'Video' && !r.video) r.video = m[2].toLowerCase();
    if (m[1] === 'Audio' && !r.audio) r.audio = m[2].toLowerCase();
  }
  return r;
}

const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4']);
const MP4_AUDIO = new Set(['aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac']);
/** MP4 quando os codecs cabem nele (o que o resto do Bah promete); senão MKV, que aceita tudo. */
export function mergeContainer(video: string, audio: string): 'mp4' | 'mkv' {
  return MP4_VIDEO.has(video.toLowerCase()) && MP4_AUDIO.has(audio.toLowerCase()) ? 'mp4' : 'mkv';
}

/** ffmpeg juntando sem reconverter (-c copy): segundos, mesmo pra 4K. */
export function ffmpegMergeArgs(video: string, audio: string, out: string, container: 'mp4' | 'mkv'): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
    ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
    '-f', container === 'mp4' ? 'mp4' : 'matroska',
    out,
  ];
}

export interface ProbedPart { path: string; probe: StreamProbe | null; complete: boolean }
/**
 * Dá pra juntar nós mesmos? Exatamente um pedaço de vídeo e um de áudio, os dois baixados
 * até o fim e da mesma base (mesmo vídeo). Pedaço pela metade (Bah fechou no meio) nunca.
 */
export function pairForMerge(parts: ProbedPart[]): { video: string; audio: string; base: string } | null {
  const vids = parts.filter(p => p.complete && p.probe?.video && !p.probe.audio);
  const auds = parts.filter(p => p.complete && p.probe?.audio && !p.probe.video);
  if (vids.length !== 1 || auds.length !== 1) return null;
  const v = componentInfo(vids[0].path), a = componentInfo(auds[0].path);
  if (!v || !a || v.base !== a.base) return null;
  return { video: vids[0].path, audio: auds[0].path, base: v.base };
}

/** Pedido normal de vídeo (não só-áudio): o arquivo final TEM que ter som. */
export function needsAudioCheck(o: { audioOnly?: boolean; videoOnly?: boolean }): boolean {
  return !o.audioOnly && !o.videoOnly;
}

/** Erro do yt-dlp que quer dizer "não existe formato com áudio" (vídeo mudo na origem). */
export const looksFormatUnavailable = (err?: string) => /requested format (is )?not available/i.test(err || '');

// ── Diário dos downloads em andamento ──
// Um arquivo JSON em userData. Cada download entra quando começa e sai quando termina (bem
// ou mal, já limpo). Sobrou entrada no próximo boot = o Bah fechou no meio daquele download.
export interface JournalEntry {
  id: string;
  dir: string;              // pasta de downloads usada (só ali o Bah apaga)
  startedAt: number;
  files: string[];          // o que este download escreveu e ainda não virou resultado
  pid?: number;             // yt-dlp em andamento (grupo de processos próprio)
  meta?: any;               // o que precisa pra "tentar de novo" (url, escolha…)
}

export function readJournal(file: string): JournalEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw.filter((e: any) => e && typeof e.id === 'string' && typeof e.dir === 'string' && Array.isArray(e.files)) : [];
  } catch { return []; }
}
export function writeJournal(file: string, entries: JournalEntry[]): void {
  try {
    if (!entries.length) { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, file);   // troca atômica: boot no meio da escrita não lê JSON cortado
  } catch {}
}

/**
 * Restos de um download interrompido que podem sair: só os arquivos que ele mesmo anotou,
 * dentro da pasta dele, que ainda existem e não são mais velhos que o download (arquivo
 * trocado depois pela pessoa fica). Nada fora disso é tocado.
 */
export function leftoversToDelete(e: JournalEntry, stat: (p: string) => { mtimeMs: number } | null): string[] {
  const dir = path.resolve(e.dir);
  const out: string[] = [];
  for (const f of new Set(e.files)) {
    if (typeof f !== 'string' || !path.isAbsolute(f)) continue;
    const abs = path.resolve(f);
    if (path.dirname(abs) !== dir) continue;
    const st = stat(abs);
    if (!st || st.mtimeMs < e.startedAt - 5000) continue;
    out.push(abs);
  }
  return out;
}
