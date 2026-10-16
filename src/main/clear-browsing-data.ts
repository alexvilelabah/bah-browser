// "Limpar dados de navegação" (menu ⋮ / Ctrl+Shift+Delete), igual ao Chrome — lado do main.
// O renderer cuida do que é dele (histórico e lista de downloads, no localStorage/estado da
// interface) e manda pra cá só as CAIXAS marcadas + o período + os sites do período. As regras
// de o que cada caixa apaga ficam em shared/clear-data.ts (testadas).
//  • Só a sessão das abas (persist:browser). O defaultSession (onde moram as configurações,
//    chaves de API e favoritos do Bah) nunca é tocado.
//  • Extensões instaladas (ligadas ou desligadas) ficam de fora: excludeOrigins com a origem
//    chrome-extension:// de cada uma. O chrome.storage delas nem passa pelo clearData.
//  • Cookies + "Todo o período" também zera a sessão antiga persist:google-login. O perfil do
//    "Entrar no Google" (navegador do sistema) fica: um clique lá reconecta a mesma conta, e
//    "Trocar de conta" continua sendo o jeito de esquecê-la.
//  • Arquivos baixados nunca são apagados.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type Session } from 'electron';
import fs from 'fs';
import path from 'path';
import { planClear, sanitizeClearRequest, type ClearDataCall } from '../shared/clear-data';

export type ClearResult = { ok: true } | { ok: false; error: 'bad-request' | 'busy' | 'failed' };

// Visualizador de PDF embutido do Chromium (extensão de componente): fica junto com as instaladas.
const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const CLEAR_TIMEOUT_MS = 120_000;   // disco lento com cache enorme demora; travado de vez não prende o botão

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export function setupClearBrowsingData(deps: {
  getMainWindow: () => BrowserWindow | null;
  browserSession: Session;
  googleLoginSession: Session;
  /** Pasta das extensões da Chrome Web Store (userData/Extensions): uma subpasta por id. */
  extensionsDir: string;
}): void {
  const fromMainWindow = (e: IpcMainInvokeEvent) => {
    const mw = deps.getMainWindow();
    return !!mw && !mw.isDestroyed() && e.sender === mw.webContents;
  };

  // Ids de TODAS as extensões instaladas: as carregadas + as que estão no disco (desligadas
  // no interruptor não carregam, mas os dados delas precisam continuar lá).
  const installedExtensionIds = (): string[] => {
    const ids = new Set<string>([PDF_VIEWER_ID]);
    try { for (const ext of deps.browserSession.extensions.getAllExtensions()) ids.add(ext.id); } catch {}
    try { for (const name of fs.readdirSync(deps.extensionsDir)) ids.add(path.basename(name)); } catch {}
    return [...ids];
  };

  const run = async (ses: Session, call: ClearDataCall) => {
    await withTimeout(ses.clearData(call), CLEAR_TIMEOUT_MS);
    // Grava já no disco: um fechamento brusco logo depois não pode "ressuscitar" o cookie apagado.
    if (call.dataTypes.includes('cookies')) { try { await ses.cookies.flushStore(); } catch {} }
  };

  let busy = false;
  ipcMain.handle('browsing-data:clear', async (e, raw: unknown): Promise<ClearResult> => {
    if (!fromMainWindow(e)) return { ok: false, error: 'bad-request' };
    const req = sanitizeClearRequest(raw);
    if (!req) return { ok: false, error: 'bad-request' };
    if (busy) return { ok: false, error: 'busy' };
    busy = true;
    try {
      const plan = planClear(req, installedExtensionIds());
      if (plan.browser) await run(deps.browserSession, plan.browser);
      if (plan.googleLogin) await run(deps.googleLoginSession, plan.googleLogin);
      return { ok: true };
    } catch (err) {
      console.warn('[Limpar dados] falhou:', err);
      return { ok: false, error: 'failed' };
    } finally {
      busy = false;
    }
  });
}
