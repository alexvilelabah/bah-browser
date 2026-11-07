// memory-saver.ts — regras PURAS da Economia de memória (o "Memory Saver" do Chrome). Sem React,
// sem DOM, sem electron: o App.tsx (varredura), o menu e os testes (tests/unit/memory-saver.test.ts)
// usam a MESMA conta.
//  • Níveis: o Chrome tem Moderado / Equilibrado / Máximo e não publica os tempos. Os do Bah são
//    escolha nossa: 2 h, 30 min (o comportamento antigo) e 10 min parada.
//  • Nunca dorme (igual ao Chrome): aba ativa, fixada, tocando áudio/vídeo (mesmo mudo), usando
//    câmera/microfone/tela, site com notificações permitidas, download em andamento que saiu dela,
//    formulário preenchido pela metade, dispositivo USB/HID/serial/Bluetooth conectado, e os sites
//    da lista "Manter estes sites sempre ativos".
//  • Do Bah: aba anônima/escondida e aba cuja SESSÃO tem tarefa do agente rodando ou esperando a
//    pessoa (cartão de confirmação, perguntas, login).
import { canDiscard } from './incognito.ts';

export type MemSaverLevel = 'moderate' | 'balanced' | 'maximum';
export const MEM_SAVER_LEVELS: readonly MemSaverLevel[] = ['moderate', 'balanced', 'maximum'];
export const DEFAULT_LEVEL: MemSaverLevel = 'balanced';

const MIN = 60 * 1000;
export const LEVEL_IDLE_MS: Record<MemSaverLevel, number> = {
  moderate: 120 * MIN,
  balanced: 30 * MIN,
  maximum: 10 * MIN,
};

export function sanitizeLevel(v: unknown): MemSaverLevel {
  return MEM_SAVER_LEVELS.includes(v as MemSaverLevel) ? (v as MemSaverLevel) : DEFAULT_LEVEL;
}

/** Tempo parada até dormir; `overrideMs` (> 0) é o atalho dos testes (localStorage memSaverIdleMs). */
export function idleMsFor(level: MemSaverLevel, overrideMs?: number): number {
  return overrideMs && overrideMs > 0 ? overrideMs : LEVEL_IDLE_MS[sanitizeLevel(level)];
}

// ── "Manter estes sites sempre ativos" ──
// Regras do Chrome: "google.com" vale pro domínio E subdomínios; ".google.com" só o domínio exato;
// "[*.]google.com" / "*.google.com" = o mesmo que sem nada; pode ter caminho ("site.com/app").
// Esquema (http/https) e porta, se escritos, também precisam bater.

export interface KeepRule { scheme?: string; host: string; exact: boolean; port?: string; path?: string }

export const MAX_KEEP_SITES = 200;

