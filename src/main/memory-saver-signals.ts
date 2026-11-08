// Economia de memória: o que só o main sabe de cada aba (a varredura do renderer pergunta só
// pelas abas que já passaram nas regras baratas de shared/memory-saver.ts).
//  • capture: câmera/microfone/tela liberados nesta página (site-permissions.ts);
//  • notifications: o site tem notificações permitidas;
//  • download: download em andamento que saiu desta aba (download-manager.ts).
import { ipcMain, webContents } from 'electron';

export interface MainTabSignals { capture?: boolean; notifications?: boolean; download?: boolean }

export function setupMemorySaverSignals(deps: {
  isCapturing: (wcId: number) => boolean;
  notificationsAllowed: (url: string) => boolean;
  downloadWcIds: () => Set<number>;
}) {
  ipcMain.handle('memsaver:signals', (_e, ids: unknown) => {
    const out: Record<number, MainTabSignals> = {};
    if (!Array.isArray(ids)) return out;
    const dl = deps.downloadWcIds();
    for (const raw of ids.slice(0, 500)) {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) continue;
      let url = '';
      try { url = webContents.fromId(id)?.getURL() || ''; } catch {}
      out[id] = {
        capture: deps.isCapturing(id),
        notifications: !!url && deps.notificationsAllowed(url),
        download: dl.has(id),
      };
    }
    return out;
  });
}
