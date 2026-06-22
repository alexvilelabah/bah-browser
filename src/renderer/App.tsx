import React, { useRef, useCallback, useEffect, useState } from 'react';
import AgentVisualOverlay, { AgentVisualState, ClickRipple } from './components/AgentVisualOverlay';
import { useTabStore } from './store';
import TabBar from './components/TabBar';
import AddressBar from './components/AddressBar';
import AgentCommandBar, { AgentProgressEvent } from './components/AgentCommandBar';
import { classifyRisk, riskForAction, RiskInfo } from './risk';
import { t, onLangChange, getLang } from './i18n';
import WebViewContainer from './components/WebViewContainer';
import SpeedDialOverlay from './components/SpeedDialOverlay';
import {
  BrowserAction,
  executeBrowserAction,
  formatAction,
  hashScreenshotDataUrl,
  ObservedState,
  observePage,
  observePageViaAXTree,
  waitForSettle,
} from './page-executor';
import {
  buildKnownSitesBlock,
  detectQuickAction,
  getInitialShortcutAction,
  rememberActionForSite,
  rememberObservedSite,
  type QuickAction,
} from './site-knowledge';
import { loadLastMacro, parseRepeatIntent, saveLastMacro, toDurableAction } from './macros';
import {
  AgentRecoveryManager,
  recoveryInstruction,
} from './agent-recovery';
import {
  detectManualHelpNeed,
  manualHelpHistoryNote,
  type ManualHelpRequest,
} from './agent-login-policy';
import {
  appendAgentRunStep,
  finishAgentRun,
  startAgentRun,
  summarizeAction,
  summarizeResult,
} from './agent-run-logger';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      setAIProvider: (provider: string, apiKey: string, baseUrl?: string) => Promise<any>;
      setUILanguage?: (lang: string) => Promise<any>;
      onZoom?: (cb: (pct: number) => void) => void;
      setLocalProvider?: (provider: string, apiKey: string, baseUrl?: string, modelName?: string) => Promise<any>;
      aiChat: (message: string, pageContent?: string, stateless?: boolean, local?: boolean) => Promise<{ response?: string; error?: string }>;
      aiAction: (command: string, pageContent?: string, screenshot?: string, tier?: 'local' | 'flash' | 'pro') => Promise<any>;
      onOpenNewTab?: (cb: (url: string) => void) => void;
      realClick?: (wcId: number, x: number, y: number, backendNodeId?: number) => Promise<any>;
      realType?: (wcId: number, text: string) => Promise<any>;
      realKey?: (wcId: number, key: string) => Promise<any>;
      getAxTree?: (wcId: number) => Promise<any>;
      getNodeCoords?: (wcId: number, backendNodeIds: number[]) => Promise<any>;
      verifyClick?: (wcId: number, backendNodeId: number) => Promise<{ ok?: boolean; stale?: boolean; covered?: boolean; covering?: string; x?: number; y?: number; error?: string }>;
      fillNode?: (wcId: number, backendNodeId: number, value: string) => Promise<{ ok?: boolean; error?: string }>;
      downloadUrl?: (url: string, filename?: string) => Promise<{ success: boolean; info?: { path: string; bytes: number; contentType?: string }; error?: string }>;
      searchImages?: (query: string, minWidth?: number, count?: number) => Promise<{ success: boolean; count?: number; images: Array<{ url: string; thumbnail?: string; width: number; height: number; title: string; source: string; license: string }>; error?: string }>;
      onDownloadEvent?: (cb: (info: { id?: string; state: string; filename: string; path?: string; url?: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number; paused?: boolean; reason?: string }) => void) => void;
      pauseDownload?: (id: string) => Promise<any>;
      resumeDownload?: (id: string) => Promise<any>;
      cancelDownload?: (id: string) => Promise<any>;
      retryDownload?: (id: string, url?: string) => Promise<any>;
      openFile?: (target: string) => Promise<any>;
      revealInFolder?: (target: string) => Promise<any>;
      downloadVideo?: (url: string, audioOnly?: boolean, count?: number, quality?: 'best' | 'low') => Promise<{ success: boolean; path?: string; paths?: string[]; title?: string; error?: string }>;
      resolveVideo?: (query: string) => Promise<{ ok: boolean; url?: string; id?: string; title?: string; error?: string }>;
      resolveVideos?: (queries: string[]) => Promise<Array<{ query: string; id?: string; title?: string }>>;
      resolveManyVideos?: (query: string, count: number) => Promise<{ ok: boolean; videos: Array<{ id: string; title: string; url: string }>; error?: string }>;
      searchVideoCuts?: (phrase: string, count?: number) => Promise<{ success: boolean; cuts: Array<{ videoId: string; seconds: number; title?: string }>; source?: string; error?: string }>;
      renderView?: (spec: object) => Promise<{ success: boolean; url?: string; error?: string }>;
      harvestImages?: (urls: string[], theme: string) => Promise<{ success: boolean; saved: number; dir?: string; paths?: string[]; error?: string }>;
      revealInFolder?: (target: string) => Promise<{ success: boolean; error?: string }>;
      googleLogin?: () => Promise<{ ok: boolean; copied?: number; browser?: string; error?: string }>;
      onShortcut?: (cb: (action: string) => void) => (() => void) | void;
      dismissOverlays?: (wcId: number) => Promise<{ dismissed: string }>;
      makeSupercut?: (phrase: string, count?: number) => Promise<{ success: boolean; dir?: string; paths?: string[]; clipCount?: number; clips?: Array<{ title?: string; videoId: string; seconds: number }>; error?: string }>;
      onSupercutProgress?: (cb: (p: { stage: string; message: string; current?: number; total?: number }) => void) => () => void;
      // ── Editor de vídeo local (ffmpeg nativo) ──
      pickVideo?: () => Promise<{ canceled: boolean; path?: string }>;
      getPathForFile?: (file: File) => string;
      editTrim?: (input: string, startSec: number, endSec: number) => Promise<{ success: boolean; path?: string; error?: string; info?: any }>;
      editRemoveSilence?: (input: string, opts?: { noiseDb?: number; minSilence?: number; pad?: number }) => Promise<{ success: boolean; path?: string; error?: string; info?: any }>;
      editExtractAudio?: (input: string) => Promise<{ success: boolean; path?: string; error?: string; info?: any }>;
      onVideoEditProgress?: (cb: (p: { stage: string; message: string; percent?: number }) => void) => () => void;
      stockMovers?: (direction: string, count?: number) => Promise<{ success: boolean; spec?: any; error?: string }>;
      onVideoProgress?: (cb: (p: { state: string; percent?: number; title?: string; path?: string; error?: string; speed?: string; eta?: string }) => void) => void;
      adblockGetState?: () => Promise<{ enabled: boolean; active: boolean; bypassedHosts: string[] }>;
      adblockSetEnabled?: (on: boolean) => Promise<{ enabled: boolean }>;
      adblockActiveHostChanged?: (host: string) => Promise<{ active: boolean }>;
      onSafeBrowsingBlock?: (cb: (info: { url: string; host: string }) => void) => void;
      takeOcr?: (wcId: number, domText: string, force?: boolean) => Promise<{
        ocrText: string; ocrUsed: boolean; skipped: boolean;
        confidence?: number; screenshotPath?: string; durationMs?: number; error?: string;
      }>;
    };
  }
}

