// Imprimir… (Ctrl+P / Cmd+P) e Salvar como PDF… (menu ⋮), igual ao Chrome. Sempre na página da
// ABA ATIVA (o webContents do <webview>), nunca na interface do Bah. O renderer diz qual aba é
// (wcId); aqui confere que é mesmo uma aba da janela principal antes de mexer.
//  • Imprimir: abre o diálogo de impressão do sistema (webContents.print, silent:false).
//  • PDF: diálogo "Salvar como" (nome = título da página, pasta = Downloads), printToPDF, grava,
//    e a linha aparece no painel de Downloads (Ctrl+J) com "abrir arquivo"/"mostrar na pasta".
// O window.print() da própria página já cai no mesmo gerenciador de impressão do Electron
// (o mesmo do webview.print()), então não precisa de calço aqui.
import { app, dialog, ipcMain, webContents, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { pdfFileName, paperSizeFor, printableKind } from '../shared/print-pdf';
import { getDownloadDir, rememberSavedFile } from './download-dir';

export type PrintError = 'no-tab' | 'empty' | 'internal' | 'crashed' | 'failed' | 'pdf-failed' | 'write-failed' | 'timeout' | 'canceled' | 'busy';
export type PrintResult = { ok: true } | { ok: false; error: PrintError };
export type SavePdfResult = { ok: true; file: string; path: string } | { ok: true; downloaded: true } | { ok: false; error: PrintError };

// Visualizador de PDF do Chromium (extensão embutida): a aba mostra um arquivo PDF, não uma página.
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const PDF_TIMEOUT_MS = 120_000;   // página que nunca termina de virar PDF não prende o botão pra sempre

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// A aba mostra o visualizador de PDF? (o documento de fora é "application/pdf" e/ou tem o quadro da extensão)
async function showsPdfViewer(wc: WebContents): Promise<boolean> {
  try {
    if (wc.mainFrame.framesInSubtree.some(f => { try { return f.url.startsWith(PDF_VIEWER_ORIGIN); } catch { return false; } })) return true;
  } catch {}
  try {
    const ct = await withTimeout(wc.executeJavaScript('document.contentType', false), 1500);
    return ct === 'application/pdf';
  } catch { return false; }
}

// Papel padrão pelo país do computador (Carta nos EUA/Canadá/México…, A4 no resto).
function defaultPaper(): 'A4' | 'Letter' {
  const hints: string[] = [];
  try { hints.push(app.getLocaleCountryCode()); } catch {}
  try { hints.push(app.getSystemLocale()); } catch {}
  try { hints.push(app.getLocale()); } catch {}
  return paperSizeFor(...hints);
}

export function setupPagePrint(deps: { getMainWindow: () => BrowserWindow | null; t: (key: string, vars?: Record<string, string>) => string }): void {
  const win = () => { const mw = deps.getMainWindow(); return mw && !mw.isDestroyed() ? mw : null; };
  const fromMainWindow = (e: IpcMainInvokeEvent) => { const mw = win(); return !!mw && e.sender === mw.webContents; };
  const busy = new Set<number>();   // um PDF por aba de cada vez (clique duplo não abre 2 diálogos)
  let lastPdfDir: string | undefined;

  // Só aceita uma ABA (webview) da janela principal — nunca a própria interface nem outra janela.
  const tabOf = (wcId: unknown): { wc: WebContents } | { error: PrintError } => {
    const id = Number(wcId);
    const mw = win();
    if (!mw || !Number.isInteger(id) || id <= 0) return { error: 'no-tab' };
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents !== mw.webContents) return { error: 'no-tab' };
    if (wc.isCrashed()) return { error: 'crashed' };
    const kind = printableKind(wc.getURL());
    if (kind !== 'ok') return { error: kind };
    return { wc };
  };

  ipcMain.handle('page:print', (e, wcId: unknown): PrintResult | Promise<PrintResult> => {
    if (!fromMainWindow(e)) return { ok: false, error: 'no-tab' };
    const r = tabOf(wcId);
    if ('error' in r) return { ok: false, error: r.error };
    const wc = r.wc;
    // Sem trava de "ocupado" aqui: o diálogo de impressão do sistema é modal (prende a janela),
    // então não dá pra pedir de novo com ele aberto — e uma trava presa bloquearia a aba pra sempre.
    // Abre o diálogo do sistema; a resposta só chega quando a pessoa imprime ou cancela.
    return new Promise<PrintResult>((resolve) => {
      try {
        wc.print({ silent: false }, (success, reason) => {
          if (success || /cancel/i.test(String(reason || ''))) resolve({ ok: true });
          else if (/progress|already/i.test(String(reason || ''))) resolve({ ok: false, error: 'busy' });   // a página já abriu o diálogo dela
          else { console.warn('[Imprimir] falhou:', reason); resolve({ ok: false, error: wc.isDestroyed() ? 'no-tab' : wc.isCrashed() ? 'crashed' : 'failed' }); }
        });
      } catch (err) { console.warn('[Imprimir] falhou:', err); resolve({ ok: false, error: 'failed' }); }
    });
  });

  ipcMain.handle('page:save-pdf', async (e, wcId: unknown): Promise<SavePdfResult> => {
    if (!fromMainWindow(e)) return { ok: false, error: 'no-tab' };
    const r = tabOf(wcId);
    if ('error' in r) return { ok: false, error: r.error };
    const wc = r.wc;
    if (busy.has(wc.id)) return { ok: false, error: 'busy' };
    busy.add(wc.id);
    try {
      // A aba já É um PDF: "imprimir pra PDF" sairia em branco. Igual ao Chrome, salva o próprio
      // arquivo — vai pelo gerenciador de downloads de sempre e aparece no Ctrl+J.
      if (await showsPdfViewer(wc)) {
        try { wc.downloadURL(wc.getURL()); return { ok: true, downloaded: true }; }
        catch { return { ok: false, error: 'failed' }; }
      }
      const dir = lastPdfDir && isDir(lastPdfDir) ? lastPdfDir : getDownloadDir();
      const opts: Electron.SaveDialogOptions = {
        title: deps.t('pdf.dlg.title'),
        defaultPath: path.join(dir, pdfFileName(wc.getTitle(), wc.getURL(), deps.t('pdf.fallbackName'))),
        filters: [{ name: deps.t('pdf.dlg.filter'), extensions: ['pdf'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      };
      const mw = win();
      const pick = mw ? await dialog.showSaveDialog(mw, opts) : await dialog.showSaveDialog(opts);
      if (pick.canceled || !pick.filePath) return { ok: false, error: 'canceled' };
      let file = pick.filePath;
      if (!/\.pdf$/i.test(file)) file += '.pdf';
      // O ".pdf" foi posto depois do diálogo: ele só perguntou do nome sem ".pdf". Se o nome final
      // já existe, pergunta antes de substituir (mesma frase do Chrome/Windows).
      if (file !== pick.filePath && fs.existsSync(file)) {
        const box = { type: 'warning' as const, buttons: [deps.t('pdf.dlg.replaceYes'), deps.t('pdf.dlg.replaceNo')], defaultId: 1, cancelId: 1, noLink: true, message: deps.t('pdf.dlg.replace', { name: path.basename(file) }) };
        const ans = mw ? await dialog.showMessageBox(mw, box) : await dialog.showMessageBox(box);
        if (ans.response !== 0) return { ok: false, error: 'canceled' };
      }
      lastPdfDir = path.dirname(file);
      // A aba pode ter fechado/travado enquanto o diálogo estava aberto.
      if (wc.isDestroyed()) return { ok: false, error: 'no-tab' };
      if (wc.isCrashed()) return { ok: false, error: 'crashed' };

      let data: Buffer;
      try {
        data = await withTimeout(wc.printToPDF({
          pageSize: defaultPaper(),
          printBackground: true,      // cores e fundos da página saem no PDF
          preferCSSPageSize: true,    // página que define o próprio tamanho (@page) manda, igual ao Chrome
        }), PDF_TIMEOUT_MS);
      } catch (err: any) {
        console.warn('[Salvar PDF] printToPDF falhou:', err?.message || err);
        if (err?.message === 'timeout') return { ok: false, error: 'timeout' };
        return { ok: false, error: wc.isDestroyed() ? 'no-tab' : wc.isCrashed() ? 'crashed' : 'pdf-failed' };
      }
      try { await fs.promises.writeFile(file, data); }
      catch (err: any) { console.warn('[Salvar PDF] não gravou:', err?.message || err); return { ok: false, error: 'write-failed' }; }

      // Linha "concluído" no painel de Downloads, com abrir/mostrar na pasta (liberados pra este arquivo).
      rememberSavedFile(file);
      try {
        mw?.webContents.send('agent:download-event', {
          id: `pdf-${Date.now()}`, kind: 'pdf', state: 'completed', filename: path.basename(file), path: file,
          bytes: data.length, totalBytes: data.length,
        });
      } catch {}
      return { ok: true, file: path.basename(file), path: file };
    } finally { busy.delete(wc.id); }
  });
}
