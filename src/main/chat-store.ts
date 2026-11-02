// Conversas do assistente no disco: a conversa VIVA (volta só com "Continuar de onde parou") e o 🕘
// histórico de conversas (fica com qualquer escolha, como o histórico de navegação). O texto das
// conversas é pessoal: fica SÓ neste computador, cifrado pelo cofre do sistema (safeStorage), como o
// perfil do candidato. Sem cofre disponível → não grava (as conversas ficam só na memória).
// Regras (o que entra, tetos, anônimo nunca) em shared/chat-history.ts; quem chama é só a tela do Bah.
import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  sanitizeLive, sanitizeHistory, upsertHistory, historyRows, removeHistorySince, capHistory,
  liveToSave, historyEntryFor, type ChatHistoryEntry, type LiveState, type LiveTab,
} from '../shared/chat-history';
import type { Thread } from '../shared/thread-store';
import type { AgentSession } from '../shared/agent-sessions';

const liveFile = () => path.join(app.getPath('userData'), 'threads-live.enc');
const historyFile = () => path.join(app.getPath('userData'), 'chat-history.enc');

function readEnc(file: string): unknown {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch { return null; }
}
function writeEnc(file: string, data: unknown): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try { fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(data))); fs.renameSync(file + '.tmp', file); return true; } catch { return false; }
}

let historyCache: ChatHistoryEntry[] | null = null;
const loadHistory = (): ChatHistoryEntry[] => (historyCache ??= sanitizeHistory(readEnc(historyFile())));
function saveHistory(list: ChatHistoryEntry[]): void {
  historyCache = capHistory(list);
  if (!historyCache.length) { try { fs.rmSync(historyFile(), { force: true }); } catch {} return; }
  writeEnc(historyFile(), historyCache);
}

interface SavePayload { sessions: AgentSession[]; threads: Thread[]; tabs: LiveTab[] }

/** A tela manda o estado vivo: grava a conversa viva e atualiza o histórico das sessões. As regras
 *  rodam DE NOVO aqui (anônimo fora, tetos): o main não confia no que chegou. */
function saveLive(raw: unknown): void {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<SavePayload>;
  const tabs: LiveTab[] = Array.isArray(p.tabs) ? p.tabs.filter((t: any) => t && typeof t.id === 'string').slice(0, 500).map((t: any) => ({
    id: t.id, url: typeof t.url === 'string' ? t.url : '', title: typeof t.title === 'string' ? t.title : '',
    sessionId: typeof t.sessionId === 'string' ? t.sessionId : undefined, incognito: t.incognito === true, hidden: t.hidden === true,
  })) : [];
  const clean = sanitizeLive({ sessions: p.sessions, threads: p.threads });
  const live: LiveState = liveToSave(clean.threads, clean.sessions, tabs);
  if (live.sessions.length || live.threads.length) writeEnc(liveFile(), live);
  else { try { fs.rmSync(liveFile(), { force: true }); } catch {} }
  let list = loadHistory();
  let changed = false;
  for (const s of live.sessions) {
    const e = historyEntryFor(s, live.threads.find(t => t.key === s.id), tabs);
    if (!e) continue;
    const old = list.find(x => x.id === e.id);
    if (old && old.endedAt === e.endedAt && old.name === e.name && old.color === e.color && old.tabs.length === e.tabs.length) continue;
    list = upsertHistory(list, e);
    changed = true;
  }
  if (changed) saveHistory(list);
}

export function setupChatStore(getWindow: () => BrowserWindow | null): void {
  const fromUi = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => e.sender === getWindow()?.webContents;
  // Síncrono: as abas do boot (store.ts) nascem já presas às sessões salvas.
  ipcMain.on('threads:load-live-sync', (e) => {
    if (!fromUi(e)) { e.returnValue = null; return; }
    e.returnValue = sanitizeLive(readEnc(liveFile()));
  });
  // send (não invoke): ao fechar a janela, chega ANTES do "gravei" da sessão (mesma fila).
  ipcMain.on('threads:save-live', (e, payload: unknown) => { if (fromUi(e)) saveLive(payload); });
  ipcMain.handle('threads:clear-live', (e) => { if (fromUi(e)) { try { fs.rmSync(liveFile(), { force: true }); } catch {} } return { ok: true }; });
  ipcMain.handle('chat-history:list', (e) => (fromUi(e) ? { rows: historyRows(loadHistory()), available: safeStorage.isEncryptionAvailable() } : { rows: [], available: false }));
  ipcMain.handle('chat-history:get', (e, id: unknown) => {
    if (!fromUi(e) || typeof id !== 'string') return null;
    return loadHistory().find(x => x.id === id) ?? null;
  });
  ipcMain.handle('chat-history:delete', (e, id: unknown) => {
    if (!fromUi(e) || typeof id !== 'string') return { ok: false };
    saveHistory(loadHistory().filter(x => x.id !== id));
    return { ok: true };
  });
  // "Limpar dados de navegação": since em ms; null = todo o período.
  ipcMain.handle('chat-history:clear', (e, since: unknown) => {
    if (!fromUi(e)) return { ok: false };
    saveHistory(removeHistorySince(loadHistory(), typeof since === 'number' && Number.isFinite(since) ? since : -Infinity));
    return { ok: true };
  });
}
