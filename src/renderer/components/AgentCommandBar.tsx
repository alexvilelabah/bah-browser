import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, getLang, setLang, LANGS, Lang } from '../i18n';
import { BrowserAction, formatAction } from '../page-executor';
import { AISettings, LocalSettings } from '../store';
import { detectQuickAction, getInitialShortcutAction, commandHasExplicitUrl } from '../site-knowledge';

export interface StepRecord {
  step: number;
  evaluation?: string;          // model's judgement of the PREVIOUS action
  thought?: string;
  actionLabel: string;
  success: boolean;
  resultSummary?: string;
  urlAfter?: string;
  recovery?: { decision: string; reason: string };
  screenshot?: string;          // small thumbnail dataUrl (replay)
  fromQueue?: boolean;          // executed from a batched action queue (no LLM call)
  durationMs?: number;          // wall-clock time of the whole step (slowness made visible)
}

export type AgentProgressEvent =
  | { kind: 'status'; message: string }
  | { kind: 'manual_help'; message: string; instruction: string; onContinue: () => void }
  | { kind: 'confirm'; message: string; label: string; risk: string; onConfirm: () => void; onCancel: () => void }
  | { kind: 'thought'; message: string }
  | { kind: 'action'; action: BrowserAction }
  | { kind: 'result'; action: BrowserAction; result: any }
  | { kind: 'media'; mediaKind: 'image' | 'audio' | 'video'; paths: string[]; dir: string; total: number; label: string }
  | { kind: 'step'; step: StepRecord };

interface ActionResult {
  thought?: string;
  results?: Array<{ action?: BrowserAction; description?: string; result: any }>;
  done?: BrowserAction;
  error?: string;
}

// Unified feed: agent activity + chat, interleaved chronologically (Comet-style).
// Everything here is INTERCEPTED from real events — nothing is AI-generated filler.
type FeedData =
  | { kind: 'task'; text: string }
  | { kind: 'chat-user'; text: string; file?: string }
  | { kind: 'chat-assistant'; text: string; suggestedCommand?: string; sources?: Array<{ title: string; url: string }> }
  | { kind: 'event'; event: AgentProgressEvent }
  | { kind: 'media'; mediaKind: 'image' | 'audio' | 'video'; paths: string[]; dir: string; total: number; label: string }
  | { kind: 'step'; step: StepRecord }
  | { kind: 'report'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'help'; message: string; instruction: string }
  | { kind: 'confirm'; message: string };
type FeedItem = FeedData & { id: number };

const FEED_CAP = 400;

// Sugestões de modelos por HARDWARE — do PC comum ao Mac de memória unificada e
// servidores. Cada um é um nome real do Ollama (`ollama pull <nome>`). Quem tem
// placa/memória maior pega modelos melhores; o usuário clica e baixa.
const MODEL_SUGGESTIONS: Array<{ tier: string; models: string[] }> = [
  { tier: '~16GB', models: ['qwen3:14b', 'gpt-oss:20b', 'gemma3:12b'] },
  { tier: '24–32GB', models: ['qwen3:32b', 'gemma3:27b', 'deepseek-r1:32b'] },
  { tier: '64GB+', models: ['llama3.3:70b', 'deepseek-r1:70b'] },
  { tier: '128GB+ (Mac unificado)', models: ['gpt-oss:120b', 'qwen3:235b'] },
  { tier: '~250GB (servidor/Mac topo)', models: ['llama3.1:405b'] },
];

// "sim/pode/faça/manda/bora…" — confirmação curta a uma proposta de ação do chat.
// Só conta quando há proposta pendente E a mensagem é curta (evita falso positivo).
function isAffirmative(msg: string): boolean {
  const m = msg.trim();
  if (m.length > 28) return false;
  return /^(sim|isso( mesmo)?|isso a[ií]|pode( ser|\s+sim)?|claro|com certeza|fa[cç]a|faz|fazer|vai|vai l[aá]|manda( ver)?|bora|quero( sim)?|por favor|pfv?|ok|okay|beleza|blz|exato|perfeito|aham|uhum|sim por favor|sim pode|s)\s*[.!👍✅]*$/i.test(m);
}

// Verbo de AÇÃO na web (busca/abrir/baixar/comprar/preencher/comparar…). Backup do
// roteador determinístico (detectQuickAction/atalhos). NÃO inclui "resuma/explique/o
// que/qual" — essas são perguntas, respondidas pelo chat com o conteúdo da página.
const ACTION_VERB_RE = /\b(pesquis\w+|busqu\w+|busca\b|procur\w+|abr[ae]\w*|abrir|navegu\w+|naveg\w+|acess\w+|baix\w+|download|salv\w+|clic\w+|compr[ae]\w*|comprar|adicion\w+|preench\w+|envi\w+|enviar|inscrev\w+|curt\w+|post\w+|comparar|compare\b|fa[cç]a\s+(?:uma?\s+)?(?:busca|pesquisa|supercut|download)|search|searching|find|finding|look\s+up|open|opening|go\s+to|navigate|access|save|saving|get|getting|grab|click|clicking|buy|buying|add|fill|send|subscribe|like|publish|download|downloading|watch|watching)\b/i;
function isImperativeAction(msg: string): boolean {
  return ACTION_VERB_RE.test(msg);
}

// Pergunta pura ("o que é X", "qual…?", "como…") → deve ser RESPONDIDA, não executada.
// Impede que um atalho de site (mencionar "google"/"youtube") sequestre a pergunta.
// (O detectQuickAction de preço/etc. tem confiança alta e roda FORA deste filtro.)
function isQuestion(msg: string): boolean {
  const m = msg.trim().toLowerCase();
  if (/\?\s*$/.test(m)) return true;
  return /^(o que|oque|qual|quais|quem|quando|onde|por\s*que|porque|pra que|para que|como|existe|tem como|d[aá]\s+pra|vale a pena|quanto\s+(?:tempo|tem|s[aã]o)|me explica|explica|explique|diga|fala sobre|do que (?:fala|trata)|what|what'?s|which|who|when|where|why|how|is there|can i|could you|should i|tell me|explain|worth it)\b/.test(m);
}

// Pedido INFORMACIONAL / de pesquisa → resposta no painel (web-grounded, estilo Perplexity).
const INFO_RE = /\b(pesquis\w+|busqu\w+|busca\b|procur\w+|me\s+(diga|fala|fale|conta|explica|explique|mostra|mostre)|quero\s+saber|descub\w+|descobrir|o\s+que\b|oque\b|qual\b|quais\b|quanto\w*\b|quem\b|quando\b|onde\b|por\s*que\b|porque\b|melhor(es)?\b|vale\s+a\s+pena|compar\w+|signific\w+|diferen[cç]a|not[ií]cia\w*|ultimas?\b|search\b|find\b|look\s+up|tell\s+me|want\s+to\s+know|find\s+out|what\b|which\b|how\s+(?:much|many|long|to)|who\b|when\b|where\b|why\b|best\b|compare\b|means\b|difference|news\b|latest\b)\b/i;
function isInfoRequest(msg: string): boolean { return INFO_RE.test(msg) || isQuestion(msg); }

// Verbo que OPERA numa página (faz algo, não só lê/pergunta) → agente.
const PAGE_OP_RE = /\b(abr[ae]\w*|abrir|clic\w+|preench\w+|compr[ae]\w*|comprar|carrinho|finaliz\w+|login|logar|logue|entr[ae]\w*\s+(na|no|em|com)|curt\w+|inscrev\w+|seguir|post\w+|publi\w+|coment\w+|envi\w+\s+(email|e-mail|mensagem|coment)|cadastr\w+|reserv\w+|agend\w+|toc[ae]\w*\s+(o|a|um)|assist\w+|click|fill|buy|cart|checkout|log\s?in|sign\s+in|subscribe|follow|publish|comment|send\s+(?:an?\s+)?(?:email|message)|register|book|schedule)\b/i;
function isPageOp(msg: string): boolean { return PAGE_OP_RE.test(msg); }

// Sobre a PÁGINA ATUAL (não a web aberta) → chat com o conteúdo da página.
const CUR_PAGE_RE = /\b(resum\w+|resumir|(?:essa|esta|dessa|desta|da|nessa|nesta)\s+p[aá]gina|(?:essa|esta|a|nessa|nesta|minha)\s+aba|(?:este|esse)\s+(artigo|texto|v[ií]deo|site)|o\s+que\s+(diz|fala|tem)\s+(aqui|a\s+p[aá]gina)|tradu\w+\s+(essa|esta|a)\s+p[aá]gina|summari[sz]e\w*|(?:this|the)\s+(page|tab|article|text|video|site)|what\s+does\s+this\s+(say|page|article)|translate\s+(?:this|the)\s+page)\b/i;
function isAboutCurrentPage(msg: string): boolean { return CUR_PAGE_RE.test(msg); }

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 24); }
}