/** Lê uma entrada digitada. null = inválida. */
export function parseKeepEntry(raw: string): KeepRule | null {
  let s = String(raw || '').trim().toLowerCase();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  let scheme: string | undefined;
  const m = /^([a-z][a-z0-9+.-]*):\/\//.exec(s);
  if (m) {
    if (m[1] !== 'http' && m[1] !== 'https') return null;
    scheme = m[1]; s = s.slice(m[0].length);
  }
  let exact = false;
  if (s.startsWith('[*.]')) s = s.slice(4);
  else if (s.startsWith('*.')) s = s.slice(2);
  else if (s.startsWith('.')) { exact = true; s = s.slice(1); }
  const slash = s.indexOf('/');
  let hostPort = slash >= 0 ? s.slice(0, slash) : s;
  let path = slash >= 0 ? s.slice(slash) : '';
  path = path.replace(/[?#].*$/, '').replace(/\/+$/, '');
  let port: string | undefined;
  const pm = /:(\d{1,5})$/.exec(hostPort);
  if (pm) { port = pm[1]; hostPort = hostPort.slice(0, -pm[0].length); }
  const host = hostPort.replace(/\.$/, '');
  // Domínio "normal" ou IPv4; o resto (curinga no meio, caractere estranho) não é entrada válida.
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || host.split('.').some(l => !l || l.startsWith('-') || l.endsWith('-'))) {
    // IDN: deixa o URL converter pra punycode e tenta de novo.
    let puny = '';
    try { puny = new URL('http://' + host).hostname; } catch { return null; }
    if (!puny || puny === host || !/^[a-z0-9.-]+$/.test(puny)) return null;
    return parseKeepEntry((scheme ? scheme + '://' : '') + (exact ? '.' : '') + puny + (port ? ':' + port : '') + path);
  }
  return { scheme, host, exact, ...(port ? { port } : {}), ...(path ? { path } : {}) };
}

/** Forma guardada/mostrada de uma entrada (null = inválida). */
export function normalizeKeepEntry(raw: string): string | null {
  const r = parseKeepEntry(raw);
  if (!r) return null;
  return (r.scheme ? r.scheme + '://' : '') + (r.exact ? '.' : '') + r.host + (r.port ? ':' + r.port : '') + (r.path || '');
}

/** A lista guardada, limpa: só entradas válidas, sem repetição, no máximo MAX_KEEP_SITES. */
export function sanitizeKeepList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const n = typeof x === 'string' ? normalizeKeepEntry(x) : null;
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= MAX_KEEP_SITES) break;
  }
  return out;
}

export function ruleMatches(rule: KeepRule, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (rule.scheme && u.protocol !== rule.scheme + ':') return false;
  if (rule.port && u.port !== rule.port) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (rule.exact ? host !== rule.host : host !== rule.host && !host.endsWith('.' + rule.host)) return false;
  if (rule.path) {
    // Caminho casa no começo e em fronteira de segmento ("/app" pega "/app/x", não "/apple").
    const p = u.pathname.toLowerCase();
    if (p !== rule.path && !p.startsWith(rule.path + '/')) return false;
  }
  return true;
}

export function matchesKeepList(url: string, list: readonly string[]): boolean {
  for (const e of list) {
    const r = parseKeepEntry(e);
    if (r && ruleMatches(r, url)) return true;
  }
  return false;
}

/** O que o botão "Adicionar este site" grava pra uma URL (null = não é site http/https). */
export function keepEntryForUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return normalizeKeepEntry(u.hostname);
  } catch { return null; }
}

// ── Decisão por aba ──

export interface SweepTab {
  id: string; url?: string; pinned?: boolean; incognito?: boolean; hidden?: boolean;
  discarded?: boolean; lastActiveAt?: number;
}

/** Sinais que só a página/main sabem; colhidos só pras abas que já passaram nas regras baratas. */
export interface TabSignals {
  audible?: boolean;        // tocando som (Chromium)
  playingMedia?: boolean;   // <video>/<audio> tocando, mesmo mudo
  capture?: boolean;        // câmera, microfone ou tela em uso
  notifications?: boolean;  // site com notificações permitidas
  download?: boolean;       // download em andamento que começou nesta aba
  formDirty?: boolean;      // formulário preenchido pela metade
  device?: boolean;         // USB/HID/serial/Bluetooth conectado
}

export type KeepReason =
  | 'active' | 'discarded' | 'private' | 'pinned' | 'recent' | 'agent' | 'keepSite'
  | 'media' | 'capture' | 'notifications' | 'download' | 'form' | 'device';

export interface SweepCtx {
  now: number; idleMs: number; activeId: string | null;
  /** A sessão desta aba tem tarefa do agente rodando ou esperando a pessoa. */
  agentBusy?: boolean;
  keepList: readonly string[];
}

/**
 * Regras baratas (sem falar com a página). null = candidata: falta só olhar os sinais.
 * A ordem importa pouco pra decisão, mas o motivo devolvido aparece no tooltip.
 */
