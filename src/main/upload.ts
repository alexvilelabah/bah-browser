// Ação `upload` do agente: anexar arquivo num campo de upload. Os arquivos SÓ vêm do diálogo nativo
// do SO, escolhidos pela pessoa (ou já escolhidos por ela nesta tarefa). O agente nunca informa
// caminho — recebe um token e os NOMES. Acha o <input type=file> pelo nó do ref; se o ref for um
// botão "Enviar currículo" que abre o seletor do SO, intercepta esse seletor (só durante esta ação).
import { dialog, ipcMain, webContents, type BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

type Picked = { paths: string[]; at: number };

// Pastas que a PESSOA liberou nesta sessão (some ao fechar o Bah). O agente vê caminhos relativos
// "<pasta>/<arquivo>"; tudo é resolvido e conferido aqui (realpath dentro da pasta — sem ../ nem symlink pra fora).
const grants: string[] = [];
let extractText: ((p: string) => Promise<{ ok: boolean; text?: string; error?: string }>) | null = null;
export function setUploadTextExtractor(fn: typeof extractText): void { extractText = fn; }
const label = (root: string, i: number) => `${path.basename(root) || root}${grants.findIndex(g => path.basename(g) === path.basename(root)) !== i ? `-${i + 1}` : ''}`;
function resolveFile(id: string): string | null {
  const clean = String(id || '').replace(/\\/g, '/').replace(/^\/+/, '');
  for (let i = 0; i < grants.length; i++) {
    const root = grants[i], pre = label(root, i) + '/';
    if (!clean.startsWith(pre)) continue;
    try {
      const real = fs.realpathSync(path.join(root, clean.slice(pre.length)));
      if ((real === root || real.startsWith(root + path.sep)) && fs.statSync(real).isFile()) return real;
    } catch {}
  }
  return null;
}
const SKIP_DIR = /^(\.|node_modules$|Library$|\$RECYCLE)/;
function listFiles(max = 300): Array<{ file: string; size: number; modified: string }> {
  const out: Array<{ file: string; size: number; modified: string }> = [];
  grants.forEach((root, i) => {
    const walk = (dir: string, rel: string, depth: number) => {
      if (out.length >= max || depth > 3) return;
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= max) return;
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(full, r, depth + 1); }
        else if (e.isFile()) { try { const st = fs.statSync(full); out.push({ file: `${label(root, i)}/${r}`, size: st.size, modified: st.mtime.toISOString().slice(0, 10) }); } catch {} }
      }
    };
    walk(root, '', 0);
  });
  return out;
}
function newToken(paths: string[]): string {
  prune();
  const token = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  picked.set(token, { paths, at: Date.now() });
  return token;
}
const picked = new Map<string, Picked>();
const TTL = 6 * 60 * 60_000;

function prune() { const now = Date.now(); for (const [k, v] of picked) if (now - v.at > TTL) picked.delete(k); }