interface Props {
  onExecute: (command: string, onProgress: (event: AgentProgressEvent) => void, signal?: AbortSignal, opts?: { forceImage?: boolean }) => Promise<ActionResult>;
  onSendChat: (message: string, docText?: string) => Promise<{ reply: string; suggestedCommand?: string }>;
  onResearch: (query: string) => Promise<{ answer: string; sources: Array<{ title: string; url: string }> }>;
  /** Classifica o pedido por IA (com o contexto da aba) → agir/página/web/chat. null = falhou/indisponível (cai no fallback determinístico). */
  onClassify?: (msg: string) => Promise<'action' | 'page' | 'web' | 'chat' | null>;
  onFetchHeadlines?: (query: string) => Promise<string[]>;
  onOpenUrl: (url: string) => void;
  onGoogleLogin?: () => void;
  googleLoggedIn?: boolean;
  isStartupTab?: boolean;   // só a aba inicial mostra as boas-vindas do painel
  onClose: () => void;
  activeTabId: string;
  tabIds: string;   // ids das abas existentes (csv) — descarta conversas de abas fechadas
  aiSettings: AISettings;
  onSettingsChange: (settings: AISettings) => Promise<void>;
  localSettings: LocalSettings;
  onLocalSettingsChange: (settings: LocalSettings) => Promise<void>;
}

