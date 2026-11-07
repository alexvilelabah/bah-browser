// Conteúdo de iframes pro agente (formulário embutido de vaga, pagamento, widget de reserva). A árvore de
// acessibilidade da página NÃO inclui iframes: os do mesmo processo saem por frameId; os de outro processo
// (cross-origin, OOPIF) por sessão CDP "achatada" (Target.setAutoAttach flatten). Coordenadas devolvidas
// sempre na viewport da página (OOPIF: + posição do <iframe>), pra clicar/digitar como qualquer elemento.
// Regras puras (nome, chave, caixa, filtro de extensão) em src/shared/frames.ts.
import { ipcMain, webContents, type WebContents } from 'electron';
import { MAX_FRAMES, boxFromQuad, childFrames, frameLabel, isExtensionFrameUrl, parseFrameKey } from '../shared/frames';

type FrameRef = { key: string; label: string; nodes: any[] };
// Por webContents: sessionId da sessão CDP de cada iframe de outro processo → frameId (= targetId) + URL.
const oopifs = new Map<number, Map<string, { frameId: string; url: string }>>();
const listening = new WeakSet<WebContents>();

async function ensureAutoAttach(wc: WebContents): Promise<void> {
  if (!listening.has(wc)) {
    listening.add(wc);
    const map = new Map<string, { frameId: string; url: string }>();
    oopifs.set(wc.id, map);
    wc.debugger.on('message', (_e, method: string, params: any) => {
      if (method === 'Target.attachedToTarget' && params?.targetInfo?.type === 'iframe') map.set(params.sessionId, { frameId: params.targetInfo.targetId, url: params.targetInfo.url });
      else if (method === 'Target.detachedFromTarget') map.delete(params?.sessionId);
      else if (method === 'Target.targetInfoChanged' && params?.targetInfo?.type === 'iframe') {
        for (const v of map.values()) if (v.frameId === params.targetInfo.targetId) v.url = params.targetInfo.url;
      }
    });
    wc.debugger.on('detach', () => { map.clear(); listening.delete(wc); });
    wc.once('destroyed', () => oopifs.delete(wc.id));
  }
  await wc.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
}

// Sessão CDP de um frame: frame local usa a sessão da página (sid indefinido); OOPIF, a dele — se ainda existe.
const sessionOf = (wcId: number, key: string): { ok: boolean; sid?: string } => {
  const k = parseFrameKey(key);
  if (!k) return { ok: false };
  if (k.kind === 'local') return { ok: true };
  return oopifs.get(wcId)?.has(k.sessionId) ? { ok: true, sid: k.sessionId } : { ok: false };
};

