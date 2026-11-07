// Media downloader — baixa vídeos (YouTube etc.) com yt-dlp, gerenciado pelo
// próprio navegador. yt-dlp é um binário standalone; baixamos sob demanda em
// userData/bin e usamos o ffmpeg do sistema (se houver) para mesclar alta resolução.
//
// Nota: download de mídia é função comum de navegador (uso pessoal / direitos
// autorais por conta do usuário). O usuário dirige; nós só executamos a ferramenta.
import { app } from 'electron';
import { spawn, spawnSync, execFile, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { StringDecoder } from 'string_decoder';
import { selectorArgs } from './video-formats';
import { getDownloadDir } from './download-dir';
import {
  classifyRun, componentInfo, ffmpegMergeArgs, isFinalMedia, leftoversToDelete, looksFormatUnavailable, mergeContainer,
  needsAudioCheck, pairForMerge, parseFfmpegInfo, parseFfprobeStreams, readJournal, writeJournal,
  type JournalEntry, type StreamProbe,
} from './media-parts';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const EXE = IS_WIN ? '.exe' : '';
// Binário do yt-dlp certo pra cada SO. No macOS vai o yt-dlp_macos.zip (universal: Apple
// Silicon + Intel), que é a PASTA já desempacotada: o yt-dlp_macos "onefile" se desempacota
// a CADA execução e o macOS escaneia os arquivos novos — medido ~16s por chamada num Mac
// Intel (o teste de 10s achava que estava corrompido), contra ~2,5s da pasta.
function ytDlpAsset(): string {
  if (IS_WIN) return 'yt-dlp.exe';
  if (IS_MAC) return 'yt-dlp_macos.zip';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset()}`;
// Build estático do ffmpeg (Windows). Vem num .zip → descompactamos com o Expand-Archive
// nativo do Windows (sem dependência nova). Usado pra mesclar 1080p+ e extrair mp3.
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
// Motor de JavaScript que o yt-dlp exige pro YouTube desde 2025 (sem ele: "HTTP Error 403"
// no download). Deno é o recomendado pelo próprio yt-dlp: roda o código do YouTube SEM
// acesso a arquivos nem rede. Binário único dentro do .zip (um por SO/arquitetura).
function denoAsset(): string | null {
  if (IS_WIN) return 'deno-x86_64-pc-windows-msvc.zip';
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null;
  if (!arch) return null;
  if (process.platform === 'darwin') return `deno-${arch}-apple-darwin.zip`;
  if (process.platform === 'linux') return `deno-${arch}-unknown-linux-gnu.zip`;
  return null;
}
const DENO_ASSET = denoAsset();
const DENO_URL = DENO_ASSET ? `https://github.com/denoland/deno/releases/latest/download/${DENO_ASSET}` : null;

// O yt-dlp.exe é "onefile" do PyInstaller: o processo que o Node abre só desempacota e
// lança um FILHO que faz o trabalho. child.kill() derruba só o primeiro e o filho segue
// baixando sozinho (o X de cancelar parecia só pausar). No Windows, derruba a árvore toda.
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); return; } catch {}
  }
  // macOS/Linux: o yt-dlp roda num grupo de processos só dele (spawnOpts → detached) — mata
  // o grupo inteiro, senão o ffmpeg que ele abriu (juntando vídeo+áudio) segue rodando sozinho.
  if (!IS_WIN && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); return; } catch {}
  }
  try { child.kill(); } catch {}
}

// Opções de spawn dos processos que o killTree derruba. No Windows, as MESMAS de sempre.
const spawnOpts = IS_WIN ? { windowsHide: true } : { windowsHide: true, detached: true };

// Linha do `--print after_move:filepath` = caminho final do arquivo. No Windows começa com
// "C:\"; no macOS/Linux com "/".
const FINAL_PATH_RE = IS_WIN ? /^[A-Za-z]:[\\/].+\.\w{2,4}$/ : /^\/.+\.\w{2,4}$/;

function binDir(): string {
  const d = path.join(app.getPath('userData'), 'bin');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function ytDlpPath(): string {
  return path.join(binDir(), `yt-dlp${EXE}`);
}

// macOS/Linux: o arquivo baixado chega sem permissão de execução.
function makeExecutable(file: string): void {
  if (!IS_WIN) { try { fs.chmodSync(file, 0o755); } catch {} }
}

// Apps abertos pelo Finder/Dock no macOS herdam um PATH mínimo (/usr/bin:/bin:...), sem o
// Homebrew — o `which` não acha o ffmpeg/deno/node que o usuário instalou com brew.
const EXTRA_BIN_DIRS = IS_WIN ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

function whereExe(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where' : 'which', [name], { windowsHide: true }, (err, stdout) => {
      const first = !err && stdout ? stdout.split(/\r?\n/).find(Boolean) : undefined;
      if (first) return resolve(first.trim());
      const extra = EXTRA_BIN_DIRS.map((d) => path.join(d, name)).find((p) => fs.existsSync(p));
      resolve(extra || null);
    });
  });
}

// Follow redirects (GitHub releases redirect to a CDN) and stream to disk.
function downloadToFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    const tmp = dest + '.part';
    const fail = (e: any) => { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} reject(e); };   // limpa o .part em qualquer falha
    const req = https.get(url, { headers: { 'User-Agent': 'bah-browser' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadToFile(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return fail(new Error(`HTTP ${res.statusCode}`)); }
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      res.on('error', fail);
      file.on('finish', () => file.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch (e) { fail(e); } }));
      file.on('error', fail);
    });
    req.on('error', fail);
    // Conexão travada (rede ruim no setup) → 20s de socket ocioso aborta, em vez de "Preparando…" pra sempre.
    req.setTimeout(20000, () => req.destroy(new Error('download timeout')));
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
// Devolve a versão (null = não rodou).
function ytDlpVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    try { if (!fs.existsSync(bin) || fs.statSync(bin).size < 1_000_000) return resolve(null); }
    catch { return resolve(null); }
    let out = '';
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const child = spawn(bin, ['--version'], { windowsHide: true });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        const m = /\d{4}\.\d{2}\.\d{2}(\.\d+)?/.exec(out);
        finish(code === 0 && m ? m[0] : null);
      });
      // 30s: na 1ª execução o macOS escaneia o binário novo e um PC lento demora — estourar
      // o tempo NÃO quer dizer arquivo corrompido.
      setTimeout(() => { try { child.kill(); } catch {} finish(null); }, 30_000);
    } catch { finish(null); }
  });
}
const validateYtDlp = async (bin: string) => (await ytDlpVersion(bin)) !== null;
const YTDLP_DID_NOT_START = 'The downloaded yt-dlp did not start — try again.';

