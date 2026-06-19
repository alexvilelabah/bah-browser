export type BrowserAction =
  | { type: 'plan'; steps: string[] }
  | { type: 'store'; key: string; value: any; source?: string }
  | { type: 'extract_text'; max_chars?: number }
  | { type: 'extract_images'; min_width?: number }
  | { type: 'search_images'; query: string; min_width?: number; count?: number }
  | { type: 'harvest_images'; query: string; count?: number; min_width?: number }
  | { type: 'download'; url: string; filename?: string }
  | { type: 'download_video'; url?: string; query?: string; audio_only?: boolean; count?: number; quality?: 'best' | 'low' }
  | { type: 'open_video_cuts'; phrase: string; count?: number }
  | { type: 'open_video'; query: string }
  | { type: 'create_playlist'; songs: string[]; name?: string; private?: boolean }
  | { type: 'make_supercut'; phrase: string; count?: number }
  | { type: 'render_view'; title: string; columns: string[]; rows: Array<Array<string | number>>; chart?: { type: 'bar'; label: string; labels: string[]; values: number[] }; subtitle?: string; source_note?: string }
  | { type: 'stock_movers'; direction: 'gainers' | 'losers'; count?: number }
  | { type: 'compare_prices'; query: string }
  | { type: 'google_news'; query: string }
  | { type: 'ask_ai'; question: string }
  | { type: 'find_file'; query: string; filetype?: string }
  | { type: 'read_aloud'; text?: string }
  | { type: 'report'; summary: string }
  | { type: 'switch_tab'; tab: number }
  | { type: 'new_tab'; url: string }
  | { type: 'close_tab'; tab: number }
  | { type: 'click_ref'; ref: number }
  | { type: 'fill_ref'; ref: number; value: string }
  | { type: 'click_text'; text: string; nth?: number }
  | { type: 'click_at'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'fill'; selector?: string; label?: string; value: string }
  | { type: 'press'; key: string }
  | { type: 'navigate'; url: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }
  | { type: 'wait'; ms?: number; selector?: string; timeout?: number }
  | { type: 'done'; reason: string; success: boolean };

export interface InteractiveElement {
  id: number;
  tag: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: string;
  href?: string;
  placeholder?: string;
  aria?: string;
  pressed?: boolean;
  checked?: boolean;
  backendNodeId?: number; // CDP node id for precise clicking
  repeatNote?: number;    // "+N elementos similares" colapsados após este (poda de payload)
}

export interface ObservedState {
  url: string;
  title: string;
  text_sample: string;
  interactive_elements: InteractiveElement[];
  dismissed?: string;   // rótulo do aviso de cookie/consent que o porteiro fechou (se houve)
}

export interface ToolResult {
  success: boolean;
  error?: string;
  info?: any;
  /** Motivo estruturado de falha (ex.: 'element_covered', 'stale_ref'). */
  reason?: string;
  /** Descrição do elemento que cobre o alvo, quando reason === 'element_covered'. */
  covering?: string;
}