export function setupFrames(ensureDebugger: (wc: WebContents, id: number) => Promise<void>): void {
  // Clique num elemento de iframe de OUTRO processo: sendInputEvent entrega no widget da página (o
  // <iframe> recebe o clique, o botão de dentro não). CDP Input na sessão do próprio frame, em
  // coordenadas do frame. Frame do mesmo processo: clique normal funciona (nem chega aqui).
  ipcMain.handle('cdp:frame-click', async (_e, wcId: number, key: string, id: number) => {
    const wc = webContents.fromId(wcId);
    const s = sessionOf(wcId, key);
    if (!wc || !s.ok) return { success: false, error: 'frame is gone — re-observe the page' };
    try {
      await wc.debugger.sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }, s.sid).catch(() => {});
      const b = boxFromQuad((await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: id }, s.sid) as any)?.model?.border);
      if (!b) return { success: false, error: 'element is not visible in the frame' };
      const ev = (type: string, extra: any = {}) => wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', ...extra }, s.sid);
      await ev('mouseMoved', { button: 'none' });
      await ev('mousePressed', { clickCount: 1 });
      await new Promise(r => setTimeout(r, 60 + Math.random() * 60));
      await ev('mouseReleased', { clickCount: 1 });
      return { success: true, info: { clickedInFrame: true } };
    } catch (e: any) { return { success: false, error: String(e?.message || e) }; }
  });

  // Preencher um campo DENTRO do iframe, no próprio nó (sessão do frame): não depende de foco — a UI do
  // Bah atualizando tira o foco do iframe e as teclas iam pro <iframe>, não pro campo.
  ipcMain.handle('cdp:frame-fill', async (_e, wcId: number, key: string, id: number, value: string) => {
    const wc = webContents.fromId(wcId);
    const s = sessionOf(wcId, key);
    if (!wc || !s.ok) return { ok: false, error: 'frame is gone — re-observe the page' };
    try {
      const objectId = (await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: id }, s.sid) as any)?.object?.objectId;
      if (!objectId) return { ok: false, error: 'field is gone — re-observe the page' };
      const fn = `function(v){
        try{ this.scrollIntoView({block:'center'}); }catch(e){}
        try{ this.focus(); }catch(e){}
        var el=this;
        if (el.isContentEditable){ el.textContent=v; el.dispatchEvent(new InputEvent('input',{bubbles:true,data:v,inputType:'insertReplacementText'})); return el.textContent; }
        var proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto,'value');
        if (d && d.set) d.set.call(el, v); else el.value=v;
        el.dispatchEvent(new InputEvent('input',{bubbles:true,data:v,inputType:'insertText'}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return el.value;
      }`;
      const r = await wc.debugger.sendCommand('Runtime.callFunctionOn', { objectId, functionDeclaration: fn, arguments: [{ value: String(value) }], returnByValue: true }, s.sid) as any;
      return { ok: true, value: r?.result?.value };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Árvores de acessibilidade de cada iframe (até MAX_FRAMES; os vazios e os de extensão ficam de fora).
  ipcMain.handle('cdp:frames-ax', async (_e, wcId: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { ok: false, frames: [] };
    try {
      await ensureDebugger(wc, wcId);
      await ensureAutoAttach(wc);
      const out: FrameRef[] = [];
      const tree = await wc.debugger.sendCommand('Page.getFrameTree') as any;
      for (const f of childFrames(tree?.frameTree).slice(0, MAX_FRAMES)) {
        try {
          const ax = await wc.debugger.sendCommand('Accessibility.getFullAXTree', { frameId: f.id }) as any;
          if (ax?.nodes?.length) out.push({ key: `local:${f.id}`, label: frameLabel(f.url), nodes: ax.nodes });
        } catch { /* frame de outro processo: vem pela sessão abaixo */ }
      }
      for (const [sid, info] of oopifs.get(wcId) || []) {
        if (out.length >= MAX_FRAMES) break;
        if (isExtensionFrameUrl(info.url)) continue;
        try {
          const ax = await wc.debugger.sendCommand('Accessibility.getFullAXTree', {}, sid) as any;
          if (ax?.nodes?.length) out.push({ key: `oopif:${sid}`, label: frameLabel(info.url), nodes: ax.nodes });
        } catch { /* sessão foi embora */ }
      }
      return { ok: true, frames: out };
    } catch (e: any) {
      return { ok: false, frames: [], error: String(e?.message || e) };
    }
  });

  // Caixa (centro + tamanho) de nós de UM iframe, na viewport da página.
  ipcMain.handle('cdp:frames-coords', async (_e, wcId: number, key: string, ids: number[]) => {
    const wc = webContents.fromId(wcId);
    const coords: Record<number, { x: number; y: number; w: number; h: number } | null> = {};
    const k = parseFrameKey(key);
    if (!wc || !k) return { ok: false, coords };
    const sid = k.kind === 'oopif' ? k.sessionId : undefined;
    let ox = 0, oy = 0;
    try {
      if (sid) {
        // OOPIF: as caixas vêm no documento do frame — soma o canto do conteúdo do <iframe> na página.
        const frameId = oopifs.get(wcId)?.get(sid)?.frameId;
        if (!frameId) return { ok: false, coords };
        const owner = await wc.debugger.sendCommand('DOM.getFrameOwner', { frameId }) as any;
        const ob = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }) as any;
        ox = ob.model.content[0]; oy = ob.model.content[1];
      }
      await Promise.all((ids || []).slice(0, 300).map(async (id) => {
        try {
          const r = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: id }, sid) as any;
          coords[id] = boxFromQuad(r?.model?.border, ox, oy);
        } catch { coords[id] = null; }
      }));
      return { ok: true, coords };
    } catch (e: any) {
      return { ok: false, coords, error: String(e?.message || e) };
    }
  });
}
