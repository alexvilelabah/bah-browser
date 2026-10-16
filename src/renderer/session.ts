// "Continuar de onde parou" (⋮ → Ao abrir o Bah), igual ao Chrome. A escolha e a última sessão
// ficam no localStorage, como os outros ajustes da interface; as regras (o que salvar, ler o que
// veio do disco, o que abrir no boot) estão em shared/session-restore.ts.
//  • Grava SEMPRE, com a opção ligada ou não: ligar depois já traz a última sessão.
//  • No máximo 1 s depois da primeira mudança, sem recomeçar a espera a cada mudança: um título
//    que muda sem parar (relógio, contador de mensagens) não adia a gravação pra sempre.
//  • Ao fechar a janela, grava na hora: o main pede antes de mandar tudo pro disco
//    (session:save-now) e o beforeunload/pagehide cobrem o resto.
//  • Mudou aba, endereço, ordem, fixada ou a ativa → pede ao main pra mandar o localStorage pro
//    disco já (sem esperar o lote do Chromium, que pode levar um minuto): se o Bah cair, perde
//    ~1 s. Esse "já" leva junto TUDO o que a interface mudou (o histórico inteiro é regravado a
//    cada navegação), então no máximo 1 pedido a cada 2 s — página que troca o endereço sem
//    parar (mapa sendo arrastado) não vira gravação em disco contínua. Só o nome mudou → fica
//    pro lote normal.
import {
  loadSession, normalizeStartupMode, serializeSession, sessionShape, sessionToSave,
  type SavedSession, type SessionSource, type StartupMode,
} from '../shared/session-restore';

const MODE_KEY = 'startupMode';
const SESSION_KEY = 'session.v1';
const OLD_PINNED_KEY = 'pinnedTabs.v1';   // lista antiga só das fixadas: migra uma vez e sai
const SAVE_DELAY_MS = 1000;
const DISK_GAP_MS = 2000;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

// Pede ao main pra mandar o localStorage pro disco: na hora, ou assim que fizer 2 s do último pedido.
let lastDiskAt = 0;
let diskTimer: ReturnType<typeof setTimeout> | null = null;
function requestDiskFlush(): void {
  if (diskTimer) return;   // já tem um marcado: ele leva esta mudança junto
  const go = () => {
    diskTimer = null;
    lastDiskAt = Date.now();
    try { window.electronAPI?.flushUiStorage?.(); } catch {}
  };
  const wait = lastDiskAt + DISK_GAP_MS - Date.now();
  if (wait <= 0) go(); else diskTimer = setTimeout(go, wait);
}

// ── A escolha (⋮ → Ao abrir o Bah) ──

let mode: StartupMode = normalizeStartupMode(read(MODE_KEY));
const listeners = new Set<() => void>();

export function getStartupMode(): StartupMode { return mode; }

/** Troca a escolha. Vale a partir da próxima vez que o Bah abrir. */
export function setStartupMode(next: StartupMode): void {
  mode = normalizeStartupMode(next);
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  requestDiskFlush();
  listeners.forEach(fn => { try { fn(); } catch {} });
}

export function onStartupModeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── A sessão ──

let lastJson: string | null = null;   // o que está gravado (não regrava igual)
let lastShape = '';                   // o esqueleto que já foi pedido pro disco
let dropOldPinned = read(OLD_PINNED_KEY) !== null;

/** A última sessão gravada (ou a lista antiga das fixadas, migrada). null = nenhuma ou estragada. */
export function loadSavedSession(): SavedSession | null {
  const raw = read(SESSION_KEY);
  const s = loadSession(raw, read(OLD_PINNED_KEY));
  lastJson = raw;
  lastShape = s ? sessionShape(s) : '';
  return s;
}

let latest: { tabs: readonly SessionSource[]; activeId: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** As abas mudaram: grava daqui a no máximo 1 s. */
export function noteSession(tabs: readonly SessionSource[], activeId: string): void {
  latest = { tabs, activeId };
  if (!timer) timer = setTimeout(flushSession, SAVE_DELAY_MS);
}

/** Grava agora, se mudou. */
export function flushSession(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!latest) return;
  const s = sessionToSave(latest.tabs, latest.activeId);
  const json = serializeSession(s);
  if (json !== lastJson) {
    // Não coube (localStorage cheio): fica a sessão anterior; tenta de novo na próxima mudança.
    try { localStorage.setItem(SESSION_KEY, json); } catch { return; }
    lastJson = json;
  }
  // A sessão já está gravada: a lista antiga das fixadas não serve mais (senão duplicaria).
  if (dropOldPinned) { dropOldPinned = false; try { localStorage.removeItem(OLD_PINNED_KEY); } catch {} }
  const shape = sessionShape(s);
  if (shape !== lastShape) { lastShape = shape; requestDiskFlush(); }
}

/** Grava na hora quando a janela vai fechar. Devolve o "desligar". */
export function watchSessionClose(): () => void {
  const flush = () => flushSession();
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  const off = window.electronAPI?.onSaveSessionNow?.(flush);
  return () => {
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('pagehide', flush);
    try { off?.(); } catch {}
  };
}
