// ─────────────────────────────────────────────────────────────────────────────
// IMAGE HARVESTER — baixa N imagens em paralelo numa subpasta temática do Downloads.
// A COLHEITA das URLs roda no webview (mesma origem do buscador → sem 403); aqui é só
// o download paralelo (main tem fs/rede). Guerrilha: a web pública é o nosso acervo.
//
// Nota: baixar imagens é função normal de navegador; o usuário dirige, nós executamos.
// Pós-auditoria: bloqueia SVG (pode ter script), teto de URLs, pré-checa Content-Length,
// limpa .part em erro/abort (corrige o caso "oversize"), usa stream.pipeline e limita a
// concorrência por host (educado + evita bloqueio). Mesmo resultado, mais seguro.
// ─────────────────────────────────────────────────────────────────────────────
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { pipeline } from 'stream';

// Mesma blindagem do download:url — nunca salvar executável/script disfarçado. SVG entra
// aqui porque pode carregar <script> (e não é "foto" de verdade pro nosso uso).
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|apk|dll|sh|svg)(\?|$)/i;
const IMG_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif',   // svg removido de propósito
};
const MAX_BYTES = 25 * 1024 * 1024;   // teto por imagem
const MAX_URLS = 120;                  // teto de URLs por colheita (anti-runaway)
const CONCURRENCY = 5;                 // downloads simultâneos (global)
const MAX_PER_HOST = 2;               // simultâneos por host (educado, evita bloqueio)

function slugify(s: string): string {
  return (s || 'imagens').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'imagens';
}

function extFromUrl(u: string): string {
  const m = u.split('?')[0].match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

// Baixa uma URL pra um caminho-base (sem extensão); resolve a ext por content-type.
function fetchOne(url: string, basePath: string, redirects = 0): Promise<string | null> {
  return new Promise((resolve) => {
    if (redirects > 5 || BLOCKED_EXT.test(url)) return resolve(null);
    let lib: typeof https | typeof http;
    try { lib = url.startsWith('http:') ? http : https; } catch { return resolve(null); }
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
        'Referer': 'https://duckduckgo.com/',
      },
      timeout: 15000,
    }, (res) => {
      // redirect
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return resolve(fetchOne(next, basePath, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const ct = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct && !ct.startsWith('image/')) { res.resume(); return resolve(null); }       // só imagem
      if (ct === 'image/svg+xml') { res.resume(); return resolve(null); }               // SVG bloqueado
      // pré-checa o tamanho declarado: pula gigantes antes de baixar
      const declared = Number(res.headers['content-length'] || 0);
      if (declared && declared > MAX_BYTES) { res.resume(); return resolve(null); }

      const ext = IMG_EXT[ct] || extFromUrl(url) || 'jpg';
      const dest = `${basePath}.${ext}`;
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      let bytes = 0, aborted = false;
      const cleanup = () => { try { fs.unlinkSync(tmp); } catch {} };

      res.on('data', (c) => { bytes += c.length; if (bytes > MAX_BYTES) { aborted = true; req.destroy(); } }); // cap por streaming

      // pipeline cuida do encadeamento + fecha os streams; trata erro/abort de forma limpa
      pipeline(res, file, (err) => {
        if (err || aborted) { cleanup(); return resolve(null); }          // erro/oversize → SEM .part
        if (bytes < 2000) { cleanup(); return resolve(null); }            // lixo/1px
        try { fs.renameSync(tmp, dest); resolve(dest); } catch { cleanup(); resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));   // o .part (se criado) some no callback do pipeline
  });
}

export interface HarvestResult {
  success: boolean;
  saved: number;
  dir?: string;
  paths?: string[];   // caminhos salvos (pra miniaturas no feed)
  error?: string;
}

/**
 * Baixa as URLs em paralelo (concorrência global + por host) em Downloads/<tema>/.
 * Retorna quantas salvou de fato e a pasta.
 */
export async function harvestDownload(
  urls: string[],
  theme: string,
  onProgress?: (saved: number, total: number) => void,
): Promise<HarvestResult> {
  const clean = Array.from(new Set((urls || []).filter(u => /^https?:\/\//i.test(u)))).slice(0, MAX_URLS);
  if (clean.length === 0) return { success: false, saved: 0, error: 'Nenhuma URL de imagem para baixar.' };

  const dir = path.join(app.getPath('downloads'), slugify(theme));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e: any) {
    return { success: false, saved: 0, error: `Não consegui criar a pasta: ${e?.message ?? e}` };
  }

  const paths: string[] = [];
  const pad = (n: number) => String(n).padStart(3, '0');
  const queue = clean.slice();           // fila mutável de URLs
  const hostCount = new Map<string, number>();
  let seq = 0;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  async function worker() {
    while (true) {
      // pega a próxima URL cujo host ainda não está no limite por host
      let pick = -1;
      for (let i = 0; i < queue.length; i++) {
        if ((hostCount.get(hostOf(queue[i])) || 0) < MAX_PER_HOST) { pick = i; break; }
      }
      if (pick === -1) {
        if (queue.length === 0) return;     // acabou
        await sleep(50); continue;          // todos os hosts restantes saturados → espera um tico
      }
      const url = queue.splice(pick, 1)[0];
      const h = hostOf(url);
      hostCount.set(h, (hostCount.get(h) || 0) + 1);
      const n = ++seq;
      try {
        const out = await fetchOne(url, path.join(dir, `img-${pad(n)}`));
        if (out) { paths.push(out); onProgress?.(paths.length, clean.length); }
      } finally {
        hostCount.set(h, Math.max(0, (hostCount.get(h) || 1) - 1));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, clean.length) }, worker));

  paths.sort();
  return { success: paths.length > 0, saved: paths.length, dir, paths };
}