// ── macOS: yt-dlp em PASTA versionada (bin/yt-dlp-macos-<versão>/yt-dlp_macos) ──
// A pasta desempacotada não tem `-U` ("Auto-update is not supported for unpackaged
// executables"): a checagem diária baixa a versão nova numa pasta NOVA, e as antigas só
// são apagadas no 1º uso da sessão seguinte — aí nenhum yt-dlp nosso está rodando nelas.
const MAC_YTDLP_PREFIX = 'yt-dlp-macos-';
const macYtDlpExe = (dir: string) => path.join(binDir(), dir, 'yt-dlp_macos');
const versionKey = (v: string) => v.split('.').map((n) => n.padStart(4, '0')).join('.');
function macYtDlpDirs(): string[] {   // da mais nova pra mais velha
  try {
    return fs.readdirSync(binDir())
      .filter((d) => d.startsWith(MAC_YTDLP_PREFIX) && fs.existsSync(macYtDlpExe(d)))
      .sort((a, b) => versionKey(b.slice(MAC_YTDLP_PREFIX.length)).localeCompare(versionKey(a.slice(MAC_YTDLP_PREFIX.length))));
  } catch { return []; }
}

// Versão mais nova publicada: o /releases/latest redireciona pra .../tag/<versão>.
function latestYtDlpVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = https.request('https://github.com/yt-dlp/yt-dlp/releases/latest',
        { method: 'HEAD', headers: { 'User-Agent': 'bah-browser' } }, (res) => {
          res.resume();
          const m = /\/tag\/([\d.]+)$/.exec(String(res.headers.location || ''));
          resolve(m ? m[1] : null);
        });
      req.on('error', () => resolve(null));
      req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
      req.end();
    } catch { resolve(null); }
  });
}

