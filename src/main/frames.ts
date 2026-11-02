// Conteúdo de iframes pro agente (formulário embutido de vaga, pagamento, widget de reserva). A árvore de
// acessibilidade da página NÃO inclui iframes: os do mesmo processo saem por frameId; os de outro processo
// (cross-origin, OOPIF) por sessão CDP "achatada" (Target.setAutoAttach flatten). Coordenadas devolvidas
// sempre na viewport da página (OOPIF: + posição do <iframe>), pra clicar/digitar como qualquer elemento.
import { ipcMain, webContents, type WebContents } from 'electron';
import { isExtensionFrameUrl } from '../shared/extension-ui';

type FrameRef = { key: string; label: string; nodes: any[] };
const oopifs = new Map<number, Map<string, { frameId: string; url: string }>>();
const listening = new WeakSet<WebContents>();
const label = (url: string) => { if (!url || url.startsWith('about:')) return 'embedded'; try { return new URL(url).host || url.slice(0, 40); } catch { return url.slice(0, 40); } };

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

const sessionOf = (wcId: number, key: string): { ok: boolean; sid?: string } => {
  const i = key.indexOf(':'); const kind = key.slice(0, i), ref = key.slice(i + 1);
  if (kind === 'local') return { ok: true };
  return oopifs.get(wcId)?.has(ref) ? { ok: true, sid: ref } : { ok: false };
};

export function setupFrames(ensureDebugger: (wc: WebContents, id: number) => Promise<void>): void {
  // get { ref }: estado do elemento (valor, texto, marcado, habilitado, visível, atributos úteis). Nó da página
  // (backendNodeId), de iframe (key + id) ou, sem id, o elemento na posição.
  ipcMain.handle('cdp:inspect', async (_e, wcId: number, target: { backendNodeId?: number; key?: string; id?: number; x?: number; y?: number }) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { ok: false, error: 'tab not found' };
    try {
      await ensureDebugger(wc, wcId);
      let sid: string | undefined, node = target.backendNodeId;
      if (target.key && target.id != null) { const s = sessionOf(wcId, target.key); if (!s.ok) return { ok: false, error: 'frame is gone — re-observe' }; sid = s.sid; node = target.id; }
      if (node == null && target.x != null && target.y != null) node = (await wc.debugger.sendCommand('DOM.getNodeForLocation', { x: Math.round(target.x), y: Math.round(target.y) }) as any)?.backendNodeId;
      if (node == null) return { ok: false, error: 'element not found' };
      const objectId = (await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: node }, sid) as any)?.object?.objectId;
      if (!objectId) return { ok: false, error: 'element is gone — re-observe' };
      const fn = `function(){
        var el = this.nodeType === 1 ? this : this.parentElement; if (!el) return null;
        var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        var o = { tag: el.tagName.toLowerCase(), type: el.type || undefined,
          text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
          enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true' };
        if ('value' in el && el.tagName !== 'BUTTON') { o.value = String(el.value).slice(0, 300); o.valueLength = String(el.value).length; }
        if (el.type === 'checkbox' || el.type === 'radio') o.checked = !!el.checked;
        else if (el.getAttribute('aria-checked')) o.checked = el.getAttribute('aria-checked') === 'true';
        if (el.tagName === 'SELECT') o.selected = Array.prototype.filter.call(el.options, function(x){ return x.selected; }).map(function(x){ return x.text; }).join(', ');
        ['href','name','placeholder','aria-label','aria-expanded','aria-selected','required','readonly','min','max','maxlength','pattern','title'].forEach(function(a){ var v = el.getAttribute(a); if (v != null && v !== '') o[a] = v.slice(0, 160); });
        return o;
      }`;
      const r = await wc.debugger.sendCommand('Runtime.callFunctionOn', { objectId, functionDeclaration: fn, returnByValue: true }, sid) as any;
      return { ok: true, state: r?.result?.value };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Clique num elemento de iframe de OUTRO processo: sendInputEvent entrega no widget da página (o
  // <iframe> recebe o clique, o botão de dentro não). CDP Input na sessão do próprio frame, em
  // coordenadas do frame. Frame do mesmo processo: clique normal funciona (nem chega aqui).
  ipcMain.handle('cdp:frame-click', async (_e, wcId: number, key: string, id: number) => {
    const wc = webContents.fromId(wcId);
    const s = sessionOf(wcId, key);
    if (!wc || !s.ok) return { success: false, error: 'frame is gone — re-observe the page' };
    try {
      await wc.debugger.sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }, s.sid).catch(() => {});
      const q: number[] = (await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: id }, s.sid) as any)?.model?.border;
      if (!q || q.length !== 8) return { success: false, error: 'element is not visible in the frame' };
      const x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
      const ev = (type: string, extra: any = {}) => wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra }, s.sid);
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

  // Árvores de acessibilidade de cada iframe (até 8; os vazios ficam de fora).
  ipcMain.handle('cdp:frames-ax', async (_e, wcId: number) => {
    const wc = webContents.fromId(wcId);
    if (!wc) return { ok: false, frames: [] };
    try {
      await ensureDebugger(wc, wcId);
      await ensureAutoAttach(wc);
      const out: FrameRef[] = [];
      // Iframe de extensão (menu do LastPass/Bitwarden…) e o que houver dentro dele: não é da página — fora.
      const walk = (ft: any, depth: number): any[] => depth > 3 ? [] : (ft?.childFrames || [])
        .filter((c: any) => !isExtensionFrameUrl(c?.frame?.url))
        .flatMap((c: any) => [c.frame, ...walk(c, depth + 1)]);
      const tree = await wc.debugger.sendCommand('Page.getFrameTree') as any;
      for (const f of walk(tree.frameTree, 0).slice(0, 8)) {
        try {
          const ax = await wc.debugger.sendCommand('Accessibility.getFullAXTree', { frameId: f.id }) as any;
          if (ax?.nodes?.length) out.push({ key: `local:${f.id}`, label: label(f.url), nodes: ax.nodes });
        } catch { /* frame de outro processo: vem pela sessão abaixo */ }
      }
      for (const [sid, info] of oopifs.get(wcId) || []) {
        if (out.length >= 8) break;
        if (isExtensionFrameUrl(info.url)) continue;
        try {
          const ax = await wc.debugger.sendCommand('Accessibility.getFullAXTree', {}, sid) as any;
          if (ax?.nodes?.length) out.push({ key: `oopif:${sid}`, label: label(info.url), nodes: ax.nodes });
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
    if (!wc) return { ok: false, coords };
    const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const sid = kind === 'oopif' ? ref : undefined;
    let ox = 0, oy = 0;
    try {
      if (sid) {
        const frameId = oopifs.get(wcId)?.get(sid)?.frameId;
        if (!frameId) return { ok: false, coords };
        const owner = await wc.debugger.sendCommand('DOM.getFrameOwner', { frameId }) as any;
        const ob = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }) as any;
        ox = ob.model.content[0]; oy = ob.model.content[1];
      }
      await Promise.all((ids || []).slice(0, 300).map(async (id) => {
        try {
          const r = await wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId: id }, sid) as any;
          const q: number[] = r?.model?.border;
          if (!q || q.length !== 8) { coords[id] = null; return; }
          const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          coords[id] = { x: Math.round(ox + (minX + maxX) / 2), y: Math.round(oy + (minY + maxY) / 2), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
        } catch { coords[id] = null; }
      }));
      return { ok: true, coords };
    } catch (e: any) {
      return { ok: false, coords, error: String(e?.message || e) };
    }
  });
}
