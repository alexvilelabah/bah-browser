import React, { useEffect, useRef } from 'react';
import { Tab } from '../store';

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
        ['did-navigate', (e: any) => onUpdateTab(tabId, { url: e.url, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })],
        ['did-navigate-in-page', (e: any) => onUpdateTab(tabId, { url: e.url })],
        ['new-window', (e: any) => { e.preventDefault(); if (e.url && e.url !== 'about:blank') onNewTab(e.url); }],
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

  return (
    <div className="webview-container" ref={containerRef}>
      {tabs.filter(tab => !tab.discarded).map(tab => (
        <webview
          key={tab.id}
          data-tab-id={tab.id}
          src={initialSrcRef.current.get(tab.id)}
          style={{
            width: '100%',
            height: '100%',
            display: tab.id === activeTabId ? 'flex' : 'none',
            backgroundColor: '#121214',
          }}
          // @ts-ignore
          allowpopups="true"
          partition="persist:browser"
          // Cache de bytecode V8: o JS dos sites compila 1x e reusa nas visitas seguintes.
          webpreferences="v8CacheOptions=bypassHeatCheck"
        />
      ))}
    </div>
  );
}