export function formatAction(action: BrowserAction): string {
  switch (action.type) {
    case 'plan': return `plan(${action.steps?.length ?? 0} steps)`;
    case 'store': return `store(${action.key}=${JSON.stringify(action.value).slice(0, 60)}${action.source ? ` from ${action.source}` : ''})`;
    case 'extract_text': return `extract_text()`;
    case 'extract_images': return `extract_images(${action.min_width ? `min ${action.min_width}px` : ''})`;
    case 'search_images': return `search_images("${shorten(action.query, 50)}"${action.count ? `, ${action.count}` : ''})`;
    case 'harvest_images': return `harvest_images("${shorten(action.query, 50)}", ${action.count || 10}${action.min_width ? `, min ${action.min_width}px` : ''})`;
    case 'download': return `download("${shorten(action.url, 80)}")`;
    case 'download_video': return `download_video(${action.count && action.count > 1 ? `${action.count}x, ` : ''}${action.audio_only ? 'audio, ' : ''}${action.quality === 'best' ? 'máx qualidade, ' : ''}${action.query ? `busca: "${shorten(action.query, 50)}"` : action.url ? shorten(action.url, 70) : 'aba atual'})`;
    case 'open_video_cuts': return `open_video_cuts("${shorten(action.phrase, 50)}"${action.count ? `, ${action.count}` : ''})`;
    case 'open_video': return `open_video("${shorten(action.query, 50)}")`;
    case 'create_playlist': return `create_playlist(${action.songs?.length ?? 0} músicas)`;
    case 'make_supercut': return `make_supercut("${shorten(action.phrase, 50)}"${action.count ? `, ${action.count} trechos` : ''})`;
    case 'render_view': return `render_view("${shorten(action.title, 50)}", ${action.rows?.length ?? 0} linhas)`;
    case 'stock_movers': return `stock_movers(${action.direction === 'losers' ? 'maiores quedas' : 'maiores altas'}${action.count ? `, ${action.count}` : ''})`;
    case 'compare_prices': return `compare_prices("${shorten(action.query, 50)}")`;
    case 'google_news': return `google_news("${shorten(action.query, 50)}")`;
    case 'ask_ai': return `ask_ai("${shorten(action.question, 80)}")`;
    case 'find_file': return `find_file("${shorten(action.query, 50)}", ${action.filetype || 'pdf'})`;
    case 'read_aloud': return `read_aloud(${action.text ? `"${shorten(action.text, 40)}"` : 'página atual'})`;
    case 'report': return `report("${shorten(action.summary, 120)}")`;
    case 'switch_tab': return `switch_tab(${action.tab})`;
    case 'new_tab': return `new_tab("${action.url}")`;
    case 'close_tab': return `close_tab(${action.tab})`;
    case 'click_ref': return `click_ref(@${action.ref})`;
    case 'fill_ref': return `fill_ref(@${action.ref}, "${shorten(action.value)}")`;
    case 'click_text': return `click_text("${action.text}"${action.nth ? `, nth=${action.nth}` : ''})`;
    case 'click_at': return `click_at(${Math.round(action.x)}, ${Math.round(action.y)})`;
    case 'type': return `type("${shorten(action.text)}")`;
    case 'fill': return `fill(${action.selector || action.label || 'focused'}, "${shorten(action.value)}")`;
    case 'press': return `press("${action.key}")`;
    case 'navigate': return `navigate("${action.url}")`;
    case 'scroll': return `scroll("${action.direction}"${action.amount ? `, ${action.amount}` : ''})`;
    case 'wait': return action.selector ? `wait("${action.selector}")` : `wait(${action.ms ?? action.timeout ?? 1000}ms)`;
    case 'done': return `done(${action.success ? 'success' : 'failed'}: "${shorten(action.reason)}")`;
  }
}

export async function observePage(wv: Electron.WebviewTag): Promise<ObservedState> {
  // Nudge the page to wake up lazy loaders / IntersectionObservers before observing
  try {
    await wv.executeJavaScript(NUDGE_SCRIPT);
  } catch { /* ignore */ }
  const dismissed = await dismissOverlays(wv);
  const obs = await wv.executeJavaScript(OBSERVE_SCRIPT) as ObservedState;
  if (obs?.interactive_elements?.length) {
    obs.interactive_elements = prunePayloadElements(obs.interactive_elements);
    obs.interactive_elements.forEach((el, i) => { el.id = i; });
  }
  if (dismissed && obs) obs.dismissed = dismissed;
  return obs;
}

// Porteiro: pede ao main pra rodar o dispensador em TODOS os frames (alcança iframes
// de outra origem). Se fechou algo, dá um respiro pro overlay sumir antes de observar.
async function dismissOverlays(wv: Electron.WebviewTag): Promise<string> {
  const wcId = (wv as any).getWebContentsId?.() as number | undefined;
  if (wcId == null || !window.electronAPI?.dismissOverlays) return '';
  let dismissed = '';
  try { const r = await window.electronAPI.dismissOverlays(wcId); dismissed = r?.dismissed || ''; } catch { /* ok */ }
  if (dismissed) { try { await new Promise(r => setTimeout(r, 350)); } catch {} }
  return dismissed;
}