export default function AgentCommandBar({ onExecute, onSendChat, onResearch, onClassify, onOpenUrl, onGoogleLogin, googleLoggedIn, isStartupTab, onClose, activeTabId, tabIds, aiSettings, onSettingsChange, localSettings, onLocalSettingsChange }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Caixa unificada: a proposta de ação do último turno de chat (se houver). Um "sim"
  // do usuário, ou o botão "⚡ Fazer isso", executa este comando no agente.
  const pendingSuggestionRef = useRef<string | null>(null);
  // Placeholder "vivo" (estilo Comet): frases de EXEMPLO vão sendo digitadas e apagadas,
  // ensinando o que dá pra pedir. (Uma dica instrucional + 3 exemplos curtos.)
  const [ph, setPh] = useState('');
  useEffect(() => {
    const phrases = [
      t('composer.phLead'),
      t('composer.phEx1'), t('composer.phEx2'), t('composer.phEx3'), t('composer.phEx4'),
      t('composer.phEx5'), t('composer.phEx6'), t('composer.phEx7'),
    ];
    let i = 0, c = 0, deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = phrases[i % phrases.length];
      c += deleting ? -1 : 1;
      setPh(full.slice(0, Math.max(0, c)));
      if (!deleting && c >= full.length) { deleting = true; timer = setTimeout(tick, 1900); return; }   // pausa cheia
      if (deleting && c <= 0) { deleting = false; i++; timer = setTimeout(tick, 380); return; }          // próxima frase
      timer = setTimeout(tick, deleting ? 26 : 50 + Math.random() * 45);
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [getLang()]);
  // Auto-crescer a caixa de texto conforme digita (até um teto), estilo Comet.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);
  const [loading, setLoading] = useState(false);       // agent task running
  const [chatLoading, setChatLoading] = useState(false);
  // Caixinha "modo imagem" (one-shot): marcada, a PRÓXIMA mensagem vira geração de imagem e
  // a caixa desmarca sozinha. Default OFF, NÃO persiste (reabrir nunca volta no modo imagem).
  const [imageMode, setImageMode] = useState(false);
  const [attachedDoc, setAttachedDoc] = useState<{ name: string; text: string } | null>(null);
  // ── Voz: microfone → transcrição LOCAL (Whisper via Transformers.js; sem nuvem/chave) ──
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const voiceWorkerRef = useRef<Worker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Menu "+" do compositor (Anexar / Gerar imagem), estilo Claude. Fecha ao clicar fora.
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!plusMenuOpen) return;
    const onDoc = (e: MouseEvent) => { if (plusWrapRef.current && !plusWrapRef.current.contains(e.target as Node)) setPlusMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [plusMenuOpen]);
  // Chat POR ABA: cada aba tem sua própria conversa. A aba VISTA é a ativa; uma tarefa
  // em andamento escreve na aba onde COMEÇOU (convoTabRef), mesmo se o usuário trocar.
  const [feedsByTab, setFeedsByTab] = useState<Record<string, FeedItem[]>>({});
  const convoTabRef = useRef<string>(activeTabId);
  const feed = useMemo<FeedItem[]>(() => feedsByTab[activeTabId] ?? [], [feedsByTab, activeTabId]);
  // Descarta as conversas de abas que foram fechadas (libera memória; não persiste).
  useEffect(() => {
    const ids = new Set(tabIds.split(',').filter(Boolean));
    setFeedsByTab(prev => {
      let changed = false;
      const next: Record<string, FeedItem[]> = {};
      for (const k of Object.keys(prev)) { if (ids.has(k)) next[k] = prev[k]; else changed = true; }
      return changed ? next : prev;
    });
  }, [tabIds]);
  const [manualHelp, setManualHelp] = useState<{ message: string; instruction: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string } | null>(null);   // freio de segurança
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(aiSettings);
  const [localCfg, setLocalCfg] = useState(localSettings);
  // Gerenciador de modelos Ollama (instalar/baixar/apagar/importar pela UI).
  const [models, setModels] = useState<Array<{ name: string; sizeGB: number; params: string; quant: string }>>([]);
  const [pullName, setPullName] = useState('');
  const [pullMsg, setPullMsg] = useState('');
  const [pulling, setPulling] = useState(false);
  const [ggufPath, setGgufPath] = useState('');
  const [ggufName, setGgufName] = useState('');
  // null = ainda não checado; true = Ollama respondeu; false = não detectado (não instalado/desligado).
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [notInstalled, setNotInstalled] = useState(false);
  const [startMsg, setStartMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const manualContinueRef = useRef<(() => void) | null>(null);
  const confirmActionsRef = useRef<{ onConfirm: () => void; onCancel: () => void } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const idRef = useRef(0);

  const push = (item: FeedData) => {
    const tabId = convoTabRef.current;
    setFeedsByTab(prevMap => {
      const prev = prevMap[tabId] ?? [];
      let next = [...prev, { ...item, id: ++idRef.current }];
      if (next.length > FEED_CAP) next = next.slice(-FEED_CAP);
      // Cap image memory in long recording sessions: keep thumbnails only on the
      // most recent ~40 step cards; older ones drop the heavy dataURL (text stays).
      if (item.kind === 'step') {
        let kept = 0;
        for (let i = next.length - 1; i >= 0; i--) {
          const it = next[i];
          if (it.kind === 'step' && it.step.screenshot) {
            if (kept >= 40) { next[i] = { ...it, step: { ...it.step, screenshot: undefined } }; }
            else kept++;
          }
        }
      }
      return { ...prevMap, [tabId]: next };
    });
  };

  // Stick-to-bottom: auto-scroll on new items only when the user is already near
  // the bottom (so reading history upward isn't hijacked).
  useEffect(() => {
    const el = feedRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [feed, chatLoading]);
  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const runAgent = async (cmd: string, opts?: { forceImage?: boolean }) => {
    convoTabRef.current = activeTabId;   // esta tarefa pertence à aba atual
    const abortController = new AbortController();
    abortRef.current = abortController;
    setLoading(true);
    setManualHelp(null);
    manualContinueRef.current = null;
    stickToBottomRef.current = true;
    push({ kind: 'task', text: cmd });
    try {
      const result = await onExecute(cmd, event => {
        if (event.kind === 'step') {
          push({ kind: 'step', step: event.step });
        } else if (event.kind === 'manual_help') {
          manualContinueRef.current = event.onContinue;
          setManualHelp({ message: event.message, instruction: event.instruction });
          push({ kind: 'help', message: event.message, instruction: event.instruction });
        } else if (event.kind === 'confirm') {
          confirmActionsRef.current = { onConfirm: event.onConfirm, onCancel: event.onCancel };
          setPendingConfirm({ message: event.message });
          push({ kind: 'confirm', message: event.message });
        } else if (event.kind === 'result') {
          // skip — step cards already carry action+result (avoids duplicate noise)
        } else if (event.kind === 'media') {
          push({ kind: 'media', mediaKind: event.mediaKind, paths: event.paths, dir: event.dir, total: event.total, label: event.label });
        } else {
          push({ kind: 'event', event });
        }
      }, abortController.signal, opts);
      if (result.error) {
        push({ kind: 'error', text: result.error });
      } else if ((result.done as any)?.reason) {
        push({ kind: 'report', text: (result.done as any).reason });
        // Só toca o sino de "pronto" em SUCESSO. Tarefa cancelada/falha mostra o
        // texto, mas sem o chime/notificação de "✅ Bah" (que dava falsa sensação de êxito).
        if ((result.done as any).success !== false) notifyDone((result.done as any).reason);
      } else if (result.thought) {
        push({ kind: 'report', text: result.thought.split('\n').slice(-3).join('\n') });
        notifyDone(result.thought);
      }
      if (!result.error) setInput('');
    } finally {
      abortRef.current = null;
      setLoading(false);
      setManualHelp(null);
      manualContinueRef.current = null;
      setPendingConfirm(null);
      confirmActionsRef.current = null;
    }
  };

  const runChat = async (msg: string, docText?: string, fileName?: string) => {
    convoTabRef.current = activeTabId;
    setChatLoading(true);
    stickToBottomRef.current = true;
    push({ kind: 'chat-user', text: msg, file: fileName });
    setInput('');
    try {
      const { reply, suggestedCommand } = await onSendChat(msg, docText);
      pendingSuggestionRef.current = suggestedCommand ?? null;
      push({ kind: 'chat-assistant', text: reply, suggestedCommand });
    } catch (e: any) {
      push({ kind: 'error', text: String(e?.message ?? e) });
    } finally {
      setChatLoading(false);
    }
  };

  // ── Pesquisa Rápida: busca na web em segundo plano e responde NO PAINEL com fontes. ──
  const runResearch = async (msg: string) => {
    if (loading || chatLoading) return;
    convoTabRef.current = activeTabId;
    setChatLoading(true);
    stickToBottomRef.current = true;
    push({ kind: 'chat-user', text: msg });
    push({ kind: 'event', event: { kind: 'status', message: t('feed.searchingWeb') } });
    setInput('');
    try {
      const { answer, sources } = await onResearch(msg);
      pendingSuggestionRef.current = null;
      push({ kind: 'chat-assistant', text: answer, sources });
    } catch (e: any) {
      push({ kind: 'error', text: String(e?.message ?? e) });
    } finally {
      setChatLoading(false);
    }
  };

  // ── Caixa unificada: decide AGIR (agente) · PESQUISAR (web→painel) · RESPONDER (chat),
  // sem o usuário escolher modo. Determinístico e 0 token na decisão. ──
  const classifyingRef = useRef(false);
  const routeCommand = async (msg: string) => {
    // 1) Ações determinísticas de ALTA confiança (0 token, instantâneas) passam NA FRENTE da IA —
    //    um erro do classificador nunca pode quebrar supercut/preço/notícia/download/playlist.
    if (detectQuickAction(msg)) { pendingSuggestionRef.current = null; runAgent(msg); return; }
    if (/\bplaylist\b/i.test(msg) && /\b(cri\w+|mont\w+|fa[cz]\w+|gera\w+|junt\w+|adicion\w+|creat\w+|make|made|build|generat\w+|add)\b/i.test(msg)) { pendingSuggestionRef.current = null; runAgent(msg); return; }
    // URL/site explícito + verbo de ação ("abra X e busque", "go to Y and search") → é
    // navegação: roda o agente direto (alta confiança, 0 token). Garante que dar um site
    // não caia no classificador nem vire query-lixo de atalho (bug do feedback do tarkam).
    if (commandHasExplicitUrl(msg) && isImperativeAction(msg)) { pendingSuggestionRef.current = null; runAgent(msg); return; }
    // 2) A IA classifica o pedido (agir / página atual / web / chat) com o contexto da aba.
    //    Se a chamada falhar/demorar/estiver indisponível, cai no roteador determinístico abaixo.
    if (onClassify && !classifyingRef.current) {
      classifyingRef.current = true;
      let cls: 'action' | 'page' | 'web' | 'chat' | null = null;
      try { cls = await onClassify(msg); } catch { cls = null; }
      classifyingRef.current = false;
      if (cls === 'action') { pendingSuggestionRef.current = null; runAgent(msg); return; }
      if (cls === 'page' || cls === 'chat') { runChat(msg); return; }
      if (cls === 'web') { runResearch(msg); return; }
      // cls === null → segue pro fallback determinístico.
    }
    routeDeterministic(msg);
  };

  // Fallback determinístico (o roteamento de antes da IA): usado quando a classificação por IA
  // falha/demora/está indisponível (API caiu, modo local travado). 0 token, nunca deixa a caixa morta.
  const routeDeterministic = (msg: string) => {
    if (isAboutCurrentPage(msg)) { runChat(msg); return; }
    if (isPageOp(msg) && !isQuestion(msg)) { pendingSuggestionRef.current = null; runAgent(msg); return; }
    if (isInfoRequest(msg)) { runResearch(msg); return; }
    if (getInitialShortcutAction(msg) || isImperativeAction(msg)) { pendingSuggestionRef.current = null; runAgent(msg); return; }
    runChat(msg);
  };

  const runUnified = (msg: string) => {
    // "sim/pode/faça…" logo após uma proposta → roda a proposta (reclassificada).
    if (pendingSuggestionRef.current && isAffirmative(msg)) {
      const cmd = pendingSuggestionRef.current;
      pendingSuggestionRef.current = null;
      push({ kind: 'chat-user', text: msg });   // mostra o "sim" do usuário no feed
      setInput('');
      routeCommand(cmd);
      return;
    }
    setInput('');
    routeCommand(msg);
  };

  // MODO IMAGEM (one-shot): gera UMA imagem do texto digitado e desmarca a caixinha.
  const runImage = (prompt: string) => {
    setImageMode(false);
    setInput('');
    runAgent(prompt, { forceImage: true });
  };

  // Anexar um DOCUMENTO (PDF/Word/MD/txt) pra perguntar sobre ele. O dialog nativo (main)
  // extrai o texto; fica no compositor até remover (✕), então follow-ups reusam o mesmo doc.
  const pickDoc = async () => {
    if (loading || chatLoading) return;
    const r = await (window as any).electronAPI?.pickDocument?.();
    if (!r) return;   // cancelado
    if (r.ok && r.text) setAttachedDoc({ name: r.name || 'document', text: r.text });
    else push({ kind: 'error', text: r.error || 'Could not read the file.' });
  };

  // "Buscar imagens" (atalho do +): cola o gatilho na caixa e foca; a pessoa completa o tipo
  // (e edita a quantidade). O caminho por palavra-chave ("baixar fotos de X") segue igual.
  const startImageSearch = () => {
    setInput(t('composer.searchImagesPrefix'));
    setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
  };

  // Selo da IA ativa (o provedor/modelo que a pessoa selecionou). SÓ lê o estado — não pesa,
  // sem chamada nenhuma. Sem chave (e não-Pollinations) = cai no Pollinations grátis (keyless).
  const activeAiLabel = (): string => {
    if (localSettings.enabled) return `Ollama · ${localSettings.model || 'local'}`;
    const p = aiSettings.provider;
    if (p !== 'pollinations' && !aiSettings.apiKey?.trim()) return 'Pollinations';
    if (p === 'deepseek') return 'DeepSeek';
    if (p === 'mistral') return 'Mistral';
    if (p === 'openai') return 'OpenAI';
    if (p === 'anthropic') return 'Anthropic';
    if (p === 'nvidia') {
      const names: Record<string, string> = { 'meta/llama-3.3-70b-instruct': 'Llama 3.3 70B', 'deepseek-ai/deepseek-v4-flash': 'DeepSeek V4 Flash', 'deepseek-ai/deepseek-v4-pro': 'DeepSeek V4 Pro', 'nvidia/llama-3.3-nemotron-super-49b-v1': 'Nemotron 49B', 'z-ai/glm-5.1': 'GLM 5.1', 'qwen/qwen3-next-80b-a3b-instruct': 'Qwen3 80B' };
      return aiSettings.model && names[aiSettings.model] ? `NVIDIA · ${names[aiSettings.model]}` : 'NVIDIA';
    }
    return 'Pollinations';
  };

  // Idioma da UI → nome que o Whisper entende (auto se vazio).
  const whisperLang = (): string | undefined => ({ pt: 'portuguese', en: 'english', es: 'spanish' } as Record<string, string>)[getLang()];

  const ensureVoiceWorker = (): Worker => {
    if (!voiceWorkerRef.current) {
      const w = new Worker(new URL('../whisper.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const d = e.data || {};
        if (d.type === 'result') {
          const txt = String(d.text || '').trim();
          if (txt) setInput(prev => (prev ? prev.trimEnd() + ' ' : '') + txt);
          setVoiceState('idle');
        } else if (d.type === 'error') {
          setVoiceState('idle');
          push({ kind: 'error', text: `Voice: ${d.error}` });
        }
      };
      w.postMessage({ type: 'load' });   // começa a baixar/carregar o modelo já (em paralelo com a fala)
      voiceWorkerRef.current = w;
    }
    return voiceWorkerRef.current;
  };

  // blob (webm/opus) gravado → Float32 mono 16kHz (formato que o Whisper espera).
  const blobToPcm16k = async (blob: Blob): Promise<Float32Array> => {
    const buf = await blob.arrayBuffer();
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ac = new AC();
    let decoded: AudioBuffer;
    try { decoded = await ac.decodeAudioData(buf); }
    finally { try { await ac.close(); } catch {} }   // fecha SEMPRE — senão vaza AudioContext e a voz trava após ~6 falhas
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0).slice();
    // Mic fraco/Bluetooth (perfil "Hands-Free") grava BAIXO → o Whisper "alucina" frases em áudio
    // quieto. Normaliza o volume (pico → ~0.97). Se vier quase mudo, sinaliza pra AVISAR em vez de
    // inventar texto.
    let peak = 0;
    for (let i = 0; i < data.length; i++) { const a = data[i] < 0 ? -data[i] : data[i]; if (a > peak) peak = a; }
    if (peak < 0.01) throw new Error('NO_AUDIO');
    if (peak < 0.97) { const g = 0.97 / peak; for (let i = 0; i < data.length; i++) data[i] *= g; }
    return data;
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) audioChunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        mediaStreamRef.current?.getTracks().forEach(tr => tr.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) { setVoiceState('idle'); return; }
        try {
          setVoiceState('transcribing');
          const pcm = await blobToPcm16k(blob);
          ensureVoiceWorker().postMessage({ type: 'transcribe', audio: pcm, language: whisperLang() }, [pcm.buffer]);
        } catch (err: any) {
          setVoiceState('idle');
          const m = String(err?.message || err);
          push({ kind: 'error', text: m === 'NO_AUDIO' ? t('composer.noAudio') : `Voice: ${m}` });
        }
      };
      mediaRecorderRef.current = rec;
      ensureVoiceWorker();   // já vai carregando o modelo em paralelo (1ª vez baixa ~50MB)
      rec.start();
      setVoiceState('listening');
    } catch (err: any) {
      setVoiceState('idle');
      try { mediaStreamRef.current?.getTracks().forEach(tr => tr.stop()); } catch {}   // se o MediaRecorder falhar após o getUserMedia, solta o mic (senão o ícone fica preso)
      mediaStreamRef.current = null;
      push({ kind: 'error', text: `Voice: ${String(err?.message || err)}` });
    }
  };

  const stopListening = () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
  };

  const toggleVoice = () => {
    if (loading || chatLoading || voiceState === 'transcribing') return;
    if (voiceState === 'listening') stopListening();
    else startListening();
  };

  // Limpa o worker e solta o microfone ao desmontar.
  useEffect(() => () => {
    try { voiceWorkerRef.current?.terminate(); } catch {}
    try { mediaStreamRef.current?.getTracks().forEach(tr => tr.stop()); } catch {}
  }, []);

  const handleSubmit = () => {
    const msg = input.trim();
    if (!msg) return;
    if (loading || chatLoading) return;
    if (attachedDoc) {
      // Instrução explícita: faz ATÉ um modelo fraco usar o texto fornecido em vez de
      // dizer "não consigo ver o arquivo, cole o texto".
      const ctx = `The user attached a file named "${attachedDoc.name}". Its FULL text is provided below, between the markers. Answer the user's question using ONLY this text — do NOT say you can't see the file.\n\n===== FILE CONTENT =====\n${attachedDoc.text}\n===== END FILE =====`;
      const fileName = attachedDoc.name;
      setAttachedDoc(null);   // o arquivo "sai" da caixa e aparece NA conversa (estilo ChatGPT)
      runChat(msg, ctx, fileName); return;   // doc Q&A
    }
    if (imageMode) { runImage(msg); return; }
    runUnified(msg);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setManualHelp(null);
    manualContinueRef.current = null;
    setPendingConfirm(null);
    confirmActionsRef.current = null;
    push({ kind: 'event', event: { kind: 'status', message: 'Canceling task...' } });
  };

  // Freio de segurança: usuário decidiu (Sim, pode / Cancelar) na ação de risco.
  const handleConfirmRisky = (ok: boolean) => {
    const actions = confirmActionsRef.current;
    confirmActionsRef.current = null;
    setPendingConfirm(null);
    push({ kind: 'event', event: { kind: 'status', message: ok ? '✅ You confirmed — continuing.' : '✖️ You canceled the action.' } });
    if (actions) (ok ? actions.onConfirm : actions.onCancel)();
  };

  const handleContinueAfterManualHelp = () => {
    const resume = manualContinueRef.current;
    if (!resume) return;
    manualContinueRef.current = null;
    setManualHelp(null);
    push({ kind: 'event', event: { kind: 'status', message: 'Continuing after the manual intervention...' } });
    resume();
  };

  // ── Gerenciador de modelos Ollama ──
  const ollamaApi = () => (window as any).electronAPI;
  const refreshModels = async () => {
    try {
      const r = await ollamaApi()?.ollamaList?.(localCfg.baseUrl);
      setOllamaUp(!!r?.ok);
      if (r?.ok) setModels(r.models || []);
    } catch { setOllamaUp(false); }
  };
  // Botão único "Ligar o Ollama": tenta SUBIR o Ollama (ensure-running sobe o `ollama serve`
  // se estiver instalado mas desligado), depois lista os modelos. Dá retorno na tela. Se nem
  // estiver instalado (notInstalled), a mensagem manda instalar e o botão Instalar aparece.
  const startOllama = async () => {
    if (starting) return;
    setStarting(true); setNotInstalled(false); setStartMsg(t('mm.starting'));
    try {
      const ens = await ollamaApi()?.ollamaEnsureRunning?.(localCfg.baseUrl);
      if (ens?.ok) {
        const r = await ollamaApi()?.ollamaList?.(localCfg.baseUrl);
        setOllamaUp(!!r?.ok);
        if (r?.ok) setModels(r.models || []);
        setStartMsg(r?.ok ? t('mm.started', { n: (r.models || []).length }) : '');
      } else {
        setOllamaUp(false);
        setNotInstalled(!!ens?.notInstalled);
        setStartMsg(ens?.notInstalled ? t('mm.notInstalled') : t('mm.startFailed'));
      }
    } catch {
      setOllamaUp(false); setStartMsg(t('mm.startFailed'));
    } finally {
      setStarting(false);
    }
  };
  const installOllama = () => { try { ollamaApi()?.openExternal?.('https://ollama.com/download'); } catch {} };
  const getProviderKey = () => {
    const url = settings.provider === 'mistral' ? 'https://console.mistral.ai/api-keys'
      : settings.provider === 'nvidia' ? 'https://build.nvidia.com/'
      : 'https://platform.deepseek.com/api_keys';
    try { ollamaApi()?.openExternal?.(url); } catch {}
  };
  useEffect(() => {
    if (!showSettings || !localCfg.enabled) return;
    refreshModels();
    const off = ollamaApi()?.onOllamaPullProgress?.((p: any) => {
      if (p?.canceled) { setPullMsg('canceled'); setPulling(false); refreshModels(); return; }
      if (p?.error) { setPullMsg(`error: ${p.error}`); setPulling(false); return; }
      if (p?.done) { setPullMsg('✅ Downloaded!'); setPulling(false); refreshModels(); return; }
      setPullMsg(`${p?.status || 'downloading'}${p?.percent != null ? ` ${p.percent}%` : ''}`);
    });
    return typeof off === 'function' ? off : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, localCfg.enabled, localCfg.baseUrl]);
  const handlePull = async () => {
    const m = pullName.trim(); if (!m || pulling) return;
    setPulling(true); setPullMsg('Preparing Ollama…');
    // Garante o Ollama rodando — sobe ele sozinho se estiver instalado mas fechado
    // (sem o usuário precisar abrir o app na mão).
    let up = false;
    try {
      const ens = await ollamaApi()?.ollamaEnsureRunning?.(localCfg.baseUrl);
      up = !!ens?.ok;
      if (ens?.started) setPullMsg('Ollama started ✓');
      if (!ens?.ok && ens?.notInstalled) {
        setOllamaUp(false);
        setPullMsg('Ollama is not installed. Click "Install Ollama" above, install it, open it, and try again.');
        setPulling(false); return;
      }
    } catch { up = false; }
    // Re-checa a lista (atualiza o estado e some a caixa "Ollama não detectado").
    if (up) {
      try {
        const chk = await ollamaApi()?.ollamaList?.(localCfg.baseUrl);
        up = !!chk?.ok; setOllamaUp(up);
        if (chk?.ok) setModels(chk.models || []);
      } catch { up = false; setOllamaUp(false); }
    }
    if (!up) {
      setOllamaUp(false);
      setPullMsg('Could not start Ollama. Open the Ollama app (tray icon, near the clock) and click Download again.');
      setPulling(false); return;
    }
    const url = localCfg.baseUrl || 'http://127.0.0.1:11434';
    setPullMsg('Starting the download…');
    try {
      const r = await ollamaApi()?.ollamaPull?.(m, localCfg.baseUrl);
      // Sucesso e cancelamento são tratados pelo onOllamaPullProgress. Aqui só erro real.
      if (r && !r.ok && !r.canceled) {
        const err = String(r.error || 'failed');
        const conn = /ECONNREFUSED|ENOTFOUND|fetch failed|ECONNRESET|connect\b/i.test(err);
        setPullMsg(conn
          ? `Could not reach Ollama at ${url}. Open the Ollama app and try again.`
          : `error: ${err}`);
        setPulling(false); refreshModels();
      }
    } catch (e: any) { setPullMsg(`error: ${e?.message || e}`); setPulling(false); }
  };
  const handleCancelPull = async () => {
    setPullMsg('Canceling…');
    try { await ollamaApi()?.ollamaPullCancel?.(); } catch {}
    // O resultado final ('cancelado') chega pelo onOllamaPullProgress; garante o desbloqueio.
    setPulling(false);
  };
  const handleDeleteModel = async (name: string) => {
    try { await ollamaApi()?.ollamaDelete?.(name, localCfg.baseUrl); refreshModels(); } catch {}
  };
  const handleImportGguf = async () => {
    if (!ggufPath.trim() || pulling) return;
    setPulling(true); setPullMsg('Importing .gguf…');
    try { const r = await ollamaApi()?.ollamaImportGguf?.(ggufName.trim(), ggufPath.trim()); setPullMsg(r?.ok ? '✅ imported!' : `error: ${r?.error || 'failed'}`); refreshModels(); }
    catch (e: any) { setPullMsg(`error: ${e?.message || e}`); }
    setPulling(false);
  };

  return (
    <div className="agent-command-bar" data-testid="agent-command-bar">
      <div className="sidebar-header">
        <h3>{t('assist.title')}</h3>
        <div className="sidebar-actions">
          <button onClick={() => setShowSettings(!showSettings)} title={t('assist.settings')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button onClick={() => { setFeedsByTab(m => ({ ...m, [activeTabId]: [] })); window.electronAPI?.clearChatHistory?.(activeTabId); }} title={t('assist.clear')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button onClick={onClose} title={t('assist.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <label>
            {t('settings.language')}
            <select value={getLang()} onChange={e => setLang(e.target.value as Lang)}>
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <div className="mode-switch" role="tablist" aria-label="Where the AI runs">
            <button
              type="button"
              className={`mode-opt ${!localCfg.enabled ? 'on' : ''}`}
              onClick={() => { setLocalCfg(p => ({ ...p, enabled: false })); setSettings(s => ({ ...s, provider: (s.provider === 'mistral' || s.provider === 'nvidia') ? s.provider : 'deepseek' })); }}
            >☁️ {t('set.cloudMode')}<small>{t('set.cloudSmall')}</small></button>
            <button
              type="button"
              className={`mode-opt ${localCfg.enabled ? 'on' : ''}`}
              onClick={() => setLocalCfg(p => ({ ...p, enabled: true }))}
            >🏠 {t('set.localMode')}<small>{t('set.localSmall')}</small></button>
          </div>
          {!localCfg.enabled && (
            <>
              <label>
                {t('set.provider')}
                <select
                  value={settings.provider === 'mistral' ? 'mistral' : settings.provider === 'nvidia' ? 'nvidia' : 'deepseek'}
                  onChange={e => { const next = e.target.value as AISettings['provider']; setSettings(s => { const keys = { ...(s.apiKeys || {}), [s.provider]: s.apiKey }; return { ...s, provider: next, baseUrl: '', model: '', apiKey: keys[next] || '', apiKeys: keys }; }); }}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="mistral">Mistral</option>
                  <option value="nvidia">NVIDIA NIM</option>
                </select>
              </label>
              <label>
                {t('set.apiKey')} ({settings.provider === 'mistral' ? 'Mistral' : settings.provider === 'nvidia' ? 'NVIDIA NIM' : 'DeepSeek'})
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder={t('set.apiKeyPlaceholder', { provider: settings.provider === 'mistral' ? 'Mistral' : settings.provider === 'nvidia' ? 'NVIDIA NIM' : 'DeepSeek' })}
                />
              </label>
              {settings.provider === 'nvidia' && (
                <label>
                  {t('set.model')}
                  <select
                    value={settings.model || 'meta/llama-3.3-70b-instruct'}
                    onChange={e => setSettings({ ...settings, model: e.target.value })}
                  >
                    <option value="meta/llama-3.3-70b-instruct">Llama 3.3 70B (fast)</option>
                    <option value="deepseek-ai/deepseek-v4-flash">DeepSeek V4 Flash (fast)</option>
                    <option value="deepseek-ai/deepseek-v4-pro">DeepSeek V4 Pro (strong)</option>
                    <option value="nvidia/llama-3.3-nemotron-super-49b-v1">Nemotron Super 49B</option>
                    <option value="z-ai/glm-5.1">GLM 5.1</option>
                    <option value="qwen/qwen3-next-80b-a3b-instruct">Qwen3 Next 80B</option>
                  </select>
                </label>
              )}
              <div className="mm-hint">☁️ {t('set.cloudHint')} <button type="button" className="mm-link" onClick={getProviderKey}>{t('set.getKey')}</button></div>
              <details className="mm-imp">
                <summary>{t('set.advanced')}</summary>
                <label>
                  {t('set.baseUrl')}
                  <input
                    type="text"
                    value={settings.baseUrl}
                    onChange={e => setSettings({ ...settings, baseUrl: e.target.value })}
                    placeholder={t('set.baseUrlPlaceholder')}
                  />
                </label>
              </details>
            </>
          )}
          {localCfg.enabled && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="mm-hint">💡 {t('set.localHint')}</div>
                <label>
                  {t('set.ollamaUrl')}
                  <input type="text" value={localCfg.baseUrl}
                    onChange={e => setLocalCfg(p => ({ ...p, baseUrl: e.target.value }))}
                    placeholder="http://localhost:11434" />
                </label>
                <div className="model-mgr">
                  {ollamaUp === false && (
                    <div className="mm-noollama">
                      <div className="mm-noollama-t">{t('mm.noOllama')}</div>
                      <div className="mm-noollama-b">
                        <button className="mm-recheck" onClick={startOllama} disabled={starting}>{starting ? t('mm.starting') : t('mm.startOllama')}</button>
                        {notInstalled && <button className="mm-install" onClick={installOllama}>{t('mm.install')}</button>}
                      </div>
                    </div>
                  )}
                  <div className="mm-head">
                    <span>{t('mm.installed')}</span>
                    {ollamaUp === true && <button className="mm-refresh" onClick={refreshModels} title={t('mm.refresh')}>↻</button>}
                  </div>
                  {models.length === 0 ? (
                    <div className="mm-empty">{ollamaUp === false ? t('mm.emptyNoOllama') : t('mm.empty')}</div>
                  ) : (
                    <div className="mm-list">
                      {models.map(m => (
                        <div key={m.name} className={`mm-item ${m.name === localCfg.model ? 'on' : ''}`}>
                          <button className="mm-pick" onClick={() => setLocalCfg(p => ({ ...p, model: m.name }))} title={t('mm.use')}>
                            <span className="mm-name">{m.name === localCfg.model ? '✓ ' : ''}{m.name}</span>
                            <span className="mm-meta">{[m.params, m.sizeGB ? `${m.sizeGB}GB` : ''].filter(Boolean).join(' · ')}</span>
                          </button>
                          <button className="mm-del" onClick={() => handleDeleteModel(m.name)} title={t('mm.delete')}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mm-pull">
                    <input value={pullName} onChange={e => setPullName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handlePull(); }}
                      disabled={pulling}
                      placeholder={t('mm.pullPlaceholder')} />
                    {pulling
                      ? <button className="mm-cancel" onClick={handleCancelPull} title={t('mm.stopTitle')}>{t('mm.stop')}</button>
                      : <button onClick={handlePull} disabled={!pullName.trim()}>{t('mm.download')}</button>}
                  </div>
                  {(pullMsg || startMsg) && <div className="mm-prog">{pullMsg || startMsg}</div>}
                  <div className="mm-sugg">
                    <div className="mm-sugg-cap">{t('mm.suggestions')}</div>
                    {MODEL_SUGGESTIONS.map(g => (
                      <div key={g.tier} className="mm-sugg-row">
                        <span className="mm-tier">{g.tier}</span>
                        <span className="mm-chips">
                          {g.models.map(s => (
                            <button key={s} className="mm-chip" onClick={() => setPullName(s)}>{s}</button>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                  <details className="mm-imp mm-imp-open" open>
                    <summary>{t('mm.importGguf')}</summary>
                    <input value={ggufPath} onChange={e => setGgufPath(e.target.value)} placeholder={t('mm.ggufPath')} />
                    <input value={ggufName} onChange={e => setGgufName(e.target.value)} placeholder={t('mm.ggufName')} />
                    <button onClick={handleImportGguf} disabled={!ggufPath.trim() || pulling}>{t('mm.import')}</button>
                  </details>
                </div>
            </div>
          )}
          <button className="save-settings" onClick={async () => {
            await onSettingsChange(settings);
            await onLocalSettingsChange(localCfg);
            setShowSettings(false);
          }}>
            {t('settings.save')}
          </button>
        </div>
      )}

      {/* ── Unified activity feed (infinite scroll, persists across tasks) ── */}
      <div className="agent-feed" ref={feedRef} onScroll={onFeedScroll}>
        {feed.length === 0 && isStartupTab && (
          <div className="feed-empty">
            {!aiSettings.apiKey && !localSettings.enabled && (
              <div className="ai-onboard">
                <div className="ai-onboard-title">{t('onboard.title')}</div>
                <div className="ai-onboard-text">{t('onboard.text')}</div>
                <button className="ai-onboard-btn" onClick={() => setShowSettings(true)}>{t('onboard.btn')}</button>
              </div>
            )}
            {onGoogleLogin && !googleLoggedIn && (
              <button className="glass-login-btn" onClick={onGoogleLogin} title={t('login.google')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M21 10h-8v3.6h4.6c-.4 2-2.2 3.4-4.6 3.4a5 5 0 110-10c1.3 0 2.4.5 3.3 1.3l2.6-2.6A8.8 8.8 0 0012 3a9 9 0 100 18c5.2 0 8.7-3.7 8.7-8.9 0-.7-.1-1.4-.3-2.1z"/></svg>
                <span>{t('login.google')}</span>
              </button>
            )}
            <div className="showcase-sub">{t('login.subline')}</div>
          </div>
        )}
        {feed.map(item => <FeedRow key={item.id} item={item} onContinue={handleContinueAfterManualHelp} helpActive={!!manualHelp} onConfirmRisky={handleConfirmRisky} confirmActive={!!pendingConfirm} onRunSuggestion={(cmd) => { pendingSuggestionRef.current = null; if (!loading && !chatLoading) runAgent(cmd); }} onOpenUrl={onOpenUrl} />)}
        {chatLoading && convoTabRef.current === activeTabId && (
          <div className="chat-msg assistant"><div className="chat-ai-label">{activeAiLabel()}</div><div className="msg-content typing"><span /><span /><span /></div></div>
        )}
        {loading && convoTabRef.current === activeTabId && (
          <div className="feed-working"><span className="agent-spinner" /> <span className="feed-working-ai">{activeAiLabel()}</span> · {t('feed.working')}</div>
        )}
      </div>

      {/* ── Composer: um bloco ÚNICO, limpo e generoso (estilo Comet) ── */}
      <div className="composer">
        {attachedDoc && (
          <div className="composer-attach">
            <span className="composer-attach-ic">📄</span>
            <span className="composer-attach-name">{attachedDoc.name}</span>
            <button type="button" className="composer-attach-x" onClick={() => setAttachedDoc(null)} title={t('composer.removeAttach')}>✕</button>
          </div>
        )}
        <textarea
          ref={inputRef}
          data-testid="agent-command-input"
          className="composer-input"
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder={attachedDoc ? t('composer.phFile') : imageMode ? t('composer.phImage') : ph}
          disabled={loading || chatLoading}
        />
        <div className="composer-bar">
          <div className="composer-plus-wrap" ref={plusWrapRef}>
            <button
              type="button"
              className={`composer-plus${plusMenuOpen ? ' open' : ''}`}
              onClick={() => setPlusMenuOpen(v => !v)}
              disabled={loading || chatLoading}
              title={t('composer.more')}
              aria-label={t('composer.more')}
              aria-expanded={plusMenuOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            {plusMenuOpen && (
              <div className="composer-plus-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); pickDoc(); }}>
                  <span className="composer-menu-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg></span>
                  {t('composer.attachShort')}
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setImageMode(true); }}>
                  <span className="composer-menu-ico"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6L5.7 8.8l4.6-1.7L12 2.5z"/></svg></span>
                  {t('composer.imageMode')}
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); startImageSearch(); }}>
                  <span className="composer-menu-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg></span>
                  {t('composer.searchImages')}
                </button>
              </div>
            )}
          </div>
          {imageMode && (
            <button type="button" className="composer-mode-chip" onClick={() => setImageMode(false)} title={t('composer.removeAttach')}>
              {t('composer.imageMode')} <span aria-hidden="true">✕</span>
            </button>
          )}
          <span className="composer-spacer" />
          <button
            type="button"
            className={`composer-mic${voiceState === 'listening' ? ' listening' : voiceState === 'transcribing' ? ' busy' : ''}`}
            onClick={toggleVoice}
            disabled={loading || chatLoading}
            title={voiceState === 'listening' ? t('composer.listening') : voiceState === 'transcribing' ? t('composer.voicePrep') : t('composer.voice')}
            aria-label={t('composer.voice')}
            aria-pressed={voiceState === 'listening'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          {manualHelp ? (
            <button data-testid="agent-manual-continue" onClick={handleContinueAfterManualHelp} className="composer-continue" title={manualHelp.instruction}>
              {t('feed.continue')}
            </button>
          ) : loading ? (
            <button data-testid="agent-stop" onClick={handleStop} className="composer-send stop" title={t('composer.stopTask')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
            </button>
          ) : (
            <button data-testid="agent-run" onClick={handleSubmit} disabled={!input.trim() || chatLoading} className="composer-send" title={t('composer.send')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Feed item renderers
// ────────────────────────────────────────────────────────────────────────

// "Pronto!" — toca um sininho suave (2 notas, via Web Audio, sem arquivo) e, se a
// janela NÃO estiver em foco, dispara uma notificação do SO. Para tarefas longas
// (supercut, baixar muita coisa) o usuário pode olhar pra fora e ser avisado.
function chime() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const beep = (freq: number, at: number) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.connect(g); g.connect(ac.destination); o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.13, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.35);
      o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.37);
    };
    beep(880, 0); beep(1245, 0.13);   // dó→mi, alegrinho
    setTimeout(() => { try { ac.close(); } catch {} }, 800);
  } catch {}
}
function notifyDone(message: string) {
  chime();
  try {
    if (!document.hasFocus() && 'Notification' in window) {
      new Notification('✅ Bah', { body: (message || 'Task completed.').slice(0, 140) });
    }
  } catch {}
}

function FeedRow({ item, onContinue, helpActive, onConfirmRisky, confirmActive, onRunSuggestion, onOpenUrl }: { item: FeedItem; onContinue: () => void; helpActive: boolean; onConfirmRisky: (ok: boolean) => void; confirmActive: boolean; onRunSuggestion: (cmd: string) => void; onOpenUrl: (url: string) => void }) {
  switch (item.kind) {
    case 'task':
      return <div className="chat-msg user"><div className="msg-content">⚡ {item.text}</div></div>;
    case 'chat-user':
      return <div className="chat-msg user">{item.file && <div className="chat-file">📄 {item.file}</div>}<div className="msg-content">{item.text}</div></div>;
    case 'chat-assistant':
      return (
        <div className="chat-msg assistant">
          <div className="msg-content">{item.text}</div>
          {item.sources && item.sources.length > 0 && (
            <div className="chat-sources">
              <span className="chat-sources-label">{t('feed.sources')}</span>
              {item.sources.slice(0, 6).map((s, i) => (
                <button key={i} className="chat-source" onClick={() => onOpenUrl(s.url)} title={`${s.title}\n${s.url}`}>
                  {i + 1}. {hostOf(s.url)}
                </button>
              ))}
            </div>
          )}
          {item.suggestedCommand && (
            <button className="chat-action-btn" onClick={() => onRunSuggestion(item.suggestedCommand!)} title={t('feed.runTaskTitle')}>
              ⚡ {t('feed.doThis')}{item.suggestedCommand.length <= 48 ? `: ${item.suggestedCommand}` : ''}
            </button>
          )}
        </div>
      );
    case 'report':
      return <div className="result-report">{item.text}</div>;
    case 'error':
      return <div className="result-error">{item.text}</div>;
    case 'help':
      return (
        <div className="feed-help-card">
          <div className="feed-help-title">{t('feed.helpTitle')}</div>
          <div className="feed-help-msg">{item.message}</div>
          <div className="feed-help-instr">{item.instruction}</div>
          {helpActive && <button className="manual-continue-btn" onClick={onContinue}>{t('feed.continue')}</button>}
        </div>
      );
    case 'step':
      return <StepCard step={item.step} />;
    case 'event':
      return <ProgressLine event={item.event} />;
    case 'media':
      return <MediaStrip mediaKind={item.mediaKind} paths={item.paths} dir={item.dir} total={item.total} label={item.label} />;
    case 'confirm':
      return (
        <div className="feed-confirm-card">
          <div className="feed-confirm-title">{t('feed.confirmTitle')}</div>
          <div className="feed-confirm-msg">{item.message}</div>
          {confirmActive && (
            <div className="feed-confirm-actions">
              <button className="confirm-yes" onClick={() => onConfirmRisky(true)}>{t('feed.confirmYes')}</button>
              <button className="confirm-no" onClick={() => onConfirmRisky(false)}>{t('feed.confirmNo')}</button>
            </div>
          )}
        </div>
      );
  }
}

// Tira de mídia no feed: até 5 miniaturas + "+N", clique abre a pasta. Zero IA.
function MediaStrip({ mediaKind, paths, dir, total, label }: { mediaKind: 'image' | 'audio' | 'video'; paths: string[]; dir: string; total: number; label: string }) {
  const shown = paths.slice(0, 5);
  const extra = Math.max(0, total - shown.length);
  const icon = mediaKind === 'audio' ? '🎵' : mediaKind === 'video' ? '🎬' : '🖼️';
  const fileUrl = (p: string) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');
  // 1 mídia → abre o arquivo (a imagem/áudio/vídeo); 2+ → abre a pasta.
  const single = total === 1 && shown.length === 1;
  const openFile = (p: string) => { try { (window as any).electronAPI?.openFile?.(p); } catch {} };
  const openFolder = () => { try { (window as any).electronAPI?.revealInFolder?.(dir || shown[0]); } catch {} };
  const onTile = (p: string) => { if (single) openFile(p); else openFolder(); };
  return (
    <div className="media-strip" title={single ? t('dl.openFile') : t('media.openFolderTitle')}>
      <div className="media-strip-head">{icon} {label} <span className="media-strip-open">{single ? t('dl.openFile') : t('media.openFolder')}</span></div>
      <div className="media-tiles">
        {shown.map((p, i) => (
          <div key={i} className="media-tile" onClick={() => onTile(p)} title={p.split(/[\\/]/).pop()}>
            {mediaKind === 'image'
              ? <img src={fileUrl(p)} alt="" draggable={false} onError={e => { (e.currentTarget.style.display = 'none'); }} />
              : <span className="media-tile-icon">{icon}</span>}
          </div>
        ))}
        {extra > 0 && (
          <div className="media-tile media-tile-more" onClick={openFolder} title={`${extra} more in ${dir}`}>+{extra}</div>
        )}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: StepRecord }) {
  const [open, setOpen] = useState(false);
  const evalKind = step.evaluation
    ? (/^success/i.test(step.evaluation) ? 'ok' : /^fail/i.test(step.evaluation) ? 'fail' : 'unknown')
    : null;
  const statusColor = step.success ? '#22c55e' : '#ef4444';
  const recoveryColor = '#f59e0b';
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 9px',
      background: 'rgba(255,255,255,0.02)', animation: 'msgIn 0.25s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <span style={{
          fontSize: '10px', fontWeight: 700, color: statusColor,
          background: statusColor + '1f', border: `1px solid ${statusColor}55`,
          borderRadius: '999px', padding: '1px 8px', flex: '0 0 auto',
        }}>{step.success ? '✓' : '✕'} {step.fromQueue ? `⚡${step.step}` : step.step}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {step.actionLabel}
        </span>
        {step.recovery && (
          <span style={{ fontSize: '9px', fontWeight: 700, color: recoveryColor, background: recoveryColor + '1f', border: `1px solid ${recoveryColor}55`, borderRadius: '4px', padding: '1px 5px', flex: '0 0 auto' }}>
            🛡️ {step.recovery.decision}
          </span>
        )}
        {step.durationMs != null && (
          <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', flex: '0 0 auto' }}>{(step.durationMs / 1000).toFixed(0)}s</span>
        )}
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {step.evaluation && (
        <div style={{ fontSize: '10.5px', marginTop: '4px', color: evalKind === 'ok' ? '#86efac' : evalKind === 'fail' ? '#fca5a5' : 'var(--text-muted)' }}>
          {evalKind === 'ok' ? '✅' : evalKind === 'fail' ? '❌' : '❓'} {step.evaluation}
        </div>
      )}

      {/* Screenshot always visible — the live "replay" the feed is about */}
      {step.screenshot && (
        <img src={step.screenshot} alt={`step ${step.step}`}
          style={{ width: '100%', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '6px', cursor: 'pointer' }}
          onClick={() => setOpen(o => !o)} />
      )}

      {open && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {step.thought && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.4 }}>💭 {step.thought}</div>
          )}
          {step.recovery && (
            <div style={{ fontSize: '10.5px', color: recoveryColor, lineHeight: 1.4 }}>🛡️ {step.recovery.reason}</div>
          )}
          {step.resultSummary && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{step.resultSummary}</div>
          )}
          {step.urlAfter && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔗 {step.urlAfter}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressLine({ event }: { event: AgentProgressEvent }) {
  if (event.kind === 'step') return null;
  if (event.kind === 'manual_help') return null;
  if (event.kind === 'media') return null; // renderizado pelo MediaStrip, não aqui
  if (event.kind === 'action') {
    return <div className="result-action"><span className="result-desc">▶ {formatAction(event.action)}</span></div>;
  }
  if (event.kind === 'result') {
    return (
      <div className="result-action">
        <span className="result-desc">✓ {formatAction(event.action)}</span>
        <span className="result-value">{formatResult(event.result)}</span>
      </div>
    );
  }
  if (event.kind === 'thought') {
    return (
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '2px 0', lineHeight: 1.4 }}>
        💭 {event.message}
      </div>
    );
  }
  // status — detect engine chip lines vs metric lines vs generic
  const msg = event.message;

  if (msg.startsWith('Known shortcut:')) {
    return <StatusChip label="FAST PATH" message={msg.replace('Known shortcut:', '').trim()} color="#5b9e92" />;
  }

  if (msg.includes('Local OCR:')) {
    return <StatusChip label="LOCAL OCR" message={msg.replace(/^.*Local OCR:/, '').trim()} color="#b59a4d" />;
  }

  if (/Step \d+: observing/.test(msg)) {
    return <StatusChip label="OBSERVE" message={msg} color="#6b93b8" subtle />;
  }

  if (/Step \d+: thinking/.test(msg)) {
    return <StatusChip label="THINK" message={msg} color="#8b80b5" subtle />;
  }

  if (msg.startsWith('🛡️')) {
    return <StatusChip label="RECOVERY" message={msg.replace(/^🛡️\s*(Recovery:)?\s*/, '')} color="#c0883e" />;
  }

  // Engine routing line: "⚡ flash → engine: cloud-flash-fallback" / "🧠 pro → engine: pro"
  if (msg.includes('engine:')) {
    const isLocal = msg.includes('local') && !msg.includes('fallback');
    const isFallback = msg.includes('fallback');
    const isPro = msg.includes('pro');
    const chipColor = isLocal ? '#5a9e6f' : isFallback ? '#c0793f' : isPro ? '#8b6fb0' : '#5e7fc0';
    const chipLabel = isLocal ? '🏠 LOCAL GPU' : isFallback ? '⚠️ FALLBACK CLOUD' : isPro ? '🧠 PRO CLOUD' : '⚡ FLASH CLOUD';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
          background: chipColor + '22', color: chipColor,
          border: `1px solid ${chipColor}55`,
          borderRadius: '4px', padding: '1px 6px',
        }}>{chipLabel}</span>
      </div>
    );
  }

  // Metrics line: "📊 deepseek-chat • 1200 in / 45 out / 0 cached • 2.1s"
  if (msg.startsWith('📊')) {
    return (
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', padding: '1px 0', opacity: 0.8 }}>
        {msg}
      </div>
    );
  }

  // Generic status (observing, thinking, etc.)
  return (
    <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '1px 0', opacity: 0.7 }}>
      {msg}
    </div>
  );
}

function StatusChip({
  label,
  message,
  color,
  subtle = false,
}: {
  label: string;
  message: string;
  color: string;
  subtle?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
      <span style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: color + (subtle ? '16' : '22'),
        color,
        border: `1px solid ${color}${subtle ? '33' : '55'}`,
        borderRadius: '4px',
        padding: '1px 6px',
        flex: '0 0 auto',
      }}>{label}</span>
      <span style={{ fontSize: '11px', color: subtle ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
        {message}
      </span>
    </div>
  );
}

function formatResult(result: any): string {
  if (result === undefined || result === null) return '';
  if (typeof result !== 'object') return String(result);
  return JSON.stringify(result);
}