export function cheapKeepReason(tab: SweepTab, ctx: SweepCtx): KeepReason | null {
  if (tab.discarded) return 'discarded';
  if (tab.id === ctx.activeId) return 'active';
  if (!canDiscard(tab)) return 'private';   // anônima/escondida (shared/incognito.ts)
  if (tab.pinned) return 'pinned';
  if (ctx.agentBusy) return 'agent';
  if (tab.url && matchesKeepList(tab.url, ctx.keepList)) return 'keepSite';
  if (ctx.now - (tab.lastActiveAt || ctx.now) < ctx.idleMs) return 'recent';
  return null;
}

export function signalKeepReason(s: TabSignals | null | undefined): KeepReason | null {
  if (!s) return null;
  if (s.audible || s.playingMedia) return 'media';
  if (s.capture) return 'capture';
  if (s.download) return 'download';
  if (s.formDirty) return 'form';
  if (s.device) return 'device';
  if (s.notifications) return 'notifications';
  return null;
}

/** Decisão completa: null = pode dormir. */
export function keepReason(tab: SweepTab, ctx: SweepCtx, signals?: TabSignals | null): KeepReason | null {
  return cheapKeepReason(tab, ctx) ?? signalKeepReason(signals);
}

/** Motivos que valem mostrar no tooltip ("mantida ativa: …"). */
export function isShownReason(r: KeepReason | null | undefined): r is KeepReason {
  return !!r && r !== 'active' && r !== 'discarded' && r !== 'private' && r !== 'recent';
}

/**
 * Script que roda NA ABA (mundo da página ou isolado) e devolve os sinais que só ela sabe.
 * Formulário: compara value/checked/selected com os defaults do HTML; ignora hidden, search e botões.
 * Dispositivo: só conta o que está ABERTO/conectado agora (não só "já teve permissão").
 */
export const PAGE_SIGNALS_SCRIPT = `(async () => {
  const r = { formDirty: false, playingMedia: false, capture: false, device: false };
  try {
    const skip = { hidden: 1, search: 1, submit: 1, button: 1, reset: 1, image: 1 };
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.disabled) continue;
      const tag = el.tagName;
      if (tag === 'INPUT') {
        const ty = String(el.type || 'text').toLowerCase();
        if (skip[ty]) continue;
        if (ty === 'checkbox' || ty === 'radio') { if (el.checked !== el.defaultChecked) { r.formDirty = true; break; } continue; }
        if (ty === 'file') { if (el.files && el.files.length) { r.formDirty = true; break; } continue; }
        if (el.value !== el.defaultValue) { r.formDirty = true; break; }
      } else if (tag === 'TEXTAREA') {
        if (el.value !== el.defaultValue) { r.formDirty = true; break; }
      } else if (tag === 'SELECT') {
        const opts = Array.from(el.options);
        const hasDefault = opts.some(o => o.defaultSelected);
        if (hasDefault || el.multiple) { if (opts.some(o => o.selected !== o.defaultSelected)) { r.formDirty = true; break; } }
        else if (opts.length && el.selectedIndex !== 0) { r.formDirty = true; break; }
      }
    }
  } catch (e) {}
  try {
    for (const m of document.querySelectorAll('video, audio')) {
      if (!m.paused && !m.ended && m.readyState > 2) r.playingMedia = true;
      const so = m.srcObject;
      if (so && typeof so.getTracks === 'function' && so.getTracks().some(t => t.readyState === 'live')) r.capture = true;
    }
  } catch (e) {}
  try {
    const n = navigator;
    const wait = (p) => Promise.race([Promise.resolve(p).catch(() => []), new Promise(res => setTimeout(() => res([]), 500))]);
    const [hid, usb, serial, bt] = await Promise.all([
      n.hid ? wait(n.hid.getDevices()) : [],
      n.usb ? wait(n.usb.getDevices()) : [],
      n.serial ? wait(n.serial.getPorts()) : [],
      n.bluetooth && n.bluetooth.getDevices ? wait(n.bluetooth.getDevices()) : [],
    ]);
    r.device = hid.some(d => d.opened) || usb.some(d => d.opened)
      || serial.some(p => !!p.readable || !!p.writable) || bt.some(d => d.gatt && d.gatt.connected);
  } catch (e) {}
  return r;
})()`;