async function installMacYtDlp(): Promise<string> {
  const zip = path.join(binDir(), 'ytdlp-macos-dl.zip');
  const extractDir = path.join(binDir(), 'ytdlp-macos-extract');   // nome fora do prefixo: nunca é "instalada"
  try {
    await downloadToFile(YTDLP_URL, zip);
    if (!(await expandZip(zip, extractDir))) throw new Error('failed to unzip yt-dlp');
    const exe = path.join(extractDir, 'yt-dlp_macos');
    makeExecutable(exe);
    const ver = await ytDlpVersion(exe);
    if (!ver) throw new Error(YTDLP_DID_NOT_START);
    const dir = MAC_YTDLP_PREFIX + ver;
    fs.rmSync(path.join(binDir(), dir), { recursive: true, force: true });
    fs.renameSync(extractDir, path.join(binDir(), dir));
    return macYtDlpExe(dir);
  } finally {
    try { fs.rmSync(zip, { force: true }); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  }
}

let macInstall: Promise<string> | null = null;
let macCleaned = false;
async function ensureMacYtDlp(onStatus?: (msg: string) => void): Promise<string> {
  const dirs = macYtDlpDirs();
  if (dirs.length) {
    if (!macCleaned) {
      macCleaned = true;
      for (const d of dirs.slice(1)) { try { fs.rmSync(path.join(binDir(), d), { recursive: true, force: true }); } catch {} }
    }
    if (macInstall || !updateDueToday()) return macYtDlpExe(dirs[0]);
    try { fs.writeFileSync(updateStampPath(), String(Date.now())); } catch {} // marca já: falha não re-tenta a cada download
    const latest = await latestYtDlpVersion();
    if (!latest || latest === dirs[0].slice(MAC_YTDLP_PREFIX.length)) return macYtDlpExe(dirs[0]);
    onStatus?.('Updating the download engine…');
    macInstall = installMacYtDlp().finally(() => { macInstall = null; });
    try { return await macInstall; } catch { return macYtDlpExe(dirs[0]); }   // falhou: segue com a atual
  }
  if (macInstall) return macInstall;
  onStatus?.('Preparing the video download engine (first time)…');
  macInstall = installMacYtDlp()
    .then((exe) => { onStatus?.('Download engine ready.'); return exe; })
    .finally(() => { macInstall = null; });
  return macInstall;
}

let ensurePromise: Promise<string> | null = null;
export async function ensureYtDlp(onStatus?: (msg: string) => void): Promise<string> {
  // Testes (só fora do app empacotado): um yt-dlp falso que simula falhas de merge.
  const fake = !app.isPackaged ? process.env.BAH_TEST_YTDLP : undefined;
  if (fake && fs.existsSync(fake)) return fake;
  if (IS_MAC) return ensureMacYtDlp(onStatus);
  const p = ytDlpPath();
  if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) {
    await maybeAutoUpdate(p, onStatus); // já instalado → checa atualização (throttled)
    return p;
  }
  if (ensurePromise) return ensurePromise;
  onStatus?.('Preparing the video download engine (first time)…');
  ensurePromise = downloadToFile(YTDLP_URL, p)
    .then(async () => {
      makeExecutable(p);
      // recém-baixado = última versão; confere que NÃO veio corrompido antes de confiar
      if (!(await validateYtDlp(p))) {
        try { fs.unlinkSync(p); } catch {}
        throw new Error(YTDLP_DID_NOT_START);
      }
      onStatus?.('Download engine ready.');
      return p;
    })
    .catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

// ── ffmpeg: detecta (baixado por nós OU do sistema) e, se faltar, baixa+descompacta ──
// Necessário pra mesclar 1080p+ (vídeo+áudio separados) e pra extrair mp3.
const ffmpegExePath = () => path.join(binDir(), `ffmpeg${EXE}`);
let ffmpegDirCache: string | null | undefined;

export function findFfmpegDir(): Promise<string | null> {
  if (ffmpegDirCache !== undefined) return Promise.resolve(ffmpegDirCache);
  // 1) já baixamos antes? (userData/bin/ffmpeg.exe — só no Windows)
  try { if (fs.existsSync(ffmpegExePath())) { ffmpegDirCache = binDir(); return Promise.resolve(ffmpegDirCache); } } catch {}
  // 2) ffmpeg do sistema (PATH, ou Homebrew no macOS)?
  return whereExe('ffmpeg').then((exe) => {
    const dir = exe ? path.dirname(exe) : null;
    // macOS/Linux: "não tem" não fica guardado — a pessoa pode rodar `brew install ffmpeg`
    // com o Bah aberto e o próximo download já usa. (No Windows o Bah baixa o ffmpeg sozinho.)
    if (dir || IS_WIN) ffmpegDirCache = dir;
    return dir;
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

// Descompacta o .zip com a ferramenta nativa do SO (sem lib nova): Expand-Archive no
// Windows, ditto no macOS, unzip no Linux.
function expandZip(zip: string, outDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    const ps = `Expand-Archive -LiteralPath ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(outDir)} -Force`;
    const [cmd, args]: [string, string[]] = IS_WIN ? ['powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]]
      : process.platform === 'darwin' ? ['/usr/bin/ditto', ['-x', '-k', zip, outDir]]
      : ['unzip', ['-o', '-q', zip, '-d', outDir]];
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn(cmd, args, { windowsHide: true });
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
  // Outros SO: só o do sistema (já tentado acima). No macOS: `brew install ffmpeg`.
  if (!IS_WIN) return null;
  if (ffmpegEnsurePromise) return ffmpegEnsurePromise;
  ffmpegEnsurePromise = (async () => {
    const zip = path.join(binDir(), 'ffmpeg-dl.zip');
    const extractDir = path.join(binDir(), 'ffmpeg-extract');
    try {
      onStatus?.('Preparing the video/audio converter (first time, ~80MB)…');
      await downloadToFile(FFMPEG_URL, zip);
      onStatus?.('Extracting ffmpeg…');
      if (!(await expandZip(zip, extractDir))) throw new Error('failed to unzip');
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

// ── Motor de JavaScript do yt-dlp (Deno): o YouTube manda um desafio em JS que o yt-dlp
// precisa resolver; sem motor, a lista de formatos até vem, mas o download dá 403. ──
export interface JsRuntime { name: 'deno' | 'node'; path: string }
const denoExePath = () => path.join(binDir(), `deno${EXE}`);

// Versão do motor (deno 2.5.1 / v24.1.0) — null se não roda.
function runtimeVersion(bin: string): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (v: [number, number, number] | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const child = spawn(bin, ['--version'], { windowsHide: true });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => finish(null));
      child.on('close', () => {
        const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
        finish(m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null);
      });
      setTimeout(() => { try { child.kill(); } catch {} finish(null); }, 15_000);
    } catch { finish(null); }
  });
}
const atLeast = (v: [number, number, number] | null, min: [number, number, number]) =>
  !!v && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
// Mínimos que o yt-dlp aceita (wiki EJS): Deno 2.3, Node 22.
const DENO_MIN: [number, number, number] = [2, 3, 0];
const NODE_MIN: [number, number, number] = [22, 0, 0];

let jsRuntimeResolved: JsRuntime | null = null;
let jsRuntimePromise: Promise<JsRuntime | null> | null = null;
/** O motor já pronto (sem esperar download) — pra listar formatos sem travar a 1ª vez. */
export function readyJsRuntime(): JsRuntime | null { return jsRuntimeResolved; }
/**
 * Garante um motor: o Deno que já baixamos → Deno do sistema → baixa o Deno (Windows,
 * macOS e Linux, ~43 MB, 1ª vez) → último recurso, Node do sistema. FAIL-SAFE: null = segue sem motor
 * (YouTube pode falhar, outros sites seguem normais).
 */
export function ensureJsRuntime(onStatus?: (msg: string) => void): Promise<JsRuntime | null> {
  if (jsRuntimeResolved) return Promise.resolve(jsRuntimeResolved);
  if (jsRuntimePromise) return jsRuntimePromise;
  jsRuntimePromise = (async (): Promise<JsRuntime | null> => {
    const own = denoExePath();
    if (fs.existsSync(own) && atLeast(await runtimeVersion(own), DENO_MIN)) return { name: 'deno', path: own };
    const sysDeno = await whereExe('deno');
    if (sysDeno && atLeast(await runtimeVersion(sysDeno), DENO_MIN)) return { name: 'deno', path: sysDeno };
    if (DENO_URL) {
      const zip = path.join(binDir(), 'deno-dl.zip');
      const extractDir = path.join(binDir(), 'deno-extract');
      try {
        onStatus?.('Preparing the YouTube engine (first time, ~43MB)…');
        await downloadToFile(DENO_URL, zip);
        if (!(await expandZip(zip, extractDir))) throw new Error('failed to unzip');
        const exe = findFileRecursive(extractDir, `deno${EXE}`);
        if (!exe) throw new Error('deno not found in the package');
        fs.copyFileSync(exe, own);
        makeExecutable(own);
        if (!atLeast(await runtimeVersion(own), DENO_MIN)) { try { fs.unlinkSync(own); } catch {} throw new Error('downloaded deno is invalid'); }
        return { name: 'deno', path: own };
      } catch {
        /* cai pro Node do sistema, se houver */
      } finally {
        try { fs.rmSync(zip, { force: true }); } catch {}
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      }
    }
    const sysNode = await whereExe('node');
    if (sysNode && atLeast(await runtimeVersion(sysNode), NODE_MIN)) return { name: 'node', path: sysNode };
    return null;
  })().then((r) => { jsRuntimeResolved = r; jsRuntimePromise = null; return r; });
  return jsRuntimePromise;
}
const jsRuntimeArgs = (rt: JsRuntime | null): string[] => rt ? ['--js-runtimes', `${rt.name}:${rt.path}`] : [];
const isYoutubeTarget = (url: string) => /^ytsearch\d*:/i.test(url) || /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(url);

/**
 * JSON completo do vídeo (`yt-dlp -J`): título, duração e a lista de formatos — sem baixar.
 * Usa o motor de JS se já estiver pronto; se não, lista sem ele (a lista vem igual) e
 * deixa o motor se preparando em segundo plano pro download que vem depois.
 */
/** Cookies do site (arquivo Netscape), Referer da página e o User-Agent do Bah. */
export interface SiteAccess { cookiesFile?: string; referer?: string; userAgent?: string }
const siteArgs = (a: SiteAccess = {}): string[] => [
  ...(a.cookiesFile ? ['--cookies', a.cookiesFile] : []),
  ...(a.referer ? ['--referer', a.referer] : []),
  ...(a.userAgent ? ['--user-agent', a.userAgent] : []),
];

export async function fetchVideoInfo(url: string, access?: SiteAccess & { firstOnly?: boolean }): Promise<{ ok: boolean; info?: any; error?: string }> {
  let bin: string;
  try { bin = await ensureYtDlp(); } catch (e: any) { return { ok: false, error: `yt-dlp unavailable: ${e?.message ?? e}` }; }
  const rt = readyJsRuntime();
  if (!rt && isYoutubeTarget(url)) ensureJsRuntime().catch(() => {});
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    let errTail = '';
    let done = false;
    // firstOnly: página com dezenas de vídeos (playlist do g1, carrossel) → só o 1º é lido;
    // sem isso o -J extrai TODOS e passa de um minuto.
    const child = spawn(bin, ['-J', '--no-playlist', '--no-warnings', '--no-color', ...(access?.firstOnly ? ['--playlist-items', '1'] : []),
      ...jsRuntimeArgs(rt), ...siteArgs(access), url], spawnOpts);
    const finish = (r: { ok: boolean; info?: any; error?: string }) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, error: 'timeout reading the video' }); }, 60_000);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { errTail = (errTail + d.toString()).slice(-600); });
    child.on('error', (e) => finish({ ok: false, error: String((e as any)?.message ?? e) }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: errTail.split(/\r?\n/).filter(Boolean).pop() || `yt-dlp exited with code ${code}` });
      // -J sai em ASCII (\uXXXX), então título com acento chega certo.
      try { finish({ ok: true, info: JSON.parse(Buffer.concat(out).toString('utf8')) }); }
      catch { finish({ ok: false, error: 'unreadable video info' }); }
    });
  });
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

