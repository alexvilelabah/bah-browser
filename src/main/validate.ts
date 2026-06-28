// ─────────────────────────────────────────────────────────────────────────────
// IPC VALIDATORS — small, pure helpers to check inputs of the sensitive handlers
// (URL, count, path). Defense in depth: doesn't change success behavior, only
// rejects clearly invalid/dangerous input.
// ─────────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';

/** Valid http(s) URL. */
export function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false;
  try { new URL(u); return true; } catch { return false; }
}

/** http(s) OR a yt-dlp search target ("ytsearch5:..."). */
export function isHttpOrSearch(u: unknown): u is string {
  return isHttpUrl(u) || (typeof u === 'string' && /^ytsearch\d*:/i.test(u));
}

/** Integer clamped to [min,max]; uses `def` if invalid. */
export function clampCount(n: unknown, min: number, max: number, def: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(v, min), max);
}

/** Is the resolved path INSIDE one of the allowed roots? (anti path-escape) */
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

/** Is it a file (existing, not a directory)? */
export function isExistingFile(p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
