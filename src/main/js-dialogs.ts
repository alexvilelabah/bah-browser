// alert / confirm / prompt das páginas nas abas (<webview>). O handler padrão do Electron abre uma
// caixa NATIVA que trava a página (e o agente: o clique que abriu um confirm() fica pendurado até
// alguém clicar). prompt() nem chega aqui: o Electron troca window.prompt por um que lança erro. Aqui o renderer decide: caixa do Bah
// pra pessoa, ou a política do agente quando a aba é de uma tarefa dele.
// Usa o evento interno '-run-dialog' do Electron (info + callback) — mesma assinatura do handler dele.
import { ipcMain, type BrowserWindow, type WebContents } from 'electron';

type Info = { frame?: { origin?: string; url?: string }; dialogType: 'alert' | 'confirm' | 'prompt'; messageText: string; defaultPromptText: string };
type Pending = { wcId: number; cb: (ok: boolean, text: string) => void };
const pending = new Map<number, Pending>();
let seq = 0;
// Abas que uma tarefa do agente está usando (o renderer informa). "Sair do site?" (beforeunload)
// nelas: o agente quis navegar — sai, e avisa o renderer pra constar no histórico da tarefa.
const agentTabs = new Set<number>();

export function attachJsDialogs(wc: WebContents, getMainWindow: () => BrowserWindow | null): void {
  const ee = wc as unknown as NodeJS.EventEmitter;   // eventos internos do Electron (sem tipos públicos)
  ee.removeAllListeners('-run-dialog');
  let answered = false;
  ee.on('-run-dialog', (info: Info, callback: (ok: boolean, text: string) => void) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return callback(false, '');
    const id = ++seq;
    answered = false;
    const cb = (ok: boolean, text: string) => { if (answered) return; answered = true; try { callback(ok, text); } catch {} };
    pending.set(id, { wcId: wc.id, cb });
    const origin = info.frame?.origin && info.frame.origin !== 'null' ? info.frame.origin : (info.frame?.url || wc.getURL());
    win.webContents.send('jsdialog:open', { id, wcId: wc.id, type: info.dialogType, message: String(info.messageText || '').slice(0, 2000), defaultText: String(info.defaultPromptText || ''), origin });
  });
  // Navegação/fechamento cancela diálogos abertos (o Electron emite isto).
  ee.on('-cancel-dialogs', () => {
    for (const [id, p] of pending) if (p.wcId === wc.id) { p.cb(false, ''); pending.delete(id); getMainWindow()?.webContents.send('jsdialog:closed', id); }
  });
  wc.on('will-prevent-unload', (event) => {
    if (!agentTabs.has(wc.id)) return;
    event.preventDefault();
    getMainWindow()?.webContents.send('jsdialog:left', { wcId: wc.id, url: wc.getURL() });
  });
  wc.once('destroyed', () => { for (const [id, p] of pending) if (p.wcId === wc.id) pending.delete(id); });
}

export function setupJsDialogs(): void {
  ipcMain.handle('jsdialog:agent-tabs', (_e, ids: number[]) => { agentTabs.clear(); (ids || []).forEach(i => agentTabs.add(i)); return { ok: true }; });
  ipcMain.handle('jsdialog:respond', (_e, id: number, accept: boolean, text?: string) => {
    const p = pending.get(id);
    if (!p) return { ok: false };
    pending.delete(id);
    p.cb(!!accept, accept ? String(text ?? '') : '');
    return { ok: true };
  });
}
