import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { VisionImage } from '../shared/vision';
import type { PasswordsBridge } from '../shared/password-types';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  // Continuar de onde parou: antes de fechar a janela, o main pede pra tela gravar as abas e
  // espera o "gravei"; a tela pede pra mandar o localStorage pro disco quando a sessão muda.
  onSaveSessionNow: (cb: () => void) => {
    const listener = () => { try { cb(); } catch {} ipcRenderer.send('session:saved'); };
    ipcRenderer.on('session:save-now', listener);
    return () => ipcRenderer.removeListener('session:save-now', listener);
  },
  flushUiStorage: () => ipcRenderer.send('session:flush-storage'),

  // AI
  setAIProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke('ai:set-provider', provider, apiKey, baseUrl, model),
  // Cifra (cofre do SO) o que vai pro disco; decifra na hora de carregar. Chave em texto puro só na memória.
  encryptSecret: (t: string): Promise<string> => ipcRenderer.invoke('secure:encrypt', t),
  decryptSecretSync: (t: string): string => { try { return ipcRenderer.sendSync('secure:decrypt-sync', t); } catch { return t; } },
  setUILanguage: (lang: string) => ipcRenderer.invoke('ai:set-lang', lang),
  // Valor ESTÁTICO, resolvido no carregamento do preload: o i18n do renderer roda de forma
  // síncrona no import e não pode esperar um invoke assíncrono.
  systemLocale: (() => { try { return String(ipcRenderer.sendSync('app:get-system-locale') || ''); } catch { return ''; } })(),
  onZoom: (cb: (pct: number) => void) => {
    const listener = (_e: any, pct: number) => cb(pct);
    ipcRenderer.on('app:zoom', listener);
    return () => ipcRenderer.removeListener('app:zoom', listener);
  },
  aiChat: (message: string, pageContent?: string, stateless?: boolean, local?: boolean, tabId?: string, rawContext?: string, streamId?: string, image?: VisionImage, thread?: string | { text: string; keepDoc?: boolean }) =>
    ipcRenderer.invoke('ai:chat', message, pageContent, stateless, local, tabId, rawContext, streamId, image, thread),
  contextWindow: (local?: boolean) => ipcRenderer.invoke('ai:context-window', local),
  // Botão Parar do chat: aborta o fetch da request identificada pelo streamId.
  chatCancel: (streamId: string) => ipcRenderer.invoke('ai:chat-cancel', streamId),
  // Streaming do chat: pedaços da resposta chegam por evento conforme o modelo escreve.
  onChatDelta: (cb: (p: { streamId: string; delta: string }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('ai:chat-delta', listener);
    return () => ipcRenderer.removeListener('ai:chat-delta', listener);
  },
  clearChatHistory: (tabId?: string) => ipcRenderer.invoke('ai:clear-history', tabId),
  moveChatHistory: (from: string, to: string) => ipcRenderer.invoke('ai:move-history', from, to),
  // Live model progress (tokens/sec) so a slow local step reads as working, not hung.
  onActionDelta: (cb: (m: { kind: string; estTokens: number; tokPerSec: number; elapsedMs: number; exact: boolean }) => void) => {
    const listener = (_e: any, m: any) => cb(m);
    ipcRenderer.on('ai:action-delta', listener);
    return () => ipcRenderer.removeListener('ai:action-delta', listener);
  },
  aiAction: (command: string, pageContent?: string, screenshot?: VisionImage, tier?: 'local' | 'flash' | 'pro', actionId?: string) =>
    ipcRenderer.invoke('ai:action', command, pageContent, screenshot, tier, actionId),
  // Agent Stop button: aborts the in-flight request in main, not just its result.
  actionCancel: (actionId: string) => ipcRenderer.invoke('ai:action-cancel', actionId),
  setLocalProvider: (provider: string, apiKey: string, baseUrl?: string, modelName?: string, opts?: object) =>
    ipcRenderer.invoke('ai:set-local-provider', provider, apiKey, baseUrl, modelName, opts),
  // ── Local endpoint: discovery / context / probes (no autoload, no inference,
  // except localTestModel, which IS the explicit "Test model" button) ──
  localDiscover: (provider: string, baseUrl?: string, authKey?: string) =>
    ipcRenderer.invoke('local:discover', provider, baseUrl, authKey),
  localContext: (provider: string, baseUrl?: string, model?: string, authKey?: string) =>
    ipcRenderer.invoke('local:context', provider, baseUrl, model, authKey),
  localTestConnection: (baseUrl?: string, authKey?: string) =>
    ipcRenderer.invoke('local:test-connection', baseUrl, authKey),
  localTestModel: (provider: string, baseUrl?: string, model?: string, authKey?: string) =>
    ipcRenderer.invoke('local:test-model', provider, baseUrl, model, authKey),
  gpuInfo: () => ipcRenderer.invoke('local:gpu'),
  setLocalEnabled: (enabled: boolean) => ipcRenderer.invoke('ai:set-local-enabled', enabled),
  setLocalWarmup: (on: boolean) => ipcRenderer.invoke('ai:set-local-warmup', on),
  // Descoberta genérica de backend local (Ollama OU OpenAI-compatible llama.cpp/LM Studio/vLLM).
  llmList: (baseUrl?: string, provider?: string, authKey?: string) => ipcRenderer.invoke('llm:list', baseUrl, provider, authKey),
  llmStatus: (baseUrl?: string, authKey?: string) => ipcRenderer.invoke('llm:status', baseUrl, authKey),
  // ── Gerenciador de modelos Ollama (modo local) ──
  ollamaList: (baseUrl?: string) => ipcRenderer.invoke('ollama:list', baseUrl),
  ollamaEnsureRunning: (baseUrl?: string) => ipcRenderer.invoke('ollama:ensure-running', baseUrl),
  ollamaStatus: (baseUrl?: string) => ipcRenderer.invoke('ollama:status', baseUrl),
  ollamaPull: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:pull', model, baseUrl),
  ollamaPullCancel: () => ipcRenderer.invoke('ollama:pull-cancel'),
  ollamaDelete: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:delete', model, baseUrl),
  ollamaImportGguf: (name: string, ggufPath: string) => ipcRenderer.invoke('ollama:import-gguf', name, ggufPath),
  onOllamaPullProgress: (cb: (p: { model: string; status?: string; completed?: number; total?: number; percent?: number; done?: boolean; error?: string }) => void) => {
    const listener = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on('ollama:pull-progress', listener);
    return () => ipcRenderer.removeListener('ollama:pull-progress', listener);
  },
  // opts.incognito: abrir como aba anônima (popup/pesquisa de aba anônima, "Abrir link em aba anônima").
  onOpenNewTab: (cb: (url: string, opts?: { incognito?: boolean }) => void) => {
    const listener = (_e: any, url: string, opts?: { incognito?: boolean }) => cb(url, opts && typeof opts === 'object' ? { incognito: opts.incognito === true } : undefined);
    ipcRenderer.on('open-new-tab', listener);
    return () => ipcRenderer.removeListener('open-new-tab', listener);
  },
  // Link/arquivo de outro app (Bah como navegador padrão, main/default-browser.ts) → aba. noScript:
  // página do computador, abre sem JavaScript; launch: foi ela que abriu o Bah agora.
  onOutsideOpen: (cb: (p: { url: string; noScript: boolean; launch: boolean }) => void) => {
    const listener = (_e: unknown, p: any) => {
      if (p && typeof p.url === 'string') cb({ url: p.url, noScript: p.noScript === true, launch: p.launch === true });
    };
    ipcRenderer.on('outside-open', listener);
    return () => ipcRenderer.removeListener('outside-open', listener);
  },
  outsideOpenReady: () => ipcRenderer.send('outside-open:ready'),
  // ⋮ → Navegador padrão: o Bah é o padrão? / "Tornar o Bah padrão" (grava só no Bah instalado).
  defaultBrowserStatus: () => ipcRenderer.invoke('default-browser:status'),
  defaultBrowserMake: () => ipcRenderer.invoke('default-browser:make'),
  // Aba emitindo som → alto-falante na aba. Só o aviso do Chromium; nada de config de som.
  onTabAudio: (cb: (p: { wcId: number; audible: boolean }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('tab-audio', listener);
    return () => ipcRenderer.removeListener('tab-audio', listener);
  },
  // Site pedindo câmera/microfone/localização…: o main pergunta pela tela e espera a resposta.
  onSitePermissionAsk: (cb: (p: { id: string; wcId: number; origin: string; kinds: string[]; external?: string }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('site-permission:ask', listener);
    return () => ipcRenderer.removeListener('site-permission:ask', listener);
  },
  onSitePermissionCancel: (cb: (id: string) => void) => {
    const listener = (_e: any, id: string) => cb(id);
    ipcRenderer.on('site-permission:cancel', listener);
    return () => ipcRenderer.removeListener('site-permission:cancel', listener);
  },
  answerSitePermission: (id: string, answer: 'allow' | 'block' | 'dismiss') => ipcRenderer.invoke('site-permission:answer', id, answer),
  listSitePermissions: (url: string) => ipcRenderer.invoke('site-permission:list', url),
  memSaverSignals: (wcIds: number[]) => ipcRenderer.invoke('memsaver:signals', wcIds),
  setSitePermission: (url: string, kind: string, value: 'allow' | 'block' | null) => ipcRenderer.invoke('site-permission:set', url, kind, value),
  resetSitePermissions: (url: string) => ipcRenderer.invoke('site-permission:reset', url),
  // Senhas salvas (main/password-manager.ts). A tela nunca recebe senha guardada nem cifrada: só o
  // site, o usuário e o tamanho. Revelar/copiar a guardada passam pela confirmação do main.
  passwords: ((): PasswordsBridge => {
    const on = <T>(channel: string, cb: (p: T) => void) => {
      const listener = (_e: unknown, p: T) => cb(p);
      ipcRenderer.on(channel, listener);
      return () => { ipcRenderer.removeListener(channel, listener); };
    };
    return {
      state: () => ipcRenderer.invoke('passwords:state'),
      onChanged: (cb) => on('passwords:changed', () => cb()),
      onOffer: (cb) => on('passwords:offer', cb),
      onOfferCancel: (cb) => on('passwords:offer-cancel', cb),
      answerOffer: (id, answer, username) => ipcRenderer.invoke('passwords:offer-answer', id, answer, username),
      revealOffer: (id) => ipcRenderer.invoke('passwords:offer-reveal', id),
      onSuggest: (cb) => on('passwords:suggest', cb),
      onSuggestHide: (cb) => on('passwords:suggest-hide', cb),
      fill: (suggestId, entryId) => ipcRenderer.invoke('passwords:fill', suggestId, entryId),
      setOfferToSave: (v) => ipcRenderer.invoke('passwords:set-offer', v),
      reveal: (id) => ipcRenderer.invoke('passwords:reveal', id),
      copy: (id, what) => ipcRenderer.invoke('passwords:copy', id, what),
      update: (id, patch) => ipcRenderer.invoke('passwords:update', id, patch),
      remove: (id) => ipcRenderer.invoke('passwords:delete', id),
      removeNever: (origin) => ipcRenderer.invoke('passwords:never-remove', origin),
      importCsv: () => ipcRenderer.invoke('passwords:import'),
      exportCsv: () => ipcRenderer.invoke('passwords:export'),
      lock: () => ipcRenderer.send('passwords:lock'),
    };
  })(),
  // Extensões do Chrome: botões na barra (ícone, badge), clique, remover, loja, opções.
  getExtensionsState: () => ipcRenderer.invoke('extensions:get-state'),
  onExtensionsState: (cb: (list: any[]) => void) => {
    const listener = (_e: any, list: any) => cb(list);
    ipcRenderer.on('extensions:state', listener);
    return () => ipcRenderer.removeListener('extensions:state', listener);
  },
  onExtensionOpenTab: (cb: (p: { reqId: number; url: string; active: boolean }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('extensions:open-tab', listener);
    // A tela já escuta: o main pode mandar os pedidos de aba que guardou enquanto ela subia.
    ipcRenderer.invoke('extensions:renderer-ready').catch(() => {});
    return () => ipcRenderer.removeListener('extensions:open-tab', listener);
  },
  // chrome.tabs.remove: o main pede pra fechar a aba deste webContents.
  onExtensionCloseTab: (cb: (p: { wcId: number }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('extensions:close-tab', listener);
    return () => ipcRenderer.removeListener('extensions:close-tab', listener);
  },
  // Qual webContents nasceu pra um pedido de aba da extensão (chrome.tabs.create devolve ESSA aba).
  extensionTabOpened: (reqId: number, wcId: number) => ipcRenderer.invoke('extensions:tab-opened', reqId, wcId),
  extensionActionClick: (extId: string, wcId: number | null, anchor: { left: number; top: number; right: number; bottom: number }) =>
    ipcRenderer.invoke('extensions:action-click', extId, wcId, anchor),
  removeExtension: (extId: string) => ipcRenderer.invoke('extensions:remove', extId),
  // Interruptor do quebra-cabeça: desligada = descarregada (arquivos e dados ficam).
  setExtensionEnabled: (extId: string, enabled: boolean) => ipcRenderer.invoke('extensions:set-enabled', extId, enabled),
  openExtensionStore: () => ipcRenderer.invoke('extensions:open-store'),
  openExtensionOptions: (extId: string) => ipcRenderer.invoke('extensions:open-options', extId),
  // Real OS-level input
  realClick: (wcId: number, x: number, y: number, backendNodeId?: number) =>
    ipcRenderer.invoke('input:click', wcId, x, y, backendNodeId),
  pointer: (wcId: number, op: { kind: 'hover' | 'dblclick' | 'drag' | 'focus'; x: number; y: number; x2?: number; y2?: number; backendNodeId?: number }) =>
    ipcRenderer.invoke('input:pointer', wcId, op),
  realType: (wcId: number, text: string) =>
    ipcRenderer.invoke('input:type', wcId, text),
  abortTyping: () => ipcRenderer.invoke('input:type-abort'),
  // Iframes (formulários embutidos): árvore/coords por frame, clique e preenchimento no nó do frame.
  getFramesAx: (wcId: number) => ipcRenderer.invoke('cdp:frames-ax', wcId),
  getFramesCoords: (wcId: number, key: string, ids: number[]) => ipcRenderer.invoke('cdp:frames-coords', wcId, key, ids),
  frameClick: (wcId: number, key: string, id: number) => ipcRenderer.invoke('cdp:frame-click', wcId, key, id),
  frameFill: (wcId: number, key: string, id: number, value: string) => ipcRenderer.invoke('cdp:frame-fill', wcId, key, id, value),
  markRefs: (wcId: number, attr: string, marks: Array<{ ref: number; backendNodeId?: number; x?: number; y?: number }>) => ipcRenderer.invoke('cdp:mark-refs', wcId, attr, marks),
  savePdf: (wcId: number, name?: string) => ipcRenderer.invoke('agent:save-pdf', wcId, name),
  pageScreenshot: (wcId: number, full: boolean, name?: string) => ipcRenderer.invoke('agent:screenshot', wcId, full, name),
  clipboardReadText: () => ipcRenderer.invoke('clipboard:read-text'),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text),
  realKey: (wcId: number, key: string) =>
    ipcRenderer.invoke('input:key', wcId, key),
  inspect: (wcId: number, target: any) => ipcRenderer.invoke('cdp:inspect', wcId, target),
  keyState: (wcId: number, key: string, down: boolean) => ipcRenderer.invoke('input:key-state', wcId, key, down),
  insertText: (wcId: number, text: string) => ipcRenderer.invoke('input:insert-text', wcId, text),
  // Accessibility tree via CDP
  getAxTree: (wcId: number) =>
    ipcRenderer.invoke('cdp:axtree', wcId),
  getNodeCoords: (wcId: number, backendNodeIds: number[]) =>
    ipcRenderer.invoke('cdp:node-coords', wcId, backendNodeIds),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  // Conversas do assistente (main/chat-store.ts): a viva (só volta com "Continuar de onde parou") e o
  // 🕘 histórico de conversas. Tudo cifrado no disco pelo main.
  threadsLoadLiveSync: () => { try { return ipcRenderer.sendSync('threads:load-live-sync'); } catch { return null; } },
  threadsSaveLive: (payload: unknown) => ipcRenderer.send('threads:save-live', payload),
  threadsClearLive: () => ipcRenderer.invoke('threads:clear-live'),
  chatHistoryList: () => ipcRenderer.invoke('chat-history:list'),
  chatHistoryGet: (id: string) => ipcRenderer.invoke('chat-history:get', id),
  chatHistoryDelete: (id: string) => ipcRenderer.invoke('chat-history:delete', id),
  chatHistoryClear: (since: number | null) => ipcRenderer.invoke('chat-history:clear', since),
  // Tarefas agendadas (guardadas cifradas no main; relógio/fila no renderer)
  schedList: () => ipcRenderer.invoke('sched:list'),
  schedSave: (list: any[]) => ipcRenderer.invoke('sched:save', list),
  schedClock: () => ipcRenderer.invoke('sched:clock'),
  schedNotify: (n: { title: string; body: string; taskId?: string }) => ipcRenderer.invoke('sched:notify', n),
  onSchedFocus: (cb: (taskId: string) => void) => {
    const listener = (_e: any, id: string) => cb(id);
    ipcRenderer.on('sched:focus', listener);
    return () => ipcRenderer.removeListener('sched:focus', listener);
  },
  skillsSave: (markdown: string) => ipcRenderer.invoke('skills:save', markdown),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),
  verifyClick: (wcId: number, backendNodeId: number) =>
    ipcRenderer.invoke('cdp:verify-click', wcId, backendNodeId),
  selectOption: (wcId: number, backendNodeId: number, option: string) =>
    ipcRenderer.invoke('cdp:select-option', wcId, backendNodeId, option),
  // upload do agente: arquivo SÓ do diálogo do SO (token) ou de uma pasta que a pessoa liberou na sessão.
  uploadGrantFolder: () => ipcRenderer.invoke('upload:grant-folder'),
  uploadGrants: () => ipcRenderer.invoke('upload:grants'),
  uploadRevokeAll: () => ipcRenderer.invoke('upload:revoke-all'),
  uploadListFiles: () => ipcRenderer.invoke('upload:list-files'),
  uploadReadFile: (file: string) => ipcRenderer.invoke('upload:read-file', file),
  uploadTokenFor: (files: string[]) => ipcRenderer.invoke('upload:token-for', files),
  uploadPick: (opts: { multiple?: boolean; title?: string }) => ipcRenderer.invoke('upload:pick', opts),
  uploadSet: (wcId: number, backendNodeId: number | null, token: string, at?: { x: number; y: number }) => ipcRenderer.invoke('upload:set', wcId, backendNodeId, token, at),
  fillNode: (wcId: number, backendNodeId: number, value: string) =>
    ipcRenderer.invoke('cdp:fill-node', wcId, backendNodeId, value),
  waitNetworkIdle: (wcId: number, idleMs: number, timeoutMs: number) => ipcRenderer.invoke('cdp:wait-network-idle', wcId, idleMs, timeoutMs),
  downloadUrl: (url: string, filename?: string) =>
    ipcRenderer.invoke('download:url', url, filename),
  searchImages: (query: string, minWidth?: number, count?: number) =>
    ipcRenderer.invoke('images:search', query, minWidth, count),
  onDownloadEvent: (cb: (info: { id?: string; state: string; filename: string; path?: string; url?: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number; paused?: boolean; reason?: string; reasonCode?: string; kind?: string; engine?: boolean; connections?: number; map?: number[][]; vcodec?: string; acodec?: string }) => void) => {
    const listener = (_e: any, info: any) => cb(info);
    ipcRenderer.on('agent:download-event', listener);
    return () => ipcRenderer.removeListener('agent:download-event', listener);
  },
  // Torrent (magnet/.torrent) — card "Salvar ou Tocar". add resolve com {name, files}.
  torrentAdd: (uri: string) => ipcRenderer.invoke('torrent:add', uri),
  torrentPlay: (id: string, index: number) => ipcRenderer.invoke('torrent:play', id, index),
  torrentSaveFile: (id: string, index: number) => ipcRenderer.invoke('torrent:save-file', id, index),
  torrentRemove: (id: string, destroyStore?: boolean) => ipcRenderer.invoke('torrent:remove', id, destroyStore),
  torrentSetSeed: (on: boolean) => ipcRenderer.invoke('torrent:set-seed', on),
  torrentSetBuiltin: (on: boolean) => ipcRenderer.invoke('torrent:set-builtin', on),
  torrentOpen: (uri: string) => ipcRenderer.invoke('torrent:open', uri),
  // Roteador local (Qwen2.5-1.5B): só rotula o texto da caixa. download só depois do "sim" da pessoa.
  routerStatus: () => ipcRenderer.invoke('router:status'),
  routerClassify: (text: string, ctx?: { url?: string; title?: string; lastRun?: { request: string; outcome: string } | null }) => ipcRenderer.invoke('router:classify', text, ctx),
  routerExpand: (text: string) => ipcRenderer.invoke('router:expand', text),
  routerDownload: () => ipcRenderer.invoke('router:download'),
  onRouterStatus: (cb: (s: any) => void) => {
    const listener = (_e: any, s: any) => cb(s);
    ipcRenderer.on('router:status', listener);
    return () => ipcRenderer.removeListener('router:status', listener);
  },
  setYoutubeSkipAds: (on: boolean) => ipcRenderer.invoke('youtube:set-skip-ads', on),
  // Botão "Baixar" em cima do vídeo do YouTube: liga/desliga + os textos no idioma da UI.
  setYoutubeDlButton: (on: boolean, labels?: Record<string, string>) => ipcRenderer.invoke('youtube:set-dl-button', on, labels),
  cancelVideoDownload: (id: string) => ipcRenderer.invoke('media:cancel-video', id),
  retryVideoDownload: (id: string) => ipcRenderer.invoke('media:retry-video', id),
  // Downloads de vídeo que o Bah fechou no meio (sessão anterior) → voltam pra lista como eventos.
  takeInterruptedVideoDownloads: () => ipcRenderer.invoke('media:interrupted'),
  onTorrentEvent: (cb: (info: any) => void) => {
    const listener = (_e: any, info: any) => cb(info);
    ipcRenderer.on('agent:torrent-event', listener);
    return () => ipcRenderer.removeListener('agent:torrent-event', listener);
  },
  // Gerenciador de downloads (várias conexões): preferências e pasta dos downloads.
  getDownloadEngine: () => ipcRenderer.invoke('download:get-engine'),
  setDownloadEngine: (settings: Record<string, unknown>) => ipcRenderer.invoke('download:set-engine', settings),
  setDownloadDir: (dir: string | null) => ipcRenderer.invoke('download:set-dir', dir),
  chooseDownloadDir: () => ipcRenderer.invoke('download:choose-dir'),
  // Medidor do computador (barra de cima): liga/desliga a medição e recebe os números a cada 2 s.
  hwWatch: (on: boolean) => ipcRenderer.invoke('hw:watch', on),
  onHwStats: (cb: (s: any) => void) => {
    const listener = (_e: any, s: any) => cb(s);
    ipcRenderer.on('hw:stats', listener);
    return () => ipcRenderer.removeListener('hw:stats', listener);
  },
  pauseDownload: (id: string) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('download:cancel', id),
  retryDownload: (id: string, url?: string) => ipcRenderer.invoke('download:retry', id, url),
  openFile: (target: string) => ipcRenderer.invoke('download:open-file', target),
  machineInfo: () => ipcRenderer.invoke('machine:info'),
  downloadVideo: (url: string, audioOnly?: boolean, count?: number, quality?: 'best' | 'low') =>
    ipcRenderer.invoke('media:download-video', url, audioOnly, count, quality),
  resolveVideo: (query: string) => ipcRenderer.invoke('media:resolve-video', query),
  resolveVideos: (queries: string[]) => ipcRenderer.invoke('media:resolve-videos', queries),
  resolveManyVideos: (query: string, count: number) => ipcRenderer.invoke('media:resolve-many', query, count),
  searchVideoCuts: (phrase: string, count?: number) =>
    ipcRenderer.invoke('videocuts:search', phrase, count),
  getTranscript: (url: string) => ipcRenderer.invoke('media:transcript', url),
  renderView: (spec: object) => ipcRenderer.invoke('view:render', spec),
  harvestImages: (urls: string[], theme: string) => ipcRenderer.invoke('images:harvest', urls, theme),
  generateImage: (prompt: string, count?: number) => ipcRenderer.invoke('image:generate', prompt, count),
  revealInFolder: (target: string) => ipcRenderer.invoke('shell:reveal', target),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  suggest: (q: string, engine?: unknown) => ipcRenderer.invoke('suggest:query', q, engine),
  // Mecanismo de pesquisa escolhido (⋮) → main, pro "Pesquisar no … por" do clique direito.
  setSearchEngine: (setting: unknown, googleLocale: string) => ipcRenderer.send('search:set-engine', setting, googleLocale),
  // E2E: resultados fixos pro web_search do agente (só com NODE_ENV=test; senão null).
  e2eSearchResults: (q: string) => ipcRenderer.invoke('e2e:search-results', q),
  e2ePriceStores: () => ipcRenderer.invoke('e2e:price-stores'),
  e2eTakeoverTimeout: () => ipcRenderer.invoke('e2e:takeover-timeout'),
  // Watch/Takeover: abas esperando a pessoa; avisa quando ela mexe numa delas (clique/tecla de verdade).
  takeoverWatch: (wcIds: number[]) => ipcRenderer.invoke('takeover:watch', wcIds),
  onTakeoverInput: (cb: (wcId: number) => void) => {
    const listener = (_e: any, id: number) => cb(id);
    ipcRenderer.on('takeover:input', listener);
    return () => ipcRenderer.removeListener('takeover:input', listener);
  },
  appendDatasetRun: (run: unknown) => ipcRenderer.invoke('dataset:append-run', run),
  datasetInfo: () => ipcRenderer.invoke('dataset:info'),
  googleLogin: () => ipcRenderer.invoke('google:login'),
  googleSwitchAccount: () => ipcRenderer.invoke('google:switch-account'),
  siteLogin: (url: string) => ipcRenderer.invoke('site:login', url),
  googleCheckLogin: () => ipcRenderer.invoke('google:check-login'),
  clearGoogleCookies: () => ipcRenderer.invoke('cookies:clear-google'),
  preconnect: (url: string, incognito?: boolean) => ipcRenderer.invoke('net:preconnect', url, incognito === true),
  // Aba anônima: zera a sessão anônima (a última aba anônima fechou) e avisa quando a IA trabalha numa.
  incognitoWipe: () => ipcRenderer.invoke('incognito:wipe'),
  setPrivateAi: (on: boolean) => ipcRenderer.send('incognito:private-ai', on === true),
  // Cron-Agent: monitores em background
  monitorsList: () => ipcRenderer.invoke('monitors:list'),
  monitorAdd: (data: { url: string; condition: string; intervalMin: number; notify?: Array<'trigger'|'change'|'error'> }) => ipcRenderer.invoke('monitors:add', data),
  monitorUpdate: (id: string, patch: any) => ipcRenderer.invoke('monitors:update', id, patch),
  monitorRemove: (id: string) => ipcRenderer.invoke('monitors:remove', id),
  monitorRunNow: (id: string) => ipcRenderer.invoke('monitors:run-now', id),
  onMonitorsChanged: (cb: (list: any[]) => void) => {
    const listener = (_e: any, list: any[]) => cb(list);
    ipcRenderer.on('monitors:changed', listener);
    return () => ipcRenderer.removeListener('monitors:changed', listener);
  },
  onMonitorAlert: (cb: (info: { id: string; condition: string; value: string; url: string }) => void) => {
    const listener = (_e: any, info: any) => cb(info);
    ipcRenderer.on('monitor:alert', listener);
    return () => ipcRenderer.removeListener('monitor:alert', listener);
  },
  // Bandeja do sistema (fechar mantém rodando)
  trayGet: () => ipcRenderer.invoke('tray:get'),
  traySet: (enabled: boolean) => ipcRenderer.invoke('tray:set', enabled),
  // Atalhos de teclado estilo Chrome (vêm do menu/aceleradores no main).
  onShortcut: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on('app:shortcut', listener);
    return () => ipcRenderer.removeListener('app:shortcut', listener);
  },
  dismissOverlays: (wcId: number) => ipcRenderer.invoke('overlays:dismiss', wcId),
  pickDocument: () => ipcRenderer.invoke('file:pick-extract'),
  // Favoritos: importar (Chrome/Edge/arquivo HTML) e exportar pra HTML. O main só lê/grava arquivo.
  bookmarksSources: () => ipcRenderer.invoke('bookmarks:sources'),
  bookmarksImportBrowser: (id: string) => ipcRenderer.invoke('bookmarks:import-browser', id),
  bookmarksImportHtml: () => ipcRenderer.invoke('bookmarks:import-html'),
  bookmarksExport: (favs: Array<{ url: string; title: string }>) => ipcRenderer.invoke('bookmarks:export', favs),
  // Ícones dos favoritos (cache do main, buscados no próprio site): pede vários de uma vez;
  // os que ainda não tinha chegam depois pelo onFaviconsUpdated.
  faviconsGet: (origins: string[], peek?: boolean) => ipcRenderer.invoke('favicons:get', origins, peek === true),
  onFaviconsUpdated: (cb: (batch: Record<string, string | null>) => void) => {
    const listener = (_e: unknown, batch: Record<string, string | null>) => cb(batch);
    ipcRenderer.on('favicons:updated', listener);
    return () => ipcRenderer.removeListener('favicons:updated', listener);
  },
  // Imprimir… / Salvar como PDF… da aba ativa (wcId = webContents do <webview>).
  printPage: (wcId: number) => ipcRenderer.invoke('page:print', wcId),
  savePagePdf: (wcId: number) => ipcRenderer.invoke('page:save-pdf', wcId),
  // Limpar dados de navegação: caixas + período + sites do período. O main decide o que cada caixa apaga.
  clearBrowsingData: (req: { range: string; cookies: boolean; cache: boolean; origins: string[] }) => ipcRenderer.invoke('browsing-data:clear', req),
  // Resolve o caminho real de um arquivo arrastado (File → path) no Electron 33.
  getPathForFile: (file: File) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  stockMovers: (direction: string, count?: number) => ipcRenderer.invoke('stocks:movers', direction, count),
  onVideoProgress: (cb: (p: { state: string; percent?: number; title?: string; path?: string; error?: string; speed?: string; eta?: string }) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('agent:video-progress', listener);
    return () => ipcRenderer.removeListener('agent:video-progress', listener);
  },
  // Adblock controls
  adblockGetState: () => ipcRenderer.invoke('adblock:get-state'),
  adblockSetEnabled: (on: boolean) => ipcRenderer.invoke('adblock:set-enabled', on),
  adblockActiveHostChanged: (host: string) => ipcRenderer.invoke('adblock:active-host-changed', host),
  adblockSetAgentBusy: (busy: boolean) => ipcRenderer.invoke('adblock:set-agent-busy', busy),
  // Hardware acceleration (GPU) on/off — fixes "white tab" on weak GPUs; applied on restart
  getHwAccel: () => ipcRenderer.invoke('app:get-hw-accel'),
  setHwAccel: (on: boolean) => ipcRenderer.invoke('app:set-hw-accel', on),
  // Safe browsing notifications
  onSafeBrowsingBlock: (cb: (info: { url: string; host: string }) => void) => {
    const listener = (_e: any, info: any) => cb(info);
    ipcRenderer.on('safe-browsing-block', listener);
    return () => ipcRenderer.removeListener('safe-browsing-block', listener);
  },
  // alert/confirm das páginas (src/main/js-dialogs.ts): caixa do Bah e política do agente
  jsDialogRespond: (id: number, accept: boolean, text?: string) => ipcRenderer.invoke('jsdialog:respond', id, accept, text),
  jsDialogAgentTabs: (ids: number[]) => ipcRenderer.invoke('jsdialog:agent-tabs', ids),
  onJsDialog: (cb: (ev: { type: 'open' | 'closed' | 'left'; data: any }) => void) => {
    const o = (_e: any, d: any) => cb({ type: 'open', data: d }); const c = (_e: any, d: any) => cb({ type: 'closed', data: d }); const l = (_e: any, d: any) => cb({ type: 'left', data: d });
    ipcRenderer.on('jsdialog:open', o); ipcRenderer.on('jsdialog:closed', c); ipcRenderer.on('jsdialog:left', l);
    return () => { ipcRenderer.removeListener('jsdialog:open', o); ipcRenderer.removeListener('jsdialog:closed', c); ipcRenderer.removeListener('jsdialog:left', l); };
  },
  // OCR enrichment — runs Tesseract locally, returns plain text (no image to cloud).
  // frameDataUrl: optional PNG of a frame already captured, so OCR and the model agree.
  takeOcr: (wcId: number, domText: string, force?: boolean, frameDataUrl?: string) =>
    ipcRenderer.invoke('pipeline:take-ocr', wcId, domText, force ?? false, frameDataUrl),
});