// ── Downloads em andamento: matar no Sair e limpar no próximo boot ──
// O yt-dlp roda em grupo de processos próprio (detached) → NÃO morre junto com o Bah. Ficava
// órfão, morria no 1º print com o pipe quebrado e deixava o pedaço de vídeo (.f313.webm,
// sem som) em Downloads com cara de arquivo pronto.
const activeChildren = new Set<ChildProcess>();
let shuttingDown = false;
/** Sair do Bah: derruba todos os yt-dlp (e o ffmpeg deles). O diário fica pro próximo boot. */
export function stopAllMediaDownloads(): void {
  shuttingDown = true;
  for (const c of activeChildren) killTree(c);
}

const journalFile = () => path.join(app.getPath('userData'), 'media-downloads.json');
function journalEdit(fn: (es: JournalEntry[]) => JournalEntry[]): void {
  const f = journalFile();
  writeJournal(f, fn(readJournal(f)));
}
const journalPatch = (id: string, patch: (e: JournalEntry) => void) =>
  journalEdit(es => es.map(e => { if (e.id === id) patch(e); return e; }));

// O pid anotado ainda é o NOSSO yt-dlp (pid reaproveitado pelo sistema não pode morrer)?
function looksLikeOurYtDlp(pid: number): boolean {
  if (IS_WIN || !(pid > 1)) return false;
  try {
    const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 });
    return /yt-dlp/i.test(r.stdout || '');
  } catch { return false; }
}

/**
 * Boot: downloads que ficaram no diário foram interrompidos (o Bah fechou ou caiu no meio).
 * Para o yt-dlp órfão, apaga SÓ os arquivos que aquele download anotou como seus, na pasta
 * dele, e devolve as entradas (pra lista de Downloads mostrar "Interrompido" com ↻).
 */
export function recoverInterruptedDownloads(): JournalEntry[] {
  const f = journalFile();
  const entries = readJournal(f);
  if (!entries.length) return [];
  for (const e of entries) {
    if (e.pid && looksLikeOurYtDlp(e.pid)) { try { process.kill(-e.pid, 'SIGTERM'); } catch {} }
    for (const p of leftoversToDelete(e, (x) => { try { return fs.statSync(x); } catch { return null; } })) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
  writeJournal(f, []);
  return entries;
}

// Apaga com algumas tentativas: no Windows o arquivo fica preso um instante depois que o processo morre.
async function removeFiles(files: string[]): Promise<void> {
  for (const f of files) {
    for (let i = 0; i < 6; i++) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); break; }
      catch { await new Promise(r => setTimeout(r, 500)); }
    }
  }
}

