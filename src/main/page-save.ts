// save_pdf / screenshot de página inteira / área de transferência — ações do agente (batch 8 de paridade).
// Arquivos vão pra pasta de downloads (a mesma do resto do Bah); o agente recebe o caminho.
import { clipboard, ipcMain, webContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDownloadDir } from './download-dir';

function uniquePath(dir: string, base: string, ext: string): string {
  const clean = (base || 'page').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'page';
  let p = path.join(dir, `${clean}${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${clean} (${i})${ext}`);
  return p;
}

export function setupPageSave(ensureDebugger: (wc: Electron.WebContents, id: number) => Promise<void>): void {
  ipcMain.handle('agent:save-pdf', async (_e, wcId: number, name?: string) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { success: false, error: 'tab not found' };
    try {
      const data = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
      const p = uniquePath(getDownloadDir(), name || wc.getTitle(), '.pdf');
      fs.writeFileSync(p, data);
      return { success: true, info: { path: p, bytes: data.length } };
    } catch (e: any) { return { success: false, error: String(e?.message || e) }; }
  });

  ipcMain.handle('agent:screenshot', async (_e, wcId: number, full: boolean, name?: string) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { success: false, error: 'tab not found' };
    try {
      await ensureDebugger(wc, wcId);
      let png: Buffer;
      if (full) {
        const m = await wc.debugger.sendCommand('Page.getLayoutMetrics') as any;
        const w = Math.ceil(m.cssContentSize?.width || m.contentSize.width), h = Math.min(Math.ceil(m.cssContentSize?.height || m.contentSize.height), 16000);
        const r = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }) as any;
        png = Buffer.from(r.data, 'base64');
      } else {
        png = (await wc.capturePage()).toPNG();
      }
      const p = uniquePath(getDownloadDir(), name || `${wc.getTitle()} screenshot`, '.png');
      fs.writeFileSync(p, png);
      return { success: true, info: { path: p, bytes: png.length, fullPage: !!full } };
    } catch (e: any) { return { success: false, error: String(e?.message || e) }; }
  });

  // Ler só depois da permissão (o renderer pergunta). Escrever é livre (é o agente entregando um resultado).
  ipcMain.handle('clipboard:read-text', async () => String(await clipboard.readText()).slice(0, 4000));   // Electron 44+: readText é assíncrono
  ipcMain.handle('clipboard:write-text', (_e, text: string) => { clipboard.writeText(String(text ?? '')); return { success: true, info: { chars: String(text ?? '').length } }; });
}
