import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  insertAfter, moveTab as moveInStrip, nextActiveAfterClose, setPinned as pinInStrip,
} from '../shared/tab-strip';
import { bootPlan, sessionTitle } from '../shared/session-restore';
import { getStartupMode, loadSavedSession, noteSession, watchSessionClose } from './session';
import { newTabUrl } from './search-engine';
import type { VisionMode } from '../shared/vision';
import { incognitoCount, lastIncognitoClosed, mayRecord } from '../shared/incognito';
import { wipeIncognitoSession } from './incognito';

export interface Tab {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  hidden?: boolean;   // work tab (Quick Search): loads but is hidden from the tab bar
  startup?: boolean;  // the tab created at boot — only it shows the panel's welcome
  discarded?: boolean;    // Memory Saver: webview unmounted (RAM freed); reloads on activation
  lastActiveAt?: number;  // when the tab was last the active one (drives the discard sweep)
  audible?: boolean;      // sound is coming out of this tab (drives the speaker icon, Chrome-style)
  pinned?: boolean;       // aba fixada: só o ícone, sempre à esquerda; volta sozinha ao reabrir o Bah
  restored?: boolean;     // voltou da última sessão (Continuar de onde parou) e ainda não carregou: sem webview
                          // como a dormindo, mas com ícone e nome normais (nada de 💤); carrega no clique
  incognito?: boolean;    // aba anônima: sessão só na memória, nada dela fica guardado (shared/incognito.ts).
                          // Nasce assim e nunca muda (a partição da <webview> não troca depois de criada).
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AISettings {
  provider: 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'nvidia' | 'ollama';
  apiKey: string;
  baseUrl: string;
  model?: string;                      // cloud model override (e.g. pick an NVIDIA model); empty = provider default
  apiKeys?: Record<string, string>;   // key PER provider — trocar de provedor não perde a chave dos outros
}

export type LocalProvider = 'ollama' | 'openai-compatible';

// Modo IA Local aceita DOIS backends: o Ollama nativo (/api/tags) e qualquer servidor
// OpenAI-compatible (llama.cpp, LM Studio, vLLM) via /v1/models. O provedor decide qual
// endpoint de descoberta/modelo a UI e o main usam.
export interface LocalSettings {
  enabled: boolean;          // hybrid routing on/off
  provider: LocalProvider;   // ollama nativo OU OpenAI-compatible (llama.cpp/LM Studio/vLLM)
  baseUrl: string;           // e.g. http://localhost:11434 (ollama) ou :8080 (llama.cpp)
  model: string;             // modelo selecionado (ex.: qwen3:8b ou unsloth/Qwen3.6-35B-A3B-GGUF:NOTHINK)
  authKey?: string;          // chave OPCIONAL p/ servidores compatíveis que exigem auth (≠ roteamento local)
  warmup?: boolean;          // pré-aquecer o modelo selecionado (opt-in; llama.cpp gerencia a VRAM)
  // ── Per-endpoint tuning (all optional; empty = current behaviour) ──
  contextMode?: 'auto' | 'custom';  // 'auto' detects the real window from the server
  contextTokens?: number;           // custom window, when contextMode === 'custom'
  maxOutputTokens?: number;         // reply budget, reasoning tokens included
  ollamaNumCtx?: 'auto' | number;   // Ollama server-side allocation; empty = 16384
  vision?: boolean;                 // legacy opt-in (true = 'auto'); old profiles keep working
  visionMode?: VisionMode;        // off | auto | always — screenshots to the model
}

// Encadeia as gravações do aiSettings no disco: garante ordem (o último Salvar é a
// última escrita) e dá uma promise pra quem precisar aguardar a persistência real.
let aiWriteChain: Promise<void> = Promise.resolve();
let localWriteChain: Promise<void> = Promise.resolve();

// Nova aba = página inicial do mecanismo de pesquisa escolhido (⋮ → Mecanismo de pesquisa),
// no idioma da interface. Padrão: Google (pt-BR ainda abre o Google Brasil). Aba anônima sem
// endereço nasce em branco: a tela mostra a explicação dela (IncognitoPage), a barra fica vazia.
export function createTab(url?: string, incognito = false): Tab {
  const tab: Tab = {
    id: uuidv4(),
    title: 'New Tab',
    url: url ?? (incognito ? '' : newTabUrl()),
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    lastActiveAt: Date.now(),
  };
  if (incognito) tab.incognito = true;
  return tab;
}

// Abas do boot (⋮ → Ao abrir o Bah). "Continuar de onde parou" com sessão salva: as abas da
// última vez, na mesma ordem (fixadas primeiro); só a que estava ativa carrega, as outras esperam
// o clique (descartadas, como as do Memory Saver). Senão, o de sempre: as fixadas da última vez
// (igual ao Chrome) + a aba inicial, que é a ativa. Regras em shared/session-restore.ts.
function bootTabs(): Tab[] {
  const plan = bootPlan(getStartupMode(), loadSavedSession());
  const tabs = plan.tabs.map((s): Tab => ({
    ...createTab(s.url),
    title: sessionTitle(s) || 'New Tab',
    ...(s.pinned ? { pinned: true } : {}),
    ...(s.active ? { startup: true } : {}),
    ...(s.lazy ? { discarded: true, restored: true } : {}),
  }));
  if (plan.newTab) { const t = createTab(); t.startup = true; tabs.push(t); }
  return tabs;
}

export function useTabStore() {
  // No boot: a última sessão ou as fixadas + a aba inicial de sempre (bootTabs). A ativa é a
  // marcada como inicial (a que estava ativa / a aba nova) — só ela mostra as boas-vindas do painel.
  const [tabs, setTabs] = useState<Tab[]>(bootTabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => (tabs.find(t => t.startup) ?? tabs[tabs.length - 1]).id);
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
        // Pollinations de texto deixou de existir (2026-07-26): o keyless não aguenta o
        // navegador de verdade e o grátis-com-chave testado não é confiável o bastante pra
        // ficar embutido. Quem tinha isso salvo (de qualquer versão anterior) migra pra
        // DeepSeek — sem chave, precisa configurar (não há mais fallback automático).
        if (s && (s.provider as string) === 'pollinations') {
          s.provider = 'deepseek';
          s.apiKey = (s.apiKeys && s.apiKeys.deepseek) || '';
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
      if (saved) {
        const s = JSON.parse(saved);
        // Saves antigos só tinham provider:'ollama'; qualquer valor desconhecido volta pro default.
        if (s.provider !== 'ollama' && s.provider !== 'openai-compatible') s.provider = 'ollama';
        const _dec = (window as any).electronAPI?.decryptSecretSync;
        if (_dec && typeof s.authKey === 'string') s.authKey = _dec(s.authKey);
        return s;
      }
    } catch {}
    return { enabled: false, provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' };
  });

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  // A ativa também num ref, atualizado JUNTO com o estado: o closeTabs decide quem assume lendo
  // daqui — duas ações no mesmo instante (abrir e fechar, fechar duas) não usam a ativa velha.
  const activeIdRef = useRef(activeTabId);
  activeIdRef.current = activeTabId;
  const setActive = useCallback((id: string) => { activeIdRef.current = id; setActiveTabId(id); }, []);

