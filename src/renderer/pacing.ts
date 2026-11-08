// Ritmo por site: o agente clicava a cada 2–4s em ritmo regular e a Amazon passou a tratar como
// robô. Entre ações do agente no MESMO host: espera ALEATÓRIA de 1–5s (sorteada a cada ação, então
// nenhuma sequência sai com intervalo igual); depois que o site mostra checagem anti-robô, espera
// bem maior (também aleatória) por um tempo. Só deixa o agente mais lento — não burla desafio.
export const MIN_GAP_MS = 1_000;
export const MAX_GAP_MS = 5_000;
export const BACKOFF_MIN_MS = 15_000;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_FOR_MS = 30 * 60_000;

interface HostState { next: number; until: number }
const hosts = new Map<string, HostState>();
let rng: () => number = Math.random;

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

const between = (a: number, b: number) => Math.round(a + rng() * (b - a));

/** Quanto esperar (ms) antes da próxima ação neste host. */
export function paceDelay(host: string, now = Date.now()): number {
  const h = hosts.get(host);
  return host && h ? Math.max(0, h.next - now) : 0;
}

/** Registra a ação agora e sorteia quando a PRÓXIMA pode acontecer. */
export function recordHit(host: string, now = Date.now()): void {
  if (!host) return;
  const h = hosts.get(host) || { next: 0, until: 0 };
  h.next = now + (now < h.until ? between(BACKOFF_MIN_MS, BACKOFF_MAX_MS) : between(MIN_GAP_MS, MAX_GAP_MS));
  hosts.set(host, h);
}

/** O site mostrou checagem anti-robô: esperas maiores por um tempo. */
export function backoff(host: string, now = Date.now()): void {
  if (!host) return;
  const h = hosts.get(host) || { next: 0, until: 0 };
  h.until = now + BACKOFF_FOR_MS;
  h.next = Math.max(h.next, now + between(BACKOFF_MIN_MS, BACKOFF_MAX_MS));
  hosts.set(host, h);
}

export function isBackedOff(host: string, now = Date.now()): boolean {
  const h = hosts.get(host);
  return !!h && now < h.until;
}

export function _resetPacingForTests(random: () => number = Math.random): void { hosts.clear(); rng = random; }

/** Texto de checagem anti-robô comum (Amazon, Google, Cloudflare, genéricos). */
export const BOT_CHECK_RE = /robot check|not a robot|n[aã]o sou um rob[oô]|enter the characters you see|automated access|unusual traffic|tr[aá]fego incomum|verify you are human|just a moment|checking your browser|are you a human|press (and|&) hold|captcha/i;
