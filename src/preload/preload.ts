import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // AI
  setAIProvider: (provider: string, apiKey: string, baseUrl?: string) =>
    ipcRenderer.invoke('ai:set-provider', provider, apiKey, baseUrl),
  setUILanguage: (lang: string) => ipcRenderer.invoke('ai:set-lang', lang),
  onZoom: (cb: (pct: number) => void) => ipcRenderer.on('app:zoom', (_e, pct) => cb(pct)),
  aiChat: (message: string, pageContent?: string, stateless?: boolean, local?: boolean) =>
    ipcRenderer.invoke('ai:chat', message, pageContent, stateless, local),
  aiAction: (command: string, pageContent?: string, screenshot?: string, tier?: 'local' | 'flash' | 'pro') =>
    ipcRenderer.invoke('ai:action', command, pageContent, screenshot, tier),
  setLocalProvider: (provider: string, apiKey: string, baseUrl?: string, modelName?: string) =>
    ipcRenderer.invoke('ai:set-local-provider', provider, apiKey, baseUrl, modelName),
  // ── Gerenciador de modelos Ollama (modo local) ──
  ollamaList: (baseUrl?: string) => ipcRenderer.invoke('ollama:list', baseUrl),
  ollamaEnsureRunning: (baseUrl?: string) => ipcRenderer.invoke('ollama:ensure-running', baseUrl),
  ollamaPull: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:pull', model, baseUrl),
  ollamaPullCancel: () => ipcRenderer.invoke('ollama:pull-cancel'),
  ollamaDelete: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:delete', model, baseUrl),
  ollamaImportGguf: (name: string, ggufPath: string) => ipcRenderer.invoke('ollama:import-gguf', name, ggufPath),
  onOllamaPullProgress: (cb: (p: { model: string; status?: string; completed?: number; total?: number; percent?: number; done?: boolean; error?: string }) => void) => {
    const listener = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on('ollama:pull-progress', listener);
    return () => ipcRenderer.removeListener('ollama:pull-progress', listener);
  },
  onOpenNewTab: (cb: (url: string) => void) => {
    ipcRenderer.on('open-new-tab', (_e, url: string) => cb(url));
  },
  // Real OS-level input
  realClick: (wcId: number, x: number, y: number, backendNodeId?: number) =>
    ipcRenderer.invoke('input:click', wcId, x, y, backendNodeId),
  realType: (wcId: number, text: string) =>
    ipcRenderer.invoke('input:type', wcId, text),
  realKey: (wcId: number, key: string) =>
    ipcRenderer.invoke('input:key', wcId, key),
  // Accessibility tree via CDP
  getAxTree: (wcId: number) =>
    ipcRenderer.invoke('cdp:axtree', wcId),
  getNodeCoords: (wcId: number, backendNodeIds: number[]) =>
    ipcRenderer.invoke('cdp:node-coords', wcId, backendNodeIds),
  verifyClick: (wcId: number, backendNodeId: number) =>
    ipcRenderer.invoke('cdp:verify-click', wcId, backendNodeId),
  fillNode: (wcId: number, backendNodeId: number, value: string) =>
    ipcRenderer.invoke('cdp:fill-node', wcId, backendNodeId, value),
  downloadUrl: (url: string, filename?: string) =>
    ipcRenderer.invoke('download:url', url, filename),
  searchImages: (query: string, minWidth?: number, count?: number) =>
    ipcRenderer.invoke('images:search', query, minWidth, count),
  onDownloadEvent: (cb: (info: { state: string; filename: string; path?: string; bytes?: number; totalBytes?: number; reason?: string }) => void) =>
    ipcRenderer.on('agent:download-event', (_e, info) => cb(info)),
  downloadVideo: (url: string, audioOnly?: boolean, count?: number, quality?: 'best' | 'low') =>
    ipcRenderer.invoke('media:download-video', url, audioOnly, count, quality),
  resolveVideo: (query: string) => ipcRenderer.invoke('media:resolve-video', query),
  resolveVideos: (queries: string[]) => ipcRenderer.invoke('media:resolve-videos', queries),
  resolveManyVideos: (query: string, count: number) => ipcRenderer.invoke('media:resolve-many', query, count),
  searchVideoCuts: (phrase: string, count?: number) =>
    ipcRenderer.invoke('videocuts:search', phrase, count),
  renderView: (spec: object) => ipcRenderer.invoke('view:render', spec),
  harvestImages: (urls: string[], theme: string) => ipcRenderer.invoke('images:harvest', urls, theme),
  revealInFolder: (target: string) => ipcRenderer.invoke('shell:reveal', target),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  googleLogin: () => ipcRenderer.invoke('google:login'),
  // Atalhos de teclado estilo Chrome (vêm do menu/aceleradores no main).
  onShortcut: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on('app:shortcut', listener);
    return () => ipcRenderer.removeListener('app:shortcut', listener);
  },
  dismissOverlays: (wcId: number) => ipcRenderer.invoke('overlays:dismiss', wcId),
  makeSupercut: (phrase: string, count?: number) => ipcRenderer.invoke('media:make-supercut', phrase, count),
  // ── Editor de vídeo local (ffmpeg nativo) ──
  pickVideo: () => ipcRenderer.invoke('video:pick'),
  // Resolve o caminho real de um arquivo arrastado (File → path) no Electron 33.
  getPathForFile: (file: File) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  editTrim: (input: string, startSec: number, endSec: number) => ipcRenderer.invoke('videoedit:trim', input, startSec, endSec),
  editRemoveSilence: (input: string, opts?: { noiseDb?: number; minSilence?: number; pad?: number }) => ipcRenderer.invoke('videoedit:remove-silence', input, opts),
  editExtractAudio: (input: string) => ipcRenderer.invoke('videoedit:extract-audio', input),
  onVideoEditProgress: (cb: (p: { stage: string; message: string; percent?: number }) => void) => {
    const listener = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on('agent:videoedit-progress', listener);
    return () => ipcRenderer.removeListener('agent:videoedit-progress', listener);
  },
  onSupercutProgress: (cb: (p: any) => void) => {
    const listener = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on('agent:supercut-progress', listener);
    return () => ipcRenderer.removeListener('agent:supercut-progress', listener);
  },
  stockMovers: (direction: string, count?: number) => ipcRenderer.invoke('stocks:movers', direction, count),
  onVideoProgress: (cb: (p: { state: string; percent?: number; title?: string; path?: string; error?: string; speed?: string; eta?: string }) => void) =>
    ipcRenderer.on('agent:video-progress', (_e, p) => cb(p)),
  // Adblock controls
  adblockGetState: () => ipcRenderer.invoke('adblock:get-state'),
  adblockSetEnabled: (on: boolean) => ipcRenderer.invoke('adblock:set-enabled', on),
  adblockActiveHostChanged: (host: string) => ipcRenderer.invoke('adblock:active-host-changed', host),
  // Safe browsing notifications
  onSafeBrowsingBlock: (cb: (info: { url: string; host: string }) => void) =>
    ipcRenderer.on('safe-browsing-block', (_e, info) => cb(info)),
  // OCR enrichment — runs Tesseract locally, returns plain text (no image to cloud)
  takeOcr: (wcId: number, domText: string, force?: boolean) =>
    ipcRenderer.invoke('pipeline:take-ocr', wcId, domText, force ?? false),
});
