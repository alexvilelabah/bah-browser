import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { detectLang } from './i18n';

export interface Tab {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  hidden?: boolean;   // work tab (Quick Search): loads but is hidden from the tab bar
  startup?: boolean;  // the tab created at boot — only it shows the panel's welcome
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AISettings {
  provider: 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'nvidia' | 'pollinations' | 'ollama';
  apiKey: string;
  baseUrl: string;
  model?: string;                      // cloud model override (e.g. pick an NVIDIA model); empty = provider default
  apiKeys?: Record<string, string>;   // key PER provider — the DeepSeek one never leaks into the Pollinations field
  apiPaused?: boolean;                 // chave salva, mas "pausada" → roda a IA grátis (Pollinations) sem perder a chave
}

export interface LocalSettings {
  enabled: boolean;          // hybrid routing on/off
  provider: 'ollama';        // only ollama for now
  baseUrl: string;           // e.g. http://localhost:11434
  model: string;             // e.g. qwen3-vl:8b
}

// Home page = Google in the user's language (don't force Brazil on everyone).
// An English OS opens Google in English; pt-BR still gets Google Brazil.
function googleHome(): string {
  const lang = detectLang();
  if (lang === 'pt') return 'https://www.google.com.br/webhp?hl=pt-BR&gl=BR&pws=0&gws_rd=cr';
  if (lang === 'es') return 'https://www.google.com/webhp?hl=es&pws=0';
  return 'https://www.google.com/webhp?hl=en&pws=0';
}

export function createTab(url = googleHome()): Tab {
  return {
    id: uuidv4(),
    title: 'New Tab',
    url,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  };
}

export function useTabStore() {
  const [tabs, setTabs] = useState<Tab[]>(() => { const t = createTab(); t.startup = true; return [t]; });
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiSettings, setAISettings] = useState<AISettings>(() => {
    try {
      const saved = localStorage.getItem('aiSettings');
      if (saved) {
        const s = JSON.parse(saved);
        // Decifra a chave (cofre do SO) de volta pra texto puro NA MEMÓRIA. Chave legada em
        // texto puro passa intacta (decryptSecretSync só decifra o que começa com 'enc:').
        const _dec = (window as any).electronAPI?.decryptSecretSync;
        if (_dec && s) {
          if (typeof s.apiKey === 'string') s.apiKey = _dec(s.apiKey);
          if (s.apiKeys) for (const _k of Object.keys(s.apiKeys)) s.apiKeys[_k] = _dec(s.apiKeys[_k]);
        }
        // Pollinations is no longer a SELECTABLE provider (just the keyless fallback +
        // image generator). Anyone who had it saved migrates to DeepSeek; with no key the
        // engine falls back to Pollinations on its own — same behavior, consistent UI.
        if (s && s.provider === 'pollinations') {
          s.provider = 'deepseek';
          s.apiKey = (s.apiKeys && s.apiKeys.deepseek) || '';   // nao mandar a chave do Pollinations pro DeepSeek; sem chave cai no Pollinations
          s.baseUrl = '';
        }
        return s;
      }
    } catch {}
    return { provider: 'deepseek', apiKey: '', baseUrl: '' };
  });

  const [localSettings, setLocalSettingsState] = useState<LocalSettings>(() => {
    try {
      const saved = localStorage.getItem('localSettings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' };
  });

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  // Pilha de URLs de abas fechadas → reabrir com Ctrl+Shift+T (estilo Chrome).
  const closedTabsRef = useRef<string[]>([]);

  const addTab = useCallback((url?: string): string => {
    const tab = createTab(url);
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }, []);

  // HIDDEN tab (Quick Search): mounts the webview and loads the URL, but does NOT become
  // the active tab nor appear in the tab bar — the search runs "behind the scenes". It's
  // removed with closeTab when done. The TabBar ignores tabs with hidden=true.
  const addHiddenTab = useCallback((url?: string): string => {
    const tab = { ...createTab(url), hidden: true };
    setTabs(prev => [...prev, tab]);
    return tab.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    window.electronAPI?.clearChatHistory?.(id);   // free that tab's chat memory
    setTabs(prev => {
      const closing = prev.find(t => t.id === id);
      if (closing && !closing.hidden && closing.url && /^https?:\/\//i.test(closing.url)) {
        closedTabsRef.current.push(closing.url);
        if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      }
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const newTab = createTab();
        setActiveTabId(newTab.id);
        return [newTab];
      }
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
  }, [activeTabId]);

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // Reopen the last closed tab (Ctrl+Shift+T).
  const reopenClosedTab = useCallback(() => {
    const url = closedTabsRef.current.pop();
    if (url) addTab(url);
  }, [addTab]);

  return {
    tabs, activeTabId, activeTab, sidebarOpen,
    aiSettings, localSettings,
    setActiveTabId, addTab, addHiddenTab, closeTab, updateTab, reopenClosedTab,
    setSidebarOpen,
    setAISettings: (s: AISettings) => {
      setAISettings(s);   // memória = texto puro (UI/agente intactos)
      // No disco vai CIFRADO (cofre do SO); fire-and-forget. Se falhar, grava texto puro (nunca perde a config).
      (async () => {
        try {
          const _enc = (window as any).electronAPI?.encryptSecret;
          const copy: AISettings = { ...s };
          if (_enc) {
            if (s.apiKey) copy.apiKey = await _enc(s.apiKey);
            if (s.apiKeys) { copy.apiKeys = {}; for (const _k of Object.keys(s.apiKeys)) copy.apiKeys[_k] = s.apiKeys[_k] ? await _enc(s.apiKeys[_k]) : s.apiKeys[_k]; }
          }
          localStorage.setItem('aiSettings', JSON.stringify(copy));
        } catch { try { localStorage.setItem('aiSettings', JSON.stringify(s)); } catch {} }
      })();
    },
    setLocalSettings: (s: LocalSettings) => {
      setLocalSettingsState(s);
      try { localStorage.setItem('localSettings', JSON.stringify(s)); } catch {}
    },
  };
}