  // Ativar uma aba também a "acorda" (Memory Saver, ou a que voltou da última sessão) e carimba o
  // relógio de inatividade: a que ENTRA zera o descarte; a que SAI ganha lastActiveAt=agora.
  const activateTab = useCallback((id: string) => {
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, discarded: false, restored: false, lastActiveAt: Date.now() }
      : t.id === activeTabId ? { ...t, lastActiveAt: Date.now() }
      : t));
    setActive(id);
  }, [activeTabId, setActive]);

  // Pilha de URLs de abas fechadas → reabrir com Ctrl+Shift+T (estilo Chrome).
  const closedTabsRef = useRef<string[]>([]);

  // incognito = nasce aba anônima (quem decide é o chamador: shared/incognito.ts → opensIncognito).
  const addTab = useCallback((url?: string, incognito = false): string => {
    const tab = createTab(url, incognito);
    setTabs(prev => [...prev, tab]);
    setActive(tab.id);
    return tab.id;
  }, [setActive]);

  // Aba de RESULTADO (tabela de preço/notícia, render_view) — aparece na barra de abas,
  // clicável, mas NÃO rouba o foco. Sem isso, a aba nova virava a ativa e o painel da IA
  // (que mostra o feed DA ABA ATIVA) ficava em branco — a resposta ficava presa na aba
  // de origem da conversa, fora de vista, parecendo que a tarefa "sumiu" mesmo tendo dado
  // certo. Diferente do addHiddenTab (Pesquisa Rápida): aqui a aba é visível de propósito,
  // só não some com o foco de quem estava conversando.
  const addBackgroundTab = useCallback((url?: string, incognito = false): string => {
    const tab = createTab(url, incognito);
    setTabs(prev => [...prev, tab]);
    return tab.id;
  }, []);

  // HIDDEN tab (Quick Search): mounts the webview and loads the URL, but does NOT become
  // the active tab nor appear in the tab bar — the search runs "behind the scenes". It's
  // removed with closeTab when done. The TabBar ignores tabs with hidden=true.
  const addHiddenTab = useCallback((url?: string, incognito = false): string => {
    const tab = { ...createTab(url, incognito), hidden: true };
    setTabs(prev => [...prev, tab]);
    return tab.id;
  }, []);

  // Fecha uma ou várias abas (×, Ctrl+W, botão do meio, "Fechar outras abas", "Fechar abas à
  // direita"). Cada endereço vai pra pilha do Ctrl+Shift+T, na ordem da barra. Se a ativa saiu,
  // assume a vizinha que sobrou NA BARRA (direita, senão esquerda) — nunca uma aba escondida do
  // agente (antes, fechar a última visível com uma Pesquisa Rápida rodando ativava a escondida);
  // sem nenhuma visível, abre uma nova. A ativa vem de um ref: quem guardou o closeTab de um
  // render antigo (ouvinte de IPC registrado uma vez) não decide com a ativa velha.
  const closeTabs = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const closing = new Set(ids);
    for (const id of closing) window.electronAPI?.clearChatHistory?.(id);   // free that tab's chat memory
    setTabs(prev => {
      const next = prev.filter(t => !closing.has(t.id));
      if (next.length === prev.length) return prev;
      for (const t of prev) {
        if (!closing.has(t.id) || t.hidden || !t.url || !/^https?:\/\//i.test(t.url)) continue;
        if (!mayRecord('closedTabs', t.incognito)) continue;   // aba anônima fechada não volta no Ctrl+Shift+T
        closedTabsRef.current.push(t.url);
        if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      }
      const cur = activeIdRef.current;
      let newActive = nextActiveAfterClose(prev, closing, cur);
      if (newActive === null) {
        const newTab = createTab();
        next.push(newTab);
        newActive = newTab.id;
      } else {
        // A vizinha que assume pode estar DORMINDO (Memory Saver) → acorda ela junto,
        // senão viraria aba ativa sem webview montado (tela em branco).
        const pos = next.findIndex(t => t.id === newActive);
        if (pos >= 0 && next[pos].discarded) next[pos] = { ...next[pos], discarded: false, restored: false, lastActiveAt: Date.now() };
      }
      if (newActive !== cur) setActive(newActive);
      return next;
    });
  }, [setActive]);
  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs]);

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // Reopen the last closed tab (Ctrl+Shift+T).
  const reopenClosedTab = useCallback(() => {
    const url = closedTabsRef.current.pop();
    if (url) addTab(url);
  }, [addTab]);

  // Limpar histórico (Limpar dados de navegação): o Ctrl+Shift+T não pode trazer de volta
  // um endereço que acabou de sair do histórico.
  const forgetClosedTabs = useCallback((drop: (url: string) => boolean) => {
    closedTabsRef.current = closedTabsRef.current.filter(u => !drop(u));
  }, []);
  // Tem aba pra reabrir? (o item "Reabrir aba fechada" do menu da aba fica apagado sem nenhuma)
  const hasClosedTabs = useCallback(() => closedTabsRef.current.length > 0, []);

  // ── Barra de abas estilo Chrome (arrastar, menu do botão direito, fixar) ──
  // A conta (ordem, fronteira das fixadas, onde nasce a aba nova) mora em shared/tab-strip.ts.
  // Só a ORDEM da lista muda: os <webview> ficam na ordem de chegada (WebViewContainer), então
  // mover uma aba nunca recarrega a página dela.
  const moveTab = useCallback((id: string, to: number) => {
    setTabs(prev => moveInStrip(prev, id, to));
  }, []);
  const setPinned = useCallback((id: string, pinned: boolean) => {
    setTabs(prev => pinInStrip(prev, id, pinned));
  }, []);
  // "Nova aba à direita": nasce logo depois da clicada (nunca no meio das fixadas) e vira a ativa.
  const addTabAfter = useCallback((anchorId: string, url?: string, extra?: Partial<Tab>): string => {
    const tab: Tab = { ...createTab(url, !!extra?.incognito), ...extra };
    setTabs(prev => insertAfter(prev, anchorId, tab));
    setActive(tab.id);
    return tab.id;
  }, [setActive]);
  // "Duplicar": o mesmo endereço numa aba nova logo depois (fixada, se a original é). O Chrome
  // copia também o histórico de voltar/avançar; aqui a cópia carrega o endereço do zero. A cópia
  // de uma aba anônima continua anônima (mesma sessão: segue logada no que a original estava).
  const duplicateTab = useCallback((id: string): string | null => {
    const src = tabs.find(t => t.id === id && !t.hidden);
    if (!src) return null;
    return addTabAfter(id, src.url, { title: src.title, pinned: src.pinned, ...(src.incognito ? { incognito: true } : {}) });
  }, [tabs, addTabAfter]);

  // Continuar de onde parou: a sessão (abas da barra + a ativa) é gravada SEMPRE, com a opção
  // ligada ou não — ligar depois já traz a última. As fixadas moram nela (não há outra lista).
  // No máximo 1 s depois de cada mudança e na hora ao fechar a janela (renderer/session.ts).
  useEffect(() => { noteSession(tabs, activeTabId); }, [tabs, activeTabId]);
  useEffect(() => watchSessionClose(), []);

  // A última aba anônima fechou (as escondidas, de trabalho da IA, contam) → o main zera a sessão
  // anônima. A próxima aba anônima espera a limpeza (renderer/incognito.ts → incognitoReady).
  const incognitoRef = useRef(0);
  useEffect(() => {
    const n = incognitoCount(tabs);
    if (lastIncognitoClosed(incognitoRef.current, n)) wipeIncognitoSession();
    incognitoRef.current = n;
  }, [tabs]);

  return {
    tabs, activeTabId, activeTab, sidebarOpen,
    aiSettings, localSettings,
    setActiveTabId: activateTab, addTab, addBackgroundTab, addHiddenTab, closeTab, updateTab, reopenClosedTab, forgetClosedTabs,
    closeTabs, hasClosedTabs, moveTab, setPinned, addTabAfter, duplicateTab,
    setSidebarOpen,
    setAISettings: (s: AISettings) => {
      setAISettings(s);   // memória = texto puro (UI/agente intactos)
      // No disco vai CIFRADO (cofre do SO). SERIALIZADO num encadeamento (writeChain) e
      // com a promise DEVOLVIDA: dois Salvar rápidos não terminam fora de ordem (o velho
      // gravando por último), e quem aguardar (botão Salvar) garante o disco atualizado
      // antes de, por exemplo, a pessoa fechar o app. Se falhar, grava texto puro.
      const write = async () => {
        try {
          const _enc = (window as any).electronAPI?.encryptSecret;
          const copy: AISettings = { ...s };
          if (_enc) {
            if (s.apiKey) copy.apiKey = await _enc(s.apiKey);
            if (s.apiKeys) { copy.apiKeys = {}; for (const _k of Object.keys(s.apiKeys)) copy.apiKeys[_k] = s.apiKeys[_k] ? await _enc(s.apiKeys[_k]) : s.apiKeys[_k]; }
          }
          localStorage.setItem('aiSettings', JSON.stringify(copy));
        } catch { try { localStorage.setItem('aiSettings', JSON.stringify(s)); } catch {} }
      };
      aiWriteChain = aiWriteChain.then(write, write);
      return aiWriteChain;
    },
    setLocalSettings: (s: LocalSettings) => {
      setLocalSettingsState(s);
      // authKey segue o mesmo cofre das chaves de nuvem (encryptSecret → 'enc:…' no disco).
      const write = async () => {
        try {
          const _enc = (window as any).electronAPI?.encryptSecret;
          const copy: LocalSettings = { ...s };
          if (_enc && s.authKey) copy.authKey = await _enc(s.authKey);
          localStorage.setItem('localSettings', JSON.stringify(copy));
        } catch { try { localStorage.setItem('localSettings', JSON.stringify(s)); } catch {} }
      };
      localWriteChain = localWriteChain.then(write, write);
      return localWriteChain;
    },
  };
}
