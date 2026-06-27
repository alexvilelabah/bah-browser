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
  hidden?: boolean;   // aba de trabalho (Pesquisa Rápida): carrega mas não aparece na barra
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
  apiKeys?: Record<string, string>;   // chave POR provedor — a do DeepSeek não vaza pro campo do Pollinations
}

export interface LocalSettings {
  enabled: boolean;          // hybrid routing on/off
  provider: 'ollama';        // only ollama for now
  baseUrl: string;           // e.g. http://localhost:11434
  model: string;             // e.g. qwen3-vl:8b
}

// Página inicial = Google no idioma da pessoa (não força o Brasil pra todo mundo).
// Quem tem o PC em inglês abre o Google em inglês; pt-BR continua no Google do Brasil.
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
  const [tabs, setTabs] = useState<Tab[]>([createTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiSettings, setAISettings] = useState<AISettings>(() => {
    try {
      const saved = localStorage.getItem('aiSettings');
      if (saved) {
        const s = JSON.parse(saved);
        // Pollinations deixou de ser provedor SELECIONÁVEL (virou só fallback sem-chave +
        // gerador de imagem). Quem tinha ele salvo migra pra DeepSeek; sem chave, o engine
        // cai no Pollinations sozinho — mesmo comportamento, UI consistente.
        if (s && s.provider === 'pollinations') s.provider = 'deepseek';
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

  // Aba OCULTA (Pesquisa Rápida): monta o webview e carrega a URL, mas NÃO vira a aba
  // ativa nem aparece na barra de abas — a busca roda "por baixo dos panos". É removida
  // com closeTab quando termina. A barra (TabBar) ignora abas com hidden=true.
  const addHiddenTab = useCallback((url?: string): string => {
    const tab = { ...createTab(url), hidden: true };
    setTabs(prev => [...prev, tab]);
    return tab.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    window.electronAPI?.clearChatHistory?.(id);   // libera a memória de chat daquela aba
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

  // Reabre a última aba fechada (Ctrl+Shift+T).
  const reopenClosedTab = useCallback(() => {
    const url = closedTabsRef.current.pop();
    if (url) addTab(url);
  }, [addTab]);

  const addChatMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setChatMessages(prev => [...prev, { id: uuidv4(), role, content, timestamp: Date.now() }]);
  }, []);

  const clearChat = useCallback(() => setChatMessages([]), []);

  return {
    tabs, activeTabId, activeTab, sidebarOpen,
    chatMessages, aiSettings, localSettings,
    setActiveTabId, addTab, addHiddenTab, closeTab, updateTab, reopenClosedTab,
    setSidebarOpen, addChatMessage, clearChat,
    setAISettings: (s: AISettings) => {
      setAISettings(s);
      try { localStorage.setItem('aiSettings', JSON.stringify(s)); } catch {}
    },
    setLocalSettings: (s: LocalSettings) => {
      setLocalSettingsState(s);
      try { localStorage.setItem('localSettings', JSON.stringify(s)); } catch {}
    },
  };
}