// ═══ Navalha de payload — poda agressiva p/ páginas gigantes (Reddit, GitHub, catálogos)
// (1) capa texto/aria por elemento (~70 chars + reticências);
// (2) remove duplicata pai↔filho no mesmo ponto (aninhamento div>span>a redundante);
// (3) colapsa corridas de elementos idênticos consecutivos → "2 reps + [+N similares]".
// Mantém os elementos clicáveis; o chamador reatribui os ids sequenciais depois.
function prunePayloadElements(elements: InteractiveElement[]): InteractiveElement[] {
  const CAP = 70;
  const cap = (s?: string): string | undefined => {
    if (!s) return s;
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > CAP ? t.slice(0, CAP - 1) + '…' : t;
  };
  for (const e of elements) { e.text = cap(e.text) || ''; if (e.aria) e.aria = cap(e.aria); }

  // (2) duplicata posicional pai↔filho: MESMO texto no MESMO ponto exato (centro).
  // Pai (div/link) que embrulha um único botão filho cai no mesmo centro → funde.
  // Posição EXATA (não grade) pra NUNCA fundir itens de lista adjacentes (distintos).
  const seen = new Set<string>();
  const dedup: InteractiveElement[] = [];
  for (const e of elements) {
    const t = (e.text || '').toLowerCase();
    const posKey = `${t}|${e.x}|${e.y}`;
    if (t && seen.has(posKey)) continue;   // só funde elementos COM rótulo, sobrepostos
    seen.add(posKey);
    dedup.push(e);
  }

  // (3) colapsa corridas (>=6) de assinatura idêntica consecutiva
  const sig = (e: InteractiveElement) => `${e.tag}|${e.role || ''}|${(e.text || '').toLowerCase()}`;
  const out: InteractiveElement[] = [];
  for (let i = 0; i < dedup.length;) {
    let j = i + 1;
    while (j < dedup.length && sig(dedup[j]) === sig(dedup[i])) j++;
    const run = j - i;
    if (run >= 6) {
      out.push(dedup[i], dedup[i + 1]);   // 2 representantes
      dedup[i + 2].repeatNote = run - 3;  // marcador "+N similares" no 3º
      out.push(dedup[i + 2]);             // (descarta os run-3 restantes)
    } else {
      for (let k = i; k < j; k++) out.push(dedup[k]);
    }
    i = j;
  }
  return out;
}