function runTool(bin: string, args: string[], ms: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const finish = (code: number | null) => { if (!done) { done = true; resolve({ code, out, err }); } };
    try {
      const child = spawn(bin, args, { windowsHide: true });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-20000); });
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code));
      setTimeout(() => { try { child.kill(); } catch {} finish(null); }, ms);
    } catch { finish(null); }
  });
}

/** Que faixas o arquivo tem (ffprobe do mesmo ffmpeg; sem ffprobe, o `ffmpeg -i`). null = não deu pra ver. */
export async function probeStreams(ffmpegDir: string, file: string): Promise<StreamProbe | null> {
  const ffprobe = path.join(ffmpegDir, `ffprobe${EXE}`);
  if (fs.existsSync(ffprobe)) {
    const r = await runTool(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', file], 30_000);
    if (r.code === 0) return parseFfprobeStreams(r.out);
  }
  const ffmpeg = path.join(ffmpegDir, `ffmpeg${EXE}`);
  if (!fs.existsSync(ffmpeg)) return null;
  const r = await runTool(ffmpeg, ['-hide_banner', '-i', file], 30_000);   // sai ≠ 0 (sem saída), mas lista as faixas
  const p = parseFfmpegInfo(r.err);
  return p.video || p.audio ? p : null;
}

/**
 * O yt-dlp baixou as duas partes mas não juntou: junta nós mesmos (-c copy, sem reconverter).
 * MP4 quando os codecs cabem; senão (ou se o MP4 falhar) MKV. Nunca sobrescreve arquivo que já existe.
 */
async function mergeParts(ffmpegDir: string, video: string, audio: string, base: string, vcodec: string, acodec: string): Promise<string | null> {
  const ffmpeg = path.join(ffmpegDir, `ffmpeg${EXE}`);
  const first = mergeContainer(vcodec, acodec);
  for (const container of first === 'mp4' ? (['mp4', 'mkv'] as const) : (['mkv'] as const)) {
    const out = `${base}.${container}`;
    if (fs.existsSync(out)) continue;
    const tmp = `${base}.temp.${container}`;
    const r = await runTool(ffmpeg, ffmpegMergeArgs(video, audio, tmp, container), 15 * 60_000);
    if (r.code === 0 && fs.existsSync(tmp) && !fs.existsSync(out)) {
      try { fs.renameSync(tmp, out); return out; } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
  return null;
}

export const NOT_MERGED_ERROR = 'The audio and video parts were not joined, so the download did not finish.';
export const NO_AUDIO_ERROR = 'The downloaded video has no sound track.';
export const INTERRUPTED_ERROR = 'The download was interrupted when Bah closed.';
export type DownloadFailReason = 'not-merged' | 'no-audio' | 'interrupted';

export interface VideoDownloadProgress {
  state: 'preparing' | 'downloading' | 'merging' | 'completed' | 'failed';
  percent?: number;
  title?: string;
  path?: string;
  error?: string;
  speed?: string;
  eta?: string;
  // Números crus da parte que está baixando (vídeo OU áudio — `part` é o format_id).
  bytes?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSec?: number;
  part?: string;
}

export interface VideoDownloadResult {
  success: boolean; path?: string; paths?: string[]; title?: string; error?: string; cancelled?: boolean; partials?: string[];
  reason?: DownloadFailReason;
  warning?: 'source-has-no-audio';
}

/**
 * Baixa um vídeo. Resolve com o caminho final. Reporta progresso via onProgress.
 * audioOnly extrai mp3 (com ffmpeg) ou, sem ffmpeg, salva o áudio como veio (geralmente m4a).
 * resolution: baixa NAQUELA resolução (lado menor, ex. 1080) — botão "Baixar" do YouTube.
 * niceNames: nome de arquivo com o título de verdade (acentos/espaços) + a resolução.
 * signal: cancelar mata o yt-dlp; os arquivos pela metade deste download são apagados aqui.
 * jobId/journalMeta: entrada no diário (o que "tentar de novo" precisa depois de reabrir o Bah).
 */
export async function downloadVideo(
  url: string,
  opts: SiteAccess & {
    audioOnly?: boolean; count?: number; quality?: 'best' | 'low'; resolution?: number; niceNames?: boolean; signal?: AbortSignal;
    titleOverride?: string;   // stream sem título bom ("index.m3u8") → nome do arquivo = título da página
    firstOnly?: boolean;      // post com várias mídias: só a primeira (a mesma da lista)
    jobId?: string;
    journalMeta?: unknown;
  },
  onProgress: (p: VideoDownloadProgress) => void,
): Promise<VideoDownloadResult> {
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
  // YouTube sem motor de JS = 403 no download. Fail-safe: sem motor, tenta mesmo assim.
  const jsRuntime = isYoutubeTarget(url)
    ? await ensureJsRuntime((m) => onProgress({ state: 'preparing', title: m })).catch(() => null)
    : null;
  if (opts.signal?.aborted) return { success: false, error: 'cancelled', cancelled: true };
  const outDir = getDownloadDir();
  const resTag = opts.resolution && !opts.audioOnly ? ` (${opts.resolution}p)` : '';
  // Título da página vira nome de arquivo: tira o que o Windows não aceita e escapa o %
  // (o -o do yt-dlp é um template — "100%" viraria campo).
  const pageTitle = (opts.titleOverride || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 150).replace(/%/g, '%%');
  const outTmpl = path.join(outDir, pageTitle ? `${pageTitle}${resTag}.%(ext)s`
    : opts.niceNames ? `%(title).150B${resTag} [%(id)s].%(ext)s` : '%(title).120B [%(id)s].%(ext)s');

  // Seleção de formato/áudio — compartilhada por TODAS as rotas.
  const toolArgs: string[] = [...jsRuntimeArgs(jsRuntime)];
  if (ffmpegDir) toolArgs.push('--ffmpeg-location', ffmpegDir);
  const fmtArgs: string[] = [];
  if (opts.audioOnly) {
    // Faixa só de áudio quando existe (YouTube). Stream com áudio colado no vídeo (HLS de
    // site comum) não tem: aí baixa até 480p — o áudio é o mesmo AAC e o download cai de
    // ~450 MB (1080p) pra ~60 MB.
    if (ffmpegDir) fmtArgs.push('-f', 'ba/b[height<=480]/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
    // Sem ffmpeg (Mac sem `brew install ffmpeg`, ou o download do ffmpeg falhou) não dá pra
    // virar mp3 — antes o download inteiro falhava no fim. Agora salva o áudio como veio (m4a).
    else fmtArgs.push('-f', 'ba[ext=m4a]/ba/b[height<=480]/b');
  } else if (opts.resolution) {
    fmtArgs.push(...selectorArgs(opts.resolution, !!ffmpegDir));
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
  // Nome bonito (niceNames) troca o --restrict-filenames por --encoding utf-8: sem isso o
  // yt-dlp imprime o caminho em cp1252 e "VIOLÃO" chegaria quebrado.
  // --no-quiet: o --print liga o modo quieto e some com as linhas "Destination:"/"Merging" —
  // sem elas o Bah não sabia que arquivos ESTE download escreveu (nem pra limpar).
  const baseArgs = (allowPlaylist: boolean, sel: string[] = fmtArgs): string[] => [
    ...(allowPlaylist ? [] : ['--no-playlist']),
    '--no-part', ...(opts.niceNames ? ['--encoding', 'utf-8'] : ['--restrict-filenames']), '--no-color', '--progress', '--no-quiet',
    '--progress-template', 'DLPROG:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s'
      + '|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s',
    '-o', outTmpl,
    '--print', 'after_move:filepath',
    // De onde veio cada arquivo final (busca "ytsearch" → o vídeo de verdade), pra tentar de novo.
    '--print', `after_move:BAHSRC\t%(webpage_url)s\t%(filepath)s`,
    ...siteArgs(opts),
    ...(opts.firstOnly ? ['--playlist-items', '1'] : []),
    ...toolArgs,
    ...sel,
  ];

  const count = Math.min(Math.max(opts.count || 1, 1), 50);   // quantas pegar (N músicas, teto 50)
  const isSearch = /^ytsearch\d*:/i.test(url);
  const query = isSearch ? url.replace(/^ytsearch\d*:/i, '').trim() : '';
  const DURATION = 'duration >= 60 & duration <= 1200';       // pula Shorts (<1min) e mixes (>20min)

  // Diário: se o Bah fechar no meio, o próximo boot sabe o que este download escreveu.
  const jobId = opts.jobId || `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  journalEdit(es => [...es.filter(e => e.id !== jobId), { id: jobId, dir: outDir, startedAt: Date.now(), files: [], meta: opts.journalMeta }]);

  interface RunResult {
    ok: boolean; paths: string[]; title: string; err?: string; cancelled?: boolean;
    exitCode: number | null; written: string[]; doneParts: Set<string>; sources: Map<string, string>;
  }

  // ── Um disparo do yt-dlp: spawn + parse de progresso/saída → { ok, paths, title } ──
  // priorCount: quantas já vieram em disparos anteriores (só pro rótulo "i/N").
  // expect: quantas ESTE disparo deve trazer (pro fallback por filesystem).
  const runYtDlp = (
    runArgs: string[],
    priorCount: number,
    expect: number,
  ): Promise<RunResult> =>
    new Promise((resolveRun) => {
      const paths: string[] = [];
      const written: string[] = [];          // o que ESTE disparo escreveu (pra limpar/conferir)
      const doneParts = new Set<string>();   // format_id que chegaram a 100%
      const sources = new Map<string, string>();
      const startedAt = Date.now();
      let lastActivity = startedAt;   // pra detectar yt-dlp travado (sem nenhuma saída)
      let title = '';
      let stderrTail = '';
      let seenMerge = false;
      let settled = false;
      const child = spawn(bin, runArgs, spawnOpts);
      activeChildren.add(child);
      if (child.pid) journalPatch(jobId, (e) => { e.pid = child.pid; });
      const resolve = (r: Omit<RunResult, 'written' | 'doneParts' | 'sources'>) => {
        if (settled) return;
        settled = true;
        activeChildren.delete(child);
        resolveRun({ ...r, written, doneParts, sources });
      };
      // Cancelar (botão ✕ em Downloads): derruba a árvore e só responde quando o processo
      // morreu de fato — aí os arquivos pela metade já estão soltos pra apagar.
      let aborted = false;
      const cancelledResult = () => ({ ok: false, paths, title, err: 'cancelled', cancelled: true, exitCode: null });
      const onAbort = () => {
        aborted = true;
        killTree(child);
        setTimeout(() => resolve(cancelledResult()), 5000);   // rede de segurança se o 'close' não vier
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      // Sem deadline o yt-dlp pode travar pra sempre (vídeo bloqueado/rede parada) e prender a fila.
      // 2 min SEM nenhuma saída = travado → mata (download lento mas em progresso não dispara).
      const idleKill = setInterval(() => {
        if (Date.now() - lastActivity > 120000) {
          clearInterval(idleKill);
          killTree(child);
          resolve({ ok: false, paths, title, err: 'yt-dlp stalled (no output for 2 min) — canceled', exitCode: null });
        }
      }, 15000);
      const num = (s: string | undefined) => { const n = parseFloat(String(s ?? '')); return Number.isFinite(n) ? n : undefined; };
      const noteWritten = (p: string) => {
        if (written.includes(p)) return;
        written.push(p);
        journalPatch(jobId, (e) => { if (!e.files.includes(p)) e.files.push(p); });
      };

      const handleLine = (raw: string) => {
        if (aborted) return;   // depois do cancelar, nada de "progresso" ressuscitando a barra
        // O yt-dlp põe um "apaga a linha" (\x1b[K) na frente do caminho do --print, mesmo com
        // --no-color — sem tirar isso o caminho final nunca era reconhecido e tudo dependia da
        // varredura da pasta (um vídeo que já estava em Downloads dava "Nothing was downloaded.").
        const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
        if (!line) return;
        lastActivity = Date.now();
        const m = line.match(/DLPROG:\s*([\d.]+)%\|([^|]*)\|([^|]*)(?:\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*))?$/);
        if (m) {
          const part = m[8]?.trim() || undefined;
          if (part && parseFloat(m[1]) >= 100) doneParts.add(part);
          const done = priorCount + paths.length + 1;
          const label = count > 1 ? `${title} (${Math.min(done, count)}/${count})` : title;
          onProgress({
            state: 'downloading', percent: parseFloat(m[1]), speed: m[2].trim(), eta: m[3].trim(), title: label,
            bytes: num(m[4]), totalBytes: num(m[5]), speedBps: num(m[6]), etaSec: num(m[7]), part,
          });
          return;
        }
        const src = /^BAHSRC\t([^\t]*)\t(.+)$/.exec(line);
        if (src) { sources.set(src[2].trim(), src[1].trim()); return; }
        if (/\[Merger\]|\[ExtractAudio\]|Merging formats/i.test(line) && !seenMerge) {
          seenMerge = true;
          onProgress({ state: 'merging', percent: 99, title });
        }
        // Arquivos que o yt-dlp começou a escrever (pedaços e o MP4 juntado): com --no-part
        // eles ficariam pela metade em Downloads se cancelar/falhar/fechar o Bah.
        const dest = line.match(/Destination: (.+)$/) || line.match(/Merging formats into "(.+)"$/);
        if (dest) noteWritten(dest[1].trim());
        // O merge grava antes num "X.temp.mp4" e só depois renomeia: fechar no meio deixa esse.
        const merging = line.match(/Merging formats into "(.+)\.([A-Za-z0-9]{2,5})"$/);
        if (merging) noteWritten(`${merging[1]}.temp.${merging[2]}`);
        const t = line.match(/Destination: .*[\\/](.+?) \[/);
        if (t) { title = t[1]; seenMerge = false; }
        if (FINAL_PATH_RE.test(line) && !paths.includes(line)) {
          paths.push(line);
          // Arquivo final pronto: sai do diário (fechar o Bah depois não pode apagá-lo).
          journalPatch(jobId, (e) => { e.files = e.files.filter(f => f !== line); });
        }
      };

      const leftovers: Array<() => void> = [];
      const mkSink = () => {
        let buf = '';
        // Decodificador por fluxo: um acento partido entre dois pedaços não vira "�".
        const dec = new StringDecoder('utf8');
        leftovers.push(() => { buf += dec.end(); if (buf) handleLine(buf); buf = ''; });
        return (d: Buffer) => {
          buf += dec.write(d);
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

      child.on('error', (e) => { clearInterval(idleKill); opts.signal?.removeEventListener('abort', onAbort); resolve({ ok: false, paths, title, err: String((e as any)?.message ?? e), exitCode: null }); });
      child.on('close', (code) => {
        clearInterval(idleKill);
        opts.signal?.removeEventListener('abort', onAbort);
        leftovers.forEach(fl => { try { fl(); } catch {} });
        if (aborted) return resolve(cancelledResult());
        // 101 = MaxDownloadsReached (do nosso --max-downloads): isso é SUCESSO.
        if (code === 0 || code === 101) {
          if (paths.length < expect) {
            // As linhas --print podem se perder entre updates \r — confia no filesystem:
            // arquivos de mídia criados depois que ESTE disparo começou são deste disparo.
            // Pedaço .fNNN e arquivo de trabalho (.temp.mp4) nunca entram.
            try {
              fs.readdirSync(outDir)
                .filter(f => isFinalMedia(f))
                .map(f => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
                .filter(x => x.t >= startedAt - 2000)
                .sort((a, b) => b.t - a.t)
                .slice(0, expect)
                .forEach(x => { if (!paths.includes(x.p)) paths.push(x.p); });
            } catch {}
          }
          resolve({ ok: true, paths, title, exitCode: code });
        } else {
          const err = stderrTail.split(/\r?\n/).filter(Boolean).pop() || `yt-dlp exited with code ${code}`;
          resolve({ ok: false, paths, title, err, exitCode: code });
        }
      });
    });

  // ── Depois de cada disparo: o que é resultado de verdade, o que juntar, o que apagar ──
  let notMerged = false;
  const settle = async (r: RunResult): Promise<RunResult> => {
    const out = classifyRun({ exitCode: r.exitCode, cancelled: r.cancelled, reported: r.paths, written: r.written, exists: (p) => fs.existsSync(p) });
    const finals = [...out.finals];
    let cleanup = out.cleanup;
    if (out.verdict === 'not-merged' && ffmpegDir && !r.cancelled && !shuttingDown) {
      // Pedaço completo = chegou a 100% no progresso, ou o yt-dlp saiu bem (baixou tudo, só não juntou).
      const exitOk = r.exitCode === 0 || r.exitCode === 101;
      const parts = await Promise.all(out.components.map(async (p) => ({
        path: p,
        probe: await probeStreams(ffmpegDir, p),
        complete: exitOk || r.doneParts.has(componentInfo(p)?.formatId || ''),
      })));
      const pair = pairForMerge(parts);
      if (pair) {
        const vp = parts.find(x => x.path === pair.video)!.probe!, ap = parts.find(x => x.path === pair.audio)!.probe!;
        onProgress({ state: 'merging', percent: 99, title: r.title });
        const merged = await mergeParts(ffmpegDir, pair.video, pair.audio, pair.base, vp.video || '', ap.audio || '');
        if (merged) {
          finals.push(merged);
          cleanup = cleanup.filter(p => p !== merged);
          const src = r.sources.get(pair.base + '.mp4') || [...r.sources.values()][0];
          if (src) r.sources.set(merged, src);
        }
      }
    }
    if (out.verdict === 'not-merged' && !finals.length) notMerged = true;
    await removeFiles(cleanup.filter(p => !finals.includes(p)));
    return { ...r, paths: finals, err: out.verdict === 'not-merged' && !finals.length ? NOT_MERGED_ERROR : r.err };
  };
  const run = async (runArgs: string[], priorCount: number, expect: number) => settle(await runYtDlp(runArgs, priorCount, expect));

  // ── Orquestração das rotas (com rede de segurança) ───────────────────────────
  const cancelled = () => !!opts.signal?.aborted;
  const all: string[] = [];
  const sources = new Map<string, string>();
  const addPaths = (r: RunResult) => {
    for (const p of r.paths) if (!all.includes(p)) all.push(p);
    for (const [k, v] of r.sources) sources.set(k, v);
  };
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
    const r = await run(
      [...baseArgs(true), '--download-archive', archive, '--match-filter', DURATION, '--max-downloads', String(count), plUrl],
      0, count,
    );
    addPaths(r);
    if (!r.ok || !r.paths.length) lastErr = r.err || lastErr;
  }

  // ROTA 2 — busca de vídeos (ytsearch). É o CASO NORMAL (1 música / nomeada) e também o
  // FALLBACK automático: roda quando ainda falta música (playlist falhou ou trouxe menos).
  if (all.length < count && isSearch && !cancelled() && !shuttingDown) {
    const need = count - all.length;
    const pool = Math.min(need * 3 + 8, 60);   // poço largo: o filtro de duração pula Shorts/mixes
    const searchArgs = [...baseArgs(false)];
    if (usePlaylistRoute) searchArgs.push('--download-archive', archive);   // não repete a faixa da playlist
    searchArgs.push('--match-filter', DURATION, '--max-downloads', String(need), url.replace(/^ytsearch\d*:/i, `ytsearch${pool}:`));
    if (all.length > 0) onProgress({ state: 'preparing', title: 'Completing via normal search…' });
    const r = await run(searchArgs, all.length, need);
    addPaths(r);
    if ((!r.ok || !r.paths.length) && all.length === 0) lastErr = r.err || lastErr;
  }

  // ROTA DIRETA — URL real (página de vídeo / aba atual): baixa esse vídeo (igual antes).
  if (all.length === 0 && !isSearch && !cancelled() && !shuttingDown) {
    const r = await run([...baseArgs(false), url], 0, count);
    addPaths(r);
    if (!r.ok || !r.paths.length) lastErr = r.err || lastErr;
  }

  try { fs.unlinkSync(archive); } catch {}

  // ── Vídeo normal TEM que ter som. Sem faixa de áudio: tenta 1× com um seletor que garante
  // áudio; se a origem não tem áudio nenhum, entrega avisando; senão é falha (nunca sucesso calado).
  let warning: VideoDownloadResult['warning'];
  let noAudio = false;
  if (all.length && ffmpegDir && needsAudioCheck(opts) && !cancelled() && !shuttingDown) {
    for (const file of [...all]) {
      const probe = await probeStreams(ffmpegDir, file);
      if (!probe || !probe.video || probe.audio) continue;   // não deu pra ver / só áudio / tem som
      const src = sources.get(file) || (!isSearch ? url : '');
      let fixed = false;
      let sourceSilent = false;
      if (src && /^https?:\/\//i.test(src)) {
        const strict = ['-f', 'bv*+ba/b[acodec!=none]', ...(opts.resolution ? ['-S', `res:${opts.resolution},+codec:avc:m4a`] : []),
          '--merge-output-format', 'mp4', '--force-overwrites'];
        onProgress({ state: 'preparing', title: 'The video came without sound — trying again…' });
        const r = await run([...baseArgs(false, strict), src], 0, 1);
        const again = r.paths[0];
        const p2 = again ? await probeStreams(ffmpegDir, again) : null;
        if (again && p2?.audio) {
          if (again !== file) await removeFiles([file]);
          all.splice(all.indexOf(file), 1, again);
          fixed = true;
        } else if (!again && looksFormatUnavailable(r.err) && fs.existsSync(file)) {
          sourceSilent = true;   // a origem não tem NENHUM formato com áudio (vídeo mudo de verdade)
        } else if (again && again !== file && !p2?.audio) {
          await removeFiles([again]);
        }
      }
      if (fixed) continue;
      if (sourceSilent) { warning = 'source-has-no-audio'; continue; }
      await removeFiles([file]);
      all.splice(all.indexOf(file), 1);
      noAudio = true;
    }
  }

  // Terminou (bem ou mal, já limpo): sai do diário. No Sair do Bah fica — o próximo boot
  // mostra "Interrompido" e limpa o que sobrar.
  if (!shuttingDown) journalEdit(es => es.filter(e => e.id !== jobId));

  if (cancelled()) return { success: false, error: 'cancelled', cancelled: true, partials: [] };
  if (all.length > 0) {
    const first = all[0];
    const name = path.basename(first);
    onProgress({ state: 'completed', percent: 100, title: name, path: first });
    return { success: true, path: first, paths: all, title: name, warning };
  }
  const reason: DownloadFailReason | undefined = shuttingDown ? 'interrupted' : noAudio ? 'no-audio' : notMerged ? 'not-merged' : undefined;
  const error = reason === 'interrupted' ? INTERRUPTED_ERROR : reason === 'no-audio' ? NO_AUDIO_ERROR
    : reason === 'not-merged' ? NOT_MERGED_ERROR : (lastErr || 'Nothing was downloaded.');
  onProgress({ state: 'failed', error });
  return { success: false, error, reason, partials: [] };
}
