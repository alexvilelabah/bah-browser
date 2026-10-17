import React, { useEffect, useRef } from 'react';
import { Tab } from '../store';
import { webviewOrder } from '../../shared/tab-strip';
import { partitionFor } from '../../shared/incognito';

interface Props {
  tabs: Tab[];
  activeTabId: string;
  webviewRefs: React.MutableRefObject<Map<string, Electron.WebviewTag>>;
  onUpdateTab: (id: string, patch: Partial<Tab>) => void;
  onNewTab: (url?: string) => void;
}

export default function WebViewContainer({ tabs, activeTabId, webviewRefs, onUpdateTab, onNewTab }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boundIds = useRef<Set<string>>(new Set());
  // Keep the bound element + its listeners so we can detach when a tab closes.
  const boundHandlers = useRef<Map<string, { wv: any; handlers: Array<[string, EventListener]> }>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const webviews = container.querySelectorAll('webview');
    webviews.forEach((wv: any) => {
      const tabId = wv.dataset.tabId;
      if (!tabId || boundIds.current.has(tabId)) return;

      webviewRefs.current.set(tabId, wv);
      boundIds.current.add(tabId);

      const handlers: Array<[string, EventListener]> = [
        ['did-start-loading', () => onUpdateTab(tabId, { isLoading: true })],
        ['did-stop-loading', () => onUpdateTab(tabId, {
          isLoading: false,
          title: wv.getTitle() || 'Untitled',
          url: wv.getURL(),
          canGoBack: wv.canGoBack(),
          canGoForward: wv.canGoForward(),
        })],
        ['page-title-updated', (e: any) => onUpdateTab(tabId, { title: e.title })],
        // O ícone que a página declarou (<link rel="icon">) — muitos sites não têm /favicon.ico e a
        // aba ficava sem nada. Guarda junto a origem: navegou pra outro site, este não vale mais.
        ['page-favicon-updated', (e: any) => {
          const list: unknown[] = Array.isArray(e?.favicons) ? e.favicons : [];
          const icon = list.find((u): u is string => typeof u === 'string' && u.length <= 200_000
            && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)));
          if (!icon) return;
          let origin = '';
          try { origin = new URL(wv.getURL()).origin; } catch {}
          if (origin) onUpdateTab(tabId, { favicon: icon, faviconOrigin: origin });
        }],
        ['did-navigate', (e: any) => onUpdateTab(tabId, { url: e.url, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })],
        ['did-navigate-in-page', (e: any) => onUpdateTab(tabId, { url: e.url })],
        // NÃO existe listener de 'new-window' aqui: o evento foi removido da <webview> no
        // Electron 22 e este projeto roda o 42 (a interface WebviewTag em electron.d.ts
        // não o declara). Quem decide popup é o setWindowOpenHandler no main, em
        // did-attach-webview. Um listener aqui nunca dispararia e enganaria quem lesse.
      ];
      for (const [ev, fn] of handlers) wv.addEventListener(ev, fn);
      boundHandlers.current.set(tabId, { wv, handlers });
    });

    // Cleanup removed OR discarded tabs — detach listeners so unmounted webviews don't
    // linger (a discarded tab must re-bind cleanly when it wakes up and remounts).
    const mountedIds = new Set(tabs.filter(t => !t.discarded).map(t => t.id));
    for (const id of Array.from(boundIds.current)) {
      if (!mountedIds.has(id)) {
        const bound = boundHandlers.current.get(id);
        if (bound) { for (const [ev, fn] of bound.handlers) { try { bound.wv.removeEventListener(ev, fn); } catch {} } }
        boundHandlers.current.delete(id);
        boundIds.current.delete(id);
        webviewRefs.current.delete(id);
      }
    }
  });

  // Capture each tab's initial src ONCE so React re-renders don't trigger reloads.
  // A discarded tab loses its entry → when it wakes, it remounts at the CURRENT url.
  const initialSrcRef = useRef<Map<string, string>>(new Map());
  const liveIds = new Set(tabs.map(t => t.id));
  for (const id of Array.from(initialSrcRef.current.keys())) {
    if (!liveIds.has(id)) initialSrcRef.current.delete(id);   // closed tabs: free the entry
  }
  for (const tab of tabs) {
    if (tab.discarded) { initialSrcRef.current.delete(tab.id); continue; }
    if (!initialSrcRef.current.has(tab.id)) {
      initialSrcRef.current.set(tab.id, tab.url || 'about:blank');
    }
  }

  // Os <webview> ficam na ordem em que cada aba CHEGOU, nunca na ordem da barra. Arrastar uma
  // aba, "Nova aba à direita", "Duplicar" e Fixar mudam a ordem da lista; se os <webview>
  // seguissem essa ordem, o React MOVERIA o elemento no DOM — e <webview> movido desanexa a
  // página e recarrega do zero (vídeo, formulário, login em andamento: tudo perdido). Assim
  // nenhum se mexe: aba nova entra no fim, fechada sai, a que acorda (Memory Saver) volta pra
  // casa dela — inserir/remover não move os vizinhos. A posição na tela é só o display.
  const mountSeqRef = useRef<Map<string, number>>(new Map());

  return (
    <div className="webview-container" ref={containerRef}>
      {webviewOrder(tabs, mountSeqRef.current).map(tab => (
        <webview
          key={tab.id}
          data-tab-id={tab.id}
          src={initialSrcRef.current.get(tab.id)}
          style={{
            width: '100%',
            height: '100%',
            display: tab.id === activeTabId ? 'flex' : 'none',
            backgroundColor: '#262624',
          }}
          // @ts-ignore
          allowpopups="true"
          // Aba normal: persist:browser (em disco). Aba anônima: a sessão só na memória que todas as
          // anônimas dividem (shared/incognito.ts). Nunca muda depois que a <webview> nasce.
          partition={partitionFor(tab.incognito)}
          // Cache de bytecode V8: o JS dos sites compila 1x e reusa nas visitas seguintes. Página do
          // computador aberta de fora: sem JavaScript (store.ts → noScript; vale pra vida da <webview>).
          webpreferences={tab.noScript ? 'v8CacheOptions=bypassHeatCheck, javascript=no' : 'v8CacheOptions=bypassHeatCheck'}
        />
      ))}
    </div>
  );
}