// ═══ AX-Tree observer (Comet-style) ═══
// Uses CDP Accessibility.getFullAXTree + DOM.getBoxModel to get
// semantically meaningful elements with real, CSS-transform-aware coordinates.
// Falls back to DOM scraping if CDP is unavailable or returns too few elements.
export async function observePageViaAXTree(
  wv: Electron.WebviewTag,
): Promise<ObservedState> {
  const wcId = (wv as any).getWebContentsId?.() as number | undefined;

  // Always nudge first (wakes up lazy loaders / IntersectionObserver)
  try { await wv.executeJavaScript(NUDGE_SCRIPT); } catch { /* ok */ }
  // PORTEIRO: fecha aviso de cookie/consent ANTES de observar (0 token, proativo)
  const dismissed = await dismissOverlays(wv);

  // --- Attempt AX Tree path ---
  if (wcId != null && window.electronAPI?.getAxTree && window.electronAPI?.getNodeCoords) {
    try {
      const axResult = await window.electronAPI.getAxTree(wcId);
      if (axResult?.ok && Array.isArray(axResult.nodes) && axResult.nodes.length > 5) {
        const elements = buildElementsFromAXTree(axResult.nodes);
        if (elements.length > 0) {
          // Resolve coordinates for all elements in a single IPC round-trip
          const idsToResolve = elements
            .filter(e => e.backendNodeId != null)
            .map(e => e.backendNodeId as number);

          if (idsToResolve.length > 0) {
            const coordsResult = await window.electronAPI.getNodeCoords(wcId, idsToResolve);
            if (coordsResult?.ok) {
              const coords = coordsResult.coords as Record<number, { x: number; y: number; w: number; h: number } | null>;
              for (const el of elements) {
                if (el.backendNodeId != null) {
                  const c = coords[el.backendNodeId];
                  if (c) { el.x = c.x; el.y = c.y; el.w = c.w; el.h = c.h; }
                }
              }
            }
          }

          // Filter out elements with no resolved coordinates (off-screen / hidden)
          const allVisible = elements.filter(e => e.w > 0 && e.h > 0 && e.x > 0 && e.y > 0);
          if (allVisible.length >= 4) {
            // PRIORIZAÇÃO POR VIEWPORT (pedido do Gemini): coords do getBoxModel são
            // relativas à viewport, então y <= innerHeight = está na tela. Elementos
            // visíveis vêm PRIMEIRO; os abaixo da dobra entram só como amostra (60) —
            // corta menus/rodapés gigantes do payload e foca o modelo no que dá pra ver.
            // (O agente ainda pode rolar a página pra revelar o resto.)
            let vh = 900;
            try { vh = (await wv.executeJavaScript('window.innerHeight')) || 900; } catch { /* default */ }
            const inView = allVisible.filter(e => e.y <= vh);
            const below = allVisible.filter(e => e.y > vh);
            const visible = [...inView, ...below.slice(0, 60)].slice(0, 200);
            // Navalha de payload (poda agressiva) + medição da economia TOTAL
            // (bruto = todos os elementos resolvidos; final = após viewport + poda).
            const approxChars = (arr: InteractiveElement[]) =>
              arr.reduce((s, e) => s + (e.text || '').length + (e.aria || '').length + (e.role || '').length + (e.href || '').length + 18, 0);
            const rawN = allVisible.length, rawC = approxChars(allVisible);
            const pruned = prunePayloadElements(visible);
            console.log(`[AXTree] poda de payload: bruto ${rawN} elems/~${rawC} chars → final ${pruned.length} elems/~${approxChars(pruned)} chars (${rawC ? Math.round((1 - approxChars(pruned) / rawC) * 100) : 0}% menor)`);
            // Reassign sequential ids
            pruned.forEach((el, i) => { el.id = i; });
            const url = wv.getURL();
            const title = wv.getTitle();
            const text_sample = await getTextSample(wv);
            return { url, title, text_sample, interactive_elements: pruned, dismissed: dismissed || undefined };
          }
        }
      }
    } catch (e) {
      console.warn('[AXTree] CDP path failed, falling back to DOM scraping:', e);
    }
  }

  // --- Fallback: DOM scraping ---
  const fallback = await wv.executeJavaScript(OBSERVE_SCRIPT) as ObservedState;
  if (fallback?.interactive_elements?.length) {
    fallback.interactive_elements = prunePayloadElements(fallback.interactive_elements);
    fallback.interactive_elements.forEach((el, i) => { el.id = i; });
  }
  if (dismissed && fallback) fallback.dismissed = dismissed;
  return fallback;
}

// Roles considered interactive by the AX tree
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio',
  'slider', 'spinbutton', 'switch', 'tab', 'treeitem', 'gridcell',
  'columnheader', 'rowheader', 'cell',
]);

// HTML tags that are inherently interactive
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select']);

function buildElementsFromAXTree(nodes: any[]): InteractiveElement[] {
  // Build a map from nodeId for parent lookups
  const nodeMap = new Map<string, any>();
  for (const n of nodes) nodeMap.set(n.nodeId, n);

  const elements: InteractiveElement[] = [];

  for (const node of nodes) {
    // Skip hidden, ignored, or generic container nodes
    if (node.ignored) continue;
    if (node.role?.value === 'none' || node.role?.value === 'presentation') continue;
    if (node.role?.value === 'generic' || node.role?.value === 'InlineTextBox') continue;
    if (!node.backendDOMNodeId) continue;

    const role = node.role?.value as string | undefined;
    const name = getProp(node, 'name')?.trim() ?? '';
    const tag = getTagFromRole(role);

    // Only include roles we care about, or nodes explicitly marked focusable
    const isFocusable = node.properties?.some((p: any) => p.name === 'focusable' && p.value?.value === true);
    const isInteractive = (role && INTERACTIVE_ROLES.has(role)) || isFocusable || INTERACTIVE_TAGS.has(tag);
    if (!isInteractive) continue;

    // Skip nodes with no useful name (pure icon buttons are ok if they have aria)
    if (!name && !role) continue;

    const pressedProp = node.properties?.find((p: any) => p.name === 'pressed');
    const checkedProp = node.properties?.find((p: any) => p.name === 'checked');
    const disabledProp = node.properties?.find((p: any) => p.name === 'disabled');
    // Skip truly disabled elements
    if (disabledProp?.value?.value === true) continue;

    elements.push({
      id: elements.length,
      tag,
      text: name.slice(0, 120),
      x: 0, // will be resolved by DOM.getBoxModel
      y: 0,
      w: 0,
      h: 0,
      role: role || undefined,
      aria: name ? name.slice(0, 80) : undefined,
      placeholder: getProp(node, 'placeholder')?.slice(0, 40),
      pressed: pressedProp ? pressedProp.value?.value === true || pressedProp.value?.value === 'true' : undefined,
      checked: checkedProp ? checkedProp.value?.value === true || checkedProp.value?.value === 'true' : undefined,
      backendNodeId: node.backendDOMNodeId as number,
    });
  }

  return elements;
}