export function setupUpload(getMainWindow: () => BrowserWindow | null, ensureDebugger: (wc: Electron.WebContents, id: number) => Promise<void>): void {
  // Diálogo do SO → token. Só o renderer do Bah chama (depois do cartão que a pessoa aceitou).
  ipcMain.handle('upload:pick', async (_e, opts: { multiple?: boolean; title?: string }) => {
    const win = getMainWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { title: opts?.title || 'Choose file to upload', properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const token = newToken(r.filePaths);
    return { ok: true, token, names: r.filePaths.map(p => path.basename(p)), sizes: r.filePaths.map(p => { try { return fs.statSync(p).size; } catch { return 0; } }) };
  });

  // ── pasta liberada pra esta sessão ──
  ipcMain.handle('upload:grant-folder', async () => {
    const win = getMainWindow();
    const r = win ? await dialog.showOpenDialog(win, { title: 'Allow the agent to use this folder (this session)', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    let real = r.filePaths[0];
    try { real = fs.realpathSync(real); } catch {}
    if (!grants.includes(real)) grants.push(real);
    return { ok: true, folder: label(real, grants.indexOf(real)) };
  });
  ipcMain.handle('upload:grants', () => grants.map((g, i) => ({ folder: label(g, i), path: g.replace(require('os').homedir(), '~') })));
  ipcMain.handle('upload:revoke-all', () => { grants.length = 0; return { ok: true }; });
  ipcMain.handle('upload:list-files', () => ({ ok: grants.length > 0, files: listFiles() }));
  ipcMain.handle('upload:read-file', async (_e, id: string) => {
    const p = resolveFile(id);
    if (!p) return { ok: false, error: `"${id}" is not a file in a folder the user allowed — use a name from list_files` };
    if (!extractText) return { ok: false, error: 'reading files is not available' };
    const r = await extractText(p);
    return r.ok ? { ok: true, text: String(r.text || '').slice(0, 6000) } : { ok: false, error: r.error };
  });
  ipcMain.handle('upload:token-for', (_e, ids: string[]) => {
    const paths = (ids || []).map(resolveFile);
    if (!paths.length || paths.some(p => !p)) return { ok: false, error: 'file not found in the folders the user allowed — use a name from list_files' };
    return { ok: true, token: newToken(paths as string[]), names: (paths as string[]).map(p => path.basename(p)) };
  });

  ipcMain.handle('upload:set', async (_e, wcId: number, nodeId: number | null, token: string, at?: { x: number; y: number }) => {
    let backendNodeId = nodeId;
    const files = picked.get(token)?.paths;
    if (!files?.length) return { ok: false, error: 'no files chosen for this upload' };
    const wc = webContents.fromId(wcId);
    if (!wc) return { ok: false, error: 'tab not found' };
    try {
      await ensureDebugger(wc, wcId);
      const send = (m: string, p?: any) => wc.debugger.sendCommand(m, p) as Promise<any>;
      await send('DOM.getDocument', { depth: 0 }).catch(() => {});
      // Observação pelo DOM (sem id de nó): o elemento EXATO na posição do campo — nunca "o 1º da página".
      if (backendNodeId == null && at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
        backendNodeId = (await send('DOM.getNodeForLocation', { x: Math.round(at.x), y: Math.round(at.y), includeUserAgentShadowDOM: false }).catch(() => null))?.backendNodeId ?? null;
      }

      // 1) o próprio nó, um input de arquivo dentro dele, o que o <label> controla, ou o ÚNICO da página.
      const findInput = async (): Promise<{ id?: number; multiple?: boolean; accept?: string }> => {
        const fn = `function(){
          var el=this, f=null;
          if (el && el.tagName==='INPUT' && el.type==='file') f=el;
          if (!f && el && el.querySelector) f=el.querySelector('input[type=file]');
          if (!f && el && el.control && el.control.type==='file') f=el.control;
          if (!f && el && el.closest){ var l=el.closest('label'); if (l && l.control && l.control.type==='file') f=l.control; }
          if (!f && el && el.parentElement && el!==document.body){ var sib=el.parentElement.querySelectorAll('input[type=file]'); if (sib.length===1) f=sib[0]; }
          if (!f && el===document.body){ var all=document.querySelectorAll('input[type=file]'); if (all.length===1) f=all[0]; }
          return f;
        }`;
        let objectId: string | undefined;
        if (backendNodeId != null) objectId = (await send('DOM.resolveNode', { backendNodeId }))?.object?.objectId;
        else objectId = (await send('Runtime.evaluate', { expression: 'document.body' }))?.result?.objectId;
        if (!objectId) return {};
        const r = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: fn, returnByValue: false });
        const fid = r?.result?.objectId;
        if (!fid) return {};
        const desc = await send('DOM.describeNode', { objectId: fid });
        const attrs: string[] = desc?.node?.attributes || [];
        const attr = (n: string) => { const i = attrs.indexOf(n); return i >= 0 ? attrs[i + 1] : undefined; };
        return { id: desc?.node?.backendNodeId, multiple: attr('multiple') != null, accept: attr('accept') };
      };

      let target = await findInput();
      // 2) botão que abre o seletor do SO: intercepta o seletor, clica, pega o input que ele abriu.
      if (!target.id && backendNodeId != null) {
        await send('Page.enable');
        await send('Page.setInterceptFileChooserDialog', { enabled: true });
        try {
          const opened = new Promise<{ backendNodeId: number; mode: string } | null>((resolve) => {
            const timer = setTimeout(() => { wc.debugger.off('message', on); resolve(null); }, 5000);
            const on = (_ev: any, method: string, params: any) => {
              if (method !== 'Page.fileChooserOpened') return;
              clearTimeout(timer); wc.debugger.off('message', on); resolve(params);
            };
            wc.debugger.on('message', on);
          });
          const box = await send('DOM.getBoxModel', { backendNodeId }).catch(() => null);
          const q: number[] | undefined = box?.model?.content;
          if (q) {
            const x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
            for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
          } else {
            const objectId = (await send('DOM.resolveNode', { backendNodeId }))?.object?.objectId;
            if (objectId) await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ this.click(); }', userGesture: true });
          }
          const ev = await opened;
          if (ev) target = { id: ev.backendNodeId, multiple: ev.mode === 'selectMultiple' };
        } finally {
          await send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
        }
      }
      // 3) nada abriu (o botão só chama input.click() por script, ou o script ainda não carregou): o input
      //    de arquivo escondido da MESMA seção — o ancestral mais próximo que tem exatamente um.
      if (!target.id && backendNodeId != null) {
        const objectId = (await send('DOM.resolveNode', { backendNodeId }))?.object?.objectId;
        if (objectId) {
          const r = await send('Runtime.callFunctionOn', { objectId, returnByValue: false, functionDeclaration: `function(){
            for (var el=this.parentElement, k=0; el && el!==document.documentElement && k<8; el=el.parentElement, k++) {
              var f=el.querySelectorAll('input[type=file]'); if (f.length===1) return f[0]; if (f.length>1) return null;
            }
            return null;
          }` });
          const fid = r?.result?.objectId;
          if (fid) {
            const desc = await send('DOM.describeNode', { objectId: fid });
            const attrs: string[] = desc?.node?.attributes || [];
            target = { id: desc?.node?.backendNodeId, multiple: attrs.includes('multiple'), accept: attrs[attrs.indexOf('accept') + 1] && attrs.includes('accept') ? attrs[attrs.indexOf('accept') + 1] : undefined };
          }
        }
      }
      if (!target.id) return { ok: false, error: 'no file upload field found at that element — pick the upload button or the "Choose file" field' };
      const use = target.multiple ? files : files.slice(0, 1);
      await send('DOM.setFileInputFiles', { files: use, backendNodeId: target.id });
      return { ok: true, names: use.map(p => path.basename(p)), accept: target.accept || '', dropped: files.length - use.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
