// ─────────────────────────────────────────────────────────────────────────────
// VALIDADORES DE IPC — helpers pequenos e puros pra checar entradas dos handlers
// sensíveis (URL, contagem, caminho). Defesa em profundidade: não muda comportamento
// de sucesso, só rejeita entrada claramente inválida/perigosa.
// ─────────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';

/** URL http(s) válida. */
export function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false;
  try { new URL(u); return true; } catch { return false; }
}

/** http(s) OU alvo de busca do yt-dlp ("ytsearch5:..."). */
export function isHttpOrSearch(u: unknown): u is string {
  return isHttpUrl(u) || (typeof u === 'string' && /^ytsearch\d*:/i.test(u));
}

/** Inteiro preso entre [min,max]; usa `def` se inválido. */
export function clampCount(n: unknown, min: number, max: number, def: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(v, min), max);
}

/** O caminho resolvido está DENTRO de alguma das raízes permitidas? (anti path-escape) */
export function isInsideAllowedRoot(target: unknown, roots: string[]): boolean {
  if (typeof target !== 'string' || !target) return false;
  let resolved: string;
  try { resolved = path.resolve(target); } catch { return false; }
  const norm = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  for (const root of roots) {
    if (!root) continue;
    let r: string;
    try { r = path.resolve(root); } catch { continue; }
    const rn = process.platform === 'win32' ? r.toLowerCase() : r;
    const withSep = rn.endsWith(path.sep) ? rn : rn + path.sep;
    if (norm === rn || norm.startsWith(withSep)) return true;
  }
  return false;
}

/** É um arquivo (existente, não diretório)? */
export function isExistingFile(p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