function getProp(node: any, propName: string): string | undefined {
  // name/description/placeholder can be in node.name, node.description, or node.properties
  if (propName === 'name') {
    const v = node.name?.value;
    return typeof v === 'string' ? v : undefined;
  }
  if (propName === 'placeholder') {
    const p = node.properties?.find((x: any) => x.name === 'placeholder');
    const v = p?.value?.value;
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

function getTagFromRole(role?: string): string {
  switch (role) {
    case 'button': return 'button';
    case 'link': return 'a';
    case 'textbox': case 'searchbox': return 'input';
    case 'combobox': return 'select';
    case 'checkbox': return 'input';
    case 'radio': return 'input';
    default: return 'div';
  }
}

async function getTextSample(wv: Electron.WebviewTag): Promise<string> {
  try {
    return await wv.executeJavaScript(
      `(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 1200)`
    );
  } catch { return ''; }
}

const NUDGE_SCRIPT = `
(function(){
  try {
    window.focus();
    document.body && document.body.focus && document.body.focus();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    window.scrollBy(0, 1); window.scrollBy(0, -1);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('mousemove'));
  } catch(e) {}
  return true;
})()
`;

// PORTEIRO de overlays (cookie/consent) → movido p/ src/main/overlay-script.ts e executado
// em TODOS os frames via o IPC `overlays:dismiss` (alcança iframes de outra origem, ex.:
// Sourcepoint). Ver dismissOverlays() abaixo.

// Espera a página ASSENTAR (o DOM parar de crescer) em vez de tempo fixo. Retorna assim
// que estabiliza (mesma contagem de elementos por `quietMs`, com readyState=complete) —
// rápido em página rápida, e só o necessário em página lenta (até maxMs). Substitui os
// setTimeout fixos pós-navegação (que sempre esperavam o pior caso).
export async function waitForSettle(
  wv: Electron.WebviewTag,
  opts?: { maxMs?: number; quietMs?: number; minMs?: number },
): Promise<void> {
  const maxMs = opts?.maxMs ?? 4000;
  const quietMs = opts?.quietMs ?? 350;
  const start = Date.now();
  if (opts?.minMs) { try { await new Promise(r => setTimeout(r, opts.minMs)); } catch {} }
  let lastCount = -1;
  let stableSince = 0;
  while (Date.now() - start < maxMs) {
    let snap: { rs: string; n: number } | null = null;
    try {
      snap = await wv.executeJavaScript(`({ rs: document.readyState, n: document.getElementsByTagName('*').length })`, false);
    } catch { return; }   // webview ocupado/trocou de página: não trava
    if (!snap) return;
    if (snap.n === lastCount) {
      if (!stableSince) stableSince = Date.now();
      if (snap.rs === 'complete' && Date.now() - stableSince >= quietMs) return;   // assentou
    } else {
      lastCount = snap.n;
      stableSince = 0;
    }
    await new Promise(r => setTimeout(r, 120));
  }
}

export async function executeBrowserAction(wv: Electron.WebviewTag, action: BrowserAction): Promise<ToolResult> {
  if (action.type === 'navigate') {
    if (!action.url) return { success: false, error: 'Missing url' };
    const target = normalizeUrl(action.url);
    try { await wv.loadURL(target); } catch (e: any) { /* ignore mid-load aborts */ }
    // Wait until page settles or timeout
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        wv.removeEventListener('did-stop-loading', onStop);
        resolve();
      }, 12000);
      const onStop = () => {
        wv.removeEventListener('did-stop-loading', onStop);
        window.clearTimeout(timer);
        // small grace period for async scripts / framework hydration
        window.setTimeout(resolve, 800);
      };
      if (!wv.isLoading()) {
        window.setTimeout(() => { window.clearTimeout(timer); resolve(); }, 800);
      } else {
        wv.addEventListener('did-stop-loading', onStop);
      }
    });
    return { success: true, info: { url: wv.getURL() } };
  }

  if (action.type === 'done') {
    return { success: action.success, info: { reason: action.reason } };
  }

  const payload = JSON.stringify(action);
  return wv.executeJavaScript(`
    (async () => {
      ${PAGE_TOOLS_SCRIPT}
      return await window.__browserTools.execute(${payload});
    })()
  `);
}