export default function App() {
  const store = useTabStore();
  const webviewRefs = useRef<Map<string, Electron.WebviewTag>>(new Map());
  const [agentVisual, setAgentVisual] = useState<AgentVisualState>('idle');
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const [lastFooterMsg, setLastFooterMsg] = useState<string>('');
  const rippleId = useRef(0);
  const activeTabIdRef = useRef(store.activeTabId);
  useEffect(() => { activeTabIdRef.current = store.activeTabId; }, [store.activeTabId]);
  // #12: o loop do agente é uma closure longa — `store.tabs` capturado no render fica
  // DEFASADO se o agente abre/fecha abas durante a execução. Espelhamos a lista viva
  // num ref pra switch_tab/close_tab/contexto do modelo lerem o estado atual, não o velho.
  const tabsRef = useRef(store.tabs);
  useEffect(() => { tabsRef.current = store.tabs; }, [store.tabs]);
  // Site-initiated downloads (will-download no main) — drenados pelo loop do agente
  // para a IA saber que o clique em "baixar" realmente produziu um arquivo.
  const downloadEventsRef = useRef<Array<{ state: string; filename: string; path?: string; bytes?: number; reason?: string }>>([]);

  // ── Supercut: abas "armadas" em pausa ───────────────────────────────────────
  // open_video_cuts abre abas do YouTube já na minutagem certa, mas o YouTube dá
  // autoplay em segundo plano (4 abas tocando som juntas). O guard injetado pausa
  // e silencia o vídeo (e RE-pausa se o player tentar tocar); quando o usuário
  // CLICA na aba, o release dá play exatamente do ponto onde a frase é dita.
  const pausedCutTabsRef = useRef<Map<string, number>>(new Map());

  // ── Memória curta da conversa ───────────────────────────────────────────────
  // O usuário emenda pedidos ("e com a palavra bom dia?") esperando que o agente
  // lembre do anterior. Guardamos os últimos comandos+desfechos (vai no GOAL do
  // modelo) e a última quick action (pra follow-up determinístico sem IA).
  const recentRunsRef = useRef<Array<{ cmd: string; outcome: string }>>([]);
  const lastQuickActionRef = useRef<QuickAction | null>(null);
  // Gravação de macro: ações duráveis executadas com sucesso no run atual.
  // No fim (sucesso), vira a "receita" que o usuário repete sem gastar IA.
  const macroTraceRef = useRef<BrowserAction[]>([]);
  const VCUT_GUARD_JS = `(function(){
    if (window.__vcutArmed) return 'armed';
    window.__vcutArmed = true;
    window.__vcutHold = true;
    var bind = function(){
      var v = document.querySelector('video');
      if (!v) return false;
      if (!v.__vcutBound) {
        v.__vcutBound = true;
        v.addEventListener('play', function(){ if (window.__vcutHold) { try { v.pause(); } catch(e){} } });
      }
      if (window.__vcutHold) { try { v.muted = true; v.pause(); } catch(e){} }
      return true;
    };
    window.__vcutRelease = function(){
      window.__vcutHold = false;
      var v = document.querySelector('video');
      if (v) { try { v.muted = false; v.play(); } catch(e){} }
    };
    var n = 0;
    var iv = setInterval(function(){ n++; bind(); if (n > 60 || !window.__vcutHold) clearInterval(iv); }, 500);
    bind();
    return 'ok';
  })()`;
  const VCUT_RELEASE_JS = `(function(){ if (window.__vcutRelease) { window.__vcutRelease(); return 'released'; } return 'noop'; })()`;

  /** Fica tentando injetar o guard até o webview da aba existir e a página aceitar JS. */
  const armCutTab = useCallback((tabId: string) => {
    (async () => {
      for (let i = 0; i < 40; i++) {
        const wv = webviewRefs.current.get(tabId) as any;
        if (wv) {
          // Muta no nível do Electron NA HORA (sem esperar o JS injetar) → mata o
          // "pisco de som" antes do guard conseguir pausar o vídeo.
          try { wv.setAudioMuted(true); } catch {}
          try {
            const r = await wv.executeJavaScript(VCUT_GUARD_JS, false);
            if (r === 'ok' || r === 'armed') return;
          } catch { /* página ainda carregando — tenta de novo */ }
        }
        await new Promise(r => setTimeout(r, 700));
      }
    })().catch(() => {});
  }, []);

  // Usuário clicou numa aba armada → solta o play no ponto exato.
  useEffect(() => {
    const id = store.activeTabId;
    if (!pausedCutTabsRef.current.has(id)) return;
    pausedCutTabsRef.current.delete(id);
    const wv = webviewRefs.current.get(id) as any;
    try { wv?.setAudioMuted(false); } catch {}   // usuário abriu a aba → libera o som
    setTimeout(() => { try { wv?.executeJavaScript(VCUT_RELEASE_JS, false); } catch {} }, 250);
  }, [store.activeTabId]);

  const addRipple = useCallback((x: number, y: number) => {
    const id = ++rippleId.current;
    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 1100);
  }, []);

  const [adblockOn, setAdblockOn] = useState(true);
  const [adblockActive, setAdblockActive] = useState(true);
  // Menu ⋮ (canto superior) + favoritos (estilo Chrome, salvos localmente).
  const [menuOpen, setMenuOpen] = useState(false);
  const [favorites, setFavorites] = useState<Array<{ url: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('favorites.v1') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    window.electronAPI?.setAIProvider(store.aiSettings.provider, store.aiSettings.apiKey, store.aiSettings.baseUrl);
    window.electronAPI?.setUILanguage?.(getLang());   // i18n Fase 2: agente responde no idioma da UI
    window.electronAPI?.onZoom?.((pct) => showZoom(pct));   // Ctrl+roda → badge de zoom na tela
    // Initialize local (GPU) engine if hybrid is enabled
    if (store.localSettings.enabled) {
      window.electronAPI?.setLocalProvider?.(store.localSettings.provider, 'local', store.localSettings.baseUrl, store.localSettings.model);
    }
    window.electronAPI?.onOpenNewTab?.((url: string) => store.addTab(url));
    window.electronAPI?.adblockGetState?.().then(s => { setAdblockOn(s.enabled); setAdblockActive(s.active); });
    window.electronAPI?.onSafeBrowsingBlock?.((info) => {
      setLastFooterMsg(`⚠️ Site malicioso bloqueado: ${info.host} (${info.url})`);
    });
    window.electronAPI?.onDownloadEvent?.((info) => {
      downloadEventsRef.current.push(info);
      setDownloads(prev => {
        const key = info.id || info.path || info.filename;
        const existing = prev.find(d => (d.id || d.path || d.filename) === key);
        const rest = prev.filter(d => (d.id || d.path || d.filename) !== key);
        const done = info.state === 'completed' || info.state === 'failed' || info.state === 'cancelled';
        const merged = {
          ...existing,
          id: info.id ?? existing?.id,
          filename: info.filename ?? existing?.filename ?? 'download',
          path: info.path ?? existing?.path,
          url: info.url ?? existing?.url,
          bytes: info.bytes ?? existing?.bytes,
          totalBytes: info.totalBytes ?? existing?.totalBytes,
          state: info.state,
          paused: done ? false : (info.paused ?? existing?.paused),
          speedBps: done ? 0 : (info.speedBps ?? existing?.speedBps),
          etaSec: done ? undefined : (info.etaSec ?? existing?.etaSec),
        };
        return [merged, ...rest].slice(0, 50);
      });
      if (info.state === 'completed') setLastFooterMsg(`💾 Baixado: ${info.filename} (${Math.round((info.bytes || 0) / 1024)} KB)`);
      else if (info.state === 'blocked') setLastFooterMsg(`🚫 Download bloqueado: ${info.filename} (${info.reason || 'executável'})`);
    });
    window.electronAPI?.onVideoProgress?.((p) => {
      // Sem card de progresso no meio do site: a animação na barra de digitar já mostra o
      // trabalho. Só um aviso discreto no rodapé quando o download termina.
      if (p.state === 'completed') setLastFooterMsg(`🎬 Vídeo salvo: ${p.title ?? ''}`);
    });
  }, []);

  // Notify main process when active tab's host changes (auto-bypass adblock for known sites)
  useEffect(() => {
    try {
      const u = new URL(store.activeTab.url);
      window.electronAPI?.adblockActiveHostChanged?.(u.hostname).then(r => setAdblockActive(r.active));
    } catch {}
  }, [store.activeTab.url]);

  const toggleAdblock = useCallback(async () => {
    const r = await window.electronAPI?.adblockSetEnabled?.(!adblockOn);
    if (r) setAdblockOn(r.enabled);
  }, [adblockOn]);

  // ── Favoritos (estilo Chrome) ──
  const saveFavorite = useCallback(() => {
    const t = store.activeTab;
    if (!t?.url || !/^https?:\/\//i.test(t.url)) { setLastFooterMsg('Abra uma página antes de favoritar.'); return; }
    setFavorites(prev => {
      if (prev.some(f => f.url === t.url)) { setLastFooterMsg('⭐ Esta página já está nos favoritos.'); return prev; }
      const next = [{ url: t.url, title: (t.title || t.url).slice(0, 80) }, ...prev].slice(0, 60);
      try { localStorage.setItem('favorites.v1', JSON.stringify(next)); } catch {}
      setLastFooterMsg('⭐ Favorito salvo.');
      return next;
    });
  }, [store.activeTab]);
  const removeFavorite = useCallback((url: string) => {
    setFavorites(prev => {
      const next = prev.filter(f => f.url !== url);
      try { localStorage.setItem('favorites.v1', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Histórico de navegação (alimenta o autocomplete da barra + tela Ctrl+H) ──
  const historyRef = useRef<Array<{ url: string; title: string; ts: number }>>([]);
  useEffect(() => {
    try { const h = JSON.parse(localStorage.getItem('history.v1') || '[]'); if (Array.isArray(h)) historyRef.current = h; } catch {}
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState<Array<{ url: string; title: string; ts: number }>>([]);
  // ── Downloads (painel Ctrl+J) ──
  const [downloads, setDownloads] = useState<Array<{ id?: string; filename: string; path?: string; url?: string; state: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number; paused?: boolean }>>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  // Badge de zoom flutuante (estilo Chrome: "120%" aparece e some), pra teclado e roda.
  const [zoomBadge, setZoomBadge] = useState<number | null>(null);
  const zoomBadgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showZoom = useCallback((pct: number) => {
    setZoomBadge(pct);
    if (zoomBadgeTimer.current) clearTimeout(zoomBadgeTimer.current);
    zoomBadgeTimer.current = setTimeout(() => setZoomBadge(null), 1400);
  }, []);
  const recordHistory = useCallback((url: string, title?: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    const list = historyRef.current;
    const prev = list.find(h => h.url === url);
    const entry = { url, title: (title || prev?.title || url).slice(0, 120), ts: Date.now() };
    historyRef.current = [entry, ...list.filter(h => h.url !== url)].slice(0, 1000);
    try { localStorage.setItem('history.v1', JSON.stringify(historyRef.current)); } catch {}
  }, []);
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    try { localStorage.removeItem('history.v1'); } catch {}
    setHistoryView([]);
  }, []);
  // Sugestões pro autocomplete: favoritos + histórico, casando a busca em url/título.
  const getSuggestions = useCallback((q: string): Array<{ url: string; title: string }> => {
    const query = q.trim().toLowerCase();
    if (!query || /^https?:\/\//i.test(q)) return [];   // já é uma URL completa → não sugere
    const seen = new Set<string>();
    const out: Array<{ url: string; title: string }> = [];
    const push = (url: string, title: string) => { if (!seen.has(url)) { seen.add(url); out.push({ url, title }); } };
    for (const f of favorites) {
      if (out.length >= 8) break;
      if (f.url.toLowerCase().includes(query) || (f.title || '').toLowerCase().includes(query)) push(f.url, f.title || f.url);
    }
    for (const h of historyRef.current) {
      if (out.length >= 8) break;
      if (h.url.toLowerCase().includes(query) || (h.title || '').toLowerCase().includes(query)) push(h.url, h.title || h.url);
    }
    return out;
  }, [favorites]);

  // Troca de idioma re-renderiza a UI SEM recarregar a página (o menu não fecha).
  const [, forceI18n] = useState(0);
  useEffect(() => onLangChange(() => { forceI18n(n => n + 1); window.electronAPI?.setUILanguage?.(getLang()); }), []);

  // ── Atalhos da nova aba (speed-dial) — flutuam SOBRE o Google real; lista própria ──
  const isGoogleHome = (u?: string) => !!u && /^https?:\/\/(www\.)?google\.[a-z.]+\/(webhp|\?|$)/i.test(u);
  const [speeddial, setSpeedDial] = useState<Array<{ url: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('speeddial.v1') || '[]'); } catch { return []; }
  });
  const addSpeedDial = useCallback((url: string, title: string) => {
    setSpeedDial(prev => {
      if (prev.some(s => s.url === url)) return prev;
      const next = [...prev, { url, title }].slice(0, 30);
      try { localStorage.setItem('speeddial.v1', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const removeSpeedDial = useCallback((url: string) => {
    setSpeedDial(prev => {
      const next = prev.filter(s => s.url !== url);
      try { localStorage.setItem('speeddial.v1', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  // Login do Google (navegador real → importa sessão por CDP, automático). Reusado pelo
  // botão de vidro do painel e pelo item do menu ⋮.
  const handleGoogleLogin = useCallback(async () => {
    setLastFooterMsg('🔑 Abrindo Chrome/Edge — faça o login lá. Eu detecto e importo sozinho (não precisa fechar nada nem clicar em importar).');
    try {
      const result = await window.electronAPI?.googleLogin?.();
      if (!result?.ok) { setLastFooterMsg(result?.error || 'Não consegui importar o login do Google.'); return; }
      setLastFooterMsg(`✅ Login importado de ${result.browser || 'Chrome/Edge'} (${result.copied || 0} cookies). Recarregando…`);
      const wv = webviewRefs.current.get(store.activeTab?.id) as any;
      try { wv?.reload?.(); } catch {}
    } catch { setLastFooterMsg('Não consegui abrir o login do Google.'); }
  }, [store]);

  const getActiveWebview = useCallback((): Electron.WebviewTag | null => {
    return webviewRefs.current.get(activeTabIdRef.current) ?? null;
  }, []);


  const navigate = useCallback((url: string) => {
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url) && !/^file:/i.test(url)) {
      finalUrl = url.includes('.') && !url.includes(' ')
        ? `https://${url}`
        : `https://www.google.com.br/search?hl=pt-BR&gl=BR&pws=0&q=${encodeURIComponent(url)}`;
    }
    store.updateTab(store.activeTabId, { isLoading: true });
    getActiveWebview()?.loadURL(finalUrl).catch(() => {});
  }, [store, getActiveWebview]);

  const goBack = useCallback(() => { getActiveWebview()?.goBack(); }, [getActiveWebview]);
  const goForward = useCallback(() => { getActiveWebview()?.goForward(); }, [getActiveWebview]);
  const reload = useCallback(() => { getActiveWebview()?.reload(); }, [getActiveWebview]);

  // ── Buscar na página (Ctrl+F) — usa o findInPage nativo do webview ──
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findCount, setFindCount] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);
  const runFind = useCallback((text: string, opts?: { findNext?: boolean; forward?: boolean }) => {
    const wv = getActiveWebview() as any;
    if (!wv) return;
    if (text) { try { wv.findInPage(text, opts); } catch {} }
    else { try { wv.stopFindInPage('clearSelection'); } catch {} setFindCount({ active: 0, total: 0 }); }
  }, [getActiveWebview]);
  const closeFind = useCallback(() => {
    setFindOpen(false); setFindText('');
    try { (getActiveWebview() as any)?.stopFindInPage('clearSelection'); } catch {}
    setFindCount({ active: 0, total: 0 });
  }, [getActiveWebview]);
  useEffect(() => {
    if (!findOpen) return;
    const wv = getActiveWebview() as any;
    if (!wv) return;
    const onFound = (e: any) => { if (e?.result) setFindCount({ active: e.result.activeMatchOrdinal || 0, total: e.result.matches || 0 }); };
    wv.addEventListener('found-in-page', onFound);
    const t = setTimeout(() => findInputRef.current?.focus(), 60);
    return () => { clearTimeout(t); try { wv.removeEventListener('found-in-page', onFound); } catch {} };
  }, [findOpen, getActiveWebview]);

  // ── Atalhos de teclado estilo Chrome (vêm do menu/aceleradores no main → funcionam
  // mesmo com a página focada). Handler num ref atualizado a cada render → registra 1x. ──
  const shortcutRef = useRef<(action: string) => void>(() => {});
  shortcutRef.current = (action: string) => {
    const visible = store.tabs.filter(t => !t.hidden);
    const curIdx = visible.findIndex(t => t.id === store.activeTabId);
    const go = (t?: { id: string }) => { if (t) store.setActiveTabId(t.id); };
    switch (action) {
      case 'new-tab': store.addTab(); break;
      case 'close-tab': store.closeTab(store.activeTabId); break;
      case 'reopen-tab': store.reopenClosedTab(); break;
      case 'focus-url': { const el = document.querySelector('.url-input') as HTMLInputElement | null; if (el) { el.focus(); el.select(); } break; }
      case 'reload': reload(); break;
      case 'find': setFindOpen(true); setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select(); }, 0); break;
      case 'back': goBack(); break;
      case 'forward': goForward(); break;
      case 'next-tab': if (visible.length) go(visible[(curIdx + 1) % visible.length]); break;
      case 'prev-tab': if (visible.length) go(visible[(curIdx - 1 + visible.length) % visible.length]); break;
      case 'bookmark': { const u = store.activeTab.url; if (favorites.some(f => f.url === u)) removeFavorite(u); else saveFavorite(); break; }
      case 'zoom-in': case 'zoom-out': case 'zoom-reset': {
        const wv = getActiveWebview() as any; if (!wv) break;
        // Lê o zoom REAL da aba (mesma fonte que o Ctrl+roda usa no main) → teclado e
        // roda do mouse ficam consistentes, sem pulo.
        const cur = (typeof wv.getZoomFactor === 'function' ? wv.getZoomFactor() : 1) || 1;
        let z = action === 'zoom-reset' ? 1 : cur + (action === 'zoom-in' ? 0.1 : -0.1);
        z = Math.max(0.3, Math.min(3, Math.round(z * 100) / 100));
        try { wv.setZoomFactor(z); } catch {}
        showZoom(Math.round(z * 100));
        break;
      }
      case 'history': setHistoryView(historyRef.current.slice(0, 300)); setHistoryOpen(true); break;
      case 'downloads': setDownloadsOpen(o => !o); break;
      default:
        if (action.startsWith('tab-')) {
          const n = parseInt(action.slice(4), 10);
          go(n === 9 ? visible[visible.length - 1] : visible[n - 1]);
        }
    }
  };
  useEffect(() => {
    const off = window.electronAPI?.onShortcut?.((a: string) => shortcutRef.current(a));
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const getPageContent = useCallback(async (): Promise<string> => {
    const wv = getActiveWebview();
    if (!wv) return '';
    try {
      return await raceTimeout(wv.executeJavaScript(`
        (function() {
          return JSON.stringify({
            title: document.title,
            url: location.href,
            text: (document.body?.innerText || '').slice(0, 6000)
          });
        })()
      `), 6000, '');
    } catch {
      return '';
    }
  }, [getActiveWebview]);

  const captureScreenshot = useCallback(async (): Promise<string | undefined> => {
    const wv = getActiveWebview();
    if (!wv) return undefined;
    try {
      const img = await wv.capturePage();
      // Resize the NativeImage to 480px BEFORE encoding — avoids building a multi-MB
      // full-res PNG dataURL each step (the result only feeds change-detection hashing
      // and the feed thumbnail; never sent to the AI). ~4x less memory/CPU per step.
      return img.resize({ width: 480, quality: 'good' }).toDataURL();
    } catch {
      return undefined;
    }
  }, [getActiveWebview]);

  // ── PESQUISA RÁPIDA (estilo Perplexity/Comet) ──────────────────────────────
  // Para perguntas/pesquisas, NÃO dirige o navegador na cara do usuário: abre uma
  // aba em SEGUNDO PLANO no Google (Bing de fallback), raspa os snippets dos
  // resultados, manda pro modelo sintetizar e devolve a resposta + fontes pro
  // PAINEL onde o usuário digita. A aba dele não muda; ele não "lê a página".
  const runWebResearch = useCallback(async (query: string): Promise<{ answer: string; sources: Array<{ title: string; url: string }> }> => {
    const q = (query || '').trim();
    if (!q) return { answer: 'Pergunta vazia.', sources: [] };
    // Aba OCULTA: carrega e raspa "por baixo dos panos" — nunca aparece na barra de
    // abas nem rouba o foco do usuário (ele continua exatamente onde estava).
    const bgId = store.addHiddenTab(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR`);
    const scrape = async (wv: Electron.WebviewTag) => {
      await waitForWebviewSettled(wv, '');
      await waitForSettle(wv, { maxMs: 4500, minMs: 300 });
      let r: Array<{ title: string; snippet: string; url: string }> = [];
      try { r = await raceTimeout(wv.executeJavaScript(SEARCH_EXTRACTOR_JS, false), 9000, [] as any); } catch {}
      return (r || []).filter(x => x && x.title && x.url).slice(0, 6);
    };
    try {
      let waited = 0;
      let bgWv = webviewRefs.current.get(bgId) as Electron.WebviewTag | undefined;
      while (waited < 6000 && !bgWv) { await new Promise(r => setTimeout(r, 150)); waited += 150; bgWv = webviewRefs.current.get(bgId) as any; }
      if (!bgWv) return { answer: 'Não consegui abrir a busca agora.', sources: [] };
      let results = await scrape(bgWv);
      if (results.length < 2) {   // Google não rendeu → tenta Bing na mesma aba de fundo
        try { await bgWv.loadURL(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=pt-BR`); } catch {}
        results = await scrape(bgWv);
      }
      if (results.length === 0) return { answer: 'Não encontrei resultados úteis pra essa busca agora. Pode reformular?', sources: [] };
      const snippetsBlock = results.map((x, i) => `[${i + 1}] ${x.title}\n${x.snippet || ''}\n(${x.url})`).join('\n\n');
      const prompt = `Pergunta do usuário: "${q}"\n\nResultados de busca da web (de HOJE):\n${snippetsBlock}\n\nResponda à pergunta de forma DIRETA e útil em português, usando SOMENTE estes resultados. Cite as fontes pelo nome do site entre parênteses (ex.: (Wikipedia)). Seja conciso: no máximo ~6 linhas ou uma lista curta. Se os resultados não responderem com clareza, diga o que dá pra concluir. NÃO escreva nenhuma linha [[ACTION:]].`;
      const r = await window.electronAPI?.aiChat(prompt, '', true, store.localSettings.enabled);   // stateless: não polui o histórico
      const answer = (r?.response || '').trim() || (r?.error ? `Erro ao resumir: ${r.error}` : 'Não consegui resumir os resultados.');
      return { answer, sources: results.map(x => ({ title: x.title, url: x.url })) };
    } finally {
      try { store.closeTab(bgId); } catch {}   // remove a aba oculta (nunca foi vista)
    }
  }, [store]);

  // ── VITRINE DE NOVIDADES (placeholder dinâmico) ────────────────────────────
  // Puxa manchetes recentes pra ciclar no placeholder da caixa. Reusa o vertical de
  // Notícias do Google (udm=12) + o NEWS_EXTRACTOR_JS do google_news, numa aba OCULTA
  // (mesmo padrão da Pesquisa Rápida — não aparece, não vaza). Devolve só os títulos.
  // O tópico (contextual) e o cache ficam no AgentCommandBar.
  const fetchNewsHeadlines = useCallback(async (query: string): Promise<string[]> => {
    const q = (query || 'inteligência artificial').trim();
    const bgId = store.addHiddenTab(`https://www.google.com/search?q=${encodeURIComponent(q)}&udm=12&hl=pt-BR&gl=BR`);
    try {
      let waited = 0;
      let bgWv = webviewRefs.current.get(bgId) as Electron.WebviewTag | undefined;
      while (waited < 6000 && !bgWv) { await new Promise(r => setTimeout(r, 150)); waited += 150; bgWv = webviewRefs.current.get(bgId) as any; }
      if (!bgWv) return [];
      await waitForWebviewSettled(bgWv, '');
      await waitForSettle(bgWv, { maxMs: 3500, minMs: 250 });
      let news: Array<{ title?: string; source?: string }> = [];
      try { news = await raceTimeout(bgWv.executeJavaScript(NEWS_EXTRACTOR_JS, false), 9000, [] as any); } catch {}
      // Manchetes longas (>120 chars) são COMUNS — não filtrar por tamanho máximo
      // (era o bug: rejeitava as longas e sobrava zero). Só corta as curtas demais e trunca.
      return (news || [])
        .map(n => (n.title || '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 14)
        .map(t => (t.length > 64 ? t.slice(0, 63) + '…' : t))
        .slice(0, 6);
    } finally {
      try { store.closeTab(bgId); } catch {}
    }
  }, [store]);

  return (
    <div className="app-container">
      <div className="top-bar">
        <div className="top-bar-tabs">
          <TabBar
            tabs={store.tabs}
            activeTabId={store.activeTabId}
            onSelect={store.setActiveTabId}
            onClose={store.closeTab}
            onNew={store.addTab}
          />
        </div>
        <button
          className={`ai-toggle top-bar-ai ${store.sidebarOpen ? 'active' : ''}`}
          onClick={() => store.setSidebarOpen(!store.sidebarOpen)}
          title={t('ai.toggle')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2H10a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
            <path d="M10 21h4M12 17v4"/>
          </svg>
          <span>AI</span>
        </button>
        <div className="window-controls">
          <button onClick={() => window.electronAPI?.minimize()} className="win-btn minimize" title={t('win.minimize')}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1"><path d="M2 6h8"/></svg>
          </button>
          <button onClick={() => window.electronAPI?.maximize()} className="win-btn maximize" title={t('win.maximize')}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2.5" y="2.5" width="7" height="7" rx="0.5"/></svg>
          </button>
          <button onClick={() => window.electronAPI?.close()} className="win-btn close" title={t('win.close')}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
          </button>
        </div>
      </div>

      <div className="address-bar-row">
        <AddressBar
          url={isGoogleHome(store.activeTab.url) ? '' : store.activeTab.url}
          isLoading={store.activeTab.isLoading}
          canGoBack={store.activeTab.canGoBack}
          canGoForward={store.activeTab.canGoForward}
          onNavigate={navigate}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          isBookmarked={favorites.some(f => f.url === store.activeTab.url)}
          onToggleBookmark={() => { const u = store.activeTab.url; if (favorites.some(f => f.url === u)) removeFavorite(u); else saveFavorite(); }}
          getSuggestions={getSuggestions}
        />
        <div className="menu-wrap">
          <button
            className={`menu-btn${downloads.some(d => d.state === 'started' || d.state === 'progress') ? ' dl-active' : ''}`}
            onClick={() => setDownloadsOpen(o => !o)}
            title={t('downloads.open')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
          </button>
          {downloadsOpen && (
            <>
              <div className="menu-overlay" onClick={() => setDownloadsOpen(false)} />
              <div className="menu-panel downloads-panel">
                <div className="dl-head">
                  <span>⬇️ {t('downloads.title')}</span>
                  {downloads.length > 0 && <button className="history-clear" onClick={() => setDownloads([])}>{t('downloads.clear')}</button>}
                </div>
                {downloads.length === 0 ? (
                  <div className="history-empty">{t('downloads.empty')}</div>
                ) : (
                  <ul className="dl-list">
                    {downloads.map((d, i) => {
                      const pct = d.totalBytes ? Math.min(100, Math.round(((d.bytes || 0) / d.totalBytes) * 100)) : 0;
                      const active = d.state === 'started' || d.state === 'progress' || d.state === 'queued';
                      const label = d.state === 'queued' ? t('dl.queued')
                        : d.paused ? t('dl.paused')
                        : (d.state === 'started' || d.state === 'progress') ? t('dl.downloading')
                        : d.state === 'completed' ? t('dl.done')
                        : d.state === 'blocked' ? t('dl.blocked')
                        : d.state === 'cancelled' ? t('dl.cancelled')
                        : t('dl.failed');
                      return (
                        <li key={d.id || d.path || d.filename || String(i)} className="dl-item" title={d.path || d.filename}>
                          <div className="dl-row1">
                            <span className="dl-name">{d.filename}</span>
                            <span className={`dl-state ${d.state}`}>{label}</span>
                          </div>
                          {active && d.totalBytes ? (
                            <div className="dl-bar"><div className="dl-bar-fill" style={{ width: pct + '%' }} /></div>
                          ) : null}
                          <div className="dl-row2">
                            <span className="dl-meta">
                              {fmtSize(d.bytes)}{d.totalBytes ? ' / ' + fmtSize(d.totalBytes) : ''}
                              {active && !d.paused && d.speedBps ? ' · ' + fmtSpeed(d.speedBps) : ''}
                              {active && !d.paused && d.etaSec != null ? ' · ' + fmtEta(d.etaSec) : ''}
                            </span>
                            <span className="dl-actions">
                              {d.id && active && (
                                (d.paused || d.state === 'queued')
                                  ? <button title={t('dl.resume')} onClick={() => window.electronAPI?.resumeDownload?.(d.id!)}>▶</button>
                                  : <button title={t('dl.pause')} onClick={() => window.electronAPI?.pauseDownload?.(d.id!)}>⏸</button>
                              )}
                              {d.id && active && <button title={t('dl.cancel')} onClick={() => window.electronAPI?.cancelDownload?.(d.id!)}>✕</button>}
                              {(d.state === 'failed' || d.state === 'cancelled') && <button title={t('dl.retry')} onClick={() => window.electronAPI?.retryDownload?.(d.id || '', d.url)}>↻</button>}
                              {d.state === 'completed' && d.path && <button title={t('dl.openFile')} onClick={() => window.electronAPI?.openFile?.(d.path!)}>📂</button>}
                              {d.path && <button title={t('media.openFolderTitle')} onClick={() => window.electronAPI?.revealInFolder?.(d.path!)}>🗂</button>}
                              {d.url && <button title={t('dl.copyUrl')} onClick={() => { try { navigator.clipboard.writeText(d.url!); } catch {} }}>🔗</button>}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
        <div className="menu-wrap">
          <button className="menu-btn" onClick={() => setMenuOpen(o => !o)} title={t('menu.title')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>
          </button>
          {menuOpen && (
            <>
              <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
              <div className="menu-panel">
                <button className="menu-item" onClick={() => toggleAdblock()} title={t('menu.adblockTitle')}>
                  <span className="menu-ic">🛡️</span>
                  <span className="menu-label">{t('menu.adblock')}</span>
                  <span className={`menu-switch ${adblockOn ? 'on' : ''}`}>{!adblockOn ? 'OFF' : (adblockActive ? 'ON' : 'BYPASS')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); handleGoogleLogin(); }} title={t('menu.googleLoginTitle')}>
                  <span className="menu-ic">🔑</span>
                  <span className="menu-label">{t('menu.googleLogin')}</span>
                </button>
                <div className="menu-sep" />
                <div className="menu-section-title">
                  <span>⭐ {t('menu.favorites')}</span>
                  <button className="menu-add" onClick={saveFavorite} title={t('menu.save')}>{t('menu.save')}</button>
                </div>
                {favorites.length === 0 ? (
                  <div className="menu-empty">{t('menu.noFavorites')}</div>
                ) : (
                  <div className="menu-favlist">
                    {favorites.map(f => (
                      <div key={f.url} className="fav-item">
                        <button className="fav-open" onClick={() => { navigate(f.url); setMenuOpen(false); }} title={f.url}>
                          <span className="fav-title">{f.title}</span>
                          <span className="fav-url">{(() => { try { return new URL(f.url).hostname.replace(/^www\./, ''); } catch { return f.url; } })()}</span>
                        </button>
                        <button className="fav-del" onClick={() => removeFavorite(f.url)} title={t('fav.remove')}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barra de favoritos (estilo Chrome) — aparece quando há favoritos salvos. */}
      {favorites.length > 0 && (
        <div className="bookmarks-bar">
          {favorites.map(f => (
            <button key={f.url} className="bookmark-chip" onClick={() => navigate(f.url)} title={f.url}>
              <img
                className="bm-fav"
                src={(() => { try { return `${new URL(f.url).origin}/favicon.ico`; } catch { return ''; } })()}
                alt=""
                draggable={false}
                onError={e => { (e.currentTarget.style.visibility = 'hidden'); }}
              />
              <span className="bm-title">{(() => { try { return f.title || new URL(f.url).hostname.replace(/^www\./, ''); } catch { return f.title || f.url; } })()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="main-content">
        <div className="webview-area">
          <WebViewContainer
            tabs={store.tabs}
            activeTabId={store.activeTabId}
            webviewRefs={webviewRefs}
            onUpdateTab={(id, patch) => {
              store.updateTab(id, patch);
              // Registra no histórico só páginas reais de abas VISÍVEIS (ignora abas de
              // busca em segundo plano da Pesquisa Rápida).
              if (patch.url) {
                const tab = tabsRef.current.find(t => t.id === id);
                if (!tab?.hidden) recordHistory(patch.url, patch.title);
              }
            }}
            onNewTab={store.addTab}
          />
          <AgentVisualOverlay state={agentVisual} ripples={ripples} />
          {zoomBadge != null && (
            <div className="zoom-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              {zoomBadge}%
            </div>
          )}
          {findOpen && (
            <div className="find-bar">
              <input
                ref={findInputRef}
                className="find-input"
                value={findText}
                onChange={e => { setFindText(e.target.value); runFind(e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); runFind(findText, { findNext: true, forward: !e.shiftKey }); }
                  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
                }}
                placeholder={t('find.placeholder')}
                spellCheck={false}
              />
              <span className="find-count">{findText ? `${findCount.active}/${findCount.total}` : ''}</span>
              <button className="find-btn" onClick={() => runFind(findText, { findNext: true, forward: false })} title={t('find.prev')}>↑</button>
              <button className="find-btn" onClick={() => runFind(findText, { findNext: true, forward: true })} title={t('find.next')}>↓</button>
              <button className="find-btn" onClick={closeFind} title={t('find.close')}>✕</button>
            </div>
          )}
          {isGoogleHome(store.activeTab.url) && (
            <SpeedDialOverlay items={speeddial} onNavigate={navigate} onAdd={addSpeedDial} onRemove={removeSpeedDial} />
          )}
        </div>

        {/* Kept mounted even when closed so a running task survives toggling the sidebar */}
        <div className={`agent-side-panel-host ${store.sidebarOpen ? '' : 'collapsed'}`}>
          <AgentCommandBar
            onExecute={async (command, onProgress, signal) => {
              const runLog = startAgentRun(command);
              if (isTrashDestroyerCommand(command)) {
                const wv = getActiveWebview();
                if (!wv) return { error: 'No active webview', results: [] };
                setAgentVisual('observing');
                onProgress({ kind: 'status', message: 'Destruidor de Lixo: lendo o DOM da pagina...' });
                try {
                  const result = await runTrashDestroyer(wv, command, onProgress, signal);
                  const rdone = result.done as { reason?: string; success?: boolean };
                  setLastFooterMsg(rdone.reason ?? '');
                  finishAgentRun(runLog, rdone.success ? 'success' : 'failed', rdone.reason);
                  return result;
                } finally {
                  setAgentVisual('idle');
                }
              }
              const MAX_STEPS = 25;
              const allResults: Array<{ action: BrowserAction; result: any }> = [];
              const thoughts: string[] = [];
              macroTraceRef.current = [];                      // nova gravação por run
              const repeatIntent = parseRepeatIntent(command); // "repete N vezes"?
              // Contexto da conversa: o GOAL pode ser um follow-up do pedido anterior
              // ("e com a palavra bom dia?" = repetir a tarefa anterior com outro termo).
              const convoCtx = recentRunsRef.current.slice(-3)
                .map(r => `- "${r.cmd}" → ${r.outcome}`)
                .join('\n');
              let history = `${convoCtx ? `PREVIOUS REQUESTS THIS SESSION (newest last — the GOAL below may be a FOLLOW-UP reusing their intent, e.g. "e com a palavra X?" means: redo the previous task with X):\n${convoCtx}\n\n` : ''}GOAL: ${command}`;
              let previousStateKey = '';
              let noEffectCount = 0;
              let consecutiveExtracts = 0;   // freio anti-coleta (modelo fraco re-extrai sem reportar)
              let lastExtractedText = '';    // último texto extraído (fallback de resposta se travar)
              // Structured agent state — visible to AI on every step
              let plan: string[] = [];
              const memory: Array<{ key: string; value: any; source?: string; ts: number }> = [];
              let replanRequested = false;
              let lastSeenUrl = '';
              let stepsOnSameUrl = 0;
              let usedInitialShortcut = false;
              const commandLooksLikeImageTextRead = /imagem|imagens|foto|fotos|print|ocr/i.test(command)
                && /texto|escrito|escrita|aparece|diga|ler|leia/i.test(command);
              const commandLooksLikeDestructiveEmailTask = /gmail|email|e-mail|mensagem|mensagens/i.test(command)
                && /apagar|deletar|delete|excluir|remover|lixeira|trash/i.test(command);
              const commandRequiresGmailPromotions = commandLooksLikeDestructiveEmailTask
                && /promo[cç][aã]o|promo[cç][oõ]es|promotions|promo/i.test(command);
              const commandLooksLikeGoogleLogin = /gmail|google/i.test(command)
                && /login|logar|entrar|conta|sign in|continue|continuar/i.test(command);
              const commandLooksLikeSendEmail = /gmail|email|e-mail/i.test(command)
                && /mandar|enviar|escrever|compose|send/i.test(command);
              const commandLooksLikeYouTubeComment = /youtube|youtu\.be|video|v[ií]deo/i.test(command)
                && /coment[aá]rio|comentar|comment/i.test(command);
              const parsedEmailDraft = commandLooksLikeSendEmail ? parseEmailDraft(command) : null;
              let gmailComposeAttempted = false;
              let gmailDraftFilled = false;
              let youtubeCommentFilled = false;
              let youtubeCommentSubmitted = false;
              let youtubeCommentScrolls = 0;
              const youtubeCommentText = pickYouTubeCommentText(command);
              const submittedYouTubeComments = new Set<string>();
              // Recovery manager — detects blockers (login, captcha, paywall, overlay, etc.)
              const recovery = new AgentRecoveryManager();
              // Does the command explicitly reference a specific site?
              const commandMentionsDomain = (url: string): boolean => {
                try {
                  const host = new URL(url).hostname.replace(/^www\./, '');
                  return command.toLowerCase().includes(host) || command.toLowerCase().includes(host.split('.')[0]);
                } catch { return false; }
              };
              // Etapa 6: global task deadline + repeated-action detection
              // Nuvem é rápida → 5 min basta. Modo LOCAL é inerentemente lento (modelo grande
              // parte na CPU) → deadline maior pra a tarefa TERMINAR em teste interno, mesmo
              // devagar. Gated no local: NÃO altera o comportamento com API/nuvem.
              const TASK_DEADLINE_MS = (store.localSettings.enabled ? 20 : 5) * 60 * 1000;
              const taskStartedAt = Date.now();
              const recentActionHashes: string[] = [];
              // browser-use style: track element identities to mark what's NEW after each action
              const elementKey = (e: { tag?: string; text?: string; aria?: string; backendNodeId?: number }): string =>
                e.backendNodeId != null ? `b:${e.backendNodeId}` : `t:${e.tag}|${(e.text || e.aria || '').slice(0, 40)}`;
              let prevElementKeys = new Set<string>();
              let skipManualHelpDetectionOnce = false;
              // FAST MODE (browser-use #2): queue of remaining batched actions to run
              // without calling the LLM again. stableId lets us remap a ref to the fresh
              // observation; if the element vanished, the whole batch is discarded.
              let actionQueue: Array<{ action: BrowserAction; stableId?: number }> = [];
              let invalidActionRetries = 0; // re-prompt on malformed model output instead of ending
              // Observation reuse: carry the post-action observation of step N into step N+1
              // when the page hasn't changed — otherwise every step pays the full AXTree
              // observation (2-8s on heavy pages) twice. carriedOcrText rides along so
              // Tesseract isn't re-run on an unchanged page either.
              let carriedObservation: ObservedState | null = null;
              let carriedOcrText = '';
              const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
                let id: ReturnType<typeof setTimeout>;
                const t = new Promise<T>(r => { id = setTimeout(() => r(fallback), ms); });
                return Promise.race([p, t]).finally(() => clearTimeout(id));
              };
              // Observation with graceful degradation: on heavy/ad-laden pages getFullAXTree
              // can blow the budget; an EMPTY fallback then triggers skeleton retries that
              // waste ~40s/step. Instead, degrade to one-shot DOM scraping (fast, decent).
              const observeFast = async (w: Electron.WebviewTag, budgetMs: number): Promise<ObservedState> => {
                const viaAx = await withTimeout<ObservedState | null>(observePageViaAXTree(w), budgetMs, null);
                if (viaAx && viaAx.interactive_elements.length > 0) return viaAx;
                console.warn('[Agent] AXTree observe exceeded budget — degrading to DOM scraping');
                return withTimeout(observePage(w), 4000, { url: w.getURL(), title: '', text_sample: '', interactive_elements: [] });
              };
              // Page whose main thread is hung (ad/video scripts): even the 4s DOM scrape
              // returned nothing. Re-observing won't help — lean on OCR (screenshot works
              // at compositor level, independent of the page's JS thread).
              const isHungObservation = (o: ObservedState) =>
                o.interactive_elements.length === 0 && !o.text_sample;
              const finishRun = (
                status: 'success' | 'failed' | 'cancelled' | 'max_steps',
                reason?: string,
              ) => {
                // Memória curta da conversa: o próximo pedido pode ser um follow-up.
                recentRunsRef.current.push({ cmd: command, outcome: `${status}${reason ? `: ${reason.slice(0, 200)}` : ''}` });
                if (recentRunsRef.current.length > 5) recentRunsRef.current.shift();
                // Run com passos de página bem-sucedidos = receita reaproveitável.
                // (Replays não regravam: a receita original é a fonte da verdade.)
                if (status === 'success' && !repeatIntent && macroTraceRef.current.length > 0) {
                  saveLastMacro({ command, steps: [...macroTraceRef.current], savedAt: Date.now() });
                  onProgress({ kind: 'status', message: `🧠 Sequência gravada (${macroTraceRef.current.length} passo(s)). Diga "repete" ou "repete 100 vezes" pra reexecutar sem gastar IA.` });
                }
                return finishAgentRun(runLog, status, reason);
              };
              const throwIfCancelled = () => {
                if (signal?.aborted) throw new Error('TASK_CANCELLED_BY_USER');
              };
              // #11: faz QUALQUER await longo (chamada ao modelo, sleeps) abortar NA HORA
              // quando o usuário aperta Parar — sem esperar a operação terminar. Um único
              // promise de abort por execução (não vaza listeners). Também garante que uma
              // resposta ATRASADA do modelo não "ressuscite" a tarefa: o loop já rejeitou e
              // não age no resultado tardio. (Matar ffmpeg/yt-dlp no main é o passo seguinte.)
              const abortP = new Promise<never>((_, reject) => {
                const fire = () => reject(new Error('TASK_CANCELLED_BY_USER'));
                if (signal?.aborted) fire(); else signal?.addEventListener('abort', fire, { once: true });
              });
              abortP.catch(() => {});   // evita "unhandled rejection" se ninguém correr contra ele
              const raceCancel = <T,>(p: T): Promise<Awaited<T>> =>
                (signal ? (Promise.race([Promise.resolve(p), abortP]) as Promise<Awaited<T>>)
                        : (Promise.resolve(p) as Promise<Awaited<T>>));
              const sleep = (ms: number): Promise<void> => raceCancel(new Promise<void>(r => setTimeout(r, ms)));
              const waitForManualHelp = async (request: ManualHelpRequest, currentUrl: string) => {
                setAgentVisual('idle');
                setLastFooterMsg(`Ajuda manual: ${request.reason}`);
                appendAgentRunStep(runLog, {
                  manualHelp: {
                    kind: request.kind,
                    reason: request.reason,
                    beforeUrl: currentUrl,
                  },
                  note: request.instruction,
                });
                await new Promise<void>((resolve) => {
                  onProgress({
                    kind: 'manual_help',
                    message: request.reason,
                    instruction: request.instruction,
                    onContinue: resolve,
                  });
                });
                throwIfCancelled();
                const resumedWv = getActiveWebview();
                const afterUrl = resumedWv?.getURL?.() || currentUrl;
                appendAgentRunStep(runLog, {
                  manualHelp: {
                    kind: request.kind,
                    reason: request.reason,
                    beforeUrl: currentUrl,
                    afterUrl,
                  },
                  note: 'Usuario clicou em Continuar depois da intervencao manual.',
                });
                history += `\n${manualHelpHistoryNote(request, currentUrl, afterUrl)}`;
                rememberActionForSite({
                  actionType: `human_help:${request.kind}`,
                  success: true,
                  url: afterUrl,
                  title: resumedWv?.getTitle?.(),
                  note: request.reason,
                });
                setLastFooterMsg('');
                noEffectCount = 0;
                stepsOnSameUrl = 0;
                actionQueue = [];
                skipManualHelpDetectionOnce = true;
              };
              // FREIO: pausa e pergunta antes de ação de risco (pagamento/exclusão/cartão).
              // Resolve true = pode; false = cancelar. Aborta (false) se o usuário parar a tarefa.
              const confirmRisky = (risk: { kind: string; label: string }): Promise<boolean> => {
                setAgentVisual('idle');
                setLastFooterMsg(`Confirmação: ${risk.kind}`);
                const verb = risk.kind === 'dados de cartão' ? 'preencher' : 'clicar em';
                return new Promise<boolean>((resolve) => {
                  let done = false;
                  const finish = (v: boolean) => { if (!done) { done = true; setLastFooterMsg(''); resolve(v); } };
                  if (signal) signal.addEventListener('abort', () => finish(false), { once: true });
                  onProgress({
                    kind: 'confirm',
                    risk: risk.kind,
                    label: risk.label,
                    message: `⚠️ Pausa de segurança — isto envolve ${risk.kind}. Vou ${verb} "${risk.label}". Quer que eu continue?`,
                    onConfirm: () => finish(true),
                    onCancel: () => finish(false),
                  });
                });
              };
              // Freio unificado: pede confirmação pra ação de risco em QUALQUER caminho.
              // Retorna um toolResult de cancelamento (aborta a ação) ou null (pode seguir).
              const gateRisk = async (risk: RiskInfo | null): Promise<any | null> => {
                if (!risk) return null;
                const ok = await confirmRisky(risk);
                throwIfCancelled();
                if (ok) return null;
                onProgress({ kind: 'status', message: `✖️ Cancelado por você: não fiz "${risk.label}".` });
                return { success: false, reason: 'user_cancelled', error: `Você cancelou — não fiz "${risk.label}".` };
              };
              try {
                throwIfCancelled();
                // ── REPLAY DE MACRO: "repete", "repete 1000 vezes", "a cada 5 min" ──
                // Reexecuta a última sequência gravada de forma 100% determinística:
                // zero chamadas de IA, não importa quantas repetições.
                if (repeatIntent) {
                  const macro = loadLastMacro();
                  if (!macro) {
                    const msg = 'Ainda não tenho nenhuma automação gravada. Faça a tarefa uma vez (ex.: "entre no site X e clique em Y") — eu gravo a sequência e aí você pode repetir quantas vezes quiser.';
                    setLastFooterMsg(msg);
                    finishRun('failed', msg);
                    return { thought: msg, results: allResults, done: { type: 'done', reason: msg, success: false } as BrowserAction };
                  }
                  const times = repeatIntent.times;
                  const pause = repeatIntent.intervalMs ?? 1200;
                  onProgress({ kind: 'status', message: `🔁 Automação: "${macro.command.slice(0, 70)}" — ${macro.steps.length} passo(s) × ${times >= 100000 ? '∞ (até você parar)' : times}${repeatIntent.intervalMs ? `, a cada ${Math.round(repeatIntent.intervalMs / 1000)}s` : ''}. Zero IA.` });
                  // FREIO: se a automação inclui uma ação de risco (pagar/excluir/cartão),
                  // confirma UMA vez antes de repetir (não a cada repetição — seria absurdo).
                  const riskyStep = macro.steps.map(s => riskForAction(s as any)).find((r): r is RiskInfo => !!r);
                  if (riskyStep) {
                    const ok = await confirmRisky(riskyStep);
                    throwIfCancelled();
                    if (!ok) {
                      const msg = `Cancelado — a automação inclui uma ação de risco ("${riskyStep.label}") e você não confirmou.`;
                      setLastFooterMsg(msg);
                      finishRun('cancelled', msg);
                      return { thought: msg, results: allResults, done: { type: 'done', reason: msg, success: false } as BrowserAction };
                    }
                  }
                  const sleepCancelable = async (ms: number) => {
                    const until = Date.now() + ms;
                    while (Date.now() < until) { throwIfCancelled(); await new Promise(r => setTimeout(r, Math.min(400, until - Date.now()))); }
                  };
                  let rep = 0;
                  for (; rep < times; rep++) {
                    throwIfCancelled();
                    const wv = getActiveWebview();
                    if (!wv) break;
                    if (times > 1) onProgress({ kind: 'status', message: `🔁 Repetição ${rep + 1}${times < 100000 ? `/${times}` : ''}` });
                    for (let j = 0; j < macro.steps.length; j++) {
                      throwIfCancelled();
                      const a = macro.steps[j];
                      setAgentVisual('acting');
                      let r = await executeBrowserAction(wv, a);
                      if (!r?.success) { // o site pode estar lento — uma 2ª chance
                        await sleepCancelable(2500);
                        r = await executeBrowserAction(wv, a);
                      }
                      if (!r?.success) {
                        const msg = `Automação quebrou na repetição ${rep + 1}, passo ${j + 1} (${formatAction(a)}): ${r?.error || 'elemento não encontrado'}. O site deve ter mudado — faça a tarefa uma vez de novo pra eu regravar.`;
                        setLastFooterMsg(msg);
                        finishRun('failed', msg);
                        return { thought: msg, results: allResults, done: { type: 'done', reason: msg, success: false } as BrowserAction };
                      }
                      if (a.type === 'navigate') { await waitForWebviewSettled(wv, ''); }
                      await sleepCancelable(700);
                    }
                    if (rep + 1 < times) await sleepCancelable(pause);
                  }
                  const okMsg = `Automação executada ${rep} vez(es) sem quebrar (${macro.steps.length} passo(s) cada, zero IA).`;
                  setLastFooterMsg(`✅ ${okMsg}`);
                  finishRun('success', okMsg);
                  return { thought: okMsg, results: allResults, done: { type: 'done', reason: okMsg, success: true } as BrowserAction };
                }
                // QUICK INTENT: layperson media/file requests ("mp3 musica X", "baixe o
                // pdf de Y") → execute the right action at step 0 WITHOUT calling the AI.
                let quickAction = detectQuickAction(command);
                // FOLLOW-UP sem IA: "e com a palavra bom dia?" / "agora com a frase X"
                // reaproveita a intenção do pedido anterior trocando só o termo.
                if (!quickAction && lastQuickActionRef.current) {
                  const fu = command.trim().match(
                    /^(?:e|agora)[\s,]+(?:(?:com|pra|para|usando|de)\s+(?:a\s+|o\s+)?(?:palavra|frase|m[uú]sica|v[ií]deo)?|(?:a\s+)?(?:palavra|frase))\s*[:"'“”]?\s*(.{2,80}?)[\s"'“”?!.]*$/i,
                  );
                  if (fu && fu[1]) {
                    const term = fu[1].trim();
                    const last = lastQuickActionRef.current;
                    if (last.type === 'open_video_cuts') quickAction = { ...last, phrase: term };
                    else if (last.type === 'download_video') quickAction = { ...last, query: term };
                    else if (last.type === 'open_video') quickAction = { ...last, query: term };
                    else if (last.type === 'open_videos') quickAction = { ...last, query: term };
                    else if (last.type === 'find_file') quickAction = { ...last, query: term };
                    if (quickAction) onProgress({ kind: 'status', message: `🔗 Continuando o pedido anterior com "${term}"` });
                  }
                }
                if (quickAction) lastQuickActionRef.current = quickAction;
                const initialShortcut = quickAction ? null : getInitialShortcutAction(command);
                if (quickAction) {
                  actionQueue.push({ action: quickAction as BrowserAction });
                  usedInitialShortcut = true;
                  onProgress({ kind: 'status', message: `⚡ Intenção reconhecida: ${formatAction(quickAction as BrowserAction)}` });
                  console.log(`[Agent] quick action -> ${formatAction(quickAction as BrowserAction)}`);
                }
                if (initialShortcut) {
                  const wv = getActiveWebview();
                  if (!wv) { setLastFooterMsg('Nenhuma webview ativa'); finishRun('failed', 'No active webview'); return { error: 'No active webview', results: allResults }; }
                  setAgentVisual('acting');
                  onProgress({ kind: 'status', message: `Atalho conhecido: ${initialShortcut.reason}` });
                  console.log(`[Agent] fast path -> ${initialShortcut.reason}`);
                  const beforeUrl = wv.getURL();
                  // FREIO: atalho aprendido também passa pela confirmação se for de risco.
                  const scCancel = await gateRisk(riskForAction(initialShortcut.action as any, undefined, beforeUrl));
                  if (scCancel) {
                    allResults.push({ action: initialShortcut.action as BrowserAction, result: scCancel });
                    finishRun('cancelled', scCancel.error);
                    return { thought: scCancel.error, results: allResults, done: { type: 'done', reason: scCancel.error, success: false } as BrowserAction };
                  }
                  const shortcutResult = await executeBrowserAction(wv, initialShortcut.action as BrowserAction);
                  await waitForWebviewSettled(wv, beforeUrl);
                  await sleep(2500);
                  allResults.push({ action: initialShortcut.action as BrowserAction, result: shortcutResult });
                  if (shortcutResult?.success !== false) {
                    const durable = toDurableAction(initialShortcut.action as BrowserAction, { url: '', title: '', text_sample: '', interactive_elements: [] });
                    if (durable) macroTraceRef.current.push(durable);
                  }
                  appendAgentRunStep(runLog, {
                    step: 0,
                    urlBefore: beforeUrl,
                    urlAfter: wv.getURL(),
                    titleAfter: wv.getTitle(),
                    ...summarizeAction(initialShortcut.action as BrowserAction),
                    result: summarizeResult(shortcutResult),
                    success: shortcutResult?.success !== false,
                    note: initialShortcut.reason,
                  });
                  history += `\nFAST PATH: ${initialShortcut.reason}\nRESULT: ${JSON.stringify(shortcutResult).slice(0, 500)}`;
                  usedInitialShortcut = true;
                }

                for (let step = 0; step < MAX_STEPS; step++) {
                  const stepStartedAt = Date.now();
                  throwIfCancelled();
                  // Etapa 6: global time budget — bail out gracefully instead of grinding 25 steps
                  if (Date.now() - taskStartedAt > TASK_DEADLINE_MS) {
                    const done: BrowserAction = { type: 'done', success: false, reason: 'Tempo limite da tarefa atingido (5 min). Encerrando para evitar loop.' };
                    setLastFooterMsg(done.reason);
                    finishRun('failed', done.reason);
                    return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                  }
                  // Etapa 6: prune unbounded history to keep token usage and memory in check
                  if (history.length > 8000) history = `GOAL: ${command}\n...[older steps trimmed]...\n` + history.slice(-6000);
                  const wv = getActiveWebview();
                  if (!wv) { setLastFooterMsg('Nenhuma webview ativa'); finishRun('failed', 'No active webview'); return { error: 'No active webview', results: allResults }; }
                  if (commandLooksLikeGoogleLogin && step >= 8) {
                    const done: BrowserAction = {
                      type: 'done',
                      success: false,
                      reason: 'Login com Google nao foi concluido rapidamente. Pode haver bloqueio, popup, captcha ou escolha de conta que precisa de intervencao manual.',
                    };
                    setLastFooterMsg(done.reason);
                    finishRun('failed', done.reason);
                    return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                  }
                  setAgentVisual('observing');
                  onProgress({ kind: 'status', message: `Passo ${step + 1}: observando pagina...` });
                  const observeTimeoutMs = commandLooksLikeGoogleLogin ? 6000 : 8000;
                  // Reuse last step's post-action observation when the page hasn't changed.
                  const observationWasCarried: boolean = !!(carriedObservation
                    && wv.getURL() === carriedObservation.url
                    && carriedObservation.interactive_elements.length >= 8);
                  console.log(`[Agent] step ${step + 1} → observePageViaAXTree${observationWasCarried ? ' (reusing post-action observation)' : ''}`);
                  let observation: ObservedState = observationWasCarried
                    ? carriedObservation!
                    : await observeFast(wv, observeTimeoutMs);
                  carriedObservation = null;
                  // Porteiro fechou um aviso de cookie/consent → avisa no feed (uma vez).
                  if (observation?.dismissed) {
                    onProgress({ kind: 'status', message: `🚪 Fechei um aviso de cookies/consent (${observation.dismissed})` });
                    observation.dismissed = undefined;
                  }
                  throwIfCancelled();
                  console.log(`[Agent] step ${step + 1} → ${observation.interactive_elements.length} elements`);
                  // If page seems unrendered (skeleton state), wait and re-observe up to 2 times
                  if (!observationWasCarried && !isHungObservation(observation)) {
                    let initTries = 0;
                    const maxInitTries = commandLooksLikeGoogleLogin ? 1 : 2;
                    while (initTries < maxInitTries && observation.interactive_elements.length < 8) {
                      await new Promise(r => setTimeout(r, commandLooksLikeGoogleLogin ? 1000 : 2000));
                      observation = await observeFast(wv, observeTimeoutMs);
                      if (isHungObservation(observation)) break;
                      initTries++;
                    }
                  }
                  rememberObservedSite(observation);
                  if (skipManualHelpDetectionOnce) {
                    skipManualHelpDetectionOnce = false;
                    history += '\nRESUME: User clicked Continue after manual help. Observe the current page and continue the task from here.';
                  } else {
                    const manualHelpNeed = detectManualHelpNeed(command, observation, stepsOnSameUrl, noEffectCount);
                    if (manualHelpNeed) {
                      onProgress({ kind: 'status', message: `Pausa para ajuda manual: ${manualHelpNeed.reason}` });
                      await waitForManualHelp(manualHelpNeed, observation.url);
                      continue;
                    }
                  }
                  if (commandLooksLikeSendEmail && isGmailUrl(observation.url) && parsedEmailDraft && !gmailDraftFilled) {
                    gmailComposeAttempted = true;
                    const compose = await tryComposeGmailDraft(wv, parsedEmailDraft);
                    if (compose.success) {
                      gmailDraftFilled = true;
                      onProgress({ kind: 'status', message: 'Gmail: rascunho preenchido automaticamente.' });
                      if (compose.sent) {
                        const done: BrowserAction = { type: 'done', success: true, reason: 'E-mail enviado pelo Gmail.' };
                        setLastFooterMsg(done.reason);
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      observation = await withTimeout(observePageViaAXTree(wv), observeTimeoutMs, observation);
                      rememberObservedSite(observation);
                    } else {
                      onProgress({ kind: 'status', message: `Gmail: assistente de rascunho nao conseguiu preencher (${compose.reason || 'sem detalhe'}).` });
                    }
                  }
                  if (commandLooksLikeYouTubeComment && isYouTubeWatchUrl(observation.url) && !youtubeCommentFilled && step >= 2) {
                    const assist = await tryRevealYouTubeCommentBox(wv);
                    if (assist.success) {
                      onProgress({ kind: 'status', message: 'YouTube: caixa de comentario localizada/ativada.' });
                      const commentKey = makeYouTubeCommentKey(observation.url, youtubeCommentText);
                      if (submittedYouTubeComments.has(commentKey)) {
                        const done: BrowserAction = { type: 'done', success: true, reason: `Comentario ja enviado nesta tarefa: "${youtubeCommentText}"` };
                        setLastFooterMsg(done.reason);
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      const submit = await tryFillAndSubmitYouTubeComment(wv, youtubeCommentText);
                      if (submit.success) {
                        submittedYouTubeComments.add(commentKey);
                        youtubeCommentFilled = true;
                        youtubeCommentSubmitted = true;
                        const done: BrowserAction = { type: 'done', success: true, reason: `Comentario enviado no YouTube: "${youtubeCommentText}"` };
                        setLastFooterMsg(done.reason);
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      await new Promise(r => setTimeout(r, 1000));
                      observation = await withTimeout(observePageViaAXTree(wv), observeTimeoutMs, observation);
                      rememberObservedSite(observation);
                    }
                  }
                  const screenshot = await withTimeout(captureScreenshot(), 8000, undefined as any);
                  const screenshotHashBefore = hashScreenshotDataUrl(screenshot);
                  const stateKeyBefore = `${observation.url}|${observation.title}|${screenshotHashBefore}`;

                  // ── FAST MODE: try to consume a queued batched action (no LLM call) ──
                  let action: BrowserAction | undefined;
                  let fromQueue = false;
                  let stepEvaluation: string | undefined; // model's self-eval (for transcript)
                  let stepThought: string | undefined;
                  while (actionQueue.length > 0) {
                    const q = actionQueue.shift()!;
                    let a = q.action;
                    if ((a.type === 'click_ref' || a.type === 'fill_ref') && q.stableId != null) {
                      const el = observation.interactive_elements.find(e => e.backendNodeId === q.stableId);
                      if (!el) { actionQueue = []; break; } // page changed → drop batch, ask the LLM
                      a = { ...a, ref: el.id } as BrowserAction;
                    }
                    action = a;
                    fromQueue = true;
                    onProgress({ kind: 'status', message: `⚡ ação em lote (${actionQueue.length} restante(s))` });
                    break;
                  }

                  if (!fromQueue) {
                  setAgentVisual('thinking');
                  onProgress({ kind: 'status', message: `Passo ${step + 1}: pensando...` });

                  // ── OCR enrichment (local, free) ──────────────────────────────
                  // Run Tesseract on a screenshot only when DOM text is sparse.
                  // Result is plain text injected into the payload — no image sent to DeepSeek.
                  const ocrWcId = (wv as any).getWebContentsId?.() as number | undefined;
                  let ocrText = '';
                  if (observationWasCarried) {
                    // Page unchanged since last step — reuse last OCR instead of re-running Tesseract.
                    ocrText = carriedOcrText;
                  } else if (ocrWcId != null && window.electronAPI?.takeOcr && !commandLooksLikeGoogleLogin) {
                    try {
                      const ocrResult = await window.electronAPI.takeOcr(ocrWcId, observation.text_sample, commandLooksLikeImageTextRead);
                      if (ocrResult?.ocrUsed && ocrResult.ocrText) {
                        ocrText = ocrResult.ocrText;
                        onProgress({ kind: 'status', message: `🔍 OCR local: ${ocrText.length} chars (conf: ${ocrResult.confidence ?? '?'}%)` });
                      }
                    } catch { /* non-fatal */ }
                  }
                  carriedOcrText = ocrText;
                  // Mark elements that are NEW since the previous observation with a leading '*'
                  // (browser-use technique — helps the model spot a popup/modal that just appeared).
                  const curElementKeys = new Set<string>();
                  let newElementCount = 0;
                  const compactDom = observation.interactive_elements
                    .map(e => {
                      const attrs: string[] = [];
                      if (e.role) attrs.push(`role="${e.role}"`);
                      if (e.aria) attrs.push(`aria="${e.aria.slice(0, 60)}"`);
                      if (e.pressed !== undefined) attrs.push(`pressed="${e.pressed}"`);
                      if (e.checked !== undefined) attrs.push(`checked="${e.checked}"`);
                      if (e.placeholder) attrs.push(`placeholder="${e.placeholder.slice(0, 40)}"`);
                      if (e.href) attrs.push(`href="${e.href.slice(0, 60)}"`);
                      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
                      const text = (e.text || '').slice(0, 80).replace(/\s+/g, ' ').trim();
                      const key = elementKey(e);
                      curElementKeys.add(key);
                      const isNew = step > 0 && prevElementKeys.size > 0 && !prevElementKeys.has(key);
                      if (isNew) newElementCount++;
                      const repeat = e.repeatNote ? ` [... +${e.repeatNote} elementos similares]` : '';
                      return `${isNew ? '*' : ' '}[${e.id}] <${e.tag}${attrStr}>${text}</${e.tag}>${repeat}`;
                    }).join('\n');
                  prevElementKeys = curElementKeys;
                  const tabsList = tabsRef.current
                    .map((t, i) => `[${i}]${t.id === activeTabIdRef.current ? ' (active)' : ''} "${(t.title || 'Untitled').slice(0, 60)}" — ${t.url}`)
                    .join('\n');
                  const planBlock = plan.length
                    ? `PLAN (${plan.length} steps):\n${plan.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
                    : `PLAN: (none yet — for complex tasks, emit a 'plan' action FIRST listing the steps)`;
                  const memoryBlock = memory.length
                    ? `MEMORY:\n${memory.map(m => `  • ${m.key} = ${JSON.stringify(m.value)}${m.source ? ` (from ${m.source})` : ''}`).join('\n')}`
                    : 'MEMORY: (empty — use store action to save extracted data)';
                  const observedPayload = [
                    buildKnownSitesBlock(observation),
                    '',
                    planBlock,
                    '',
                    memoryBlock,
                    '',
                    `TABS:\n${tabsList}`,
                    '',
                    `URL: ${observation.url}`,
                    `TITLE: ${observation.title}`,
                    `INTERACTIVE ELEMENTS (use the [N] id with click_ref/fill_ref):`,
                    newElementCount > 0 ? `(${newElementCount} element(s) marked with '*' are NEW since your last action — e.g. a popup/modal/result that just appeared)` : '',
                    compactDom || '(none detected)',
                    '',
                    `PAGE TEXT: ${observation.text_sample.slice(0, 1500)}`,
                    ocrText ? `\nOCR TEXT (extracted locally from screenshot):\n${ocrText}` : '',
                    '',
                    `RECENT HISTORY:\n${history.slice(-2500)}`,
                  ].filter(s => s !== '').join('\n');
                  // Anti-loop: track time on same URL
                  if (observation.url === lastSeenUrl) stepsOnSameUrl++;
                  else { stepsOnSameUrl = 1; lastSeenUrl = observation.url; }

                  if (step >= 20 && !replanRequested) replanRequested = true;
                  const stuckOnUrl = stepsOnSameUrl >= 5;
                  const prompt = [
                    history, '',
                    noEffectCount > 0 ? 'IMPORTANT: Your last action had no visible effect. Try another approach.' : '',
                    commandRequiresGmailPromotions ? [
                      'DESTRUCTIVE EMAIL SAFETY:',
                      'The user asked to remove/delete emails from Gmail Promotions only.',
                      'Before clicking any delete/trash/remove button, verify the current Gmail view is Promotions/Promocoes.',
                      'Valid evidence includes URL containing #category/promotions, title/text saying Promotions/Promocoes, or active tab/category named Promotions/Promocoes.',
                      'If you are in Inbox/Caixa de entrada/Primary/Principal or unsure, navigate to https://mail.google.com/mail/u/0/#category/promotions first.',
                      'Never delete messages from the regular inbox for this task.',
                    ].join(' ') : '',
                    commandLooksLikeGoogleLogin ? [
                      'GOOGLE LOGIN TASK:',
                      'The user asked to log in using Gmail/Google.',
                      'Before changing sites, look for and try visible social login buttons such as "Continuar com Google", "Entrar com Google", "Sign in with Google", "Continue with Google", or "Gmail".',
                      'If a Google login popup or new tab opens, switch/follow that tab and continue there.',
                      'Do not abandon the current site while a Google/Gmail login option is visible.',
                    ].join(' ') : '',
                    commandLooksLikeSendEmail ? [
                      'GMAIL SEND EMAIL TASK:',
                      gmailDraftFilled ? 'The Gmail draft was filled by the local Gmail helper. Do not claim success unless the message was actually sent or the filled draft is visible.' : '',
                      'Gmail compose fields are predictable. Prefer clicking Compose/Escrever, then fill To/Para/Destinatarios, Subject/Assunto, and the message body.',
                      'If the draft is already filled, do not keep searching fields. Ask for confirmation or click Send/Enviar only if the user clearly asked to send immediately.',
                      'Never send an email if recipient or body is missing.',
                    ].join(' ') : '',
                    commandLooksLikeYouTubeComment ? [
                      'YOUTUBE COMMENT TASK:',
                      'After a YouTube video is open, scroll to the comments area and look for text like "Adicionar comentario", "Adicione um comentario", "Comente aqui", "Add a comment", or a textbox/contenteditable.',
                      'After typing/filling the comment, do NOT navigate away and do NOT keep scrolling.',
                      'Your next action must be clicking the submit button labeled "Comentar", "Comment", "Enviar", "Post", or similar.',
                      'If the comment box or submit button is visible only as faint placeholder text, use click_text/fill by text or fallback coordinates near the comments box.',
                    ].join(' ') : '',
                    commandLooksLikeImageTextRead ? [
                      'IMAGE TEXT TASK:',
                      '- Use OCR TEXT when available. Do not use extract_text for this task; extract_text reads the webpage, not the image.',
                      '- Google Images may use udm=2 instead of tbm=isch; treat either URL as already being Google Images.',
                      '- Open at most one image/result. After OCR is available on the opened image/page, report the concise visible text only.',
                      '- Do not navigate to external stock/product sites unless the user explicitly asked to open the source site.',
                    ].join(' ') : '',
                    isHungObservation(observation) && ocrText ? 'PAGE UNRESPONSIVE: This page\'s scripts are hung — interactive elements, extract_text and scroll will NOT work here, and RELOADING THIS SAME URL WILL NOT FIX IT. The OCR TEXT below is a reliable snapshot of what is visible. If it contains what you need, answer now with report/done. Otherwise navigate to a DIFFERENT website (e.g. another source for the same information).' : '',
                    stuckOnUrl ? `STUCK: You have spent ${stepsOnSameUrl} steps on ${observation.url} without finishing. ABANDON this source NOW. Either: (a) navigate to a different site (Wikipedia, NotebookCheck, Wccftech), (b) use the data you already have in MEMORY and call report. Do NOT scroll or extract again on this page.` : '',
                    replanRequested && step >= 20 ? 'REPLAN: You have used 20+ steps. If you have ANY useful data in MEMORY, call report() with what you have. Better partial answer than no answer.' : '',
                    `[STEP ${step + 1}/${MAX_STEPS}] Choose exactly one tool action. If the goal is complete, return done or report.`,
                  ].filter(Boolean).join('\n');
                  // ── Tier routing ──────────────────────────────────────────────
                  // Screenshots are NEVER sent to the model — OCR text replaces visual context.
                  // When the user enables the local (Ollama) model, the whole agent runs on it
                  // (the main process falls back to cloud automatically if the local call errors).
                  // Otherwise: fast non-thinking flash for routine steps; thinking flash ('pro')
                  // ONLY when stuck (no-effect / glued to the same URL), to break the loop.
                  // 🧠 MAESTRO — reserva a voz PENSANTE (thinking) só para os momentos de
                  // "travou": ações sem efeito ou preso na mesma URL. Aí o tier 'pro' liga o
                  // chain-of-thought no flash (ver ai-engine) para repensar a estratégia e
                  // quebrar o loop. Todo o resto roda na voz rápida (não-pensante).
                  const isStuck = noEffectCount >= 2 || stuckOnUrl;
                  let tier: 'local' | 'flash' | 'pro';
                  if (store.localSettings.enabled) {
                    tier = 'local';
                  } else if (isStuck) {
                    tier = 'pro';
                  } else {
                    tier = 'flash';
                  }
                  const tierIcon = tier === 'local' ? '🏠 local' : tier === 'pro' ? '🧠 pensando mais fundo' : '⚡ flash';
                  // Never send raw screenshot — OCR text is already in the payload
                  console.log(`[Agent] step ${step + 1} → aiAction (tier=${tier}, ocrUsed=${!!ocrText})`);
                  const result = await raceCancel(window.electronAPI?.aiAction(prompt, observedPayload, undefined, tier));
                  throwIfCancelled();
                  console.log(`[Agent] step ${step + 1} ← result:`, result?.error || `action=${result?.action?.type} engine=${result?._engine}`);
                  if (result?._engine) {
                    onProgress({ kind: 'status', message: `${tierIcon} → engine: ${result._engine}` });
                  }
                  if (result?.error) {
                    onProgress({ kind: 'status', message: `Erro: ${result.error}` });
                    setLastFooterMsg(result.error);
                    finishRun('failed', result.error);
                    return { error: result.error, thought: thoughts.join('\n'), results: allResults };
                  }
                  // browser-use style: surface the model's self-evaluation of its previous action.
                  if (result?.evaluation && step > 0) {
                    const evalStr = String(result.evaluation);
                    stepEvaluation = evalStr;
                    history += `\nSELF-EVAL [step ${step}]: ${evalStr.slice(0, 200)}`;
                    const icon = /^success/i.test(evalStr) ? '✅' : /^fail/i.test(evalStr) ? '❌' : '❓';
                    onProgress({ kind: 'status', message: `${icon} ${evalStr.slice(0, 160)}` });
                  }
                  if (result?.thought) {
                    stepThought = String(result.thought);
                    thoughts.push(`[${step + 1}] ${result.thought}`);
                    onProgress({ kind: 'thought', message: `[${step + 1}] ${result.thought.slice(0, 220)}` });
                  }
                  if (result?.metrics) {
                    const m = result.metrics;
                    const u = m.usage || {};
                    const inT = u.prompt_tokens ?? u.input_tokens ?? '?';
                    const outT = u.completion_tokens ?? u.output_tokens ?? '?';
                    const cached = u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0;
                    const sec = (m.latencyMs / 1000).toFixed(1);
                    onProgress({ kind: 'status', message: `📊 ${m.model} • ${inT} in / ${outT} out / ${cached} cached • ${sec}s` });
                  }
                  action = result?.action as BrowserAction | undefined;
                  // FAST MODE: enqueue the remaining batched actions (if any), capturing each
                  // ref's stable backendNodeId so it can be remapped to the next observation.
                  if (Array.isArray(result?.actions) && result.actions.length > 1) {
                    actionQueue = result.actions.slice(1).map((a: BrowserAction) => {
                      let stableId: number | undefined;
                      if ((a.type === 'click_ref' || a.type === 'fill_ref') && 'ref' in a) {
                        stableId = observation.interactive_elements.find(e => e.id === (a as any).ref)?.backendNodeId;
                      }
                      return { action: a, stableId };
                    });
                    onProgress({ kind: 'status', message: `⚡ lote de ${result.actions.length} ações planejado` });
                  }
                  } // end if (!fromQueue)
                  if (!action) {
                    setLastFooterMsg('AI did not return an action.');
                    finishRun('failed', 'AI did not return an action.');
                    return { error: 'AI did not return an action.', thought: thoughts.join('\n'), results: allResults };
                  }
                  // Etapa 6: repeated-action (loop) detection — same action proposed 3x in a row
                  const actionHash = formatAction(action);
                  // download/download_video ficam FORA: baixar de novo é loop de verdade.
                  const internalForDedupe = action.type === 'plan' || action.type === 'store'
                    || action.type === 'extract_text' || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'find_file'
                    || action.type === 'ask_ai' || action.type === 'read_aloud' || action.type === 'wait'
                    || action.type === 'done' || action.type === 'report';
                  const priorRepeats = recentActionHashes.slice(-3).filter(h => h === actionHash).length;
                  recentActionHashes.push(actionHash);
                  if (recentActionHashes.length > 6) recentActionHashes.shift();
                  if (!internalForDedupe && priorRepeats >= 2) {
                    history += `\nLOOP DETECTED: You proposed "${actionHash}" ${priorRepeats + 1} times without progress. Do NOT repeat it — pick a different element, scroll, or change strategy entirely.`;
                    onProgress({ kind: 'status', message: `Loop detectado: ${actionHash} repetido. Mudando estrategia.` });
                    noEffectCount = Math.max(noEffectCount, 2); // forces cloud 'pro' on next call
                    continue;
                  }
                  // ── FREIO ANTI-COLETA (crucial pro modelo LOCAL) ──────────────────
                  // extract_text é isento do loop-detector acima (re-extrair é "inofensivo").
                  // Mas modelo fraco (qwen local) re-extrai o mesmo texto várias vezes sem
                  // perceber que já tem a resposta → empaca sem dar report. Contamos extrações
                  // seguidas: na 2ª mandamos parar; e se persistir (ou já no local), ENCERRAMOS
                  // com a melhor resposta que o próprio modelo já escreveu (thought/eval).
                  if (action.type === 'extract_text') consecutiveExtracts++;
                  else if (action.type !== 'store' && action.type !== 'plan' && action.type !== 'wait') consecutiveExtracts = 0;
                  // SÓ no modo LOCAL: o freio é pra compensar o juízo fraco do modelo local.
                  // O caminho da NUVEM (API) fica 100% intocado (ele já sabe quando parar).
                  if (store.localSettings.enabled && action.type === 'extract_text' && consecutiveExtracts >= 2) {
                    if (consecutiveExtracts >= 4) {
                      // Travado de vez na coleta → encerra com o TEXTO já extraído (conteúdo real,
                      // não o pensamento de planejamento). Pelo menos entrega a informação da página.
                      const answer = (lastExtractedText || '').replace(/\s+/g, ' ').trim().slice(0, 500)
                        || (stepThought || stepEvaluation || '').trim() || 'Li o conteúdo da página.';
                      const done: BrowserAction = { type: 'done', success: true, reason: answer };
                      onProgress({ kind: 'status', message: `🛑 Travou re-extraindo — encerrei com o conteúdo extraído.` });
                      setLastFooterMsg(answer);
                      finishRun('success', answer);
                      return { thought: thoughts.join('\n\n') || answer, results: allResults, done };
                    }
                    // 2ª/3ª extração seguida: NÃO re-extrai — manda reportar com o texto que já tem.
                    history += `\nSTOP GATHERING: You ALREADY extracted the page text (see "EXTRACTED FROM ..." in RECENT HISTORY). Do NOT call extract_text again. Answer the user's question NOW with report({"summary":"..."}) using that text.`;
                    onProgress({ kind: 'status', message: `🛑 Já tenho o texto — pedindo a resposta (${consecutiveExtracts}×).` });
                    continue;
                  }
                  if (commandRequiresGmailPromotions && isPotentialDeleteAction(action, observation)) {
                    const inPromotions = isGmailPromotionsView(observation);
                    if (!inPromotions) {
                      history += '\nSAFETY BLOCK: Delete/remove action blocked because Gmail Promotions was not verified. Navigate to https://mail.google.com/mail/u/0/#category/promotions first.';
                      onProgress({ kind: 'status', message: 'Seguranca: bloqueei exclusao fora da aba Promocoes do Gmail.' });
                      noEffectCount++;
                      continue;
                    }
                  }
                  if (commandLooksLikeYouTubeComment && (youtubeCommentFilled || youtubeCommentSubmitted) && action.type === 'navigate') {
                    history += '\nSAFETY BLOCK: Navigation blocked after typing a YouTube comment. Find and click the Comentar/Comment submit button instead.';
                    onProgress({ kind: 'status', message: 'Seguranca: bloqueei navegacao depois de preencher comentario. Procurando botao Comentar.' });
                    noEffectCount++;
                    continue;
                  }
                  if (commandLooksLikeYouTubeComment && action.type === 'scroll') {
                    youtubeCommentScrolls++;
                    if (youtubeCommentScrolls >= 3 && isYouTubeWatchUrl(observation.url)) {
                      const assist = await tryRevealYouTubeCommentBox(wv);
                      if (assist.success) {
                        history += '\nYOUTUBE COMMENT ASSIST: Replaced another blind scroll with direct reveal/click of the comments box.';
                        onProgress({ kind: 'status', message: 'YouTube: evitei scroll repetido e fui direto para comentarios.' });
                        noEffectCount = 0;
                        continue;
                      }
                    }
                  }
                  throwIfCancelled();
                  onProgress({ kind: 'action', action });
                  if (action.type === 'done') {
                    // Robustness: a malformed model response is parsed into a sentinel 'done'.
                    // Don't kill the whole task on one bad output — re-prompt a few times.
                    if (/Invalid or missing action|did not return valid structured JSON/i.test(action.reason) && invalidActionRetries < 3) {
                      invalidActionRetries++;
                      history += '\nFORMAT ERROR: Your previous reply was not a valid action. Reply with ONE JSON object exactly: keys "evaluation", "thought", "action" (a tool name string) plus that tool\'s flat params. Try again now.';
                      onProgress({ kind: 'status', message: `Resposta malformada do modelo — re-tentando (${invalidActionRetries}/3)` });
                      noEffectCount = Math.max(noEffectCount, 1);
                      continue;
                    }
                    if (commandLooksLikeSendEmail && action.success && !gmailDraftFilled) {
                      history += '\nSAFETY BLOCK: Gmail email task cannot be marked done because the local helper did not verify a filled/sent draft.';
                      onProgress({ kind: 'status', message: 'Gmail: bloqueei conclusao falsa; rascunho/envio nao foi verificado.' });
                      noEffectCount++;
                      continue;
                    }
                    // LOCAL: modelos como gpt-oss às vezes GUARDAM a resposta com `store` e
                    // encerram com um `done` vago ("Answer ready"). Resgata: razão curta/
                    // genérica + há dado em MEMÓRIA → usa a memória como resposta. Só no modo
                    // local (a nuvem entrega via report normalmente — comportamento intocado).
                    if (store.localSettings.enabled && action.success) {
                      const vague = (action.reason || '').trim().length < 40
                        || /^(answer ready|resposta pronta|done|ok|completed?|conclu|pronto|feito)\b/i.test((action.reason || '').trim());
                      if (vague && memory.length) {
                        const last = memory[memory.length - 1];
                        const val = typeof last.value === 'string' ? last.value : JSON.stringify(last.value);
                        if (val && val.trim().length > 20) action.reason = val.trim().slice(0, 600);
                      }
                    }
                    setLastFooterMsg(`✅ ${action.reason}`);
                    finishRun(action.success ? 'success' : 'failed', action.reason);
                    return { thought: thoughts.join('\n\n') || action.reason, results: allResults, done: action };
                  }
                  setAgentVisual('acting');
                  const wvEl = (wv as any) as HTMLElement;
                  const wvRect = wvEl?.getBoundingClientRect?.();
                  const offX = wvRect?.left ?? 0;
                  const offY = wvRect?.top ?? 0;
                  if (action.type === 'click_at') addRipple(offX + action.x, offY + action.y);
                  else if (action.type === 'click_ref' || action.type === 'fill_ref') {
                    const target = observation.interactive_elements.find(e => e.id === action.ref);
                    if (target) addRipple(offX + target.x, offY + target.y);
                  }
                  // Real OS-level input via main process (Comet-style)
                  const wcId = (wv as any).getWebContentsId?.();
                  let toolResult: any;
                  if ((action.type === 'click_ref' || action.type === 'fill_ref') && wcId != null) {
                    const target = observation.interactive_elements.find(e => e.id === action.ref);
                    if (!target) {
                      toolResult = { success: false, error: `No element with ref @${action.ref}` };
                    } else {
                      // FREIO DE SEGURANÇA: pagamento/exclusão/cartão → confirma antes de agir.
                      const risk = classifyRisk(action.type, target.text, target.placeholder, target.aria);
                      let cancelled = false;
                      if (risk) {
                        const ok = await confirmRisky(risk);
                        throwIfCancelled();
                        if (!ok) {
                          cancelled = true;
                          toolResult = { success: false, reason: 'user_cancelled', error: `Você cancelou — não fiz "${risk.label}".` };
                          onProgress({ kind: 'status', message: `✖️ Cancelado por você: não toquei em "${risk.label}".` });
                        }
                      }
                      if (!cancelled) {
                      // Pre-click verification via CDP: re-resolve fresh coords from the stable
                      // backendNodeId (detects elements that moved or vanished) and hit-test for overlays.
                      let clickX = target.x;
                      let clickY = target.y;
                      let verifyBlocked = false;
                      if (target.backendNodeId != null && window.electronAPI?.verifyClick) {
                        const v = await window.electronAPI.verifyClick(wcId, target.backendNodeId).catch(() => null);
                        if (v && !v.error) {
                          if (v.stale) {
                            toolResult = { success: false, reason: 'stale_ref', error: `Element @${action.ref} no longer exists — re-observe the page.` };
                            verifyBlocked = true;
                          } else if (v.covered) {
                            // GENERAL: campo de input coberto por modal/overlay? Para FILL,
                            // preenche DIRETO no nó via CDP (foca + seta valor) — imune ao
                            // overlay, à coordenada e a redimensionar. Destrava formulários
                            // dentro de diálogos em QUALQUER site (login, checkout, comentário…).
                            // (Lição do salvar-playlist, agora aplicada de forma geral.)
                            if (action.type === 'fill_ref' && window.electronAPI?.fillNode && target.backendNodeId != null) {
                              const f = await window.electronAPI.fillNode(wcId, target.backendNodeId, action.value).catch(() => null);
                              if (f?.ok) {
                                toolResult = { success: true, info: { ref: action.ref, filledVia: 'cdp-node (overlay-proof)' } };
                                if (commandLooksLikeYouTubeComment && action.value.trim()) youtubeCommentFilled = true;
                              } else {
                                toolResult = { success: false, reason: 'element_covered', covering: v.covering, error: `Element @${action.ref} is covered by: ${v.covering || 'an overlay'}` };
                              }
                            } else {
                              toolResult = { success: false, reason: 'element_covered', covering: v.covering, error: `Element @${action.ref} is covered by: ${v.covering || 'an overlay'}` };
                            }
                            verifyBlocked = true;
                          } else {
                            if (typeof v.x === 'number') clickX = v.x;
                            if (typeof v.y === 'number') clickY = v.y;
                          }
                        }
                      }
                      if (verifyBlocked) { /* skip click — toolResult already set */ }
                      else {
                      const viewport = await withTimeout(
                        wv.executeJavaScript(`({ width: innerWidth, height: innerHeight })`).catch(() => ({ width: 0, height: 0 })),
                        3000, { width: 0, height: 0 });
                      const isOffscreen = clickY < 0 || clickX < 0 || clickY > viewport.height || clickX > viewport.width;
                      // BUG #1: numa página de resultados, clicar no link por coordenada
                      // costuma cair no wrapper/overlay e "não fazer nada" (loop clássico).
                      // Para um <a href> REAL num host de busca, navegar direto pro href é
                      // exatamente o que o clique pretende e é imune a wrapper/overlay/redirect.
                      // Se não achar href, cai no clique normal.
                      let r: any;
                      const isLinkTarget = target.tag === 'a' || target.role === 'link';
                      if (action.type === 'click_ref' && !isOffscreen && isLinkTarget && isSearchResultHost(observation.url)) {
                        const href = await withTimeout(
                          wv.executeJavaScript(`(function(x,y){try{var el=document.elementFromPoint(x,y);var a=el&&el.closest&&el.closest('a[href]');var h=a&&a.href;return (h&&/^https?:/i.test(h)&&!/^javascript:/i.test(h))?h:null;}catch(e){return null;}})(${clickX},${clickY})`).catch(() => null),
                          2500, null) as string | null;
                        if (href) {
                          const beforeNavUrl = wv.getURL();
                          try { await wv.loadURL(href); } catch {}
                          await waitForWebviewSettled(wv, beforeNavUrl);
                          r = { success: true, info: { navigatedHref: href, ref: action.ref } };
                        }
                      }
                      if (r === undefined) {
                        r = isOffscreen && target.text
                          ? await executeBrowserAction(wv, { type: 'click_text', text: target.text })
                          : await window.electronAPI?.realClick?.(wcId, clickX, clickY, target.backendNodeId);
                      }
                      if (action.type === 'fill_ref') {
                        await new Promise(rr => setTimeout(rr, 200));
                        // Select existing content via JS (works for inputs and contenteditable)
                        await withTimeout(
                          wv.executeJavaScript(`(function(){const el=document.activeElement;if(!el)return;try{if(el.select)el.select();else if(el.setSelectionRange)el.setSelectionRange(0,(el.value||'').length);else{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);}}catch(e){}})()`),
                          3000, null);
                        await new Promise(rr => setTimeout(rr, 80));
                        await window.electronAPI?.realType?.(wcId, action.value);
                        if (commandLooksLikeYouTubeComment && action.value.trim()) youtubeCommentFilled = true;
                      }
                      toolResult = r ?? { success: true };
                      }
                      } // fim do if(!cancelled) — freio de segurança
                    }
                  } else if (action.type === 'click_at' && wcId != null) {
                    // FREIO: resolve o rótulo do elemento SOB a coordenada e confirma se for de risco.
                    const lblAt = await withTimeout(wv.executeJavaScript(`(function(x,y){try{const e=document.elementFromPoint(x,y);if(!e)return '';const t=e.closest('a,button,[role=button],[role=link]')||e;return (t.innerText||t.textContent||t.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,80);}catch(_){return '';}})(${Math.round(action.x)},${Math.round(action.y)})`), 3000, '');
                    const cancelAt = await gateRisk(riskForAction(action as any, { text: String(lblAt || '') }));
                    toolResult = cancelAt ?? await window.electronAPI?.realClick?.(wcId, action.x, action.y);
                  } else if (action.type === 'click_text' && wcId != null) {
                    // FREIO DE SEGURANÇA: confirma antes de clicar em pagamento/exclusão.
                    const riskT = classifyRisk('click_text', action.text);
                    let cancelledT = false;
                    if (riskT) {
                      const ok = await confirmRisky(riskT);
                      throwIfCancelled();
                      if (!ok) {
                        cancelledT = true;
                        toolResult = { success: false, reason: 'user_cancelled', error: `Você cancelou — não cliquei em "${action.text}".` };
                        onProgress({ kind: 'status', message: `✖️ Cancelado por você.` });
                      }
                    }
                    if (!cancelledT) {
                    // Find coords via JS, then click via real input
                    const findScript = `(function(t){
                      const needle = String(t||'').toLowerCase().trim();
                      if (!needle) return null;
                      const NEG = ['não ','nao ','no ','un','dis','don\\'t ','do not ','desfazer ','remover ','cancelar '];
                      const NEG_SCORE = 900;
                      const score = (l) => { l=l.toLowerCase().trim(); if(!l.includes(needle)) return 999; for(const n of NEG){ if(l.includes(n+needle)) return NEG_SCORE; } return l===needle?0:5; };
                      const sel='a,button,[role=button],[role=link],input,textarea,select,[contenteditable="true"],[role=textbox],[tabindex]:not([tabindex="-1"]),span,div,p';
                      const els = Array.from(document.querySelectorAll(sel)).filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.pointerEvents!=='none'&&r.top<innerHeight&&r.bottom>0;});
                      const lab = (e) => (e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();
                      const cands = els.filter(e=>lab(e).toLowerCase().includes(needle)).sort((a,b)=>{const sa=score(lab(a)),sb=score(lab(b)); if(sa!==sb) return sa-sb; return lab(a).length-lab(b).length;});
                      const e = cands[0]; if(!e) return null;
                      if(score(lab(e))>=NEG_SCORE) return { negated: true, text: lab(e).slice(0,80) };
                      const target = e.closest('a,button,[role=button],[role=link]') || e;
                      const r = target.getBoundingClientRect();
                      return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), text: lab(target).slice(0,80), tag: target.tagName };
                    })(${JSON.stringify(action.text)})`;
                    const coords = await withTimeout(wv.executeJavaScript(findScript), 8000, null);
                    if (coords?.negated) {
                      toolResult = { success: false, error: `Only negated match found for "${action.text}" (found: "${coords.text}"). Use click_ref with the exact element ref instead.` };
                    } else if (coords && typeof coords.x === 'number') {
                      addRipple(offX + coords.x, offY + coords.y);
                      const r = await window.electronAPI?.realClick?.(wcId, coords.x, coords.y);
                      toolResult = { success: true, info: { ...coords, ...r } };
                    } else {
                      toolResult = { success: false, error: `No element with text: ${action.text}` };
                    }
                    } // fim do if(!cancelledT) — freio de segurança
                  } else if (action.type === 'type' && wcId != null) {
                    toolResult = await window.electronAPI?.realType?.(wcId, action.text);
                    if (commandLooksLikeYouTubeComment && action.text.trim()) youtubeCommentFilled = true;
                  } else if (action.type === 'press' && wcId != null) {
                    toolResult = await window.electronAPI?.realKey?.(wcId, action.key);
                  } else if (action.type === 'plan') {
                    plan = action.steps || [];
                    toolResult = { success: true, info: { steps: plan.length } };
                  } else if (action.type === 'store') {
                    memory.push({ key: action.key, value: action.value, source: action.source, ts: Date.now() });
                    // LOCAL: modelo fraco GUARDA a resposta com `store` e depois divaga sem
                    // reportar. Se o pedido é "me diga/qual/explique" e o valor guardado é uma
                    // frase substancial, ENTREGA na hora. Só no local (a nuvem reporta sozinha).
                    if (store.localSettings.enabled) {
                      const val = typeof action.value === 'string' ? action.value : '';
                      const wantsAnswer = /\b(me\s+diga|diga|me\s+fal\w+|qual|quais|o\s+que|quanto|quem|quando|onde|explique|explica|resuma|em\s+uma\s+frase|responda|defina)\b/i.test(command);
                      if (wantsAnswer && val.trim().length > 60) {
                        const answer = val.trim().slice(0, 600);
                        onProgress({ kind: 'status', message: `✅ ${answer.slice(0, 120)}` });
                        setLastFooterMsg(answer);
                        finishRun('success', answer);
                        return { thought: thoughts.join('\n\n') || answer, results: allResults, done: { type: 'done', success: true, reason: answer } as BrowserAction };
                      }
                    }
                    toolResult = { success: true, info: { stored: action.key, total_keys: memory.length } };
                  } else if (action.type === 'download') {
                    // Agent-driven download (image/pdf/...) → user's Downloads folder via main process
                    const dl = await window.electronAPI?.downloadUrl?.(action.url, action.filename);
                    toolResult = dl ?? { success: false, error: 'download API unavailable' };
                    if (dl?.success && dl.info) {
                      history += `\nDOWNLOADED: ${dl.info.path} (${Math.round(dl.info.bytes / 1024)} KB)`;
                      onProgress({ kind: 'status', message: `💾 Baixado: ${dl.info.path.split(/[\\/]/).pop()} (${Math.round(dl.info.bytes / 1024)} KB)` });
                    }
                  } else if (action.type === 'ask_ai') {
                    // Responde uma pergunta usando a NOSSA IA (DeepSeek/Ollama) — instantâneo,
                    // confiável, SEM CAPTCHA. (Antes raspava o duck.ai, que agora bloqueia bots.)
                    const q = action.question;
                    if (!q || q.length < 3) {
                      toolResult = { success: false, error: 'ask_ai needs a question.' };
                    } else {
                      setAgentVisual('thinking');
                      onProgress({ kind: 'status', message: `🤖 Consultando a IA: "${q.slice(0, 80)}"` });
                      let answered = false;
                      try {
                        const r = await window.electronAPI?.aiChat?.(q, undefined, undefined, store.localSettings.enabled);
                        if (r?.response && r.response.trim()) {
                          history += `\n\nAI ANSWER to "${q}":\n${r.response}\n(Use this to answer the user.)`;
                          onProgress({ kind: 'status', message: `🤖 Respondido (${r.response.length} chars).` });
                          toolResult = { success: true, info: { provider: 'own-ai', chars: r.response.length, preview: r.response.slice(0, 120) } };
                          answered = true;
                        }
                      } catch { /* cai pro fallback */ }
                      if (!answered) {
                        // Fallback GRÁTIS: Gemini web (gemini.google.com/app) — funciona deslogado.
                        // Se pedir CAPTCHA/login, NÃO resolvemos (anti-robô) — desiste limpo.
                        onProgress({ kind: 'status', message: `🌐 Consultando o Gemini (grátis) na web…` });
                        const g = await askWebGemini(wv, q);
                        if (g.success && g.answer) {
                          history += `\n\nGEMINI (web) ANSWER to "${q}":\n${g.answer}\n(Use this to answer the user.)`;
                          onProgress({ kind: 'status', message: `🤖 Gemini respondeu (${g.answer.length} chars).` });
                          toolResult = { success: true, info: { provider: 'gemini-web', chars: g.answer.length, preview: g.answer.slice(0, 120) } };
                        } else if (g.reason === 'captcha') {
                          toolResult = { success: false, error: 'O Gemini web pediu verificação/login (anti-robô) e eu não resolvo isso. Configure a IA própria (DeepSeek/Ollama/Gemini API) nas configurações que eu respondo direto.' };
                          onProgress({ kind: 'status', message: '⚠️ Gemini web pediu verificação — não resolvo (anti-robô). Use a IA própria nas configurações.' });
                        } else {
                          toolResult = { success: false, error: `Não consegui responder: ${g.error || 'IA indisponível'}. Configure a IA própria nas configurações.` };
                        }
                      }
                    }
                  } else if (action.type === 'find_file') {
                    // "Ache um PDF/planilha/etc de X" → Google filetype: operator → direct file URLs.
                    const ft = (action.filetype || 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf';
                    const gq = `${action.query} filetype:${ft}`;
                    onProgress({ kind: 'status', message: `📁 Procurando arquivo (${ft.toUpperCase()}): "${action.query}"` });
                    try { await wv.loadURL(`https://www.google.com/search?hl=pt-BR&gl=BR&pws=0&q=${encodeURIComponent(gq)}`); } catch {}
                    await waitForWebviewSettled(wv, '');
                    await new Promise(r => setTimeout(r, 900));
                    const links = await withTimeout<string[] | null>(wv.executeJavaScript(`(function(ft){
                      const re = new RegExp('\\\\.'+ft+'($|\\\\?|#)','i');
                      const seen = new Set();
                      const out = [];
                      for (const a of document.querySelectorAll('a[href]')) {
                        let h = a.href || '';
                        if (!/^https?:/i.test(h) || !re.test(h)) continue;
                        try { if (/(^|\\.)google\\./i.test(new URL(h).hostname)) continue; } catch { continue; }
                        if (seen.has(h)) continue; seen.add(h); out.push(h.slice(0,300));
                      }
                      return out.slice(0,10);
                    })(${JSON.stringify(ft)})`), 8000, null);
                    if (links && links.length) {
                      history += `\n\nFILES FOUND (${ft}, direct download URLs):\n${links.map((u, i) => `[file${i}] ${u}`).join('\n')}\n`;
                      onProgress({ kind: 'status', message: `📁 ${links.length} arquivo(s) ${ft.toUpperCase()} encontrado(s).` });
                      toolResult = { success: true, info: { count: links.length, filetype: ft, top: links[0] } };
                    } else {
                      toolResult = { success: false, error: `Nenhum arquivo .${ft} direto encontrado para "${action.query}". Tente outra palavra ou filetype.` };
                    }
                  } else if (action.type === 'read_aloud') {
                    // Browser reads text aloud (TTS) — great for accessibility and demos.
                    let speakText = action.text || '';
                    if (!speakText) {
                      speakText = await withTimeout<string>(wv.executeJavaScript(`(function(){
                        const main = document.querySelector('main, article, [role=main]') || document.body;
                        return (main.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 4000);
                      })()`), 5000, '');
                    }
                    if (!speakText) {
                      toolResult = { success: false, error: 'Nada para ler na página.' };
                    } else {
                      try {
                        window.speechSynthesis.cancel();
                        const u = new SpeechSynthesisUtterance(speakText.slice(0, 4000));
                        const voices = window.speechSynthesis.getVoices();
                        const pt = voices.find(v => /pt[-_]?BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang));
                        if (pt) u.voice = pt;
                        u.lang = pt?.lang || 'pt-BR';
                        u.rate = 1.0;
                        window.speechSynthesis.speak(u);
                        onProgress({ kind: 'status', message: `🔊 Lendo em voz alta (${speakText.length} chars)…` });
                        toolResult = { success: true, info: { chars: speakText.length, voice: u.voice?.name } };
                      } catch (e: any) {
                        toolResult = { success: false, error: `TTS indisponível: ${String(e?.message ?? e)}` };
                      }
                    }
                  } else if (action.type === 'download_video') {
                    // The "wow" demo action. Best path: a search query → yt-dlp finds AND
                    // downloads the top result directly (no fragile YouTube UI clicking).
                    // Fallbacks: explicit url, or the currently open tab.
                    const count = Math.min(Math.max(Number(action.count) || 1, 1), 50);
                    const target = action.query
                      ? `ytsearch1:${action.query}`
                      : (action.url || wv.getURL());
                    const isSearch = target.startsWith('ytsearch');
                    if (!isSearch && !/^https?:\/\//i.test(target)) {
                      toolResult = { success: false, error: 'No video URL/query — provide a query or open the video page.' };
                    } else {
                      setAgentVisual('acting');
                      const noun = action.audio_only ? 'música' : 'vídeo';
                      // Mensagem neutra: nunca ecoa a URL/origem (ex.: link do YouTube).
                      // Mostra só o que o usuário pediu (a query), nunca de ONDE veio.
                      onProgress({ kind: 'status', message: count > 1
                        ? `🎵 Baixando ${count} ${noun}s${isSearch ? ` "${action.query}"` : ''}…`
                        : (action.audio_only
                            ? `🎵 Baixando música${isSearch ? ` "${action.query}"` : ''}…`
                            : `🎬 Baixando vídeo${isSearch ? ` "${action.query}"` : ''}…`) });
                      const qual = action.quality === 'low' ? 'low' : action.quality === 'best' ? 'best' : undefined;
                      if (action.query) {
                        lastQuickActionRef.current = { type: 'download_video', query: action.query, audio_only: action.audio_only, count, quality: qual };
                      }
                      const vr = await window.electronAPI?.downloadVideo?.(target, action.audio_only, count, qual);
                      if (vr?.success) {
                        // A finished media download IS the goal — auto-complete the task here.
                        // Don't let a weaker model second-guess success (it was reporting
                        // done(failed) on a saved file). Instant, deterministic, ends clean.
                        const files = (vr.paths && vr.paths.length ? vr.paths : (vr.path ? [vr.path] : []))
                          .map(p => p.split(/[\\/]/).pop());
                        const nFiles = files.length || 1;
                        const list = files.join(', ') || vr.title;
                        const doneMsg = nFiles > 1
                          ? (action.audio_only
                              ? `${nFiles} músicas baixadas e salvas em Downloads: ${list}`
                              : `${nFiles} vídeos baixados e salvos em Downloads: ${list}`)
                          : `${action.audio_only ? 'Música baixada e salva' : 'Vídeo baixado e salvo'} em Downloads: ${list}`;
                        // miniaturas clicáveis no feed (clique → abre a pasta Downloads)
                        const fullPaths = (vr.paths && vr.paths.length ? vr.paths : (vr.path ? [vr.path] : []));
                        if (fullPaths.length) {
                          const dlDir = fullPaths[0].split(/[\\/]/).slice(0, -1).join('/');
                          onProgress({ kind: 'media', mediaKind: action.audio_only ? 'audio' : 'video', paths: fullPaths, dir: dlDir, total: fullPaths.length, label: `${fullPaths.length} ${action.audio_only ? (fullPaths.length > 1 ? 'músicas' : 'música') : (fullPaths.length > 1 ? 'vídeos' : 'vídeo')}` });
                        }
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { paths: vr.paths, title: vr.title } } });
                        // Auto-finish ONLY when nothing else is queued. A batch of named songs
                        // (actions:[download_video A, B, C]) must run them all before ending.
                        if (actionQueue.length === 0) {
                          setLastFooterMsg(`✅ ${doneMsg}`);
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        history += `\nDOWNLOADED: ${list}. Continue with the remaining queued downloads.`;
                        toolResult = { success: true, info: { paths: vr.paths } };
                      } else {
                        // ── FALLBACK CHAIN (self-healing, Gemini): yt-dlp falhou →
                        // varre a página por mídia DIRETA (<video>/<audio>/<source> ou
                        // links .mp4/.mp3) e tenta o download na marra antes de desistir.
                        let recovered = false;
                        if (!isSearch && window.electronAPI?.downloadUrl) {
                          try {
                            onProgress({ kind: 'status', message: '⚠️ yt-dlp falhou — procurando mídia direta na página…' });
                            const media: string[] = await withTimeout(wv.executeJavaScript(MEDIA_SCAN_JS), 5000, [] as any);
                            for (const mUrl of (media || []).slice(0, 4)) {
                              const dr = await window.electronAPI.downloadUrl(mUrl);
                              if (dr?.success) {
                                const name = dr.info?.path ? dr.info.path.split(/[\\/]/).pop() : mUrl.split('/').pop();
                                const doneMsg = `Mídia baixada direto da página (fallback): ${name}`;
                                onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                                allResults.push({ action, result: { success: true, info: dr.info } });
                                if (actionQueue.length === 0) {
                                  setLastFooterMsg(`✅ ${doneMsg}`);
                                  finishRun('success', doneMsg);
                                  return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                                }
                                toolResult = { success: true, info: dr.info };
                                recovered = true;
                                break;
                              }
                            }
                          } catch { /* cai no erro abaixo */ }
                        }
                        if (!recovered) {
                          toolResult = { success: false, error: (vr?.error || 'Falha no download do vídeo.') + ' O fallback de mídia direta também não encontrou um arquivo baixável na página.' };
                        }
                      }
                    }
                  } else if (action.type === 'open_video') {
                    // "mostre/abra/toque um vídeo de X": resolve o 1º vídeo DE VERDADE
                    // (yt-dlp pulando Shorts via filtro de duração, sem baixar) e abre
                    // TOCANDO na aba atual. Determinístico → auto-done. Em vez de largar
                    // o usuário na página de resultados (cheia de Shorts).
                    setAgentVisual('acting');
                    const vq = (action.query || '').trim();
                    lastQuickActionRef.current = { type: 'open_video', query: vq } as any;
                    // UNIVERSAL: "toque/abra ESSE vídeo" (página atual, QUALQUER site — Vimeo,
                    // Twitch, TikTok, vídeo embutido) → só dá play aqui, sem buscar no YouTube.
                    const curUrlOV = wv.getURL();
                    const refersThisVideo = /\b(este|esse|esta|essa|deste|desse|desta|dessa|aqui|daqui|atual|tocando|nessa\s+p[aá]gina|nesta\s+p[aá]gina|dessa\s+aba|que\s+(esta|t[aá])\s+(aberto|tocando|na\s+tela))\b/i.test(command);
                    const onAnyVideoPage = /youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|twitch\.tv\/|tiktok\.com\/.*\/video|dailymotion\.com\/video|globoplay|facebook\.com\/.*\/videos?\/|instagram\.com\/(reel|p|tv)\/|\.mp4($|\?)/i.test(curUrlOV);
                    if (refersThisVideo && onAnyVideoPage) {
                      await forcePlayVideo(wv);
                      const doneMsg = `▶️ Dei play no vídeo desta página.`;
                      onProgress({ kind: 'status', message: doneMsg });
                      allResults.push({ action, result: { success: true, info: { url: curUrlOV } } });
                      if (actionQueue.length === 0) {
                        setLastFooterMsg(doneMsg);
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { url: curUrlOV } };
                    } else {
                    onProgress({ kind: 'status', message: `🎬 Procurando um vídeo de "${vq}" (pulando Shorts)…` });
                    const v = await window.electronAPI?.resolveVideo?.(vq);
                    if (v?.ok && v.url) {
                      const beforeUrl = wv.getURL();
                      await executeBrowserAction(wv, { type: 'navigate', url: `${v.url}&autoplay=1` } as BrowserAction);
                      await waitForWebviewSettled(wv, beforeUrl);
                      await forcePlayVideo(wv);   // abre TOCANDO (sem o usuário clicar)
                      const doneMsg = `Abri o vídeo: ${v.title || v.url}`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { url: v.url, title: v.title } } });
                      if (actionQueue.length === 0) {
                        setLastFooterMsg(`✅ ${doneMsg}`);
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { url: v.url } };
                    } else {
                      // Não resolveu direto → abre a busca do YouTube e deixa o agente escolher
                      // (instruído a evitar Shorts), em vez de falhar.
                      const su = `https://www.youtube.com/results?search_query=${encodeURIComponent(vq)}`;
                      const beforeUrl = wv.getURL();
                      await executeBrowserAction(wv, { type: 'navigate', url: su } as BrowserAction);
                      await waitForWebviewSettled(wv, beforeUrl);
                      history += `\nOPEN_VIDEO: não resolvi um vídeo direto (${v?.error || '?'}). Abri a busca do YouTube — escolha um vídeo DE VERDADE (NÃO um Short, NÃO /shorts/) e abra clicando no título.`;
                      onProgress({ kind: 'status', message: `🔎 Não achei direto; abri a busca do YouTube pra escolher um vídeo (sem Shorts).` });
                      toolResult = { success: false, error: v?.error || 'não resolvi um vídeo direto' };
                    }
                    } // fim do else (não era "esse vídeo" da página atual)
                  } else if (action.type === 'create_playlist') {
                    // "crie uma playlist com as 10 músicas mais antigas do 2Pac": o MODELO
                    // já nomeou as músicas (action.songs); aqui resolvemos cada uma → id de
                    // vídeo real (sem Shorts) e montamos a playlist por URL (watch_videos),
                    // que toca na hora SEM login. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const songs = (action.songs || []).map(s => String(s).trim()).filter(Boolean).slice(0, 25);
                    if (songs.length < 2) {
                      toolResult = { success: false, error: 'Preciso de pelo menos 2 músicas pra montar a playlist.' };
                      history += '\nCREATE_PLAYLIST: poucas músicas. Reemita create_playlist com a lista de títulos (use seu conhecimento do artista).';
                    } else {
                      onProgress({ kind: 'status', message: `🎵 Montando a playlist — achando ${songs.length} músicas no YouTube (pulando Shorts)…` });
                      const resolved = (await window.electronAPI?.resolveVideos?.(songs)) || [];
                      const ok = resolved.filter(r => r.id);
                      const ids = ok.map(r => r.id as string);
                      if (ids.length < 2) {
                        toolResult = { success: false, error: `Só achei ${ids.length} vídeo(s) das ${songs.length} músicas — não dá pra montar a playlist.` };
                      } else {
                        const plUrl = `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`;
                        const beforeUrl = wv.getURL();
                        await executeBrowserAction(wv, { type: 'navigate', url: plUrl } as BrowserAction);
                        await waitForWebviewSettled(wv, beforeUrl);
                        await forcePlayVideo(wv);   // já começa tocando a 1ª
                        const titles = ok.map(r => r.title || r.query);
                        // Nome + privacidade: do modelo (action) OU extraídos do comando.
                        const nameM = command.match(/\b(?:nome|chamad[ao]|chame\s+de|t[ií]tulo|titulo)\s*:?\s*["'“”]?\s*([^\n"'“”]+?)\s*(?:["'“”]|,|\bque\b|\bprivad|\bparticular|$)/i);
                        const plName = (action.name && action.name.trim()) || (nameM ? nameM[1].trim() : '');
                        const wantPrivate = action.private === true || /\b(particular|privad[ao]|secret[ao]|s[oó]\s+(?:pra|para)\s+mim)\b/i.test(command);
                        const wantsSave = !!plName || wantPrivate || /\b(salv\w+|salve|guard\w+|adicion\w+\s+(ao|no)\s+(meu\s+)?perfil)\b/i.test(command);
                        allResults.push({ action, result: { success: true, info: { count: ids.length, url: plUrl } } });
                        if (wantsSave) {
                          // HÍBRIDO: a IA já escolheu as músicas; a "mão" determinística SALVA as
                          // 10 na conta logada. O save da página watch pega só 1 vídeo — então
                          // criamos a playlist com o 1º e ADICIONAMOS os outros um a um (navegando
                          // em cada vídeo; você vê o navegador montar a lista, música a música).
                          const saveName = plName || `${(songs[0] || 'Minha').split(/\s+/)[0]} — playlist`;
                          onProgress({ kind: 'status', message: `🎶 Salvando "${saveName}"${wantPrivate ? ' (privada)' : ''}: criando e adicionando ${ids.length} músicas…` });
                          await executeBrowserAction(wv, { type: 'navigate', url: `https://www.youtube.com/watch?v=${ids[0]}` } as BrowserAction);
                          await waitForWebviewSettled(wv, plUrl);
                          await new Promise(r => setTimeout(r, 1200));
                          const created = await trySaveNamedPlaylist(wv, saveName);
                          if (!created.ok) {
                            onProgress({ kind: 'status', message: `⚠️ Não criei a playlist (parou em "${created.step}"). Está logado no YouTube?` });
                            toolResult = { success: false, error: `Falha ao criar a playlist (passo ${created.step}). Precisa estar logado no YouTube.` };
                          } else {
                            let added = 1;
                            for (let k = 1; k < ids.length; k++) {
                              throwIfCancelled();
                              await executeBrowserAction(wv, { type: 'navigate', url: `https://www.youtube.com/watch?v=${ids[k]}` } as BrowserAction);
                              await waitForWebviewSettled(wv, '');
                              await new Promise(r => setTimeout(r, 900));
                              const a = await tryAddToExistingPlaylist(wv, saveName);
                              if (a.ok) added++;
                              onProgress({ kind: 'status', message: `➕ "${saveName}": ${added}/${ids.length} músicas…` });
                            }
                            // Volta pra tocar a playlist inteira (confirmação visual).
                            await executeBrowserAction(wv, { type: 'navigate', url: plUrl } as BrowserAction);
                            await waitForWebviewSettled(wv, '');
                            await forcePlayVideo(wv);
                            const doneMsg = `✅ Playlist "${saveName}" salva na sua conta (privada), com ${added} de ${ids.length} músicas${added < ids.length ? ' (algumas falharam ao adicionar)' : ''}. Tocando agora.`;
                            onProgress({ kind: 'status', message: doneMsg });
                            setLastFooterMsg(doneMsg);
                            finishRun(added >= 2 ? 'success' : 'failed', doneMsg);
                            return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: added >= 2 } as BrowserAction };
                          }
                        } else {
                          const doneMsg = `🎶 Playlist criada e tocando: ${ids.length} músicas (${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '…' : ''}).`;
                          onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                          if (actionQueue.length === 0) {
                            setLastFooterMsg(`✅ ${doneMsg}`);
                            finishRun('success', doneMsg);
                            return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                          }
                          toolResult = { success: true, info: { count: ids.length } };
                        }
                      }
                    }
                  } else if (action.type === 'open_videos') {
                    // "abre N abas, cada uma com um vídeo/música de X" → resolve N vídeos
                    // reais (ytsearchN, pulando Shorts) e abre cada um numa aba. 0 IA →
                    // segundos, em vez de o agente fazer na unha passo a passo.
                    setAgentVisual('acting');
                    const vq = (action.query || '').trim();
                    const want = Math.min(Math.max((action as any).count || 3, 2), 12);
                    lastQuickActionRef.current = { type: 'open_videos', query: vq, count: want } as any;
                    onProgress({ kind: 'status', message: `🎬 Procurando ${want} vídeos de "${vq}" (pulando Shorts)…` });
                    const rmv = await window.electronAPI?.resolveManyVideos?.(vq, want);
                    const vids = (rmv?.videos || []) as Array<{ url: string; title: string }>;
                    if (vids.length > 0) {
                      // SEM autoplay: abre TODAS em segundo plano (mudas/pausadas) e VOLTA
                      // pra aba de origem — cada vídeo só toca quando o usuário ABRE a aba
                      // (igual ao Chrome). Mesmo mecanismo do open_video_cuts (armCutTab):
                      // o guard muta+pausa e re-pausa se o player tentar tocar; o release
                      // (no clique da aba) dá play. Sem isso, as N abas tocavam todas juntas.
                      const originTabId = activeTabIdRef.current;
                      const opened: string[] = [];
                      for (const v of vids) { try { opened.push(store.addTab(v.url)); } catch {} }
                      store.setActiveTabId(originTabId);
                      activeTabIdRef.current = originTabId;
                      opened.forEach(id => { pausedCutTabsRef.current.set(id, 0); armCutTab(id); });
                      const doneMsg = `Abri ${vids.length} aba(s) com vídeos de "${vq}": ${vids.map(v => v.title).slice(0, 5).join(' · ')}`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { count: vids.length } } });
                      if (actionQueue.length === 0) {
                        setLastFooterMsg(`✅ ${doneMsg}`);
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { count: vids.length } };
                    } else {
                      const su = `https://www.youtube.com/results?search_query=${encodeURIComponent(vq)}`;
                      await executeBrowserAction(wv, { type: 'navigate', url: su } as BrowserAction);
                      history += `\nOPEN_VIDEOS: não resolvi vídeos direto (${rmv?.error || '?'}). Abri a busca — abra ${want} vídeos DE VERDADE (NÃO Shorts) em abas.`;
                      onProgress({ kind: 'status', message: `🔎 Não achei direto; abri a busca do YouTube.` });
                      toolResult = { success: false, error: `open_videos: ${rmv?.error || 'não resolvi direto'}` };
                    }
                  } else if (action.type === 'open_video_cuts') {
                    // Supercut helper: acha vídeos onde a FRASE É DITA (Filmot →
                    // fallback legendas via yt-dlp) e abre cada um na aba certa,
                    // já no segundo exato. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const want = Math.min(Math.max(Number(action.count) || 4, 1), 15);
                    // Lembra a intenção mesmo quando veio do modelo — permite o
                    // follow-up "e com a palavra X?" reaproveitar (inclusive após falha).
                    lastQuickActionRef.current = { type: 'open_video_cuts', phrase: action.phrase, count: want };
                    onProgress({ kind: 'status', message: `🎯 Procurando ${want} vídeo(s) onde "${action.phrase}" é dita… (busca em legendas, ~30s)` });
                    const vc = await window.electronAPI?.searchVideoCuts?.(action.phrase, want);
                    if (vc?.success && vc.cuts?.length) {
                      // Abre TODAS em segundo plano (pausadas/mudas) e volta pra aba
                      // original — o usuário clica em cada aba quando quiser o play.
                      const originTabId = activeTabIdRef.current;
                      const opened: string[] = [];
                      for (const c of vc.cuts) {
                        opened.push(store.addTab(`https://www.youtube.com/watch?v=${c.videoId}&t=${c.seconds}s`));
                      }
                      store.setActiveTabId(originTabId);
                      activeTabIdRef.current = originTabId;
                      opened.forEach((id, i) => { pausedCutTabsRef.current.set(id, vc.cuts[i].seconds); armCutTab(id); });
                      const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                      const listing = vc.cuts.map(c => `"${(c.title || c.videoId).slice(0, 50)}" @${fmt(c.seconds)}`).join(', ');
                      const doneMsg = `${vc.cuts.length} aba(s) abertas em segundo plano, pausadas no segundo exato em que "${action.phrase}" é dita — clique numa aba e o vídeo dá play na hora certa. ${listing} (fonte: ${vc.source === 'filmot' ? 'Filmot' : 'legendas do YouTube'})`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { cuts: vc.cuts } } });
                      if (actionQueue.length === 0) {
                        setLastFooterMsg(`✅ ${doneMsg}`);
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { cuts: vc.cuts } };
                    } else {
                      toolResult = { success: false, error: vc?.error || `Não achei vídeos onde "${action.phrase}" é dita.` };
                    }
                  } else if (action.type === 'make_supercut') {
                    // Acha onde a frase é dita e BAIXA cada trecho SEPARADO, na MELHOR
                    // qualidade do vídeo (não cola mais — a colagem mutilava a fala).
                    // Determinístico → auto-done + miniaturas clicáveis.
                    setAgentVisual('acting');
                    const want = Math.min(Math.max(Number(action.count) || 6, 1), 15);
                    lastQuickActionRef.current = { type: 'make_supercut', phrase: action.phrase, count: want } as any;
                    onProgress({ kind: 'status', message: `🎬 Buscando ${want} trechos onde "${action.phrase}" é dita e baixando na melhor qualidade…` });
                    const unsub = window.electronAPI?.onSupercutProgress?.((p) => {
                      const icon = p.stage === 'searching' ? '🔎' : p.stage === 'clipping' ? '⬇️' : '🎬';
                      onProgress({ kind: 'status', message: `${icon} ${p.message}` });
                    });
                    let sc: { success: boolean; dir?: string; paths?: string[]; clipCount?: number; clips?: Array<{ title?: string; videoId: string; seconds: number }>; error?: string } | undefined;
                    try {
                      sc = await window.electronAPI?.makeSupercut?.(action.phrase, want);
                    } finally { try { unsub?.(); } catch {} }
                    if (sc?.success && sc.paths && sc.paths.length) {
                      const folder = sc.dir ? sc.dir.split(/[\\/]/).pop() : action.phrase;
                      const doneMsg = `${sc.clipCount} trechos onde "${action.phrase}" é dita, baixados na melhor qualidade em Downloads/${folder}/`;
                      // miniaturas de vídeo clicáveis (clique → abre a pasta)
                      onProgress({ kind: 'media', mediaKind: 'video', paths: sc.paths, dir: sc.dir || '', total: sc.clipCount || sc.paths.length, label: `${sc.clipCount} trechos de "${action.phrase}"` });
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { dir: sc.dir, clips: sc.clipCount } } });
                      if (actionQueue.length === 0) {
                        setLastFooterMsg(`✅ ${doneMsg}`);
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { dir: sc.dir } };
                    } else {
                      toolResult = { success: false, error: sc?.error || 'Falha ao baixar os trechos.' };
                    }
                  } else if (action.type === 'compare_prices') {
                    // "por fora" igual ao yt-dlp: vai direto no Google Shopping (que
                    // agrega ML/Amazon/Magalu/KaBuM), deixa o WEBVIEW renderizar o JS,
                    // e o "scanner" raspa os preços do DOM → tabela ordenada. Sem o
                    // agente clicando. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const q = action.query;
                    onProgress({ kind: 'status', message: `🛒 Comparando preços de "${q}" — Google Shopping (Mercado Livre, Amazon, Magalu…)…` });
                    const shopUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=28&hl=pt-BR&gl=BR`;
                    const beforeUrl = wv.getURL();
                    await executeBrowserAction(wv, { type: 'navigate', url: shopUrl } as BrowserAction);
                    await waitForWebviewSettled(wv, beforeUrl);
                    await waitForSettle(wv, { maxMs: 4000, minMs: 300 });   // espera o Shopping ASSENTAR (não tempo fixo)
                    let items: Array<{ title: string; price: number; store: string; url: string }> = [];
                    try { items = await withTimeout(wv.executeJavaScript(PRICE_EXTRACTOR_JS, false), 9000, [] as any); } catch { /* página hostil */ }
                    const valid = (items || []).filter(x => x && x.price > 0 && x.title);
                    if (valid.length >= 2) {
                      const sorted = valid.sort((a, b) => a.price - b.price).slice(0, 30);
                      const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      const spec = {
                        title: `Preços: ${q}`,
                        subtitle: 'Google Shopping (Mercado Livre, Amazon, Magalu, KaBuM e mais) — ordenado do mais barato',
                        columns: ['Produto', 'Preço (R$)', 'Loja'],
                        rows: sorted.map(x => [x.title, fmt(x.price), x.store || '—']),
                        links: sorted.map(x => x.url || undefined),
                        chart: { type: 'bar' as const, label: 'Preço (R$)', labels: sorted.slice(0, 12).map(x => x.title.slice(0, 22)), values: sorted.slice(0, 12).map(x => x.price) },
                        sourceNote: `Fonte: Google Shopping — ${new Date().toLocaleString('pt-BR')}. Preços variam; confirme na loja antes de comprar.`,
                      };
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        const c = sorted[0];
                        const newId = store.addTab(rv.url);
                        activeTabIdRef.current = newId;
                        const doneMsg = `${sorted.length} ofertas de "${q}". Mais barato: ${c.title} — R$ ${fmt(c.price)}${c.store ? ` (${c.store})` : ''}. Tabela comparativa aberta numa aba.`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { count: sorted.length, cheapest: c } } });
                        if (actionQueue.length === 0) {
                          setLastFooterMsg(`✅ ${doneMsg}`);
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { count: sorted.length } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Falha ao montar a tabela de preços.' };
                      }
                    } else {
                      // Scanner não pegou (consent wall / layout novo): deixa o agente
                      // ler a página do Shopping que já está aberta, em vez de travar.
                      history += `\nPRICE COMPARE: auto-extraction from Google Shopping returned nothing for "${q}". The Shopping page IS OPEN — use extract_text to read the visible prices and answer, or report the cheapest you can see.`;
                      toolResult = { success: false, error: 'Não consegui raspar os preços automaticamente. A página do Google Shopping está aberta — vou ler ela.' };
                    }
                  } else if (action.type === 'google_news') {
                    // Vertical Notícias do Google (udm=12) — raspa as manchetes do DOM
                    // renderizado e monta um painel clicável. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const q = action.query;
                    onProgress({ kind: 'status', message: `📰 Buscando notícias de "${q}" no Google…` });
                    const newsUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=12&hl=pt-BR&gl=BR`;
                    const beforeUrl = wv.getURL();
                    await executeBrowserAction(wv, { type: 'navigate', url: newsUrl } as BrowserAction);
                    await waitForWebviewSettled(wv, beforeUrl);
                    await waitForSettle(wv, { maxMs: 3500, minMs: 250 });   // espera as manchetes ASSENTAREM
                    let news: Array<{ title: string; source: string; when: string; url: string }> = [];
                    try { news = await withTimeout(wv.executeJavaScript(NEWS_EXTRACTOR_JS, false), 9000, [] as any); } catch { /* hostil */ }
                    const valid = (news || []).filter(x => x && x.title && x.title.length > 12).slice(0, 30);
                    if (valid.length >= 2) {
                      const spec = {
                        title: `Notícias: ${q}`,
                        subtitle: `As ${valid.length} manchetes mais recentes — clique pra abrir a matéria`,
                        columns: ['Manchete', 'Fonte', 'Quando'],
                        rows: valid.map(x => [x.title, x.source || '—', x.when || '']),
                        links: valid.map(x => x.url || undefined),
                        sourceNote: `Fonte: Google Notícias — ${new Date().toLocaleString('pt-BR')}`,
                      };
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        const newId = store.addTab(rv.url);
                        activeTabIdRef.current = newId;
                        const doneMsg = `${valid.length} notícias sobre "${q}". Destaque: ${valid[0].title}${valid[0].source ? ` (${valid[0].source})` : ''}. Painel aberto numa aba.`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { count: valid.length } } });
                        if (actionQueue.length === 0) {
                          setLastFooterMsg(`✅ ${doneMsg}`);
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { count: valid.length } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Falha ao montar o painel de notícias.' };
                      }
                    } else {
                      history += `\nNEWS: auto-extraction returned nothing for "${q}". The Google News page IS OPEN — use extract_text to read the headlines and report them.`;
                      toolResult = { success: false, error: 'Não consegui raspar as manchetes. A página de notícias está aberta — vou ler ela.' };
                    }
                  } else if (action.type === 'render_view' || action.type === 'stock_movers') {
                    // A "mágica" visual: dados → página bonita (tabela ordenável +
                    // gráfico) aberta numa aba. Determinístico → auto-done.
                    setAgentVisual('acting');
                    let spec: any = null;
                    let failMsg = '';
                    if (action.type === 'stock_movers') {
                      const dirWord = action.direction === 'losers' ? 'que mais caíram' : 'que mais valorizaram';
                      onProgress({ kind: 'status', message: `📈 Buscando as ações ${dirWord} hoje (fonte direta, sem navegar)…` });
                      const sm = await window.electronAPI?.stockMovers?.(action.direction, action.count);
                      if (sm?.success && sm.spec) spec = sm.spec;
                      else failMsg = sm?.error || 'Fontes de cotações indisponíveis agora.';
                    } else {
                      spec = {
                        title: action.title, columns: action.columns, rows: action.rows,
                        subtitle: action.subtitle, chart: action.chart, sourceNote: action.source_note,
                      };
                    }
                    if (spec) {
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        const newId = store.addTab(rv.url);
                        activeTabIdRef.current = newId;
                        const doneMsg = `Pronto: "${spec.title}" aberta numa nova aba (${spec.rows?.length ?? 0} linhas, tabela ordenável + gráfico).`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { url: rv.url, rows: spec.rows?.length } } });
                        if (actionQueue.length === 0) {
                          setLastFooterMsg(`✅ ${doneMsg}`);
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { url: rv.url } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Falha ao montar a página de dados.' };
                      }
                    } else {
                      toolResult = { success: false, error: failMsg };
                    }
                  } else if (action.type === 'harvest_images') {
                    // COLHEITADEIRA: N imagens de um buscador → Downloads/<tema>/, em
                    // paralelo. Colhe DENTRO do webview (same-origin = sem 403): DDG i.js,
                    // com fallback Bing (auto-scroll). Determinístico → auto-done.
                    setAgentVisual('acting');
                    const q = (action.query || '').trim();
                    const want = Math.min(Math.max(Number(action.count) || 10, 1), 100);
                    const minW = Math.max(Number(action.min_width) || 800, 0);
                    if (q.length < 2) {
                      toolResult = { success: false, error: 'harvest_images precisa de um tema.' };
                    } else {
                      onProgress({ kind: 'status', message: `🪄 Colhendo ${want} imagens de "${q}" (alta qualidade)…` });
                      let urls: string[] = [];
                      // Raspa numa ABA OCULTA (same-origin evita 403, mas NÃO abre o buscador
                      // na cara do usuário — igual à Pesquisa Rápida). A aba some no fim.
                      const imgBgId = store.addHiddenTab(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`);
                      try {
                        let iw = 0;
                        let bgWv = webviewRefs.current.get(imgBgId) as Electron.WebviewTag | undefined;
                        while (iw < 6000 && !bgWv) { await new Promise(r => setTimeout(r, 150)); iw += 150; bgWv = webviewRefs.current.get(imgBgId) as any; }
                        if (bgWv) {
                          try {
                            await waitForWebviewSettled(bgWv, '');
                            await waitForSettle(bgWv, { maxMs: 3000, minMs: 250 });
                            const ddg: any = await withTimeout(bgWv.executeJavaScript(ddgHarvestScript(q, want, minW)), 20000, { urls: [] });
                            urls = Array.isArray(ddg?.urls) ? ddg.urls : [];
                          } catch { /* tenta Bing */ }
                          if (urls.length < want) {
                            try {
                              onProgress({ kind: 'status', message: `🪄 Completando no Bing Images…` });
                              await bgWv.loadURL(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}`);
                              await waitForWebviewSettled(bgWv, '');
                              await waitForSettle(bgWv, { maxMs: 3000, minMs: 250 });
                              const bing: any = await withTimeout(bgWv.executeJavaScript(bingHarvestScript(want, minW)), 25000, { urls: [] });
                              for (const u of (bing?.urls || [])) if (!urls.includes(u)) urls.push(u);
                            } catch { /* usa o que tiver */ }
                          }
                        }
                      } finally {
                        try { store.closeTab(imgBgId); } catch {}   // remove a aba oculta (nunca foi vista)
                      }
                      urls = urls.slice(0, want);
                      if (urls.length === 0) {
                        toolResult = { success: false, error: `Não consegui colher URLs de imagem para "${q}".` };
                      } else {
                        onProgress({ kind: 'status', message: `⬇️ Baixando ${urls.length} imagens em paralelo…` });
                        const hr = await window.electronAPI?.harvestImages?.(urls, q);
                        if (hr?.success && hr.saved > 0) {
                          const folder = hr.dir ? hr.dir.split(/[\\/]/).pop() : q;
                          const doneMsg = `Mágica feita! ${hr.saved} imagens de "${q}" salvas em Downloads/${folder}/`;
                          // miniaturas clicáveis no feed (clique → abre a pasta)
                          onProgress({ kind: 'media', mediaKind: 'image', paths: hr.paths || [], dir: hr.dir || '', total: hr.saved, label: `${hr.saved} imagens de "${q}"` });
                          onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                          allResults.push({ action, result: { success: true, info: { saved: hr.saved, dir: hr.dir } } });
                          if (actionQueue.length === 0) {
                            setLastFooterMsg(`✅ ${doneMsg}`);
                            finishRun('success', doneMsg);
                            return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                          }
                          toolResult = { success: true, info: { saved: hr.saved } };
                        } else {
                          toolResult = { success: false, error: hr?.error || 'Falha ao baixar as imagens colhidas.' };
                        }
                      }
                    }
                  } else if (action.type === 'search_images') {
                    // Fast, rights-clean image search via API (Openverse/Wikimedia) —
                    // returns DIRECT full-res URLs, no wandering to third-party sites.
                    const q = action.query;
                    if (!q || q.length < 2) {
                      toolResult = { success: false, error: 'search_images needs a query.' };
                    } else {
                      onProgress({ kind: 'status', message: `🖼️ Buscando imagens (alta resolução, livres): "${q}"` });
                      const sr = await window.electronAPI?.searchImages?.(q, action.min_width, action.count);
                      if (sr?.success && sr.images.length) {
                        const listing = sr.images.map((im, i) => `[img${i}] ${im.width}x${im.height} (${im.source}, ${im.license || 'lic?'}) ${im.url}`).join('\n');
                        history += `\n\nIMAGES FOUND (direct full-res URLs, ready to download):\n${listing}\n`;
                        onProgress({ kind: 'status', message: `🖼️ ${sr.images.length} imagens encontradas (maior: ${sr.images[0].width}x${sr.images[0].height}).` });
                        toolResult = { success: true, info: { count: sr.images.length, largest: `${sr.images[0].width}x${sr.images[0].height}`, top: sr.images[0].url } };
                      } else {
                        toolResult = { success: false, error: sr?.error || `Nenhuma imagem encontrada para "${q}".` };
                      }
                    }
                  } else if (action.type === 'extract_images') {
                    // List visible images with REAL dimensions so the agent can pick worthy URLs.
                    const minW = action.min_width && action.min_width > 0 ? action.min_width : 120;
                    const imgScript = `(function(minW){
                      const seen = new Set();
                      const out = [];
                      for (const im of Array.from(document.querySelectorAll('img'))) {
                        const src = im.currentSrc || im.src || '';
                        if (!src || !/^https?:/i.test(src) || seen.has(src)) continue;
                        const w = im.naturalWidth || 0, h = im.naturalHeight || 0;
                        if (w < minW) continue;
                        seen.add(src);
                        out.push({ src: src.slice(0, 500), w, h, alt: (im.alt || '').slice(0, 80) });
                      }
                      out.sort((a, b) => (b.w * b.h) - (a.w * a.h));
                      return out.slice(0, 20);
                    })(${minW})`;
                    const imgs = await withTimeout<any[] | null>(wv.executeJavaScript(imgScript), 8000, null);
                    if (imgs == null) {
                      toolResult = { success: false, error: 'extract_images timed out — page scripts unresponsive. Navigate to another source (Wikimedia, Bing Images).' };
                    } else if (imgs.length === 0) {
                      toolResult = { success: false, error: `No images >= ${minW}px found on this page.` };
                    } else {
                      const listing = imgs.map((im: any, i: number) => `[img${i}] ${im.w}x${im.h} ${im.alt ? `"${im.alt}" ` : ''}${im.src}`).join('\n');
                      history += `\n\nIMAGES ON ${wv.getURL()}:\n${listing}\n`;
                      toolResult = { success: true, info: { count: imgs.length, largest: `${imgs[0].w}x${imgs[0].h}` } };
                    }
                  } else if (action.type === 'extract_text' && commandLooksLikeImageTextRead) {
                    toolResult = { success: false, error: 'Skipped extract_text: OCR image tasks must use OCR TEXT, not webpage text.' };
                  } else if (action.type === 'extract_text') {
                    // Extract main visible text (filter scripts/styles, headings + paragraphs)
                    const max = action.max_chars && action.max_chars > 0 ? action.max_chars : 6000;
                    // Extrator estilo Readability: acha o MIOLO da página por densidade de
                    // texto (penalizando link-farms/menus), poda ads/nav/rodapé/sidebar e
                    // converte para Markdown semântico (títulos #, listas -, citações >).
                    // Economia de tokens + foco semântico (pedido do Gemini).
                    const extractScript = `(function(){
                      var clean = function(s){ return (s||'').replace(/\\s+/g,' ').trim(); };
                      var KILL = 'script,style,noscript,iframe,svg,form,button,input,select,nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[aria-hidden=true],.ad,.ads,.advert,.advertisement,.sidebar,.menu,.navbar,.cookie,.consent,.newsletter,.promo,.share,.social,.comment,.comments,.related,.recommended,.breadcrumb,.popup,.modal';
                      var score = function(el){ var t=(el.innerText||'').length; var links=el.querySelectorAll('a').length; return t - links*50; };
                      // 1) preferir contêineres semânticos de artigo
                      var root = document.querySelector('article, main, [role=main], .post-content, .entry-content, .article-body, .article-content, .post-body');
                      // 2) senão, o bloco mais "denso" de texto (Readability-style)
                      if (!root || (root.innerText||'').length < 400) {
                        var best = root ? score(root) : 0;
                        var cands = document.querySelectorAll('article, main, section, div');
                        for (var i=0;i<cands.length;i++){ var el=cands[i];
                          if (el.querySelector('article, main')) continue;      // evita o pai gigante
                          if ((el.innerText||'').length < 400) continue;
                          var s = score(el); if (s > best){ best = s; root = el; }
                        }
                      }
                      root = root || document.body;
                      var clone = root.cloneNode(true);
                      var junk = clone.querySelectorAll(KILL);
                      for (var j=0;j<junk.length;j++){ junk[j].remove(); }   // poda o lixo de dentro do miolo
                      var out = [];
                      var blocks = clone.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote');
                      if (blocks.length === 0){ out.push(clean(clone.innerText)); }
                      else { for (var k=0;k<blocks.length;k++){ var b=blocks[k]; var tag=b.tagName.toLowerCase(); var t=clean(b.innerText);
                        if (!t || t.length < 2) continue;
                        if (tag.charAt(0)==='h'){ out.push('\\n'+'######'.slice(0, parseInt(tag.charAt(1),10))+' '+t); }
                        else if (tag==='li'){ out.push('- '+t); }
                        else if (tag==='blockquote'){ out.push('> '+t); }
                        else { out.push(t); }
                      } }
                      var md = out.join('\\n\\n').replace(/\\n{3,}/g,'\\n\\n').trim();
                      if (md.length < 200){ md = clean(document.body.innerText); }  // fallback duro
                      return md.slice(0, ${max});
                    })()`;
                    try {
                      // Hung pages (ad/video scripts holding the main thread) never resolve
                      // executeJavaScript — bound it and tell the AI to use OCR instead.
                      const text = await withTimeout<string | null>(wv.executeJavaScript(extractScript), 6000, null);
                      if (text == null) {
                        toolResult = { success: false, error: 'extract_text timed out — page scripts are unresponsive. Answer from the OCR TEXT / PAGE TEXT already provided, or navigate to another page.' };
                      } else {
                        const url = wv.getURL();
                        const title = (await withTimeout<string>(wv.executeJavaScript('document.title'), 2000, '')) || '';
                        // Inject into history so subsequent steps see it
                        history += `\n\nEXTRACTED FROM ${title} (${url}):\n${text}\n`;
                        lastExtractedText = text;   // guardado pro fallback do freio anti-coleta
                        toolResult = { success: true, info: { url, title, chars: (text || '').length } };
                      }
                    } catch (e: any) {
                      toolResult = { success: false, error: String(e?.message || e) };
                    }
                  } else if (action.type === 'report') {
                    // Final synthesized answer to user — exits loop
                    setLastFooterMsg('');
                    appendAgentRunStep(runLog, {
                      step: step + 1,
                      urlBefore: observation.url,
                      urlAfter: observation.url,
                      titleAfter: observation.title,
                      ...summarizeAction(action),
                      result: { reported: action.summary },
                      success: true,
                    });
                    finishRun('success', action.summary);
                    return {
                      thought: thoughts.join('\n\n'),
                      results: [...allResults, { action, result: { reported: action.summary } }],
                      done: { type: 'done', reason: action.summary, success: true } as any,
                    };
                  } else if (action.type === 'switch_tab') {
                    const target = tabsRef.current[action.tab];
                    if (target) {
                      store.setActiveTabId(target.id);
                      activeTabIdRef.current = target.id;
                      toolResult = { success: true, info: { switchedTo: action.tab } };
                    }
                    else toolResult = { success: false, error: `Tab ${action.tab} not found` };
                    await sleep(1500);
                  } else if (action.type === 'new_tab') {
                    if (!/^https?:\/\//i.test(action.url || '')) {
                      toolResult = { success: false, error: `Bloqueado: o agente só abre páginas http(s), não "${action.url}".` };
                    } else {
                    const newId = store.addTab(action.url);
                    activeTabIdRef.current = newId;
                    toolResult = { success: true, info: { openedUrl: action.url, tabId: newId } };
                    // Wait for the new webview element to be created and attached
                    let waited = 0;
                    while (waited < 6000 && !webviewRefs.current.get(newId)) {
                      await new Promise(r => setTimeout(r, 200));
                      waited += 200;
                    }
                    // Then wait for it to load
                    await sleep(4000);
                    }
                  } else if (action.type === 'close_tab') {
                    const target = tabsRef.current[action.tab];
                    if (target) { store.closeTab(target.id); toolResult = { success: true, info: { closed: action.tab } }; }
                    else toolResult = { success: false, error: `Tab ${action.tab} not found` };
                  } else {
                    // FREIO: Enter (press) numa página de checkout pode submeter pagamento.
                    const pressCancel = action.type === 'press'
                      ? await gateRisk(riskForAction(action as any, undefined, wv.getURL?.() || ''))
                      : null;
                    // Bounded: on hung pages any executeJavaScript-based action (scroll,
                    // click_text fallback, fill...) would otherwise never resolve.
                    toolResult = pressCancel ?? await withTimeout(executeBrowserAction(wv, action),
                      12000,
                      { success: false, error: `${action.type} timed out — page scripts are unresponsive. Use OCR TEXT or navigate to a DIFFERENT site.` });
                  }
                  // Internal actions (plan/store/extract_text) never change the page — skip the
                  // settle + re-observe machinery (10-20s on heavy pages) and reuse the current state.
                  const pageNeutralAction = action.type === 'plan' || action.type === 'store' || action.type === 'extract_text'
                    || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'download' || action.type === 'download_video'
                    || action.type === 'read_aloud';
                  let screenshotAfter: string | undefined;
                  let afterObservation: ObservedState;
                  if (pageNeutralAction) {
                    screenshotAfter = screenshot;
                    afterObservation = observation;
                  } else {
                    await waitForWebviewSettled(wv, observation.url);
                    throwIfCancelled();
                    // Short adaptive debounce. waitForWebviewSettled already waited for
                    // did-stop-loading/navigate; we only add a small buffer for lazy content
                    // after a real navigation. The SPA-skeleton loop below re-waits if needed.
                    const urlChanged = wv.getURL() !== observation.url;
                    await new Promise(r => setTimeout(r, urlChanged ? 1200 : 400));
                    screenshotAfter = await withTimeout(captureScreenshot(), 8000, undefined as any);
                    afterObservation = await observeFast(wv, observeTimeoutMs);
                    rememberObservedSite(afterObservation);
                    // Detect SPA loading skeleton: drastic drop in element count → wait more, re-observe
                    const beforeCount = observation.interactive_elements.length;
                    const afterCount = afterObservation.interactive_elements.length;
                    let extraTries = 0;
                    while (extraTries < 2 && !isHungObservation(afterObservation) && (afterCount < 8 || (beforeCount > 20 && afterCount < beforeCount * 0.4))) {
                      await new Promise(r => setTimeout(r, 2000));
                      afterObservation = await observeFast(wv, observeTimeoutMs);
                      rememberObservedSite(afterObservation);
                      screenshotAfter = await withTimeout(captureScreenshot(), 8000, undefined as any);
                      if (afterObservation.interactive_elements.length >= 8 && afterObservation.interactive_elements.length >= beforeCount * 0.4) break;
                      extraTries++;
                    }
                  }
                  throwIfCancelled();
                  const stateKeyAfter = `${afterObservation.url}|${afterObservation.title}|${hashScreenshotDataUrl(screenshotAfter)}`;
                  const hadVisibleEffect = stateKeyAfter !== stateKeyBefore && stateKeyAfter !== previousStateKey;
                  allResults.push({ action, result: { ...toolResult, urlAfter: afterObservation.url, titleAfter: afterObservation.title } });
                  // Grava o passo em forma durável (click_ref→click_text etc.) pra
                  // virar macro reexecutável sem IA se o run terminar em sucesso.
                  // Clique "bem-sucedido" SEM efeito visível é flail (ex.: wrapper do
                  // botão Assets do GitHub) — não entra na receita.
                  if (toolResult?.success) {
                    const isClick = action.type === 'click_ref' || action.type === 'click_text' || action.type === 'click_at';
                    if (!isClick || hadVisibleEffect) {
                      const durable = toDurableAction(action, observation);
                      if (durable) macroTraceRef.current.push(durable);
                    }
                  }
                  history += `\nSTEP ${step + 1}: ${formatAction(action)}\nRESULT: ${JSON.stringify(toolResult).slice(0, 800)}\nURL: ${afterObservation.url}`;
                  onProgress({ kind: 'result', action, result: toolResult });
                  const targetForMemory = 'ref' in action
                    ? observation.interactive_elements.find(e => e.id === (action as any).ref)
                    : undefined;
                  rememberActionForSite({
                    actionType: action.type,
                    success: toolResult?.success !== false,
                    url: afterObservation.url,
                    title: afterObservation.title,
                    element: targetForMemory,
                    note: formatAction(action),
                  });
                  // Internal-state actions (plan/store/extract) don't change the page — don't penalize them
                  const internalAction = action.type === 'plan' || action.type === 'store' || action.type === 'extract_text'
                    || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'download' || action.type === 'download_video'
                    || action.type === 'read_aloud' || action.type === 'wait';
                  if (internalAction) {
                    // keep noEffectCount unchanged
                  } else {
                    noEffectCount = hadVisibleEffect ? 0 : noEffectCount + 1;
                  }
                  previousStateKey = stateKeyAfter;
                  // Carry the post-action observation into the next step (consumed there if the URL still matches).
                  carriedObservation = afterObservation;
                  // Site-initiated downloads triggered by this action (clicking a "baixar"
                  // button fires will-download; the page itself doesn't change). Tell the AI
                  // the click WORKED so it doesn't repeat it, and clear the no-effect penalty.
                  const dlEvents = downloadEventsRef.current.splice(0);
                  if (dlEvents.length > 0) {
                    for (const d of dlEvents) {
                      const line = d.state === 'completed'
                        ? `DOWNLOAD COMPLETED: ${d.filename} saved to Downloads (${Math.round((d.bytes || 0) / 1024)} KB). This is SUCCESS — do not click the download button again.`
                        : d.state === 'blocked'
                        ? `DOWNLOAD BLOCKED: ${d.filename} — ${d.reason || 'executable files are not allowed'}.`
                        : d.state === 'failed'
                        ? `DOWNLOAD FAILED: ${d.filename} — try another link/source.`
                        : `DOWNLOAD STARTED: ${d.filename} (saving automatically, no dialog).`;
                      history += `\n${line}`;
                      onProgress({ kind: 'status', message: `💾 ${line.slice(0, 140)}` });
                    }
                    if (dlEvents.some(d => d.state === 'completed' || d.state === 'started')) noEffectCount = 0;
                  }
                  if (toolResult && toolResult.reason === 'element_covered') {
                    history += `\nHINT: The target element is covered by an overlay (${toolResult.covering || 'unknown'}). Close the modal / cookie banner / popup first (look for "Aceitar", "Accept", "Fechar", "X", "OK"), then retry.`;
                  }
                  // Self-healing (prompt-repair): qualquer ação que FALHOU recebe uma
                  // instrução explícita pra tentar outra abordagem (não repetir). O
                  // orçamento de tentativas é o noEffectCount→search_alternative + MAX_STEPS.
                  if (toolResult && toolResult.success === false && !toolResult.reason
                      && action.type !== 'plan' && action.type !== 'store') {
                    history += `\nHINT: A última ação (${action.type}) FALHOU: ${(toolResult.error || 'sem efeito visível').slice(0, 160)}. Analise a página ATUAL e tente uma ABORDAGEM DIFERENTE (outro elemento/ref, scroll, navegar a outra fonte, ou outra ferramenta). NÃO repita a mesma ação igual.`;
                  }
                  if (noEffectCount >= 2) history += '\nWARNING: Two consecutive actions had no visible effect. Choose a different strategy now.';

                  // ── Recovery layer — detect blockers and inject corrective instructions ──
                  const recoveryVerdict = recovery.evaluate({
                    goal: command,
                    url: afterObservation.url,
                    title: afterObservation.title || '',
                    textSample: afterObservation.text_sample || '',
                    elements: afterObservation.interactive_elements || [],
                    lastResult: toolResult,
                    lastActionType: action.type,
                    // Texto do botão clicado (do estado ANTES do clique) → ação sensível precisa.
                    lastActionTargetText:
                      action.type === 'click_ref'
                        ? (observation.interactive_elements.find(e => e.id === (action as any).ref)?.text || '')
                        : action.type === 'click_text'
                        ? ((action as any).text || '')
                        : '',
                    noEffectCount,
                    stepsOnSameUrl,
                    step,
                    commandRequiresThisSite: commandMentionsDomain(afterObservation.url),
                  });
                  const urlChangedByAction = afterObservation.url !== observation.url;
                  const checkoutLikeUrl = /checkout|payment|pagamento|cart|carrinho|comprar|buy|order\/confirm|pedido\/confirm/i.test(afterObservation.url);
                  const openedRegularPage = recoveryVerdict.blocker === 'sensitive_action'
                    && urlChangedByAction
                    && !checkoutLikeUrl
                    && (action.type === 'click_ref' || action.type === 'click_text' || action.type === 'navigate');
                  const ignoreSensitivePress = recoveryVerdict.blocker === 'sensitive_action' && action.type === 'press';
                  const ignoreSensitiveRecovery = ignoreSensitivePress || openedRegularPage;
                  appendAgentRunStep(runLog, {
                    step: step + 1,
                    urlBefore: observation.url,
                    urlAfter: afterObservation.url,
                    titleAfter: afterObservation.title,
                    ...summarizeAction(action),
                    result: summarizeResult(toolResult),
                    success: toolResult?.success !== false,
                    evaluation: stepEvaluation,
                    thought: stepThought,
                    recovery: !ignoreSensitiveRecovery && recoveryVerdict.decision !== 'continue'
                      ? {
                          decision: recoveryVerdict.decision,
                          reason: recoveryVerdict.reason,
                          blocker: recoveryVerdict.blocker,
                        }
                      : undefined,
                  });

                  // ── Emit a structured step record for the transcript/replay panel ──
                  let stepThumb: string | undefined;
                  try { if (screenshotAfter) stepThumb = await resizeDataUrl(screenshotAfter, 440); } catch {}
                  onProgress({ kind: 'step', step: {
                    step: step + 1,
                    evaluation: stepEvaluation,
                    thought: stepThought,
                    actionLabel: formatAction(action),
                    success: toolResult?.success !== false,
                    resultSummary: toolResult ? JSON.stringify(toolResult).slice(0, 300) : undefined,
                    urlAfter: afterObservation.url,
                    recovery: !ignoreSensitiveRecovery && recoveryVerdict.decision !== 'continue'
                      ? { decision: recoveryVerdict.decision, reason: recoveryVerdict.reason }
                      : undefined,
                    screenshot: stepThumb,
                    fromQueue,
                    durationMs: Date.now() - stepStartedAt,
                  } });

                  if (ignoreSensitiveRecovery) {
                    history += openedRegularPage
                      ? '\nRECOVERY OVERRIDE: Ignored sensitive-action warning because the last action only opened a regular page/product, not checkout/payment/cart.'
                      : '\nRECOVERY OVERRIDE: Ignored sensitive-action warning because the last action was only a key press/dismissal attempt.';
                  } else if (recoveryVerdict.decision !== 'continue') {
                    onProgress({ kind: 'status', message: `🛡️ Recovery: ${recoveryVerdict.reason.slice(0, 120)}` });
                    const instruction = recoveryInstruction(recoveryVerdict);
                    history += instruction;

                    // Abort / ask_user → end the task immediately
                    if (recoveryVerdict.decision === 'abort' || recoveryVerdict.decision === 'ask_user') {
                      if (recoveryVerdict.decision === 'ask_user' && (
                        recoveryVerdict.blocker === 'login_required'
                        || recoveryVerdict.blocker === 'captcha'
                        || recoveryVerdict.blocker === 'paywall'
                      )) {
                        const kind = recoveryVerdict.blocker === 'captcha'
                          ? 'captcha'
                          : recoveryVerdict.blocker === 'paywall'
                          ? 'paywall'
                          : 'login';
                        await waitForManualHelp({
                          kind,
                          reason: recoveryVerdict.reason,
                          instruction: kind === 'captcha'
                            ? 'Resolva a verificacao humana manualmente nesta aba. Quando terminar, clique em Continuar.'
                            : kind === 'paywall'
                            ? 'Se voce tiver acesso, entre manualmente. Depois clique em Continuar para eu tentar seguir daqui.'
                            : 'Faca login manualmente no proprio site. Quando estiver logado, clique em Continuar para eu retomar a tarefa.',
                        }, afterObservation.url);
                        continue;
                      }
                      const done: BrowserAction = { type: 'done', success: false, reason: recoveryVerdict.reason };
                      setLastFooterMsg(`🛡️ ${recoveryVerdict.reason}`);
                      finishRun('failed', recoveryVerdict.reason);
                      return { thought: thoughts.join('\n\n') || recoveryVerdict.reason, results: allResults, done };
                    }
                    // go_back → automatically go back, re-observe next iteration
                    if (recoveryVerdict.decision === 'go_back') {
                      try { wv.goBack(); } catch {}
                      await new Promise(r => setTimeout(r, 1200));
                    }
                    // search_alternative → the instruction in history will guide the AI.
                    // Force 'pro' tier on next call for smarter recovery.
                    if (recoveryVerdict.decision === 'search_alternative') {
                      noEffectCount = Math.max(noEffectCount, 2);
                    }
                    // close_popup / retry → instruction is in history, AI will act on it next step.
                  }
                }
                setLastFooterMsg('Atingiu limite de passos');
                finishRun('max_steps', 'Atingiu limite de passos');
                return { thought: `${thoughts.join('\n\n')}\n\nReached max steps`, results: allResults };
              } catch (err: any) {
                if (err?.message === 'TASK_CANCELLED_BY_USER') {
                  const done: BrowserAction = { type: 'done', success: false, reason: 'Tarefa cancelada pelo usuario.' };
                  setLastFooterMsg(done.reason);
                  finishRun('cancelled', done.reason);
                  return { thought: done.reason, results: allResults, done };
                }
                finishRun('failed', err?.message ?? String(err));
                throw err;
              } finally {
                setAgentVisual('idle');
              }
            }}
            onSendChat={async (msg) => {
              store.addChatMessage('user', msg);
              const pageContent = await getPageContent();
              const result = await window.electronAPI?.aiChat(msg, pageContent, undefined, store.localSettings.enabled);
              const raw = result?.response ?? (result?.error ? `Erro: ${result.error}` : 'Sem resposta.');
              // Caixa unificada: o modo resposta pode propor uma ação numa linha
              // [[ACTION: ...]]. Extraímos a proposta e a removemos do texto exibido —
              // ela vira o botão "⚡ Fazer isso" (e um "sim" do usuário também a executa).
              const m = raw.match(/\[\[\s*ACTION\s*:\s*([^\]]+?)\s*\]\]/i);
              const suggestedCommand = m ? m[1].trim() : undefined;
              const reply = raw.replace(/\[\[\s*ACTION\s*:[^\]]*\]\]/ig, '').trim() || raw.trim();
              store.addChatMessage('assistant', reply);
              return { reply, suggestedCommand };
            }}
            onResearch={runWebResearch}
            onFetchHeadlines={fetchNewsHeadlines}
            onGoogleLogin={handleGoogleLogin}
            onOpenUrl={(url: string) => { const id = store.addTab(url); activeTabIdRef.current = id; }}
            onClose={() => store.setSidebarOpen(false)}
            aiSettings={store.aiSettings}
            onSettingsChange={async (settings) => {
              store.setAISettings(settings);
              await window.electronAPI?.setAIProvider(settings.provider, settings.apiKey, settings.baseUrl);
            }}
            localSettings={store.localSettings}
            onLocalSettingsChange={async (ls) => {
              store.setLocalSettings(ls);
              if (ls.enabled) {
                await window.electronAPI?.setLocalProvider?.(ls.provider, 'local', ls.baseUrl, ls.model);
              }
            }}
          />
        </div>
      </div>

      {lastFooterMsg && (
        <div className="agent-footer-strip">
          <span className="agent-footer-label">{t('footer.lastStatus')}</span>
          <span className="agent-footer-text" title={t('footer.selectCopy')}>{lastFooterMsg}</span>
          <button className="agent-footer-clear" onClick={() => setLastFooterMsg('')} title={t('footer.clear')}>×</button>
        </div>
      )}
      {historyOpen && (
        <div className="history-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="history-panel" onClick={e => e.stopPropagation()}>
            <div className="history-head">
              <span>🕘 {t('history.title')}</span>
              <div className="history-head-actions">
                <button className="history-clear" onClick={clearHistory}>{t('history.clear')}</button>
                <button className="history-close" onClick={() => setHistoryOpen(false)} title={t('assist.close')}>✕</button>
              </div>
            </div>
            {historyView.length === 0 ? (
              <div className="history-empty">{t('history.empty')}</div>
            ) : (
              <ul className="history-list">
                {historyView.map((h, i) => (
                  <li key={h.url + i} className="history-item" onClick={() => { setHistoryOpen(false); navigate(h.url); }} title={h.url}>
                    <span className="history-title">{h.title}</span>
                    <span className="history-url">{h.url.replace(/^https?:\/\//, '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {/* dead second AgentCommandBar removed */}
    </div>
  );
}

// Páginas de RESULTADO de busca cujos links são notoriamente embrulhados por wrapper/
// overlay — clicar por coordenada "não surte efeito" e o agente entra em loop (bug #1).
// Só os resultados (Google com q=, Bing /search, DDG, YouTube /results); páginas de
// destino e watch do YouTube ficam de fora (clique normal).
// Formatadores do painel de downloads (tamanho, velocidade, tempo restante).
function fmtSize(b?: number): string {
  if (!b) return '';
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
}
function fmtSpeed(bps?: number): string {
  if (!bps) return '';
  return bps >= 1048576 ? (bps / 1048576).toFixed(1) + ' MB/s' : Math.round(bps / 1024) + ' KB/s';
}
function fmtEta(s?: number): string {
  if (s == null) return '';
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s}s`;
}

function isSearchResultHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/(^|\.)google\.[a-z.]+$/.test(h) && /[?&]q=/.test(url)) return true;
    if (/(^|\.)bing\.com$/.test(h) && /\/search\?/.test(url)) return true;
    if (/(^|\.)duckduckgo\.com$/.test(h)) return true;
    if (/(^|\.)youtube\.com$/.test(h) && /\/results\?/.test(url)) return true;
    return false;
  } catch { return false; }
}

// Força a reprodução começar (autoplay-policy já liberado no main, mas o YouTube carrega
// pausado): desmuta e dá play no <video>, e clica o botão grande de play se ainda pausado.
// Injeta algumas vezes porque o player do YouTube monta com atraso. "Quem pede música
// não quer clicar" — abre tocando.
async function forcePlayVideo(wv: Electron.WebviewTag): Promise<void> {
  const js = `(function(){try{var v=document.querySelector('video');if(v){try{v.muted=false;}catch(e){}var p=v.play&&v.play();if(p&&p.catch)p.catch(function(){});}var b=document.querySelector('.ytp-large-play-button,.ytp-play-button');if(b&&v&&v.paused)b.click();return !!(v&&!v.paused);}catch(e){return false;}})()`;
  for (let i = 0; i < 4; i++) {
    try { const playing = await wv.executeJavaScript(js); if (playing) return; } catch {}
    await new Promise(r => setTimeout(r, 1200));
  }
}

// Salva a playlist temporária (watch_videos) na conta logada COM NOME, via JS puro no
// diálogo do YouTube — sem clique por coordenada (imune a maximizar a tela) e sem o
// coverage check (que bloqueava o campo do título). Estrutura confirmada por sonda 2026:
// botão aria-label="Salvar na playlist" → item "Nova playlist" → <textarea placeholder
// "Escolha um título"> → botão "Criar". Visibilidade já vem "Particular" por padrão.
async function trySaveNamedPlaylist(wv: Electron.WebviewTag, name: string): Promise<{ ok: boolean; step?: string; err?: string }> {
  const js = `(async function(name){
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function setVal(el,val){try{el.focus();var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,val);}catch(e){el.value=val;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
    try{
      var save=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return /salvar na playlist|save to playlist/i.test(b.getAttribute('aria-label')||'');});
      if(!save) return {ok:false,step:'save-btn'};
      save.click(); await wait(1700);
      var nova=Array.prototype.slice.call(document.querySelectorAll('ytd-popup-container *,tp-yt-paper-dialog *,[role=dialog] *')).find(function(e){return e.childElementCount===0 && /^\\s*(nova playlist|new playlist)\\s*$/i.test(e.textContent||'');});
      if(!nova) return {ok:false,step:'nova-playlist'};
      (nova.closest('[role=option],tp-yt-paper-item,ytd-add-to-playlist-create-renderer,button,a,[role=button]')||nova).click();
      await wait(1700);
      var ta=document.querySelector('tp-yt-paper-dialog[opened] textarea, tp-yt-paper-dialog textarea, textarea[placeholder*="t\\u00edtulo" i], textarea[placeholder*="titulo" i], textarea[placeholder*="title" i]');
      if(!ta) return {ok:false,step:'title-input'};
      setVal(ta,name); await wait(800);
      var dlg=ta.closest('tp-yt-paper-dialog')||document;
      var criar=Array.prototype.slice.call(dlg.querySelectorAll('button,tp-yt-paper-button,yt-button-shape,[role=button]')).find(function(b){return /^\\s*(criar|create)\\s*$/i.test((b.textContent||'').replace(/\\s+/g,' ').trim());});
      if(!criar) return {ok:false,step:'criar-btn'};
      criar.click(); await wait(2200);
      return {ok:true};
    }catch(e){return {ok:false,step:'exception',err:String(e&&e.message)};}
  })(${JSON.stringify(name)})`;
  try { return await wv.executeJavaScript(js) as any; } catch (e: any) { return { ok: false, step: 'inject', err: String(e?.message ?? e) }; }
}

// Adiciona o VÍDEO ATUAL a uma playlist JÁ EXISTENTE (pelo nome), via o diálogo
// "Salvar na playlist" → marca a linha da playlist. Usado pra montar a lista música a
// música (o save da página watch só pega 1 vídeo). JS puro (imune a resize/coverage).
async function tryAddToExistingPlaylist(wv: Electron.WebviewTag, name: string): Promise<{ ok: boolean; step?: string; have?: string[] }> {
  const js = `(async function(name){
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function norm(s){return (s||'').replace(/\\s+/g,' ').trim();}
    function clean(s){return norm(s).replace(/particular|p\\u00fablica|n\\u00e3o listada|public|unlisted|private/ig,'').trim();}
    try{
      var save=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return /salvar na playlist|save to playlist/i.test(b.getAttribute('aria-label')||'');});
      if(!save) return {ok:false,step:'save-btn'};
      save.click(); await wait(1600);
      var rows=Array.prototype.slice.call(document.querySelectorAll('yt-list-item-view-model,ytd-playlist-add-to-option-renderer,[role=option]'));
      var target=null;
      for(var i=0;i<rows.length;i++){ if(clean(rows[i].textContent).toLowerCase()===name.toLowerCase()){target=rows[i];break;} }
      if(!target){ var rx=new RegExp('^'+name.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&'),'i'); target=rows.find(function(r){return rx.test(clean(r.textContent));}); }
      if(!target) return {ok:false,step:'find-row',have:rows.map(function(r){return clean(r.textContent).slice(0,20);}).slice(0,8)};
      // UI nova (yt-list-item-view-model): clicar a linha (ou filho clicável) marca a playlist → adiciona o vídeo.
      (target.querySelector('[role=checkbox],button,a,.yt-list-item-view-model-wiz__container')||target).click();
      await wait(800);
      var close=document.querySelector('tp-yt-paper-dialog [aria-label*="Fechar" i],ytd-popup-container [aria-label*="Fechar" i],tp-yt-paper-dialog #close-button button');
      if(close)close.click(); else { try{document.body.click();}catch(e){} }
      return {ok:true};
    }catch(e){return {ok:false,step:'exception'};}
  })(${JSON.stringify(name)})`;
  try { return await wv.executeJavaScript(js) as any; } catch (e: any) { return { ok: false, step: 'inject' }; }
}

function isTrashDestroyerCommand(command: string): boolean {
  const text = command.toLowerCase();
  const asksSummary = /resum|sumari|3\s*t[oó]picos|tres\s*t[oó]picos|bullet|pontos/.test(text);
  const asksClean = /tira|remov|limp|destruidor|lixo|an[uú]ncio|ads?|popup|pop-up|texto principal|modo leitura/.test(text);
  return asksSummary && asksClean;
}

async function runTrashDestroyer(
  wv: Electron.WebviewTag,
  command: string,
  onProgress: (event: AgentProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{ thought: string; results: Array<{ action: BrowserAction; result: any }>; done: BrowserAction }> {
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error('TASK_CANCELLED_BY_USER');
  };

  throwIfCancelled();
  const article = await raceTimeout(wv.executeJavaScript(TRASH_DESTROYER_EXTRACT_SCRIPT), 8000, null as any);
  if (!article?.text) {
    const done: BrowserAction = { type: 'done', success: false, reason: 'Nao consegui extrair texto principal desta pagina.' };
    return { thought: done.reason, results: [], done };
  }

  onProgress({ kind: 'status', message: 'Destruidor de Lixo: resumindo em 3 pontos...' });
  const summary = await summarizeForTrashDestroyer(article, command);

  throwIfCancelled();
  onProgress({ kind: 'status', message: 'Destruidor de Lixo: removendo anuncios, popups e ruido visual...' });
  const injected = await raceTimeout(wv.executeJavaScript(`
    (function(payload) {
      ${TRASH_DESTROYER_RENDER_SCRIPT}
      return window.__trashDestroyer.render(payload);
    })(${JSON.stringify({ ...article, summary })})
  `), 10000, { success: false, error: 'inject timed out' });

  const reason = injected?.success
    ? `Pagina limpa: ${summary.length} topicos, ${article.removedCount ?? 0} elementos de ruido detectados.`
    : `Falha ao transformar a pagina: ${injected?.error ?? 'erro desconhecido'}`;
  const done: BrowserAction = { type: 'done', success: !!injected?.success, reason };
  return {
    thought: 'Detectei um pedido de resumo + limpeza visual e usei o fluxo dedicado de manipulacao DOM ao vivo.',
    results: [{ action: { type: 'report', summary: reason }, result: injected }],
    done,
  };
}

async function summarizeForTrashDestroyer(
  article: { title?: string; url?: string; text: string },
  command: string,
): Promise<string[]> {
  const fallback = fallbackThreeBullets(article.text);
  try {
    const prompt = [
      'Resuma a pagina abaixo em exatamente 3 topicos curtos, em portugues.',
      'Cada topico deve ter no maximo 140 caracteres.',
      'Nao use numeracao; retorne apenas uma linha por topico.',
      '',
      `Comando do usuario: ${command}`,
      `Titulo: ${article.title ?? ''}`,
      `URL: ${article.url ?? ''}`,
      '',
      article.text.slice(0, 9000),
    ].join('\n');
    const res = await raceTimeout(window.electronAPI?.aiChat(prompt, '', undefined, store.localSettings.enabled) ?? Promise.resolve(undefined), 14000, undefined);
    const raw = res?.response?.trim();
    if (!raw || res?.error) return fallback;
    const bullets = raw
      .split(/\n+/)
      .map(line => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    return bullets.length === 3 ? bullets : fallback;
  } catch {
    return fallback;
  }
}

function fallbackThreeBullets(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 45 && s.length < 260);
  const picked = sentences.slice(0, 3);
  while (picked.length < 3) picked.push('O texto principal foi isolado para leitura sem distracoes.');
  return picked.map(s => s.length > 150 ? `${s.slice(0, 147).trim()}...` : s);
}

// Module-level bounded await — for helpers outside the agent-loop closure.
// On hung pages (ad/video scripts holding the main thread) executeJavaScript never
// resolves; every page-touching await must be raced against a budget.
function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const t = new Promise<T>(r => { id = setTimeout(() => r(fallback), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(id));
}

const TRASH_DESTROYER_EXTRACT_SCRIPT = `
(function(){
  const noise = [
    'script','style','noscript','svg','canvas','iframe','nav','aside','footer','form',
    '[role="banner"]','[role="navigation"]','[role="complementary"]','[role="dialog"]',
    '[aria-modal="true"]','.ad','.ads','.advertisement','.banner','.popup','.modal',
    '[class*="ad-"]','[class*="ads"]','[class*="advert"]','[id*="ad-"]','[id*="ads"]',
    '[class*="cookie"]','[id*="cookie"]','[class*="newsletter"]','[class*="paywall"]'
  ].join(',');
  const clone = document.body ? document.body.cloneNode(true) : document.createElement('body');
  clone.querySelectorAll(noise).forEach(el => el.remove());
  const candidates = Array.from(clone.querySelectorAll('article, main, [role="main"], section, div'))
    .map(el => {
      const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const paragraphs = Array.from(el.querySelectorAll('p')).map(p => (p.innerText || p.textContent || '').trim()).filter(t => t.length > 40);
      const linkText = Array.from(el.querySelectorAll('a')).map(a => (a.innerText || a.textContent || '').trim()).join(' ');
      const linkDensity = text ? Math.min(0.95, linkText.length / text.length) : 1;
      const score = text.length + paragraphs.length * 450 - linkDensity * 1800;
      return { el, text, paragraphs, score };
    })
    .filter(x => x.text.length > 500)
    .sort((a,b) => b.score - a.score);
  const best = candidates[0];
  const allText = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim();
  const text = (best?.paragraphs?.length ? best.paragraphs.join('\\n\\n') : best?.text || allText).slice(0, 18000);
  const removedCount = document.querySelectorAll(noise).length;
  return {
    title: document.querySelector('h1')?.innerText?.trim() || document.title || 'Leitura limpa',
    subtitle: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    url: location.href,
    host: location.hostname.replace(/^www\\./,''),
    text,
    removedCount
  };
})()
`;

const TRASH_DESTROYER_RENDER_SCRIPT = `
window.__trashDestroyer = window.__trashDestroyer || {
  render(payload) {
    try {
      if (!window.__trashDestroyerOriginal) {
        window.__trashDestroyerOriginal = {
          html: document.documentElement.innerHTML,
          title: document.title,
          overflow: document.documentElement.style.overflow
        };
      }
      const esc = (value) => String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const paragraphs = String(payload.text || '')
        .split(/\\n{2,}|(?<=[.!?])\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/)
        .map(t => t.replace(/\\s+/g, ' ').trim())
        .filter(t => t.length > 55)
        .slice(0, 14);
      const bullets = (payload.summary || []).slice(0, 3);
      document.title = 'Leitura limpa - ' + (payload.title || 'Resumo');
      document.documentElement.style.overflow = 'auto';
      document.body.innerHTML = '<div id="trash-destroyer-root"></div>';
      const root = document.getElementById('trash-destroyer-root');
      const css = document.createElement('style');
      css.textContent = \`
        :root{color-scheme:light;}
        body{margin:0!important;background:#f7f5f0!important;color:#171717!important;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;}
        #trash-destroyer-root{min-height:100vh;background:
          radial-gradient(circle at 20% 0%,rgba(9,185,196,.16),transparent 30%),
          linear-gradient(180deg,#fbfaf6 0%,#f0eee7 100%);position:relative;overflow:hidden;}
        .td-scan{position:fixed;inset:0;z-index:20;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(18,185,170,.22),transparent);height:22vh;animation:tdScan 1.5s cubic-bezier(.2,.9,.2,1) forwards;mix-blend-mode:multiply;}
        .td-shell{width:min(980px,calc(100% - 40px));margin:0 auto;padding:44px 0 70px;animation:tdIn .7s ease both;}
        .td-top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:26px;}
        .td-brand{display:flex;align-items:center;gap:11px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#0f766e;}
        .td-mark{width:32px;height:32px;border-radius:8px;background:#111;box-shadow:0 12px 28px rgba(0,0,0,.18);position:relative;}
        .td-mark:after{content:"";position:absolute;inset:8px;border-radius:4px;background:linear-gradient(135deg,#2dd4bf,#f8fafc);}
        .td-restore{border:1px solid rgba(23,23,23,.16);background:rgba(255,255,255,.74);height:34px;border-radius:7px;padding:0 13px;font-weight:700;color:#171717;cursor:pointer;}
        .td-hero{border-bottom:1px solid rgba(23,23,23,.12);padding-bottom:28px;margin-bottom:28px;}
        .td-kicker{font-size:12px;text-transform:uppercase;letter-spacing:.18em;color:#737373;font-weight:800;margin-bottom:14px;}
        h1{font-size:clamp(34px,6vw,72px)!important;line-height:.95!important;letter-spacing:0!important;margin:0 0 18px!important;max-width:900px;font-weight:850!important;color:#111!important;}
        .td-sub{font-size:18px;line-height:1.55;color:#4b5563;max-width:760px;margin:0;}
        .td-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0;}
        .td-card{background:#111;color:#fff;border-radius:8px;padding:18px;min-height:142px;display:flex;flex-direction:column;gap:16px;box-shadow:0 22px 55px rgba(0,0,0,.18);}
        .td-num{font-size:11px;font-weight:900;color:#5eead4;letter-spacing:.14em;}
        .td-card p{font-size:17px;line-height:1.35;margin:0;font-weight:720;}
        .td-reading{background:rgba(255,255,255,.72);border:1px solid rgba(23,23,23,.10);border-radius:8px;padding:34px 38px;box-shadow:0 20px 80px rgba(38,38,38,.10);}
        .td-reading p{font-family:Georgia,"Times New Roman",serif;font-size:20px;line-height:1.75;margin:0 0 22px;color:#262626;}
        .td-stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;color:#525252;font-size:12px;font-weight:750;}
        .td-pill{background:#e7e5df;border:1px solid rgba(23,23,23,.08);border-radius:999px;padding:7px 10px;}
        @keyframes tdScan{0%{transform:translateY(-28vh);opacity:0}18%{opacity:1}100%{transform:translateY(120vh);opacity:0}}
        @keyframes tdIn{from{opacity:0;transform:translateY(18px) scale(.985)}to{opacity:1;transform:none}}
        @media(max-width:760px){.td-shell{width:min(100% - 24px,980px);padding-top:26px}.td-summary{grid-template-columns:1fr}h1{font-size:40px!important}.td-reading{padding:24px 20px}.td-reading p{font-size:18px}.td-top{align-items:flex-start}.td-restore{flex:0 0 auto}}
      \`;
      document.head.appendChild(css);
      root.innerHTML = \`
        <div class="td-scan"></div>
        <main class="td-shell">
          <div class="td-top">
            <div class="td-brand"><span class="td-mark"></span><span>Destruidor de Lixo</span></div>
            <button class="td-restore" type="button">Restaurar pagina</button>
          </div>
          <section class="td-hero">
            <div class="td-kicker">\${esc(payload.host)} - modo leitura instantaneo</div>
            <h1>\${esc(payload.title)}</h1>
            \${payload.subtitle ? '<p class="td-sub">' + esc(payload.subtitle) + '</p>' : ''}
            <div class="td-stats">
              <span class="td-pill">\${esc(payload.removedCount || 0)} elementos de ruido detectados</span>
              <span class="td-pill">Resumo em 3 pontos</span>
              <span class="td-pill">DOM refeito localmente</span>
            </div>
          </section>
          <section class="td-summary">
            \${bullets.map((b, i) => '<article class="td-card"><span class="td-num">PONTO ' + String(i + 1).padStart(2,'0') + '</span><p>' + esc(b) + '</p></article>').join('')}
          </section>
          <article class="td-reading">
            \${paragraphs.map(p => '<p>' + esc(p) + '</p>').join('')}
          </article>
        </main>
      \`;
      root.querySelector('.td-restore').addEventListener('click', () => {
        const original = window.__trashDestroyerOriginal;
        if (!original) return;
        document.open();
        document.write(original.html);
        document.close();
        document.title = original.title || document.title;
        document.documentElement.style.overflow = original.overflow || '';
      });
      return { success: true, paragraphs: paragraphs.length };
    } catch (error) {
      return { success: false, error: String(error && error.message || error) };
    }
  }
};
`;

async function resizeDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const im = new Image();
    im.onload = () => {
      const scale = im.width > maxWidth ? maxWidth / im.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(im.width * scale);
      canvas.height = Math.round(im.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    im.onerror = () => resolve(dataUrl);
    im.src = dataUrl;
  });
}

// ── O "scanner" de preços: roda DENTRO do DOM renderizado do Google Shopping ──
// Heurística robusta (não depende de classes do Google, que mudam): acha blocos de
// texto curtos que contêm UM preço "R$ x", extrai título (linha mais longa), loja
// (nome de varejista conhecido) e link. Dedupe por título. Devolve ordenado.
const PRICE_EXTRACTOR_JS = `(function(){
  try {
    var priceRe = /R\\$\\s?\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d{2})?/;
    var toNum = function(s){ var m = s.match(/R\\$\\s?([\\d.\\s]+(?:,\\d{2})?)/); if(!m) return null; var n = m[1].replace(/[.\\s]/g,'').replace(',','.'); var f = parseFloat(n); return isFinite(f)?f:null; };
    var STORE = /(Mercado\\s*Livre|Amazon|Magazine\\s*Luiza|Magalu|Americanas|Kabum|Casas\\s*Bahia|Ponto(?:frio)?|Shoptime|Pichau|Terabyte|Carrefour|AliExpress|Shopee|Fast\\s*Shop|Extra|Submarino|Girafa|Dell|Kalunga)/i;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('div, li, a'));
    var out = [], seen = {};
    for (var i=0;i<nodes.length;i++){
      var el = nodes[i];
      var txt = (el.innerText||'').trim();
      if (txt.length < 8 || txt.length > 280) continue;
      var pm = txt.match(/R\\$/g); if (!pm || pm.length > 2) continue;
      if (!priceRe.test(txt)) continue;
      var price = toNum(txt); if (!price || price < 3) continue;
      var lines = txt.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
      var titles = lines.filter(function(l){ return l.indexOf('R$') === -1 && !/^\\d+([.,]\\d+)?$/.test(l) && l.length >= 8 && !/avalia|estrela|frete|parcel|cupom|patrocinad|an[úu]ncio|promo[çc][aã]o|melhor pre|^\\d+\\s*(un|gb|tb)\\b/i.test(l); });
      titles.sort(function(a,b){ return b.length - a.length; });
      var title = (titles[0]||'').replace(/^(promo[çc][aã]o|patrocinad[oa]|oferta|novo)\\s*/i,'').trim();
      if (!title || title.length < 6) continue;
      var key = title.slice(0,42).toLowerCase().replace(/[^a-z0-9]+/g,'');
      if (!key || seen[key]) continue; seen[key] = 1;
      var sm = txt.match(STORE); var store = sm ? sm[0] : '';
      var a = el.tagName === 'A' ? el : el.querySelector('a[href]');
      var href = a && a.href ? a.href : '';
      out.push({ title: title.slice(0,90), price: price, store: store, url: href });
      if (out.length > 60) break;
    }
    out.sort(function(a,b){ return a.price - b.price; });
    return out.slice(0, 40);
  } catch(e){ return []; }
})()`;

// ── Scanner de NOTÍCIAS: raspa as manchetes do Google News (udm=12) renderizado ──
// Cada resultado é um <a> que embrulha o card. Pega título (linha mais longa), fonte
// (1ª linha curta) e o "quando" (há X horas / data). Link = href do próprio <a>.
const NEWS_EXTRACTOR_JS = `(function(){
  try {
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
    var out = [], seen = {};
    for (var i=0;i<anchors.length;i++){
      var a = anchors[i];
      var href = a.href || '';
      if (!/^https?:/.test(href) || /google\\.com|gstatic|googleusercontent/.test(href)) continue;
      var txt = (a.innerText||'').trim();
      if (txt.length < 18 || txt.length > 320) continue;
      var lines = txt.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
      if (lines.length < 2) continue;
      // título = linha mais longa; fonte = linha curta sem digito de tempo; quando = "há.."/data
      var sorted = lines.slice().sort(function(x,y){return y.length-x.length;});
      var title = sorted[0];
      if (!title || title.length < 16) continue;
      var when = (lines.filter(function(l){ return /\\b(h[aá]\\s*\\d|min|hora|dia|semana|m[eê]s|ontem|hoje|\\d{1,2}\\/\\d{1,2})\\b/i.test(l) && l.length < 30; })[0]) || '';
      var source = (lines.filter(function(l){ return l !== title && l !== when && l.length >= 2 && l.length < 40 && !/^\\d/.test(l); })[0]) || '';
      var key = title.slice(0,46).toLowerCase().replace(/[^a-z0-9]+/g,'');
      if (!key || seen[key]) continue; seen[key] = 1;
      out.push({ title: title.slice(0,140), source: source, when: when, url: href });
      if (out.length > 40) break;
    }
    return out.slice(0, 30);
  } catch(e){ return []; }
})()`;

// ── Extrator de RESULTADOS de busca (Pesquisa Rápida estilo Perplexity) ──
// Raspa título + snippet + url dos resultados orgânicos do Google E do Bing
// (Google: <a><h3>; Bing: <h2><a>) → o modelo sintetiza a resposta no painel.
const SEARCH_EXTRACTOR_JS = `(function(){
  try {
    var out = [], seen = {};
    var heads = Array.prototype.slice.call(document.querySelectorAll('h3, h2'));
    for (var i=0;i<heads.length;i++){
      var h = heads[i];
      var title = (h.innerText||h.textContent||'').replace(/\\s+/g,' ').trim();
      if (title.length < 8 || title.length > 180) continue;
      var link = (h.querySelector && h.querySelector('a[href]')) || (h.closest && h.closest('a[href]'));
      if (!link || !link.href || !/^https?:/.test(link.href)) continue;
      var href = link.href, host='';
      try { host = new URL(href).hostname; } catch(e){ continue; }
      if (/(^|\\.)google\\.|gstatic|googleusercontent|(^|\\.)bing\\.com|go\\.microsoft|microsofttranslator/.test(host)) continue;
      var key = href.split('#')[0];
      if (seen[key]) continue;
      // container do resultado: sobe alguns níveis e pega o maior bloco de texto != título
      var c = link, best = '';
      for (var k=0;k<5 && c.parentElement;k++) c = c.parentElement;
      var nodes = Array.prototype.slice.call(c.querySelectorAll('div,span,p'));
      for (var j=0;j<nodes.length;j++){
        var t = (nodes[j].innerText||'').replace(/\\s+/g,' ').trim();
        if (t.length > best.length && t.length >= 40 && t.indexOf(title.slice(0,16)) === -1) best = t;
      }
      seen[key] = 1;
      out.push({ title: title.slice(0,160), snippet: best.slice(0,300), url: href });
      if (out.length >= 6) break;
    }
    return out;
  } catch(e){ return []; }
})()`;

// ── Scanner de mídia direta (fallback do download): acha arquivos baixáveis no DOM ──
// <video>/<audio>/<source> com src http(s) + links terminados em extensão de mídia.
// Ignora blob:/m3u8 (streams que só o yt-dlp resolve). É a "força bruta" do fallback.
const MEDIA_SCAN_JS = `(function(){
  try {
    var urls = [];
    var push = function(u){ if(u && /^https?:/.test(u) && !/\\.m3u8(\\?|$)/i.test(u) && urls.indexOf(u)<0) urls.push(u); };
    document.querySelectorAll('video[src],audio[src],video source[src],audio source[src],source[src]').forEach(function(e){ push(e.src); });
    document.querySelectorAll('video,audio').forEach(function(e){ if(e.currentSrc && e.currentSrc.indexOf('blob:')!==0) push(e.currentSrc); });
    document.querySelectorAll('a[href]').forEach(function(a){ if(/\\.(mp4|webm|m4a|mp3|ogg|wav|mov|mkv|flac|aac)(\\?|$)/i.test(a.href)) push(a.href); });
    return urls.slice(0, 8);
  } catch(e){ return []; }
})()`;

// ── Colheita de imagens DENTRO do webview (mesma origem = sem 403) ──
// DDG: pega o vqd do HTML e chama /i.js?o=json (XHR same-origin, como o próprio DDG)
// paginando até juntar `count` URLs originais com largura >= minW.
const ddgHarvestScript = (query: string, count: number, minW: number) => `(async function(){
  try {
    var html = document.documentElement.innerHTML;
    var m = html.match(/vqd=\\"([0-9-]+)\\"/) || html.match(/vqd=([0-9-]{6,})/);
    if (!m) return { error: 'sem vqd' };
    var vqd = m[1];
    var want = ${count}, minW = ${minW};
    var q = ${JSON.stringify(query)};
    var urls = [], seen = {};
    var next = '/i.js?l=us-en&o=json&q=' + encodeURIComponent(q) + '&vqd=' + vqd + '&f=,,,&p=1';
    for (var pg = 0; pg < 10 && urls.length < want && next; pg++) {
      var r = await fetch(next, { headers: { 'Accept':'application/json, text/javascript, */*; q=0.01', 'X-Requested-With':'XMLHttpRequest' }, credentials:'include' });
      if (!r.ok) break;
      var j = await r.json();
      (j.results || []).forEach(function(it){
        var u = it.image;
        if (u && !seen[u] && (it.width||0) >= minW) { seen[u] = 1; urls.push(u); }
      });
      next = j.next ? ('/' + j.next.replace(/^\\//,'')) : null;
      await new Promise(function(res){ setTimeout(res, 200); });
    }
    return { urls: urls.slice(0, want) };
  } catch(e) { return { error: String(e) }; }
})()`;

// Bing fallback: cada card é <a class="iusc" m='{"murl":"<URL ORIGINAL>",...}'>.
// Auto-scroll (lazy load) até juntar `count`.
const bingHarvestScript = (count: number, minW: number) => `(async function(){
  try {
    var want = ${count}, minW = ${minW};
    var collect = function(){
      var out = [];
      document.querySelectorAll('a.iusc').forEach(function(a){
        try { var d = JSON.parse(a.getAttribute('m')); if (d && d.murl) out.push({ url: d.murl, w: d.mw||0 }); } catch(e){}
      });
      return out;
    };
    var map = {};
    for (var i = 0; i < 12; i++) {
      collect().forEach(function(o){ if (o.url && !map[o.url] && o.w >= minW) map[o.url] = 1; });
      if (Object.keys(map).length >= want) break;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(function(res){ setTimeout(res, 700); });
    }
    return { urls: Object.keys(map).slice(0, want) };
  } catch(e) { return { error: String(e) }; }
})()`;

async function waitForWebviewSettled(wv: Electron.WebviewTag, beforeUrl: string): Promise<void> {
  await new Promise<void>((resolve) => {
    // Ceiling 5s: ad-heavy pages keep loading forever and never fire did-stop-loading;
    // the post-action debounce + skeleton re-observe already cover late content.
    const timeout = window.setTimeout(done, 5000);

    function done() {
      window.clearTimeout(timeout);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate', onNavigate);
      wv.removeEventListener('did-navigate-in-page', onNavigate);
      resolve();
    }

    function onStop() {
      window.setTimeout(done, 300);
    }

    function onNavigate() {
      window.setTimeout(done, 300);
    }

    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate', onNavigate);
    wv.addEventListener('did-navigate-in-page', onNavigate);
    window.setTimeout(() => {
      if (!wv.isLoading() || wv.getURL() !== beforeUrl) done();
    }, 500);
  });
}

function isGmailPromotionsView(observation: { url: string; title?: string; text_sample?: string }): boolean {
  const haystack = `${observation.url} ${observation.title ?? ''} ${observation.text_sample ?? ''}`.toLowerCase();
  return haystack.includes('#category/promotions')
    || haystack.includes('/#category/promotions')
    || haystack.includes('promotions')
    || haystack.includes('promoções')
    || haystack.includes('promocoes');
}

function isPotentialDeleteAction(action: BrowserAction, observation: { interactive_elements: Array<{ id: number; text?: string; aria?: string; role?: string; placeholder?: string }> }): boolean {
  const deleteWords = /excluir|apagar|deletar|delete|remove|remover|trash|lixeira/i;
  if (action.type === 'click_text') return deleteWords.test(action.text);
  if (action.type === 'press') return /delete|backspace/i.test(action.key);
  if (action.type === 'click_ref' || action.type === 'fill_ref') {
    const target = observation.interactive_elements.find(e => e.id === action.ref);
    const label = `${target?.text ?? ''} ${target?.aria ?? ''} ${target?.role ?? ''} ${target?.placeholder ?? ''}`;
    return deleteWords.test(label);
  }
  return false;
}

function isYouTubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch';
  } catch {
    return false;
  }
}

function isGmailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'mail.google.com';
  } catch {
    return false;
  }
}

interface EmailDraft {
  to?: string;
  subject?: string;
  body?: string;
  shouldSend?: boolean;
}

function parseEmailDraft(command: string): EmailDraft | null {
  const email = command.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const subjectMatch = command.match(/\b(?:assunto|subject)\s*[:\-]?\s*([^.;\n]+?)(?=\s+(?:corpo|mensagem|dizendo|falando|com\s+o\s+texto)\b|$)/i);
  const bodyMatch = command.match(/\b(?:corpo|mensagem|dizendo|falando|com\s+o\s+texto|texto)\s*[:\-]?\s*(.+)$/i);
  const quoted = command.match(/["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/);
  const body = bodyMatch?.[1]?.trim() || quoted?.[1]?.trim();
  if (!email && !body && !subjectMatch?.[1]) return null;
  return {
    to: email,
    subject: subjectMatch?.[1]?.trim(),
    body,
    shouldSend: /mandar|enviar|send/i.test(command),
  };
}

// Consulta o Gemini (gemini.google.com/app) SEM LOGIN: carrega, digita, envia, espera a
// resposta estabilizar e extrai. Se aparecer CAPTCHA/login, NÃO resolve — retorna reason:'captcha'
// (o robô não resolve anti-bot; quem resolve é o humano). É um fallback gratuito que degrada
// com elegância — pra pergunta avulsa, não pra dirigir o agente inteiro.
async function askWebGemini(wv: Electron.WebviewTag, question: string): Promise<{ success: boolean; answer?: string; error?: string; reason?: string }> {
  try {
    try { await wv.loadURL('https://gemini.google.com/app'); } catch {}
    await waitForSettle(wv, { maxMs: 9000, minMs: 3000 });
    const res = await raceTimeout<any>(wv.executeJavaScript(`(async function(q){
      const sleep = ms => new Promise(r=>setTimeout(r,ms));
      const blocked = () => location.host.indexOf('accounts.google')>=0 || /captcha|n[aã]o sou um rob[oô]|verify you are human|unusual traffic|tr[aá]fego incomum/i.test((document.body&&document.body.innerText||'').slice(0,3000));
      if (blocked()) return { ok:false, blocked:true };
      // 1) achar o campo (textarea OU contenteditable/role=textbox)
      let el=null, t=Date.now();
      while(Date.now()-t<15000){ el=document.querySelector('textarea, [contenteditable="true"], [role="textbox"]'); if(el && el.offsetParent!==null) break; await sleep(400); }
      if(!el) return { ok:false, error:'campo do Gemini não apareceu' };
      el.focus();
      try {
        if(el.tagName==='TEXTAREA'){ const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(el,q); el.dispatchEvent(new Event('input',{bubbles:true})); }
        else { document.execCommand('insertText',false,q); el.dispatchEvent(new InputEvent('input',{bubbles:true,data:q,inputType:'insertText'})); }
      } catch(e){ return { ok:false, error:'falha ao digitar' }; }
      await sleep(500);
      // 2) enviar (botão Enviar/Send; senão Enter)
      const btn=[...document.querySelectorAll('button,[role=button]')].find(b=>{ const a=((b.getAttribute('aria-label')||'')+' '+(b.innerText||'')).toLowerCase(); return /enviar|send|submit/.test(a) && !b.disabled && b.offsetParent!==null; });
      if(btn){ btn.click(); } else { ['keydown','keypress','keyup'].forEach(tp=>el.dispatchEvent(new KeyboardEvent(tp,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}))); }
      // 3) extrair: texto após o último "o gemini disse"/"gemini said", esperando estabilizar
      const extract=()=>{ const body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' '); const low=body.toLowerCase(); let i=low.lastIndexOf('o gemini disse'); let mk='o gemini disse'; const ie=low.lastIndexOf('gemini said'); if(ie>i){i=ie;mk='gemini said';} if(i<0) return ''; let a=body.slice(i+mk.length).trim(); a=a.split(/o gemini (é|e) uma ia|gemini can make mistakes|enviar feedback|mostrar rascunhos|new flash|verifique as informa/i)[0].trim(); return a; };
      let ans='', stable=0;
      for(let k=0;k<24;k++){ await sleep(1000); if(blocked()) return {ok:false,blocked:true}; const a=extract(); if(a && a===ans){ stable++; if(stable>=3) break; } else { ans=a; stable=0; } }
      return { ok: ans.length>0, answer: ans.slice(0,4000), error: ans.length?undefined:'sem resposta' };
    })(${JSON.stringify(question)})`), 90000, { ok: false, error: 'tempo esgotado consultando o Gemini' });
    if (res?.blocked) return { success: false, reason: 'captcha', error: 'Gemini pediu verificação/login.' };
    if (res?.ok) return { success: true, answer: res.answer };
    return { success: false, error: res?.error || 'sem resposta' };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
}

async function tryComposeGmailDraft(wv: Electron.WebviewTag, draft: EmailDraft): Promise<{ success: boolean; sent?: boolean; reason?: string }> {
  try {
    return await raceTimeout(wv.executeJavaScript(`
      (async function(draft){
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const label = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || '').replace(/\\s+/g,' ').trim();
        const click = (el) => {
          if (!el) return false;
          el.scrollIntoView({ block:'center', inline:'center' });
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
          }
          if (typeof el.click === 'function') el.click();
          return true;
        };
        const typeInto = (el, value) => {
          if (!el || !value) return false;
          el.focus();
          if ('value' in el) {
            const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
            if (setter) setter.call(el, value); else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles:true }));
            el.dispatchEvent(new Event('change', { bubbles:true }));
          } else {
            document.execCommand('selectAll', false);
            document.execCommand('insertText', false, value);
            el.dispatchEvent(new InputEvent('input', { bubbles:true, data:value, inputType:'insertText' }));
          }
          return true;
        };
        const key = (target, keyName) => {
          target.dispatchEvent(new KeyboardEvent('keydown', { key:keyName, code:keyName, bubbles:true, cancelable:true }));
          target.dispatchEvent(new KeyboardEvent('keyup', { key:keyName, code:keyName, bubbles:true, cancelable:true }));
        };

        const state = { to:false, subject:false, body:false, sent:false };
        let compose = Array.from(document.querySelectorAll('[role="button"], div, button'))
          .filter(visible)
          .find(el => /^(compose|escrever|redigir)$/i.test(label(el)) || /compose|escrever|redigir/i.test(label(el)));
        if (compose) {
          click(compose);
          for (let i = 0; i < 12; i++) {
            await sleep(250);
            const dialog = Array.from(document.querySelectorAll('[role="dialog"], .M9, .AD, .nH.Hd')).find(visible);
            if (dialog) break;
          }
        }

        const composeDialog = () => Array.from(document.querySelectorAll('[role="dialog"], .M9, .AD, .nH.Hd'))
          .filter(visible)
          .sort((a,b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (br.right + br.bottom) - (ar.right + ar.bottom);
          })[0] || document;
        const rootOf = () => composeDialog();
        const inputs = () => Array.from(rootOf().querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')).filter(visible);
        let all = inputs();

        if (draft.to) {
          const to = all.find(el => /^(to|para|destinat[aá]rios?|recipients?)$/i.test(label(el)))
            || all.find(el => /to|para|destinat|recipient/i.test(label(el)))
            || rootOf().querySelector('textarea[name="to"], input[name="to"]')
            || rootOf().querySelector('input[aria-label*="Destinat" i], textarea[aria-label*="Destinat" i], input[aria-label*="To" i], textarea[aria-label*="To" i]');
          if (to) {
            click(to);
            await sleep(150);
            typeInto(to, draft.to);
            state.to = true;
            await sleep(350);
            key(document.activeElement || to, 'Enter');
            await sleep(250);
            key(document.activeElement || to, 'Tab');
            await sleep(250);
          }
        }

        all = inputs();
        if (draft.subject) {
          const subject = rootOf().querySelector('input[name="subjectbox"]')
            || rootOf().querySelector('input[aria-label*="Assunto" i], input[aria-label*="Subject" i]')
            || all.find(el => /subject|assunto/i.test(label(el)));
          if (subject) {
            click(subject);
            await sleep(150);
            state.subject = typeInto(subject, draft.subject);
            await sleep(250);
          }
        }

        all = inputs();
        if (draft.body) {
          const body = rootOf().querySelector('div[aria-label="Corpo da mensagem"], div[aria-label="Message Body"], .Am.Al.editable[contenteditable="true"]')
            || Array.from(rootOf().querySelectorAll('[aria-label*="Message Body" i], [aria-label*="corpo" i], [contenteditable="true"][role="textbox"], div[aria-label][contenteditable="true"], div[contenteditable="true"]'))
            .filter(visible)
            .find(el => !/to|para|assunto|subject|destinat/i.test(label(el)));
          if (body) {
            click(body);
            await sleep(150);
            state.body = typeInto(body, draft.body);
          }
        }

        if (draft.shouldSend && state.to && state.body) {
          await sleep(500);
          const send = Array.from(rootOf().querySelectorAll('[role="button"], div, button'))
            .filter(visible)
            .find(el => /^(enviar|send)$/i.test(label(el)) || /enviar|send/i.test(label(el)));
          if (send) {
            click(send);
            state.sent = true;
            await sleep(1000);
          }
        }

        const requiredOk = (!draft.to || state.to) && (!draft.subject || state.subject) && (!draft.body || state.body);
        return { success: requiredOk && (state.to || state.subject || state.body), sent: state.sent, reason: JSON.stringify(state) };
      })(${JSON.stringify(draft)})
    `), 20000, { success: false, reason: 'gmail compose helper timed out (page unresponsive)' });
  } catch (e: any) {
    return { success: false, reason: String(e?.message ?? e) };
  }
}

function pickYouTubeCommentText(command: string): string {
  const quoted = command.match(/["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/);
  if (quoted?.[1]) return quoted[1].trim().slice(0, 240);

  const natural = command.match(/\b(?:coment(?:a|e|ar|ando)|comment|escrev(?:a|e|er)|diz(?:endo|er)?|fal(?:a|e|ar))\s+(?:que\s+)?(.{2,})$/i);
  if (natural?.[1]) {
    const cleaned = natural[1]
      .replace(/\b(?:no|na|em|num|uma|um)\s+(?:youtube|v[ií]deo|video|clipe)\b/ig, ' ')
      .replace(/\b(?:em\s+ingl[eê]s|in\s+english|em\s+portugu[eê]s)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 2 && !/^(coment[aá]rio|comment)$/i.test(cleaned)) return cleaned.slice(0, 240);
  }

  if (/2pac|tupac/i.test(command) && /ingles|inglês|english/i.test(command)) return 'Legendary song. Tupac forever!';
  if (/ingles|inglês|english/i.test(command)) return 'Great song!';
  return 'Muito bom!';
}

function makeYouTubeCommentKey(url: string, text: string): string {
  try {
    const u = new URL(url);
    const videoId = u.searchParams.get('v') || url;
    return `${videoId}|${text.trim().toLowerCase()}`;
  } catch {
    return `${url}|${text.trim().toLowerCase()}`;
  }
}

async function tryRevealYouTubeCommentBox(wv: Electron.WebviewTag): Promise<{ success: boolean; reason?: string }> {
  try {
    return await raceTimeout(wv.executeJavaScript(`
      (async function(){
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const click = (el) => {
          if (!el) return false;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
          }
          if (typeof el.click === 'function') el.click();
          return true;
        };

        const comments = document.querySelector('ytd-comments, #comments');
        if (comments) {
          comments.scrollIntoView({ block: 'start' });
          await sleep(900);
        } else {
          window.scrollBy({ top: Math.max(900, innerHeight * 0.9), behavior: 'smooth' });
          await sleep(900);
        }

        const selectors = [
          'ytd-comment-simplebox-renderer #placeholder-area',
          '#simplebox-placeholder',
          '#placeholder-area',
          'ytd-comment-simplebox-renderer [contenteditable="true"]',
          '#contenteditable-root[contenteditable="true"]',
          '[aria-label*="comment" i]',
          '[aria-label*="coment" i]',
          '[placeholder*="comment" i]',
          '[placeholder*="coment" i]'
        ];

        for (const selector of selectors) {
          const el = Array.from(document.querySelectorAll(selector)).find(visible);
          if (el && click(el)) return { success: true, reason: selector };
        }

        const textTargets = Array.from(document.querySelectorAll('div,span,yt-formatted-string'))
          .filter(visible)
          .filter(el => /add a comment|adicionar comentario|adicionar comentário|comente aqui|comment/i.test((el.innerText || el.textContent || '').trim()))
          .slice(0, 5);
        for (const el of textTargets) {
          if (click(el)) return { success: true, reason: 'text:' + (el.innerText || el.textContent || '').slice(0, 80) };
        }

        return { success: false, reason: 'comment box not found' };
      })()
    `), 15000, { success: false, reason: 'youtube reveal helper timed out (page unresponsive)' });
  } catch (e: any) {
    return { success: false, reason: String(e?.message ?? e) };
  }
}

async function tryFillAndSubmitYouTubeComment(wv: Electron.WebviewTag, text: string): Promise<{ success: boolean; reason?: string }> {
  try {
    return await raceTimeout(wv.executeJavaScript(`
      (async function(commentText){
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const click = (el) => {
          if (!el) return false;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
          }
          if (typeof el.click === 'function') el.click();
          return true;
        };
        const setText = (el) => {
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('insertText', false, commentText);
          el.dispatchEvent(new InputEvent('input', { bubbles:true, data: commentText, inputType:'insertText' }));
        };
        const alreadyVisible = Array.from(document.querySelectorAll('ytd-comment-thread-renderer #content-text, #content-text'))
          .some(el => ((el.innerText || el.textContent || '').trim().toLowerCase() === String(commentText).trim().toLowerCase()));
        if (alreadyVisible) return { success:true, reason:'comment already visible' };

        let editor = document.querySelector('ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]')
          || document.querySelector('#contenteditable-root[contenteditable="true"]')
          || document.querySelector('ytd-comment-simplebox-renderer [contenteditable="true"]');

        if (!editor || !visible(editor)) {
          const placeholder = document.querySelector('ytd-comment-simplebox-renderer #placeholder-area, #simplebox-placeholder, #placeholder-area');
          if (placeholder) {
            click(placeholder);
            await sleep(700);
          }
          editor = document.querySelector('ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]')
            || document.querySelector('#contenteditable-root[contenteditable="true"]')
            || document.querySelector('ytd-comment-simplebox-renderer [contenteditable="true"]');
        }

        if (!editor || !visible(editor)) return { success:false, reason:'editor not found' };
        setText(editor);
        await sleep(900);

        const buttons = Array.from(document.querySelectorAll('ytd-button-renderer, button, [role="button"]'))
          .filter(visible)
          .map(el => ({ el, label: (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim() }))
          .filter(x => /^(comentar|comment|post|enviar)$/i.test(x.label) || /comentar|comment|post|enviar/i.test(x.label));
        const submit = buttons.find(x => !/cancelar|cancel/i.test(x.label))?.el;
        if (!submit) return { success:false, reason:'submit button not found' };
        click(submit);
        await sleep(800);
        return { success:true, reason:'submitted' };
      })(${JSON.stringify(text)})
    `), 15000, { success: false, reason: 'youtube comment helper timed out (page unresponsive)' });
  } catch (e: any) {
    return { success: false, reason: String(e?.message ?? e) };
  }
}
