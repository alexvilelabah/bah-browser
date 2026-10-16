// session-restore.ts — regras PURAS do "Continuar de onde parou" (⋮ → Ao abrir o Bah), igual ao
// Chrome. Sem React, sem DOM, sem electron: o renderer (renderer/session.ts) e os testes
// (tests/unit/session-restore.test.ts) usam a MESMA conta.
//  • O que salvar: as abas da barra (nunca as escondidas, de trabalho do agente, nem as anônimas),
//    na ordem da barra, com endereço, nome e se é fixada — e qual é a ativa. Só http/https: about:blank, data:,
//    file: (tabelas do Bah), chrome://, chrome-extension://, o player de torrent do próprio Bah
//    (porta que muda a cada vez) e endereço com usuário:senha não voltam. Teto de abas e de texto.
//  • A ativa depois de filtrar: se ela mesma não volta, assume a vizinha que sobrou (direita,
//    senão esquerda) — a mesma regra de fechar a aba ativa. Passou do teto de abas: a ativa fica.
//  • Ler o que veio do disco (pode estar velho, estragado ou editado à mão): fixadas sempre
//    primeiro. A lista antiga só das fixadas (pinnedTabs.v1) vira sessão uma vez; uma sessão
//    válida ganha dela (as duas juntas duplicariam as fixadas).
//  • O que abrir no boot: "Continuar de onde parou" com abas salvas → elas, e só a ativa carrega;
//    senão o de sempre: as fixadas + uma aba nova, que é a ativa.

import { sanitizePinned } from './tab-strip.ts';

export type StartupMode = 'newtab' | 'restore';
/** Padrão pra todo mundo (igual ao Chrome): abrir uma aba nova. */
export const DEFAULT_STARTUP_MODE: StartupMode = 'newtab';

export const MAX_SESSION_TABS = 100;
export const MAX_SESSION_URL = 8192;
export const MAX_SESSION_TITLE = 300;
const MAX_SCAN = 1000;   // lista estragada enorme: não percorre além disso

export interface SessionTab { url: string; title: string; pinned?: boolean }
/** active = posição da ativa em tabs; -1 só quando não sobrou aba nenhuma. */
export interface SavedSession { tabs: SessionTab[]; active: number }
/** O que interessa de uma aba viva do renderer. */
export interface SessionSource { id: string; url: string; title?: string; pinned?: boolean; hidden?: boolean; incognito?: boolean }

/** Escolha salva → 'restore' ou o padrão (qualquer outra coisa, inclusive nada salvo). */
export function normalizeStartupMode(raw: unknown): StartupMode {
  return raw === 'restore' ? 'restore' : DEFAULT_STARTUP_MODE;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/** Esse endereço volta na próxima vez? */
export function restorableUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url || url.length > MAX_SESSION_URL) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return false;
  if (u.username || u.password) return false;   // senha no endereço não vai pro disco
  if (LOOPBACK.test(u.hostname) && u.pathname.startsWith('/webtorrent/')) return false;
  return true;
}

function toSessionTab(raw: unknown): SessionTab | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { url?: unknown; title?: unknown; pinned?: unknown };
  if (!restorableUrl(r.url)) return null;
  const title = typeof r.title === 'string' ? r.title.slice(0, MAX_SESSION_TITLE) : '';
  return r.pinned === true ? { url: r.url, title, pinned: true } : { url: r.url, title };
}