export function hashScreenshotDataUrl(dataUrl?: string): string {
  if (!dataUrl) return '';
  let hash = 5381;
  const step = Math.max(1, Math.floor(dataUrl.length / 6000));
  for (let i = 0; i < dataUrl.length; i += step) {
    hash = ((hash << 5) + hash) ^ dataUrl.charCodeAt(i);
  }
  return String(hash >>> 0);
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || /^file:/i.test(url)) return url;
  return `https://${url}`;
}

function shorten(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

const OBSERVE_SCRIPT = `
(function() {
  const selector = 'a,button,input,textarea,select,[contenteditable="true"],[role=textbox],[role=button],[role=link],[tabindex]:not([tabindex="-1"])';
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && r.bottom >= 0 && r.right >= 0 && r.top <= innerHeight && r.left <= innerWidth;
  };
  const textFor = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').replace(/\\s+/g, ' ').trim();
  const elements = Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .slice(0, 200)
    .map((el, id) => {
      const r = el.getBoundingClientRect();
      const ariaLabel = el.getAttribute('aria-label') || '';
      const innerText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const text = (innerText || ariaLabel || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').slice(0, 120);
      const pressed = el.getAttribute('aria-pressed');
      const checked = el.getAttribute('aria-checked');
      return {
        id,
        tag: el.tagName.toLowerCase(),
        text,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        role: el.getAttribute('role') || undefined,
        href: el.href || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        aria: ariaLabel ? ariaLabel.slice(0, 80) : undefined,
        pressed: pressed === 'true' ? true : (pressed === 'false' ? false : undefined),
        checked: checked === 'true' ? true : (checked === 'false' ? false : undefined),
      };
    });
  return {
    url: location.href,
    title: document.title,
    text_sample: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 1200),
    interactive_elements: elements,
  };
})()
`;

const PAGE_TOOLS_SCRIPT = `
window.__browserTools = window.__browserTools || {
  visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0)) return false;
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (s.pointerEvents === 'none') return false;
    const opacity = parseFloat(s.opacity);
    if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
    return true;
  },
  // Retorna {ok, covering} verificando se o ponto central do elemento realmente
  // atinge o próprio elemento (ou um ancestral/descendente). Caso contrário, há
  // um overlay/modal por cima e o clique acertaria o elemento errado.
  coverageCheck(el) {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { ok: true }; // fora do viewport: não bloqueia (será tratado pelo scroll)
    if (hit === el || el.contains(hit) || hit.contains(el)) return { ok: true };
    const desc = (hit.tagName || '?').toLowerCase()
      + (hit.id ? '#' + hit.id : '')
      + (hit.getAttribute && hit.getAttribute('aria-label') ? ' [' + hit.getAttribute('aria-label').slice(0, 40) + ']' : '');
    return { ok: false, covering: desc };
  },
  label(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').replace(/\\s+/g, ' ').trim();
  },
  fireClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
    }
    if (typeof el.click === 'function') el.click();
  },
  async execute(action) {
    try {
      switch (action.type) {
        case 'click_ref': return this.clickRef(action.ref);
        case 'fill_ref': return this.fillRef(action.ref, action.value);
        case 'click_text': return this.clickText(action.text, action.nth);
        case 'click_at': return this.clickAt(action.x, action.y);
        case 'type': return this.typeText(action.text);
        case 'fill': return this.fill(action);
        case 'press': return this.press(action.key);
        case 'scroll': return this.scroll(action.direction, action.amount);
        case 'wait': return await this.wait(action);
        default: return { success: false, error: 'Unknown action: ' + action.type };
      }
    } catch (err) {
      return { success: false, error: String(err && err.message || err) };
    }
  },
  enumerate() {
    const sel = 'a,button,input,textarea,select,[contenteditable="true"],[role=textbox],[role=button],[role=link],[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll(sel)).filter(el => this.visible(el)).slice(0, 120);
  },
  byRef(ref) {
    const list = this.enumerate();
    return list[Number(ref)] || null;
  },
  clickRef(ref) {
    const el = this.byRef(ref);
    if (!el) return { success: false, error: 'No element with ref @' + ref };
    const link = el.closest('a[href]');
    if (link && link.href && !link.href.startsWith('javascript:')) {
      location.href = link.href;
      return { success: true, info: { navigated: link.href, ref } };
    }
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const cov = this.coverageCheck(el);
    if (!cov.ok) return { success: false, reason: 'element_covered', covering: cov.covering, error: 'Element @' + ref + ' is covered by: ' + cov.covering };
    this.fireClick(el);
    return { success: true, info: { ref, tag: el.tagName, text: this.label(el).slice(0, 120) } };
  },
  fillRef(ref, value) {
    const el = this.byRef(ref);
    if (!el) return { success: false, error: 'No element with ref @' + ref };
    el.focus();
    this.insertText(el, String(value || ''), true);
    return { success: true, info: { ref, tag: el.tagName, valueLength: String(value || '').length } };
  },
  clickText(text, nth = 1) {
    const needle = String(text || '').toLowerCase().trim();
    if (!needle) return { success: false, error: 'Missing text' };
    const NEG = ['não ', 'nao ', 'no ', 'un', 'dis', 'don\\'t ', 'do not ', 'desfazer ', 'remover ', 'cancelar '];
    const NEG_SCORE = 900;
    const escapeRe = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    const wordRe = new RegExp('(^|\\\\W)' + escapeRe(needle) + '($|\\\\W)');
    const score = (label) => {
      const l = label.toLowerCase().trim();
      if (!l.includes(needle)) return 999;
      for (const neg of NEG) { if (l.includes(neg + needle)) return NEG_SCORE; }
      if (l === needle) return 0;
      if (wordRe.test(l)) return 1;
      return 5;
    };
    const selector = 'a,button,[role=button],[role=link],input,textarea,select,[contenteditable="true"],[role=textbox],[tabindex]:not([tabindex="-1"]),span,div,p';
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(el => this.visible(el))
      .filter(el => this.label(el).toLowerCase().includes(needle))
      .sort((a, b) => {
        const sa = score(this.label(a));
        const sb = score(this.label(b));
        if (sa !== sb) return sa - sb;
        const ap = a.closest('a,button,[role=button],[role=link]') ? 0 : 1;
        const bp = b.closest('a,button,[role=button],[role=link]') ? 0 : 1;
        return ap - bp || this.label(a).length - this.label(b).length;
      });
    const raw = candidates[Math.max(0, Number(nth || 1) - 1)];
    if (!raw) return { success: false, error: 'No visible element contains text: ' + text };
    // Reject if best candidate is a negation (e.g. "Não gostei" for needle "Gostei")
    if (score(this.label(raw)) >= NEG_SCORE) return { success: false, error: 'Only negated matches found for: ' + text + ' (e.g. "' + this.label(raw).slice(0, 60) + '"). Use click_ref with the exact element ref instead.' };
    const el = raw.closest('a,button,[role=button],[role=link]') || raw;
    const link = el.closest('a[href]');
    if (link && link.href && !link.href.startsWith('javascript:')) {
      location.href = link.href;
      return { success: true, info: { navigated: link.href, text: this.label(link) } };
    }
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const cov = this.coverageCheck(el);
    if (!cov.ok) return { success: false, reason: 'element_covered', covering: cov.covering, error: 'Element "' + text + '" is covered by: ' + cov.covering };
    this.fireClick(el);
    return { success: true, info: { tag: el.tagName, text: this.label(el).slice(0, 120) } };
  },
  clickAt(x, y) {
    const el = document.elementFromPoint(Number(x), Number(y));
    if (!el) return { success: false, error: 'No element at coordinates' };
    this.fireClick(el);
    return { success: true, info: { tag: el.tagName, text: this.label(el).slice(0, 120), x, y } };
  },
  typeText(text) {
    const el = this.editableTarget(document.activeElement);
    if (!el) return { success: false, error: 'No focused element' };
    this.insertText(el, String(text || ''), false);
    return { success: true, info: { tag: el.tagName, contentEditable: el.isContentEditable, textLength: String(text || '').length } };
  },
  fill(action) {
    const el = this.findField(action) || this.editableTarget(document.activeElement);
    if (!el) return { success: false, error: 'No matching input found' };
    el.focus();
    this.insertText(el, String(action.value || ''), true);
    return { success: true, info: { tag: el.tagName, contentEditable: el.isContentEditable, valueLength: String(action.value || '').length } };
  },
  insertText(el, value, replace) {
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
      el.focus();
      if (replace) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: value, inputType: replace ? 'insertReplacementText' : 'insertText' }));
      if (!document.execCommand('insertText', false, value)) {
        if (replace) el.textContent = value;
        else el.textContent = (el.textContent || '') + value;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: replace ? 'insertReplacementText' : 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    // Frameworks (React/Vue) often listen to key events; emit a representative pair
    // so controlled inputs and date pickers register the change.
    const keyOpts = { bubbles: true, cancelable: true, key: value.slice(-1) || 'a' };
    el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  editableTarget(el) {
    if (!el) return null;
    if (el.matches && (el.matches('input,textarea,select,[contenteditable="true"],[role=textbox]') || el.isContentEditable)) return el;
    return el.closest && el.closest('input,textarea,select,[contenteditable="true"],[role=textbox]');
  },
  findField(action) {
    if (action.selector) {
      const direct = document.querySelector(action.selector);
      if (direct) return direct;
    }
    const label = String(action.label || '').toLowerCase().trim();
    const fields = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"],[role=textbox]'));
    if (!label) return this.editableTarget(document.activeElement) || fields.find(el => this.visible(el));
    for (const el of fields) {
      const idLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
      const haystack = [
        el.name,
        el.id,
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        idLabel && this.label(idLabel),
        el.closest('label') && this.label(el.closest('label')),
      ].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(label) && this.visible(el)) return el;
    }
    return null;
  },
  press(key) {
    const target = document.activeElement || document.body;
    const normalized = String(key || 'Enter');
    for (const type of ['keydown', 'keypress', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key: normalized, code: normalized, bubbles: true, cancelable: true }));
    }
    if (normalized === 'Enter') {
      const button = Array.from(document.querySelectorAll('button,[role=button]'))
        .filter(el => this.visible(el))
        .find(el => /generate|criar|gerar|submit|enviar|continuar|next/i.test(this.label(el)));
      if (button) {
        this.fireClick(button);
        return { success: true, info: { key: normalized, clickedFallback: this.label(button).slice(0, 120) } };
      }
    }
    return { success: true, info: { key: normalized } };
  },
  scroll(direction, amount) {
    const n = Number(amount || 650);
    const map = { up: -n, down: n, top: -document.documentElement.scrollHeight, bottom: document.documentElement.scrollHeight };
    window.scrollBy({ top: map[direction] || n, behavior: 'smooth' });
    return { success: true, info: { direction, amount: n } };
  },
  async wait(action) {
    if (action.selector) {
      const timeout = Number(action.timeout || 5000);
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (document.querySelector(action.selector)) return { success: true, info: { selector: action.selector } };
        await new Promise(r => setTimeout(r, 200));
      }
      return { success: false, error: 'Timed out waiting for selector: ' + action.selector };
    }
    await new Promise(r => setTimeout(r, Number(action.ms || 1000)));
    return { success: true, info: { waitedMs: Number(action.ms || 1000) } };
  }
};
`;