// Monta a sessão a partir da lista (na ordem) e da posição da ativa nela (-1 = não se sabe).
function build(list: readonly unknown[], activePos: number): SavedSession {
  const kept: SessionTab[] = [];
  const at: number[] = [];   // posição de cada uma na lista original
  const n = Math.min(list.length, MAX_SCAN);
  for (let i = 0; i < n; i++) {
    const s = toSessionTab(list[i]);
    if (s) { kept.push(s); at.push(i); }
  }
  if (!kept.length) return { tabs: [], active: -1 };
  // A própria ativa ou a 1ª que sobrou à direita dela; nenhuma à direita (ou não se sabe qual
  // era) → a última que sobrou, que é a vizinha da esquerda.
  let active = activePos >= 0 ? at.findIndex(i => i >= activePos) : -1;
  if (active < 0) active = kept.length - 1;
  // Teto: as primeiras da barra — a ativa entra mesmo se passou (no lugar da última que cabia).
  let tabs = kept;
  if (tabs.length > MAX_SESSION_TABS) {
    if (active < MAX_SESSION_TABS) tabs = tabs.slice(0, MAX_SESSION_TABS);
    else { tabs = [...tabs.slice(0, MAX_SESSION_TABS - 1), tabs[active]]; active = MAX_SESSION_TABS - 1; }
  }
  // Fixadas primeiro (a barra garante; o disco pode não garantir), sem mudar a ordem entre elas.
  const order = tabs.map((_, i) => i).sort((a, b) => Number(!tabs[a].pinned) - Number(!tabs[b].pinned) || a - b);
  return { tabs: order.map(i => tabs[i]), active: order.indexOf(active) };
}

/** O que gravar: as abas da barra (sem as escondidas), na ordem, e qual é a ativa. Aba anônima
 *  nunca vai pro disco — mas fica na conta da posição: se ela é a ativa, assume a vizinha. */
export function sessionToSave(tabs: readonly SessionSource[], activeId: string): SavedSession {
  const strip = tabs.filter(t => !t.hidden);
  return build(
    strip.map(t => (t.incognito ? null : { url: t.url, title: t.title, pinned: t.pinned })),
    strip.findIndex(t => t.id === activeId),
  );
}

/** Sessão que veio do disco → só o que presta. null = nem parece uma sessão (estragada). */
export function sanitizeSession(raw: unknown): SavedSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(r.tabs)) return null;
  const a = r.active;
  return build(r.tabs, typeof a === 'number' && Number.isInteger(a) && a >= 0 ? a : -1);
}

/** Texto que vai pro localStorage. */
export function serializeSession(s: SavedSession): string {
  return JSON.stringify({ v: 1, active: s.active, tabs: s.tabs });
}

/** O que estava gravado: a sessão; se ela não existe ou estragou, a lista antiga só das fixadas
 *  (migração). Uma sessão válida, mesmo vazia, ganha sempre: nunca as duas juntas. */
export function loadSession(rawSession: string | null, rawOldPinned: string | null): SavedSession | null {
  if (rawSession) {
    try { const s = sanitizeSession(JSON.parse(rawSession)); if (s) return s; } catch {}
  }
  if (rawOldPinned) {
    try {
      const old = sanitizePinned(JSON.parse(rawOldPinned));
      if (old.length) return build(old.map(p => ({ ...p, pinned: true })), -1);
    } catch {}
  }
  return null;
}

export interface BootTab extends SessionTab {
  active: boolean;   // a aba ativa do boot
  lazy: boolean;     // não carrega agora: só quando alguém clicar nela
}

/** Abas do boot. newTab = abrir também a aba nova de sempre (que aí é a ativa). */
export function bootPlan(mode: StartupMode, saved: SavedSession | null): { tabs: BootTab[]; newTab: boolean } {
  if (mode === 'restore' && saved && saved.tabs.length) {
    const n = saved.tabs.length;
    const active = saved.active >= 0 && saved.active < n ? saved.active : n - 1;
    return { tabs: saved.tabs.map((t, i) => ({ ...t, active: i === active, lazy: i !== active })), newTab: false };
  }
  // O de sempre: as fixadas da última vez (carregam já, como antes) + a aba nova.
  const pinned = saved ? saved.tabs.filter(t => t.pinned) : [];
  return { tabs: pinned.map(t => ({ ...t, active: false, lazy: false })), newTab: true };
}

/** Nome da aba antes de carregar: o salvo; sem nome, o site (sem "www."). */
export function sessionTitle(t: SessionTab): string {
  const title = t.title.trim();
  if (title) return title;
  try { return new URL(t.url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

/** O "esqueleto" da sessão (endereços, fixadas e a ativa), sem os nomes: mudou → vale mandar pro
 *  disco na hora. Só o nome mudou (relógio, contador de mensagens no título) → não precisa. */
export function sessionShape(s: SavedSession): string {
  return JSON.stringify([s.active, s.tabs.map(t => [t.url, t.pinned === true])]);
}
