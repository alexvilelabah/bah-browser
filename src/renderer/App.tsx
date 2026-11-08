import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import AgentVisualOverlay, { AgentVisualState, ClickRipple } from './components/AgentVisualOverlay';
import { AppGuideBar, BeginnerTour } from './components/AppGuide';
import { prefetchGpuInfo, gpuInfo, gpuIsLoaded } from './gpu-info';
import TorrentSheet, { TorrentSheetData } from './components/TorrentSheet';
import { useTabStore } from './store';
import { getPerm, setPerm, nextMode, applyAnswer, type PermKind, type PermAnswer } from './agent-permissions';
import TabBar, { type TabCommand, type SessionCommand } from './components/TabBar';
import { useSiteMute } from './site-mute';
import { closeOthersIds, closeRightIds, nextActiveAfterClose } from '../shared/tab-strip';
import AddressBar from './components/AddressBar';
import AgentCommandBar, { AgentProgressEvent } from './components/AgentCommandBar';
import HwMonitor from './components/HwMonitor';
import DownloadButtonIcon from './components/DownloadButtonIcon';
import { commandHasFollowUp, commandWantsSeveralFiles, isMediaCollectionRequest, collectionWantsAudioOnly, listItems, collectionSubject, collectionQuery, subjectYear, isTopNCollection, collectionCount, topNListPrompt, parseTopNList } from './download-steps';
import { codecReport } from '../shared/media-codecs';
import { classifyRisk, riskForAction, socialActionToBlock, RiskInfo } from './risk';
import { paceDelay, recordHit, backoff, isBackedOff, hostOf as paceHostOf, BOT_CHECK_RE } from './pacing';
import { runHandoff, classifyWebview, setHumanCheckFlag, humanCheckFlag } from './takeover-driver';
import { TAKEOVER_TIMEOUT_MS, guardAgentAction, type TakeoverOutcome } from '../shared/takeover';
import { classifyHumanCheck, HUMAN_CHECK_SIGNALS_JS, type HumanCheckKind, type HumanCheckVerdict } from '../shared/human-check';
import { isCarefulHost, CAREFUL_ALLOWED } from './careful-sites';
import {
  promptBlock as threadPromptBlock, estimateTokens as estimateThreadTokens, noteTask as noteThreadTask,
  noteFact as noteThreadFact, noteUsage as noteContextUsage, noteTrimmed as noteThreadTrimmed,
  contextWindow as contextWindowNow, setContextWindow, usageOf as contextUsageOf,
} from './threads';
import { meterState } from '../shared/context-meter';
import { ENGINES, engineOrder, engineForUrl, markBlocked, agentSearchLine, SEARCH_BLOCK_RE, preferredEngine, setPreferredEngine, type EngineId } from './search-engines';
import { namesStore } from './stores';
import { commandIsGrocery, parseGroceryList, GROCERY_TILES_SCRIPT, CART_PAGE_SCRIPT, formatProductTiles, formatCartPage, formatListProgress, offListAdd, searchBoxRef, nextListItem, cartFinishProblem, type ProductTile, type CartPage } from './grocery';
import { namedSiteHint, localeCountry } from './known-sites';
import { isPriceComparison, priceCompareQuery, pickStores, unknownNamedStores, storeSearchUrl, blockedReason, BOT_CHECK_REASON, HUMAN_CHECK_REASON, pageSnippets, readPricePrompt, parseReadReply, checkRead, titleMatchesQuery, looksLikeAccessory, isStoreSource, compareTableSpec, compareSummary, type PriceRow, type PriceStore } from './price-compare';
import { collectHtmlScript, serializeHtml, selectorNotFoundMessage, pageHtmlBlock, type CollectResult } from '../shared/html-clean';
import { readBudget, resolveReadMax, pageText as pageOfText, pageTextBlock, pastEndMessage, rangeLine, nextCall, type PageInfo } from '../shared/read-paging';
import { matchControl, pickOverlay, type PageControl, type OverlayCandidate } from '../shared/page-controls';
import { machineProfile, machineLine, checkBuild, isDownloadControl, installerFileOf, thirdPartyDownloadSite, thirdPartyNote, signInWall, type MachineInput, type MachineProfile } from '../shared/software-download';
import { stripTrackingParams } from '../main/tracking-params';
import { speak, stopSpeaking, isSpeaking } from './tts';
import { t, onLangChange, getLang, googleLocaleParams, uiLangName } from './i18n';
import WebViewContainer from './components/WebViewContainer';
import PermissionPrompt, { type SitePermAsk } from './components/PermissionPrompt';
import PasswordSavePrompt from './components/PasswordSavePrompt';
import { JsDialogHost } from './components/JsDialogHost';
import { matchRole } from '../shared/role-target';
import { agentDialogsStart, agentDialogsStop, agentDialogsTab, armDialog, drainDialogLog } from './js-dialogs';
import PasswordSuggest from './components/PasswordSuggest';
import PasswordsPanel from './components/PasswordsPanel';
import type { PasswordsBridge, PwOffer, PwSuggest } from '../shared/password-types';
import MonitorsPanel from './components/MonitorsPanel';
import { ScheduledTasksPanel, MissedRunsCard } from './components/ScheduledTasksPanel';
import { useScheduler } from './scheduler';
import ClearDataDialog, { type ClearChoice } from './components/ClearDataDialog';
import { keepDownloads, originsVisited, rangeSince, splitHistory, type TimeRange } from '../shared/clear-data';
import ExtensionsToolbar, { type ExtensionInfo } from './components/ExtensionsToolbar';
import SearchEngineMenu from './components/SearchEngineMenu';
import StartupMenu from './components/StartupMenu';
import ChatHistoryPanel from './components/ChatHistoryPanel';
import MemorySaverMenu from './components/MemorySaverMenu';
import {
  cheapKeepReason, signalKeepReason, isShownReason, idleMsFor, sanitizeLevel, sanitizeKeepList, PAGE_SIGNALS_SCRIPT,
  type KeepReason, type MemSaverLevel, type SweepCtx, type TabSignals,
} from '../shared/memory-saver';
import DefaultBrowserMenu from './components/DefaultBrowserMenu';
import { searchUrlFor, isNewTabPage, onSearchEngineChange, syncSearchEngineToMain } from './search-engine';
import { isAboutLastRun, reportsIncompleteRun } from './last-run';
import { parseRoute, routeToIntent, type RoutedIntent, type RouteContext, type RouterStatus } from '../shared/router-routes';
import { shouldExpandRequest, understoodNote } from '../shared/request-expansion';
import BookmarksBar from './components/BookmarksBar';
import SiteIcon from './components/SiteIcon';
import IncognitoPage from './components/IncognitoPage';
import { isIncognitoBlank, mayRecord, opensIncognito } from '../shared/incognito';
import { incognitoReady, setAiIncognitoProbe } from './incognito';
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
  STICKY_VISION_REASONS,
  VISION_MAX_SIDE,
  VISION_AGENT_MAX_SIDE,
  defaultVisionMode,
  VISION_MIN_SIDE,
  base64Head,
  decideAgentShot,
  decideChatShot,
  encodedImageSize,
  looksLikeTextReadIntent,
  mapShotPointToViewport,
  resolveVisionMode,
  type VisionImage,
  type VisionMode,
} from '../shared/vision';
import {
  buildKnownSitesBlock,
  detectQuickAction,
  getInitialShortcutAction,
  commandHasExplicitUrl,
  pointsAtOpenScreen,
  isTaskDataAction,
  rememberActionForSite,
  rememberObservedSite,
  type QuickAction,
} from './site-knowledge';
import { wantsTabsSummary, wantsWakeTabs, selectTabsForSummary, tabsAccessDecision, buildTabsSummaryPrompt, parseTabsSummary, type TabText } from './tabs-summary';
import { loadLastMacro, parseRepeatIntent, saveLastMacro, toDurableAction } from './macros';
import { costOf, fmtUsd } from './pricing';
import {
  AgentRecoveryManager,
  recoveryInstruction,
} from './agent-recovery';
import {
  detectManualHelpNeed,
  commandLikelyNeedsAccount,
  noteAccountState,
  accountStateLine,
  manualHelpHistoryNote,
  type ManualHelpRequest,
} from './agent-login-policy';
import {
  appendAgentRunStep,
  finishAgentRun,
  setRunError,
  startAgentRun,
  summarizeAction,
  summarizeResult,
} from './agent-run-logger';
import { createDeadline } from './task-deadline';
import { classifySelfEval, nextSelfFailCount } from '../shared/self-eval';
import { mergeFavorites, MAX_FAVORITES, type FlatBookmark } from '../shared/bookmarks';
import { selectSkills, formatSkillsBlock, validateSkill, SKILL_STATES, SKILL_TASKS, SKILL_MAX_WORDS, type Skill } from '../shared/skills';

// Quantos favoritos desenhar na barra e no menu ⋮ (a lista inteira continua no autocomplete).
// Barra: os primeiros 100 (o que não cabe na largura vai pro "»"). ⋮ → Favoritos: os primeiros 150.
const FAV_BAR_MAX = 100;
const FAV_MENU_MAX = 150;
// Atalho do "Imprimir…" como o sistema escreve (dica do item no menu ⋮).
const BOOKMARK_KEY = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform || '' : '') ? '⌘D' : 'Ctrl+D';
const PRINT_KEY = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform || '' : '') ? '⌘P' : 'Ctrl+P';
// Atalho da "Nova aba anônima" (o da janela anônima do Chrome).
const INCOGNITO_KEY = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform || '' : '') ? '⇧⌘N' : 'Ctrl+Shift+N';
// Atalho do Limpar dados de navegação, como no Chrome (no Mac a tecla "delete" é o Backspace).
const CLEAR_DATA_KEY = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform || '' : '') ? '⇧⌘⌫' : 'Ctrl+Shift+Delete';

declare global {
  interface Window {
    electronAPI?: {
    gpuInfo?: () => Promise<any>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      setAIProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) => Promise<any>;
      encryptSecret?: (t: string) => Promise<string>;
      decryptSecretSync?: (t: string) => string;
      setUILanguage?: (lang: string) => Promise<any>;
      setSearchEngine?: (setting: { id: string; custom?: string }, googleLocale: string) => void;
      e2eSearchResults?: (q: string) => Promise<Array<{ title: string; snippet: string; url: string }> | null>;
      e2ePriceStores?: () => Promise<PriceStore[] | null>;
      e2eTakeoverTimeout?: () => Promise<number | null>;
      takeoverWatch?: (wcIds: number[]) => Promise<boolean>;
      onTakeoverInput?: (cb: (wcId: number) => void) => () => void;
      onZoom?: (cb: (pct: number) => void) => void;
      setLocalProvider?: (provider: string, apiKey: string, baseUrl?: string, modelName?: string, opts?: { contextMode?: 'auto' | 'custom'; contextTokens?: number; maxOutputTokens?: number; ollamaNumCtx?: 'auto' | number; vision?: boolean; visionMode?: VisionMode }) => Promise<any>;
      localDiscover?: (provider: string, baseUrl?: string, authKey?: string) => Promise<{ ok: boolean; models: Array<{ id: string; loaded?: boolean; vision: string; contextTokens?: number; contextSource?: string; unsuitable?: string }>; error?: string }>;
      localContext?: (provider: string, baseUrl?: string, model?: string, authKey?: string) => Promise<{ ok: boolean; tokens?: number; source: string; error?: string }>;
      localTestConnection?: (baseUrl?: string, authKey?: string) => Promise<{ ok: boolean; reachable: boolean; modelsFound: number; error?: string }>;
      localTestModel?: (provider: string, baseUrl?: string, model?: string, authKey?: string) => Promise<{ ok: boolean; ms?: number; reply?: string; error?: string }>;
      setLocalEnabled?: (enabled: boolean) => Promise<boolean>;
      setLocalWarmup?: (on: boolean) => Promise<boolean>;
      llmList?: (baseUrl?: string, provider?: string, authKey?: string) => Promise<any>;
      llmStatus?: (baseUrl?: string, authKey?: string) => Promise<{ running: boolean; installed: boolean; backend: string }>;
      aiChat: (message: string, pageContent?: string, stateless?: boolean, local?: boolean, tabId?: string, rawContext?: string, streamId?: string, image?: VisionImage, thread?: string | { text: string; keepDoc?: boolean }) => Promise<{ response?: string; error?: string; ctx?: { system: number } }>;
      contextWindow?: (local?: boolean) => Promise<{ tokens: number; source: string } | null>;
      // Conversas do assistente (main/chat-store.ts, cifradas no disco).
      threadsLoadLiveSync?: () => unknown;
      threadsSaveLive?: (payload: unknown) => void;
      threadsClearLive?: () => Promise<{ ok: boolean }>;
      chatHistoryList?: () => Promise<{ rows: import('../shared/chat-history').ChatHistoryRow[]; available: boolean }>;
      chatHistoryGet?: (id: string) => Promise<import('../shared/chat-history').ChatHistoryEntry | null>;
      chatHistoryDelete?: (id: string) => Promise<{ ok: boolean }>;
      chatHistoryClear?: (since: number | null) => Promise<{ ok: boolean }>;
      onChatDelta?: (cb: (p: { streamId: string; delta: string }) => void) => () => void;
      onActionDelta?: (cb: (m: { kind: 'thinking' | 'answer'; estTokens: number; tokPerSec: number; elapsedMs: number; exact: boolean }) => void) => () => void;
      clearChatHistory?: (tabId?: string) => Promise<any>;
      moveChatHistory?: (from: string, to: string) => Promise<any>;
      // Continuar de onde parou: o main pede pra gravar as abas antes de fechar a janela; a tela
      // pede pra mandar o localStorage pro disco já quando a sessão muda (renderer/session.ts).
      onSaveSessionNow?: (cb: () => void) => (() => void);
      flushUiStorage?: () => void;
      aiAction: (command: string, pageContent?: string, screenshot?: VisionImage, tier?: 'local' | 'flash' | 'pro', actionId?: string) => Promise<{
        action?: any; actions?: any[]; thought?: string; error?: string;
        /** Machine-readable failure (shared/error-codes.ts) — the renderer decides on this. */
        errorCode?: string; errorRetryable?: boolean; errorDetail?: Record<string, unknown>;
        [k: string]: any;
      }>;
      actionCancel?: (actionId: string) => Promise<any>;
      onOpenNewTab?: (cb: (url: string, opts?: { incognito?: boolean }) => void) => void;
      onOutsideOpen?: (cb: (p: { url: string; noScript: boolean; launch: boolean }) => void) => (() => void);
      outsideOpenReady?: () => void;
      defaultBrowserStatus?: () => Promise<{ platform: 'win32' | 'darwin' | 'other'; packaged: boolean; isDefault: boolean }>;
      defaultBrowserMake?: () => Promise<{ ok: true; alreadyDefault?: boolean; openedSettings?: boolean } | { ok: false; error: string }>;
      incognitoWipe?: () => Promise<boolean>;
      setPrivateAi?: (on: boolean) => void;
      onTabAudio?: (cb: (p: { wcId: number; audible: boolean }) => void) => (() => void);
      memSaverSignals?: (wcIds: number[]) => Promise<Record<number, { capture?: boolean; notifications?: boolean; download?: boolean }>>;
      onSitePermissionAsk?: (cb: (p: SitePermAsk) => void) => (() => void);
      onSitePermissionCancel?: (cb: (id: string) => void) => (() => void);
      answerSitePermission?: (id: string, answer: 'allow' | 'block' | 'dismiss') => Promise<any>;
      listSitePermissions?: (url: string) => Promise<{ origin: string; perms: Record<string, 'allow' | 'block'> }>;
      setSitePermission?: (url: string, kind: string, value: 'allow' | 'block' | null) => Promise<{ ok: boolean; perms?: Record<string, 'allow' | 'block'> }>;
      resetSitePermissions?: (url: string) => Promise<any>;
      passwords?: PasswordsBridge;
      getExtensionsState?: () => Promise<ExtensionInfo[]>;
      onExtensionsState?: (cb: (list: ExtensionInfo[]) => void) => (() => void);
      onExtensionOpenTab?: (cb: (p: { reqId: number; url: string; active: boolean }) => void) => (() => void);
      extensionTabOpened?: (reqId: number, wcId: number) => Promise<boolean>;
      onExtensionCloseTab?: (cb: (p: { wcId: number }) => void) => (() => void);
      extensionActionClick?: (extId: string, wcId: number | null, anchor: { left: number; top: number; right: number; bottom: number }) => Promise<{ ok: boolean; popup?: boolean; disabled?: boolean }>;
      removeExtension?: (extId: string) => Promise<{ ok: boolean; error?: string }>;
      setExtensionEnabled?: (extId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string; quiet?: boolean }>;
      openExtensionStore?: () => Promise<{ ok: boolean }>;
      openExtensionOptions?: (extId: string) => Promise<{ ok: boolean }>;
      torrentAdd?: (uri: string) => Promise<{ ok: boolean; id?: string; name?: string; files?: Array<{ index: number; name: string; length: number }>; error?: string }>;
      torrentPlay?: (id: string, index: number) => Promise<{ ok: boolean; url?: string; error?: string }>;
      torrentSaveFile?: (id: string, index: number) => Promise<{ ok: boolean; dest?: string; blocked?: boolean }>;
      torrentRemove?: (id: string, destroyStore?: boolean) => Promise<{ ok: boolean }>;
      torrentSetSeed?: (on: boolean) => Promise<{ ok: boolean; seed: boolean }>;
      torrentSetBuiltin?: (on: boolean) => Promise<{ ok: boolean; builtin: boolean }>;
      torrentOpen?: (uri: string) => Promise<{ ok: boolean }>;
      routerStatus?: () => Promise<RouterStatus & { rss?: number }>;
      routerClassify?: (text: string, ctx?: RouteContext) => Promise<{ route: string; ms: number } | null>;
      routerExpand?: (text: string) => Promise<{ expanded: string; ms: number } | null>;
      routerDownload?: () => Promise<{ ok: boolean; error?: string }>;
      onRouterStatus?: (cb: (s: RouterStatus) => void) => (() => void);
      setYoutubeSkipAds?: (on: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
      setYoutubeDlButton?: (on: boolean, labels?: Record<string, string>) => Promise<{ ok: boolean; enabled: boolean }>;
      cancelVideoDownload?: (id: string) => Promise<any>;
      retryVideoDownload?: (id: string) => Promise<any>;
      takeInterruptedVideoDownloads?: () => Promise<number>;
      onTorrentEvent?: (cb: (info: any) => void) => (() => void);
      realClick?: (wcId: number, x: number, y: number, backendNodeId?: number) => Promise<any>;
      realType?: (wcId: number, text: string) => Promise<any>;
      abortTyping?: () => Promise<any>;
      realKey?: (wcId: number, key: string) => Promise<any>;
      inspect?: (wcId: number, target: any) => Promise<{ ok: boolean; state?: any; error?: string }>;
      keyState?: (wcId: number, key: string, down: boolean) => Promise<any>;
      insertText?: (wcId: number, text: string) => Promise<any>;
      skillsList?: () => Promise<Skill[]>;
      skillsSave?: (markdown: string) => Promise<{ ok: boolean; name?: string; path?: string; error?: string }>;
      skillsOpenFolder?: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      openExternal?: (url: string) => Promise<{ success: boolean; error?: string }>;
      frameClick?: (wcId: number, key: string, id: number) => Promise<any>;
      frameFill?: (wcId: number, key: string, id: number, value: string) => Promise<{ ok: boolean; value?: string; error?: string }>;
      getFramesAx?: (wcId: number) => Promise<{ ok: boolean; frames: Array<{ key: string; label: string; nodes: any[] }> }>;
      getFramesCoords?: (wcId: number, key: string, ids: number[]) => Promise<{ ok: boolean; coords: Record<number, { x: number; y: number; w: number; h: number } | null> }>;
      markRefs?: (wcId: number, attr: string, marks: Array<{ ref: number; backendNodeId?: number; x?: number; y?: number }>) => Promise<{ ok: boolean; marked?: number; error?: string }>;
      getAxTree?: (wcId: number) => Promise<any>;
      getNodeCoords?: (wcId: number, backendNodeIds: number[]) => Promise<any>;
      savePdf?: (wcId: number, name?: string) => Promise<any>;
      pageScreenshot?: (wcId: number, full: boolean, name?: string) => Promise<any>;
      clipboardReadText?: () => Promise<string>;
      clipboardWriteText?: (text: string) => Promise<any>;
      verifyClick?: (wcId: number, backendNodeId: number) => Promise<{ ok?: boolean; stale?: boolean; covered?: boolean; covering?: string; x?: number; y?: number; error?: string }>;
      pointer?: (wcId: number, op: { kind: 'hover' | 'dblclick' | 'drag' | 'focus'; x: number; y: number; x2?: number; y2?: number; backendNodeId?: number }) => Promise<{ success: boolean; error?: string }>;
      selectOption?: (wcId: number, backendNodeId: number, option: string) => Promise<{ ok: boolean; selected?: string; options?: string[]; error?: string }>;
      uploadGrantFolder?: () => Promise<{ ok: boolean; canceled?: boolean; folder?: string }>;
      uploadGrants?: () => Promise<Array<{ folder: string; path: string }>>;
      uploadRevokeAll?: () => Promise<any>;
      uploadListFiles?: () => Promise<{ ok: boolean; files: Array<{ file: string; size: number; modified: string }> }>;
      uploadReadFile?: (file: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      uploadTokenFor?: (files: string[]) => Promise<{ ok: boolean; token?: string; names?: string[]; error?: string }>;
      uploadPick?: (opts: { multiple?: boolean; title?: string }) => Promise<{ ok: boolean; canceled?: boolean; token?: string; names?: string[]; sizes?: number[] }>;
      uploadSet?: (wcId: number, backendNodeId: number | null, token: string, at?: { x: number; y: number }) => Promise<{ ok: boolean; names?: string[]; accept?: string; dropped?: number; error?: string }>;
      fillNode?: (wcId: number, backendNodeId: number, value: string) => Promise<{ ok?: boolean; error?: string }>;
      waitNetworkIdle?: (wcId: number, idleMs: number, timeoutMs: number) => Promise<{ ok: boolean; waitedMs?: number; error?: string }>;
      downloadUrl?: (url: string, filename?: string) => Promise<{ success: boolean; info?: { id?: string; path: string; bytes?: number; totalBytes?: number; contentType?: string; background?: boolean }; error?: string }>;
      searchImages?: (query: string, minWidth?: number, count?: number) => Promise<{ success: boolean; count?: number; images: Array<{ url: string; thumbnail?: string; width: number; height: number; title: string; source: string; license: string }>; error?: string }>;
      onDownloadEvent?: (cb: (info: { id?: string; state: string; filename: string; path?: string; url?: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number | null; paused?: boolean; reason?: string; reasonCode?: string; kind?: string; engine?: boolean; connections?: number; map?: number[][]; notify?: boolean; stalled?: boolean; stalledForSec?: number; vcodec?: string; acodec?: string }) => void) => void;
      getDownloadEngine?: () => Promise<DlEngineSettings>;
      setDownloadEngine?: (settings: DlEngineSettings) => Promise<DlEngineSettings>;
      setDownloadDir?: (dir: string | null) => Promise<string>;
      chooseDownloadDir?: () => Promise<string | null>;
      pauseDownload?: (id: string) => Promise<any>;
      resumeDownload?: (id: string) => Promise<any>;
      cancelDownload?: (id: string) => Promise<any>;
      retryDownload?: (id: string, url?: string) => Promise<any>;
      openFile?: (target: string) => Promise<any>;
      machineInfo?: () => Promise<MachineInput>;
      getTranscript?: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      downloadVideo?: (url: string, audioOnly?: boolean, count?: number, quality?: 'best' | 'low') => Promise<{ success: boolean; path?: string; paths?: string[]; title?: string; error?: string; reason?: string; warning?: string }>;
      resolveVideo?: (query: string) => Promise<{ ok: boolean; url?: string; id?: string; title?: string; error?: string }>;
      resolveVideos?: (queries: string[]) => Promise<Array<{ query: string; id?: string; title?: string }>>;
      resolveManyVideos?: (query: string, count: number) => Promise<{ ok: boolean; videos: Array<{ id: string; title: string; url: string }>; error?: string }>;
      searchVideoCuts?: (phrase: string, count?: number) => Promise<{ success: boolean; cuts: Array<{ videoId: string; seconds: number; title?: string }>; source?: string; error?: string }>;
      renderView?: (spec: object) => Promise<{ success: boolean; url?: string; error?: string }>;
      harvestImages?: (urls: string[], theme: string) => Promise<{ success: boolean; saved: number; dir?: string; paths?: string[]; error?: string }>;
      generateImage?: (prompt: string, count?: number) => Promise<{ success: boolean; saved: number; dir?: string; paths?: string[]; error?: string }>;
      revealInFolder?: (target: string) => Promise<{ success: boolean; error?: string }>;
      googleLogin?: () => Promise<{ ok: boolean; copied?: number; browser?: string; error?: string }>;
      googleSwitchAccount?: () => Promise<{ ok: boolean; copied?: number; browser?: string; error?: string }>;
      siteLogin?: (url: string) => Promise<{ ok: boolean; copied?: number; domain?: string; browser?: string; error?: string }>;
      googleCheckLogin?: () => Promise<{ loggedIn: boolean }>;
      clearGoogleCookies?: () => Promise<{ ok: boolean; cleared?: number; error?: string }>;
      monitorsList?: () => Promise<any[]>;
      monitorAdd?: (data: { url: string; condition: string; intervalMin: number }) => Promise<any>;
      monitorUpdate?: (id: string, patch: any) => Promise<boolean>;
      monitorRemove?: (id: string) => Promise<boolean>;
      monitorRunNow?: (id: string) => Promise<boolean>;
      onMonitorsChanged?: (cb: (list: any[]) => void) => () => void;
      onMonitorAlert?: (cb: (info: { id: string; condition: string; value: string; url: string }) => void) => () => void;
      trayGet?: () => Promise<{ enabled: boolean }>;
      traySet?: (enabled: boolean) => Promise<{ enabled: boolean }>;
      onShortcut?: (cb: (action: string) => void) => (() => void) | void;
      dismissOverlays?: (wcId: number) => Promise<{ dismissed: string }>;
      pickDocument?: () => Promise<{ ok: boolean; name?: string; text?: string; error?: string } | null>;
      bookmarksSources?: () => Promise<Array<{ id: 'chrome' | 'edge'; name: string }>>;
      bookmarksImportBrowser?: (id: string) => Promise<{ ok: true; items: FlatBookmark[]; profile?: string } | { ok: false; error: string }>;
      bookmarksImportHtml?: () => Promise<{ ok: true; items: FlatBookmark[] } | { ok: false; error: string }>;
      bookmarksExport?: (favs: FlatBookmark[]) => Promise<{ ok: true; count: number; file: string } | { ok: false; error: string }>;
      faviconsGet?: (origins: string[], peek?: boolean) => Promise<Record<string, string | null>>;
      onFaviconsUpdated?: (cb: (batch: Record<string, string | null>) => void) => () => void;
      printPage?: (wcId: number) => Promise<{ ok: true } | { ok: false; error: string }>;
      savePagePdf?: (wcId: number) => Promise<{ ok: true; file?: string; path?: string; downloaded?: boolean } | { ok: false; error: string }>;
      clearBrowsingData?: (req: { range: TimeRange; cookies: boolean; cache: boolean; origins: string[] }) => Promise<{ ok: true } | { ok: false; error: string }>;
      getPathForFile?: (file: File) => string;
      stockMovers?: (direction: string, count?: number) => Promise<{ success: boolean; spec?: any; error?: string }>;
      onVideoProgress?: (cb: (p: { state: string; percent?: number; title?: string; path?: string; error?: string; speed?: string; eta?: string }) => void) => void;
      adblockGetState?: () => Promise<{ enabled: boolean; active: boolean; bypassedHosts: string[] }>;
      adblockSetEnabled?: (on: boolean) => Promise<{ enabled: boolean }>;
      adblockActiveHostChanged?: (host: string) => Promise<{ active: boolean }>;
      adblockSetAgentBusy?: (busy: boolean) => Promise<{ active: boolean }>;
      getHwAccel?: () => Promise<{ enabled: boolean }>;
      setHwAccel?: (on: boolean) => Promise<{ ok: boolean; enabled?: boolean }>;
      onSafeBrowsingBlock?: (cb: (info: { url: string; host: string }) => void) => void;
      schedList?: () => Promise<{ tasks: import('../shared/schedule').ScheduledTask[]; available: boolean }>;
      schedSave?: (list: import('../shared/schedule').ScheduledTask[]) => Promise<{ ok: boolean; tasks: import('../shared/schedule').ScheduledTask[] }>;
      schedClock?: () => Promise<{ offset: number; test: boolean }>;
      schedNotify?: (n: { title: string; body: string; taskId?: string }) => Promise<{ ok: boolean }>;
      onSchedFocus?: (cb: (taskId: string) => void) => () => void;
      jsDialogRespond?: (id: number, accept: boolean, text?: string) => Promise<any>;
      jsDialogAgentTabs?: (ids: number[]) => Promise<any>;
      onJsDialog?: (cb: (ev: { type: 'open' | 'closed' | 'left'; data: any }) => void) => () => void;
      takeOcr?: (wcId: number, domText: string, force?: boolean, frameDataUrl?: string) => Promise<{
        ocrText: string; ocrUsed: boolean; skipped: boolean;
        confidence?: number; screenshotPath?: string; durationMs?: number; error?: string;
      }>;
    };
  }
}

/** Just the local-endpoint tuning the main process needs (context / output / vision). */
function localOptsForMain(ls: { contextMode?: 'auto' | 'custom'; contextTokens?: number; maxOutputTokens?: number; ollamaNumCtx?: 'auto' | number; vision?: boolean; visionMode?: VisionMode }) {
  return {
    contextMode: ls.contextMode ?? 'auto',
    contextTokens: ls.contextTokens,
    maxOutputTokens: ls.maxOutputTokens,
    ollamaNumCtx: ls.ollamaNumCtx,
    vision: ls.vision === true,
    visionMode: resolveVisionMode(ls),
  };
}

/** Página do próprio buscador (resultado/ajuda), que nunca serve de fonte de uma resposta. */
function isSearchEnginePage(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (/^search\.google$|(^|\.)google\.[a-z.]+$/.test(h) && (h === 'search.google' || /^\/(search|url|webhp)\b/.test(u.pathname))) return true;
    if (/(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|search\.brave\.com|yandex\.[a-z]+|ecosia\.org|startpage\.com)$/.test(h) && (/\/(search|html)\b/.test(u.pathname) || u.searchParams.has('q'))) return true;
    return false;
  } catch { return false; }
}

export default function App() {
  const store = useTabStore();
  // A aba que a pessoa está vendo é anônima (selo na barra, extensões e "Entrar…" apagados).
  const activeIncognito = !!store.activeTab?.incognito;
  const webviewRefs = useRef<Map<string, Electron.WebviewTag>>(new Map());
  // "Desativar som do site" (menu da aba): mudo em todas as abas do site, salvo entre sessões.
  const siteMute = useSiteMute(store.tabs, webviewRefs);
  const [agentVisual, setAgentVisual] = useState<AgentVisualState>('idle');
  // Live tokens/sec from the engine, shown while the agent works.
  const [liveMetrics, setLiveMetrics] = useState<{ kind: 'thinking' | 'answer'; estTokens: number; tokPerSec: number; elapsedMs: number; exact: boolean } | null>(null);
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const rippleId = useRef(0);
  const activeTabIdRef = useRef(store.activeTabId);
  const userTabRef = useRef(store.activeTabId);   // a aba que o USUÁRIO está vendo (sempre atualizada)
  const taskRunningRef = useRef(false);           // tem uma tarefa do agente rodando agora?
  // Mudou de ideia no meio: mensagem enviada com a tarefa rodando entra AQUI. O passo em
  // andamento é cortado (a IA para de pensar na hora — llama.cpp/Ollama param quando a
  // conexão cai) e o laço refaz o passo com a mensagem no histórico. A IA decide o resto:
  // continuar ajustado, mudar de rumo ou encerrar (nada de palavra-chave: "para" também é
  // "para mim"). O Stop continua sendo o freio de verdade.
  const interjectRef = useRef<{ running: boolean; queue: string[]; abortStep: (() => void) | null }>({ running: false, queue: [], abortStep: null });
  const interjectToAgent = useCallback((msg: string): boolean => {
    const r = interjectRef.current;
    if (!r.running || !msg.trim()) return false;
    r.queue.push(msg.trim());
    try { r.abortStep?.(); } catch {}
    return true;
  }, []);
  const takeUnreadInterjections = useCallback((): string[] => (
    interjectRef.current.running ? [] : interjectRef.current.queue.splice(0)
  ), []);
  // Live tokens/sec from the engine (ai:action-delta). Cleared on idle so a stale number
  // never shows on the next step.
  useEffect(() => {
    prefetchGpuInfo();
    if (agentVisual === 'idle') { setLiveMetrics(null); return; }
    const off = window.electronAPI?.onActionDelta?.((m) => { if (m?.kind) setLiveMetrics(m); });
    return () => { try { off?.(); } catch {} };
  }, [agentVisual]);
  useEffect(() => {
    userTabRef.current = store.activeTabId;
    // Enquanto uma tarefa roda, a "aba de trabalho" do agente é controlada pelo PRÓPRIO loop
    // (ele seta activeTabIdRef ao abrir/navegar). Se o usuário trocar de aba no meio, NÃO deixa
    // isso sequestrar a aba do agente — senão ele passaria a clicar/observar na aba errada.
    if (!taskRunningRef.current) activeTabIdRef.current = store.activeTabId;
  }, [store.activeTabId]);
  // #12: o loop do agente é uma closure longa — `store.tabs` capturado no render fica
  // DEFASADO se o agente abre/fecha abas durante a execução. Espelhamos a lista viva
  // num ref pra switch_tab/close_tab/contexto do modelo lerem o estado atual, não o velho.
  const tabsRef = useRef(store.tabs);
  useEffect(() => { tabsRef.current = store.tabs; }, [store.tabs]);

  // ── Aba anônima (regras em shared/incognito.ts) ──
  // A aba que a pessoa está vendo é anônima? (o que ela abre dali — favorito em aba nova — também é)
  const userOnIncognito = useCallback(() => !!tabsRef.current.find(t => t.id === userTabRef.current)?.incognito, []);
  // A IA está trabalhando numa aba anônima? (a tarefa começou numa, ou a aba de trabalho dela é
  // anônima) → o que ela abrir nasce anônimo e nada do que ela vê fica guardado (site-knowledge,
  // "repetir", registro das tarefas: renderer/incognito.ts).
  const privateTaskRef = useRef(false);
  const aiOnIncognito = useCallback(() => privateTaskRef.current || !!tabsRef.current.find(t => t.id === activeTabIdRef.current)?.incognito, []);
  useEffect(() => { setAiIncognitoProbe(aiOnIncognito); }, [aiOnIncognito]);
  // Ctrl+Shift+N, ⋮ → Nova aba anônima, "Abrir link em aba anônima": espera a limpeza da sessão
  // anônima anterior (se a última aba anônima acabou de fechar) e abre na frente. Sem endereço →
  // a página que explica a aba anônima, com o cursor já na barra de endereço (igual ao Chrome).
  const openIncognitoTab = useCallback(async (url?: string) => {
    await incognitoReady();
    store.addTab(url || '', opensIncognito('incognito'));
    if (!url) setTimeout(() => { (document.querySelector('.url-input') as HTMLInputElement | null)?.focus(); }, 60);
  }, [store.addTab]);
  // Perguntas de permissão dos sites esperando resposta (cada uma presa à sua aba).
  const [permAsks, setPermAsks] = useState<Array<SitePermAsk & { tabId: string }>>([]);
  const answerPerm = useCallback((id: string, answer: 'allow' | 'block' | 'dismiss') => {
    setPermAsks(prev => prev.filter(a => a.id !== id));
    window.electronAPI?.answerSitePermission?.(id, answer);
  }, []);
  // Senhas salvas: o balão "Salvar senha?" (preso à aba do login) e a lista de contas em cima do
  // campo. A senha nunca chega aqui — só site, usuário e tamanho (main/password-manager.ts).
  const [pwOffers, setPwOffers] = useState<Array<PwOffer & { tabId: string }>>([]);
  const [pwSuggest, setPwSuggest] = useState<(PwSuggest & { tabId: string }) | null>(null);
  const [passwordsOpen, setPasswordsOpen] = useState<{ query?: string } | null>(null);
  const answerPwOffer = useCallback(async (id: string, answer: 'save' | 'never' | 'dismiss', username?: string) => {
    const r = await window.electronAPI?.passwords?.answerOffer(id, answer, username).catch(() => undefined);
    // Gravar falhou: o balão fica (com o aviso) pra pessoa tentar de novo.
    if (answer === 'save' && r && !r.ok && r.error === 'write-failed') return false;
    setPwOffers(prev => prev.filter(o => o.id !== id));
    return true;
  }, []);
  const revealPwOffer = useCallback(async (id: string) => {
    const r = await window.electronAPI?.passwords?.revealOffer(id).catch(() => undefined);
    return r && r.ok ? r.password : null;
  }, []);
  const closePwSuggest = useCallback(() => setPwSuggest(null), []);
  const pickPwSuggest = useCallback((suggestId: string, entryId: string) => {
    setPwSuggest(null);
    void window.electronAPI?.passwords?.fill(suggestId, entryId).catch(() => {});
  }, []);
  // Trocou de aba: a lista era do campo da outra.
  useEffect(() => { setPwSuggest(cur => (cur && cur.tabId !== store.activeTabId ? null : cur)); }, [store.activeTabId]);
  // Site-initiated downloads (will-download no main) — drenados pelo loop do agente
  // para a IA saber que o clique em "baixar" realmente produziu um arquivo.
  // Eventos de download que vão pra história do agente. O painel recebe todos; aqui só entram
  // os que importam pro agente: início/fim e os ticks com `notify` (cadência pelo ETA, ver
  // download-progress.ts) — senão o progresso de 1s viraria spam na história.
  // Downloads que começaram DURANTE uma tarefa do agente (link clicado ou ação download) e o
  // último estado de cada um. Servem pra (a) não deixar o agente dizer "baixou" com o arquivo
  // ainda baixando e (b) entregar o FIM na próxima tarefa, com o caminho, se acabar depois.
  const agentDlIdsRef = useRef<Set<string>>(new Set());
  const agentCancelledRef = useRef<Set<string>>(new Set());   // cancelados pelo próprio agente (cancel_download)
  // Fim da última tarefa: um download que começa logo depois (página "thank you" que dispara o
  // arquivo uns segundos após carregar) ainda é do agente — o fim dele vai pra próxima tarefa.
  const taskEndedAtRef = useRef(0);
  const DL_GRACE_MS = 30_000;
  const agentDlThreadRef = useRef(new Map<string, string>());   // download do agente → conversa onde avisar o fim
  const dlLatestRef = useRef<Map<string, { state: string; filename: string; path?: string; bytes?: number; totalBytes?: number; etaSec?: number | null }>>(new Map());
  const downloadEventsRef = useRef<Array<{ id?: string; kind?: string; state: string; filename: string; path?: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number | null; reason?: string; stalled?: boolean; stalledForSec?: number }>>([]);

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
  // Os pedidos anteriores (e o que o chat respondeu) moram na thread da sessão (renderer/threads.ts):
  // o agente lê o bloco dela no começo do prompt e grava o resumo da tarefa no fim.
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
    // usuário abriu a aba → libera o som (menos se o site está com "Desativar som do site")
    const tabUrl = store.tabs.find(x => x.id === id)?.url || '';
    if (!siteMute.isMuted(tabUrl)) { try { wv?.setAudioMuted(false); } catch {} }
    setTimeout(() => { try { wv?.executeJavaScript(VCUT_RELEASE_JS, false); } catch {} }, 250);
  }, [store.activeTabId]);

  const addRipple = useCallback((x: number, y: number) => {
    const id = ++rippleId.current;
    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 1100);
  }, []);

  const [adblockOn, setAdblockOn] = useState(true);
  const [adblockActive, setAdblockActive] = useState(true);
  const [hwAccelOn, setHwAccelOn] = useState(true);
  // Menu ⋮ (canto superior) + favoritos (estilo Chrome, salvos localmente).
  const [menuOpen, setMenuOpen] = useState(false);
  // Pastas que a pessoa liberou ao agente nesta sessão (menu → revogar).
  const [folderGrants, setFolderGrants] = useState<Array<{ folder: string; path: string }>>([]);
  useEffect(() => { if (menuOpen) window.electronAPI?.uploadGrants?.().then(g => setFolderGrants(g || [])); }, [menuOpen]);
  const [favorites, setFavorites] = useState<Array<{ url: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('favorites.v1') || '[]'); } catch { return []; }
  });

  // Painel do assistente redimensionável — arrastar a divisória pro lado (estilo Comet). Largura salva.
  const [panelWidth, setPanelWidth] = useState<number>(() => { const s = parseInt(localStorage.getItem('panelWidth') || '', 10); return (s >= 390 && s <= 1200) ? s : 420; });
  const [isResizing, setIsResizing] = useState(false);
  const startPanelResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      // painel na direita: quanto mais pra esquerda arrasta, mais largo. Deixa >=420px pro navegador.
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 390), Math.max(390, window.innerWidth - 420));
      setPanelWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setIsResizing(false);
      setPanelWidth(w => { try { localStorage.setItem('panelWidth', String(w)); } catch {} return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    window.electronAPI?.setAIProvider(store.aiSettings.provider, store.aiSettings.apiKey, store.aiSettings.baseUrl, store.aiSettings.model);
    window.electronAPI?.setUILanguage?.(getLang());   // i18n Fase 2: agente responde no idioma da UI
    // Listeners com unsubscribe (higiene: sem cleanup, o StrictMode do dev duplicava eventos).
    const offs: Array<(() => void) | undefined> = [];
    offs.push(window.electronAPI?.onZoom?.((pct) => showZoom(pct)) as any);   // Ctrl+roda → badge de zoom na tela
    // Initialize local (GPU) engine if hybrid is enabled. authKey é OPCIONAL (não o marcador
    // 'local' — o roteamento local é explícito no main, e um 'Bearer local' fabricado confundia).
    if (store.localSettings.enabled) {
      window.electronAPI?.setLocalWarmup?.(!!store.localSettings.warmup);
      window.electronAPI?.setLocalProvider?.(store.localSettings.provider, store.localSettings.authKey ?? '', store.localSettings.baseUrl, store.localSettings.model, localOptsForMain(store.localSettings));
    }
    // opts.incognito: popup/pesquisa saída de aba anônima ou "Abrir link em aba anônima" (main).
    offs.push(window.electronAPI?.onOpenNewTab?.((url: string, opts) => {
      if (opts?.incognito) void openIncognitoTab(url);
      else {
        // Link aberto em aba nova a partir da aba ativa ("Apply on company site"): entra na sessão dela.
        const opener = activeTabIdRef.current;
        const id = store.addTab(url);
        if (opener) store.joinOpenerSession(id, opener);
      }
    }) as any);
    // Link/arquivo de outro app (Bah como navegador padrão). O main segura o que chegou antes da tela
    // montar (o link que ABRIU o Bah) e só manda depois do aviso — então o ouvinte vem antes dele.
    offs.push(window.electronAPI?.onOutsideOpen?.((p) => { store.addOutsideTab(p.url, { launch: p.launch, noScript: p.noScript }); }));
    window.electronAPI?.outsideOpenReady?.();
    // Extensão pediu aba nova (chrome.tabs.create, opções, loja): na frente, ou atrás se active:false.
    offs.push(window.electronAPI?.onExtensionOpenTab?.(({ reqId, url, active }) => {
      const target = typeof url === 'string' && url ? url : undefined;
      const id = active === false && target ? store.addBackgroundTab(target) : store.addTab(target);
      // Avisa o main qual webContents é o DESTA aba (não "a próxima webview que anexar").
      // getWebContentsId lança até a webview anexar: tenta de novo por até 5 s.
      if (typeof reqId !== 'number') return;
      const started = Date.now();
      const report = () => {
        let wcId: number | null = null;
        try { const v = (webviewRefs.current.get(id) as any)?.getWebContentsId?.(); if (typeof v === 'number') wcId = v; } catch {}
        if (wcId !== null) { window.electronAPI?.extensionTabOpened?.(reqId, wcId)?.catch(() => {}); return; }
        if (Date.now() - started < 5000) setTimeout(report, 50);
      };
      setTimeout(report, 0);
    }));
    // Extensão fechou uma aba (chrome.tabs.remove): só aba que aparece na barra (a de trabalho
    // do agente, escondida, não é da extensão).
    offs.push(window.electronAPI?.onExtensionCloseTab?.(({ wcId }) => {
      if (typeof wcId !== 'number') return;
      for (const [tabId, wv] of webviewRefs.current) {
        let id: number | null = null;
        try { id = (wv as any).getWebContentsId?.(); } catch {}
        if (id !== wcId) continue;
        const tab = tabsRef.current.find(t => t.id === tabId);   // lista viva (o listener é registrado uma vez)
        if (tab && !tab.hidden) store.closeTab(tabId);
        return;
      }
    }));
    // Som na aba: o main manda o webContents que começou/parou de emitir áudio; aqui
    // achamos a aba dona dele. getWebContentsId lança se a webview ainda não anexou.
    offs.push(window.electronAPI?.onTabAudio?.(({ wcId, audible }) => {
      for (const [tabId, wv] of webviewRefs.current) {
        try { if ((wv as any).getWebContentsId?.() === wcId) { store.updateTab(tabId, { audible }); return; } } catch {}
      }
    }) as any);
    // Site pediu câmera/microfone/localização…: a pergunta fica presa à aba dona e aparece
    // quando ela estiver na frente. Pedido de aba escondida (busca rápida, monitor) → nega.
    offs.push(window.electronAPI?.onSitePermissionAsk?.((ask) => {
      let owner = '';
      for (const [tabId, wv] of webviewRefs.current) {
        try { if ((wv as any).getWebContentsId?.() === ask.wcId) { owner = tabId; break; } } catch {}
      }
      const tab = tabsRef.current.find(x => x.id === owner);
      if (!tab || tab.hidden) { window.electronAPI?.answerSitePermission?.(ask.id, 'dismiss'); return; }
      setPermAsks(prev => [...prev, { ...ask, tabId: owner }]);
    }) as any);
    offs.push(window.electronAPI?.onSitePermissionCancel?.((id) => {
      setPermAsks(prev => prev.filter(a => a.id !== id));
    }) as any);
    // Senhas: a aba dona pelo webContents. Aba escondida (trabalho da IA, busca rápida) nunca
    // pergunta nem mostra a lista; a anônima o main já nem manda pergunta.
    const pwOwner = (wcId: number) => {
      for (const [tabId, wv] of webviewRefs.current) {
        try { if ((wv as any).getWebContentsId?.() === wcId) return tabsRef.current.find(x => x.id === tabId); } catch {}
      }
      return undefined;
    };
    const pw = window.electronAPI?.passwords;
    offs.push(pw?.onOffer((offer) => {
      const tab = pwOwner(offer.wcId);
      if (!tab || tab.hidden || tab.incognito) { void pw.answerOffer(offer.id, 'dismiss').catch(() => {}); return; }
      // Uma pergunta por aba: a nova (outro login na mesma aba) toma o lugar.
      setPwOffers(prev => [...prev.filter(o => o.tabId !== tab.id), { ...offer, tabId: tab.id }]);
    }));
    offs.push(pw?.onOfferCancel((id) => setPwOffers(prev => prev.filter(o => o.id !== id))));
    offs.push(pw?.onSuggest((s) => {
      const tab = pwOwner(s.wcId);
      if (!tab || tab.hidden || tab.id !== userTabRef.current) return;
      setPwSuggest({ ...s, tabId: tab.id });
    }));
    offs.push(pw?.onSuggestHide(({ wcId }) => setPwSuggest(cur => (cur && cur.wcId === wcId ? null : cur))));
    // Torrent: o main manda 'open' quando intercepta magnet/.torrent → abre o card e busca
    // a metadata; 'stats' atualiza peers/progresso ao vivo; save-done/erro atualizam a linha.
    offs.push(window.electronAPI?.onTorrentEvent?.((info) => {
      if (info.kind === 'open') {
        setTorrent({ uri: info.uri, phase: 'fetching', saving: {}, saved: {} });
        window.electronAPI?.torrentAdd?.(info.uri).then((r) => {
          setTorrent(cur => (cur && cur.uri === info.uri)
            ? (r?.ok ? { ...cur, id: r.id, name: r.name, files: r.files, phase: 'choosing' } : { ...cur, phase: 'error', error: r?.error })
            : cur);
        });
      } else if (info.kind === 'stats') {
        setTorrent(cur => (cur && cur.id === info.id) ? { ...cur, stats: info } : cur);
      } else if (info.kind === 'save-done') {
        setTorrent(cur => (cur && cur.id === info.id) ? { ...cur, saved: { ...cur.saved, [info.index]: info.dest }, saving: { ...cur.saving, [info.index]: false } } : cur);
      } else if (info.kind === 'save-error') {
        setTorrent(cur => (cur && cur.id === info.id) ? { ...cur, saving: { ...cur.saving, [info.index]: false } } : cur);
      }
    }) as any);
    window.electronAPI?.adblockGetState?.().then(s => { setAdblockOn(s.enabled); setAdblockActive(s.active); });
    window.electronAPI?.getHwAccel?.().then(s => setHwAccelOn(s.enabled));
    try { window.electronAPI?.torrentSetSeed?.(localStorage.getItem('torrentSeed') === '1'); } catch {}   // aplica a pref de seed salva
    try { window.electronAPI?.torrentSetBuiltin?.(localStorage.getItem('torrentBuiltin') === '1'); } catch {}   // cliente embutido: padrão desligado
    try { window.electronAPI?.setYoutubeSkipAds?.(localStorage.getItem('ytSkipAds') !== '0'); } catch {}   // aplica a pref de pular anúncio salva
    try { window.electronAPI?.setYoutubeDlButton?.(localStorage.getItem('ytDlButton') !== '0', ytDlLabels()); } catch {}   // botão "Baixar" no YouTube
    // Gerenciador de downloads: preferências salvas + a pasta escolhida (vazia = Downloads).
    try { window.electronAPI?.setDownloadEngine?.(loadDlEngine()); } catch {}
    try { window.electronAPI?.setDownloadDir?.(localStorage.getItem('dlDir') || null)?.then(d => { if (d) setDlDir(d); }); } catch {}
    offs.push(window.electronAPI?.onSafeBrowsingBlock?.((info) => {
      try { new Notification('Bah', { body: `⚠️ Malicious site blocked: ${info.host}` }); } catch {}
    }) as any);
    offs.push(window.electronAPI?.onDownloadEvent?.((info) => {
      const dlKey = info.id || info.path || info.filename;
      // startedAt = quando o download apareceu pela 1ª vez → a qual tarefa ele pertence.
      dlLatestRef.current.set(dlKey, { ...info, at: Date.now(), startedAt: (dlLatestRef.current.get(dlKey) as any)?.startedAt ?? Date.now() } as any);
      const agentWindow = taskRunningRef.current || Date.now() - taskEndedAtRef.current < DL_GRACE_MS;
      if (agentWindow && (info.state === 'started' || info.state === 'queued' || info.kind === 'agent' || info.kind === 'video')) {
        if (!agentDlIdsRef.current.has(dlKey)) agentDlThreadRef.current.set(dlKey, store.threadKeyOf(activeTabIdRef.current));
        agentDlIdsRef.current.add(dlKey);
      }
      // Download que o AGENTE começou terminou (a tarefa já acabou quando ele começou): avisa na mesma conversa,
      // com os codecs — 4K do YouTube vem em AV1/VP9 e o QuickTime só toca o som (shared/media-codecs.ts).
      if (info.state === 'completed' && agentDlThreadRef.current.has(dlKey)) {
        const key = agentDlThreadRef.current.get(dlKey)!;
        agentDlThreadRef.current.delete(dlKey);
        const rep = codecReport(info.vcodec, info.acodec);
        const text = `✅ ${t('dl.agentDone', { file: info.filename })}${rep ? ' — ' + rep.label + '.' : ''}${rep && rep.label && !rep.quicktime ? ' ' + t('dl.useVlc', { codec: rep.blocker }) : ''}`;
        window.dispatchEvent(new CustomEvent('bah:agent-note', { detail: { key, text } }));
      }
      if (info.state !== 'progress' || info.notify) downloadEventsRef.current.push(info);
      if (info.state === 'duplicate') return;   // só pro agente; o painel já tem a linha do original
      setDownloads(prev => {
        const key = info.id || info.path || info.filename;
        const existing = prev.find(d => (d.id || d.path || d.filename) === key);
        const rest = prev.filter(d => (d.id || d.path || d.filename) !== key);
        const done = info.state === 'completed' || info.state === 'failed' || info.state === 'cancelled';
        const merged = {
          ...existing,
          at: existing?.at ?? Date.now(),   // quando apareceu na lista (período do Limpar dados)
          id: info.id ?? existing?.id,
          kind: info.kind ?? existing?.kind,
          engine: info.engine ?? existing?.engine,
          connections: done ? undefined : (info.connections ?? existing?.connections),
          map: done ? undefined : (info.map ?? existing?.map),
          filename: info.filename ?? existing?.filename ?? 'download',
          path: info.path ?? existing?.path,
          url: info.url ?? existing?.url,
          bytes: info.bytes ?? existing?.bytes,
          totalBytes: info.totalBytes ?? existing?.totalBytes,
          state: info.state,
          paused: done ? false : (info.paused ?? existing?.paused),
          speedBps: done ? 0 : (info.speedBps ?? existing?.speedBps),
          etaSec: done ? undefined : (info.etaSec ?? existing?.etaSec ?? undefined),
          stalled: done ? false : (info.stalled ?? existing?.stalled),
          reasonCode: info.state === 'failed' ? info.reasonCode : undefined,
          vcodec: info.vcodec ?? existing?.vcodec,
          acodec: info.acodec ?? existing?.acodec,
        };
        return [merged, ...rest].slice(0, 50);
      });
    }) as any);
    // Downloads de vídeo que o Bah fechou no meio da última vez: chegam como eventos acima.
    window.electronAPI?.takeInterruptedVideoDownloads?.()?.catch(() => {});
    return () => { for (const off of offs) { try { off?.(); } catch {} } };
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

  const toggleHwAccel = useCallback(async () => {
    const next = !hwAccelOn;
    const r = await window.electronAPI?.setHwAccel?.(next);
    if (r?.ok) { setHwAccelOn(next); window.alert(t('menu.hwAccelRestart')); }
  }, [hwAccelOn]);
  // Buscador preferido da pesquisa rápida e do agente (o da barra de endereço é o do ⋮ → Mecanismo
  // de pesquisa). 'auto' = Google primeiro.
  const [searchEngine, setSearchEngineState] = useState<EngineId | 'auto'>(() => preferredEngine());
  const cycleSearchEngine = useCallback(() => {
    setSearchEngineState(v => { const order: Array<EngineId | 'auto'> = ['auto', ...ENGINES.map(e => e.id)]; const n = order[(order.indexOf(v) + 1) % order.length]; setPreferredEngine(n); return n; });
  }, []);

  // ── Economia de memória (Memory Saver, estilo Chrome) ──
  // Aba parada há 30+ min (não ativa, sem áudio) tem o webview DESMONTADO → o Chromium
  // libera o processo/RAM. Ao clicar na aba ela recarrega na URL onde estava (na barra ela fica igual às outras).
  const [memSaverOn, setMemSaverOn] = useState<boolean>(() => { try { return localStorage.getItem('memSaver') !== '0'; } catch { return true; } });
  const toggleMemSaver = useCallback(() => {
    setMemSaverOn(v => { const n = !v; try { localStorage.setItem('memSaver', n ? '1' : '0'); } catch {} return n; });
  }, []);
  // Nível (Moderada 2 h / Equilibrada 30 min / Máxima 10 min) e "Manter estes sites sempre ativos".
  const [memSaverLevel, setMemSaverLevelState] = useState<MemSaverLevel>(() => { try { return sanitizeLevel(localStorage.getItem('memSaverLevel')); } catch { return sanitizeLevel(null); } });
  const setMemSaverLevel = useCallback((l: MemSaverLevel) => {
    setMemSaverLevelState(l); try { localStorage.setItem('memSaverLevel', l); } catch {}
  }, []);
  const [memSaverKeep, setMemSaverKeepState] = useState<string[]>(() => { try { return sanitizeKeepList(JSON.parse(localStorage.getItem('memSaverKeep') || '[]')); } catch { return []; } });
  const memSaverKeepRef = useRef(memSaverKeep); memSaverKeepRef.current = memSaverKeep;
  const setMemSaverKeep = useCallback((list: string[]) => {
    const clean = sanitizeKeepList(list);
    setMemSaverKeepState(clean); try { localStorage.setItem('memSaverKeep', JSON.stringify(clean)); } catch {}
  }, []);
  // Por que cada aba candidata ficou acordada na última varredura (balão da aba).
  const [memKept, setMemKept] = useState<Record<string, KeepReason>>({});
  // Abas de onde partiu uma tarefa do agente que ainda não acabou (rodando ou parada num cartão
  // esperando a pessoa). A varredura protege a SESSÃO inteira delas (store.threadKeyOf).
  const agentBusyTabsRef = useRef(new Set<string>());
  const [, setPermTick] = useState(0);   // re-render ao trocar uma permissão do agente no menu
  // Compartilhar (seed) do torrent — padrão DESLIGADO (baixa/streama sem subir nada).
  const [torrentSeed, setTorrentSeed] = useState<boolean>(() => { try { return localStorage.getItem('torrentSeed') === '1'; } catch { return false; } });
  const toggleTorrentSeed = useCallback(() => {
    setTorrentSeed(v => { const n = !v; try { localStorage.setItem('torrentSeed', n ? '1' : '0'); } catch {} window.electronAPI?.torrentSetSeed?.(n); return n; });
  }, []);
  // Cliente de torrent embutido — padrão DESLIGADO (.torrent baixa como arquivo; magnet vai pro app do sistema).
  const [torrentBuiltin, setTorrentBuiltin] = useState<boolean>(() => { try { return localStorage.getItem('torrentBuiltin') === '1'; } catch { return false; } });
  const toggleTorrentBuiltin = useCallback(() => {
    setTorrentBuiltin(v => { const n = !v; try { localStorage.setItem('torrentBuiltin', n ? '1' : '0'); } catch {} window.electronAPI?.torrentSetBuiltin?.(n); return n; });
  }, []);
  // Pular anúncio do YouTube sozinho, fantasma — clica em "Pular" assim que aparece, sem
  // highlight nem aviso nosso na tela. Padrão LIGADO (mesmo espírito do adblock).
  const [ytSkipAds, setYtSkipAds] = useState<boolean>(() => { try { return localStorage.getItem('ytSkipAds') !== '0'; } catch { return true; } });
  const toggleYtSkipAds = useCallback(() => {
    setYtSkipAds(v => { const n = !v; try { localStorage.setItem('ytSkipAds', n ? '1' : '0'); } catch {} window.electronAPI?.setYoutubeSkipAds?.(n); return n; });
  }, []);
  // Botão "Baixar" semitransparente em cima dos vídeos — YouTube e qualquer site (estilo IDM). Padrão LIGADO.
  const [ytDlButton, setYtDlButton] = useState<boolean>(() => { try { return localStorage.getItem('ytDlButton') !== '0'; } catch { return true; } });
  const toggleYtDlButton = useCallback(() => {
    setYtDlButton(v => { const n = !v; try { localStorage.setItem('ytDlButton', n ? '1' : '0'); } catch {} window.electronAPI?.setYoutubeDlButton?.(n, ytDlLabels()); return n; });
  }, []);
  // Modelo ATUAL, visto pelo loop do agente (o state dentro do loop async fica congelado no início
  // da tarefa; o main troca de motor na hora). Usado pra pausar a tarefa quando o modelo muda.
  const modelLabelRef = useRef('');
  modelLabelRef.current = store.localSettings.enabled
    ? `${store.localSettings.model || 'local model'} (local)`
    : `${store.aiSettings.provider}${store.aiSettings.model ? ' · ' + store.aiSettings.model : ''}`;
  const [switchModelSilently, setSwitchModelSilently] = useState<boolean>(() => { try { return localStorage.getItem('switchModelSilently') === '1'; } catch { return false; } });
  const switchModelSilentlyRef = useRef(switchModelSilently);
  switchModelSilentlyRef.current = switchModelSilently;
  // "Deixar a IA dirigir" (modo Comet): DESLIGA os atalhos determinísticos e todo comando
  // vira tarefa do agente — a IA observa a página e decide CADA passo. Padrão OFF (os
  // atalhos são mais rápidos/grátis); melhor com chave de API (grátis/local é lento).
  // PADRÃO DEPENDE DO MODO — a mesma muleta que atrapalha um cérebro grande socorre um pequeno:
  //   NUVEM: IA no comando (agentDrive=true, atalhos desligados). O modelo é esperto o bastante
  //          pra dispensar, e a heurística chegava a picar a frase do usuário.
  //   LOCAL: atalhos LIGADOS (agentDrive=false). Modelo fraco erra o roteamento e é lento;
  //          o atalho acerta o óbvio de graça. Continua desligável no botão do compositor.
  // Escolha explícita já salva manda sempre — o padrão só vale pra quem nunca mexeu.
  // Roteador local: estado vindo do main (baixar / carregando / pronto). Pronto → classifyIntent usa ele.
  const [routerStatus, setRouterStatus] = useState<RouterStatus>({ state: 'not-downloaded' });
  const routerReadyRef = useRef(false);
  useEffect(() => {
    const api = window.electronAPI;
    const apply = (st: RouterStatus) => { routerReadyRef.current = st?.state === 'ready'; setRouterStatus(st); };
    api?.routerStatus?.().then((st) => { if (st) apply(st); }).catch(() => {});
    return api?.onRouterStatus?.(apply);
  }, []);
  const [agentDrive, setAgentDrive] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('agentDrive');
      if (raw !== null) return raw === '1';
      const ls = localStorage.getItem('localSettings');
      const localOn = ls ? !!JSON.parse(ls).enabled : false;
      return !localOn;   // local → atalhos ligados; nuvem → IA decide
    } catch { return true; }
  });
  const agentDriveRef = useRef(agentDrive);
  agentDriveRef.current = agentDrive;
  const toggleAgentDrive = useCallback(() => {
    setAgentDrive(v => { const n = !v; try { localStorage.setItem('agentDrive', n ? '1' : '0'); } catch {} return n; });
  }, []);

  // Ler em voz alta (TTS) — vozes nativas do SO, grátis/offline. Estado só de UI (não
  // persiste): reflete se a PÁGINA está sendo lida agora, pro rótulo do menu virar "Parar".
  // O handler toggleReadPage é definido abaixo, após getActiveWebview.
  const [pageSpeaking, setPageSpeaking] = useState(false);

  // ── Limite de passos do agente (25/50/100/∞) ──
  // Clique cicla 25→50→100→∞, persiste. O teto de TEMPO escala junto; em ∞ não há teto de
  // passos NEM de tempo — é o modo "trabalha a noite toda" (pensado pra quem usa API, onde
  // o limite virava o estorvo). Só o Stop encerra. Vale pro PRÓXIMO run.
  // 0 = ilimitado (guardado assim); getItem(null)→25 é tratado explicitamente, senão
  // Number(null)===0 ligaria o ∞ sozinho em quem nunca mexeu na opção.
  const [agentMaxSteps, setAgentMaxSteps] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('agentMaxSteps');
      if (raw !== null) {
        const v = Number(raw);
        return (v === 25 || v === 50 || v === 100 || v === 0) ? v : 0;
      }
      // PADRÃO: ∞ (sem teto), inclusive no modo local. Nenhum freio nasce ligado — limite é
      // escolha explícita, não precaução. Os dois freios ficam a um clique no compositor.
      return 0;
    } catch { return 0; }
  });
  // ── TRAVA DE TEMPO (opcional) ───────────────────────────────────────────────────
  // Freio pensado pra tarefa longa sem ninguém olhando: "no máximo 8h" é mais intuitivo
  // que contar passos, e é o único freio que age quando o usuário foi dormir (o botão
  // Parar exige alguém na frente da tela). 0 = desligada, que é o padrão — coerente com
  // o resto: nada limita por precaução, só por escolha explícita.
  // First-run guide: the bar is a hint until dismissed, the tour is a reopenable dialog.
  const [showGuide, setShowGuide] = useState<boolean>(() => { try { return localStorage.getItem('guideSeen') !== '1'; } catch { return true; } });
  const [showTour, setShowTour] = useState<boolean>(() => { try { return localStorage.getItem('tourSeen') !== '1'; } catch { return true; } });
  const [agentTimeLimitMin, setAgentTimeLimitMin] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('agentTimeLimitMin'));
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return 0; }
  });
  // Gasto acumulado desde que o navegador abriu. Vive no cabeçalho do painel (e não no feed)
  // porque os chips de status somem em 2s — e o número que interessa é justamente o que
  // continua lá quando você volta de manhã. Zera ao fechar o app: é um contador de sessão,
  // não uma fatura; a verdade sobre cobrança é sempre a do provedor.
  const [sessionCost, setSessionCost] = useState<{ usd: number; calls: number; est: boolean }>({ usd: 0, calls: 0, est: false });
  const bumpSessionCost = useCallback((usd: number, est: boolean) => {
    if (!(usd > 0)) return;   // local/Ollama é zero: não conta chamada nem acende o contador
    setSessionCost(p => ({ usd: p.usd + usd, calls: p.calls + 1, est: p.est || est }));
  }, []);
  const sweepTabsRef = useRef(store.tabs); sweepTabsRef.current = store.tabs;
  const sweepActiveIdRef = useRef(store.activeTabId); sweepActiveIdRef.current = store.activeTabId;
  useEffect(() => {
    if (!memSaverOn) { setMemKept({}); return; }
    // Overrides só p/ testes: memSaverIdleMs (tempo parada) e memSaverSweepMs (intervalo da varredura).
    let override = 0, sweepMs = 60000;
    try { override = Number(localStorage.getItem('memSaverIdleMs')) || 0; const sw = Number(localStorage.getItem('memSaverSweepMs')); if (sw > 0) sweepMs = sw; } catch {}
    const idleMs = idleMsFor(memSaverLevel, override);
    let alive = true, running = false;
    const ctxFor = (now: number): ((tabId: string) => SweepCtx) => {
      const busy = new Set<string>();
      for (const id of agentBusyTabsRef.current) busy.add(store.threadKeyOf(id));
      return (tabId) => ({ now, idleMs, activeId: sweepActiveIdRef.current, agentBusy: busy.has(store.threadKeyOf(tabId)), keepList: memSaverKeepRef.current });
    };
    const sweep = async () => {
      if (running) return;
      running = true;
      try {
        const reasons: Record<string, KeepReason> = {};
        let ctx = ctxFor(Date.now());
        // 1) Regras baratas (sem falar com a página): ativa, fixada, anônima, sessão do agente, lista, tempo.
        const cands: Array<{ id: string; wv: any; wcId: number | null }> = [];
        for (const tb of sweepTabsRef.current) {
          const r = cheapKeepReason(tb, ctx(tb.id));
          if (r) { if (isShownReason(r)) reasons[tb.id] = r; continue; }
          const wv = webviewRefs.current.get(tb.id) as any;
          let wcId: number | null = null;
          try { const n = wv?.getWebContentsId?.(); if (typeof n === 'number') wcId = n; } catch {}
          cands.push({ id: tb.id, wv, wcId });
        }
        // 2) Só pras candidatas: o que o main sabe (câmera/tela, notificações, download) e o que a
        //    página sabe (formulário, vídeo tocando mesmo mudo, dispositivo).
        if (cands.length) {
          const ids = cands.map(c => c.wcId).filter((n): n is number => n != null);
          const fromMain = ids.length ? await window.electronAPI?.memSaverSignals?.(ids).catch(() => ({})) || {} : {};
          await Promise.all(cands.map(async c => {
            let page: Partial<TabSignals> | null = null;
            if (c.wv) {
              page = await Promise.race([
                Promise.resolve(c.wv.executeJavaScript(PAGE_SIGNALS_SCRIPT)).catch(() => null),
                new Promise<null>(r => setTimeout(() => r(null), 3000)),
              ]);
            }
            let audible = false;
            try { audible = !!c.wv?.isCurrentlyAudible?.(); } catch {}
            const m = (c.wcId != null && (fromMain as any)[c.wcId]) || {};
            const sig: TabSignals = { ...(page || {}), ...m, audible, capture: !!(m.capture || page?.capture) };
            const r = signalKeepReason(sig);
            if (r) { reasons[c.id] = r; return; }
            // A pessoa pode ter voltado pra aba (ou a IA começado nela) enquanto a página respondia.
            const cur = sweepTabsRef.current.find(x => x.id === c.id);
            if (!alive || !cur || cheapKeepReason(cur, ctxFor(Date.now())(c.id))) return;
            // audible:false junto — a webview morre sem emitir o "parou de tocar" final.
            store.updateTab(c.id, { discarded: true, audible: false, restored: false });
          }));
        }
        if (alive) setMemKept(prev => {
          const a = Object.keys(prev), b = Object.keys(reasons);
          return a.length === b.length && b.every(k => prev[k] === reasons[k]) ? prev : reasons;
        });
      } finally { running = false; }
    };
    const iv = setInterval(() => { void sweep(); }, sweepMs);
    return () => { alive = false; clearInterval(iv); };
  }, [memSaverOn, memSaverLevel, store.updateTab, store.threadKeyOf]);

  // ── Favoritos (estilo Chrome) ──
  // Salva a lista; false = não coube no localStorage (aí o import desiste em vez de perder no reinício).
  const persistFavorites = (list: FlatBookmark[]): boolean => {
    try { localStorage.setItem('favorites.v1', JSON.stringify(list)); return true; } catch { return false; }
  };
  const saveFavorite = useCallback(() => {
    const t = store.activeTab;
    if (!t?.url || !/^https?:\/\//i.test(t.url)) { return; }
    setFavorites(prev => {
      if (prev.some(f => f.url === t.url)) { return prev; }
      // Teto alto: com importação a lista passa fácil dos 60 de antes (a barra continua mostrando só o começo).
      const next = [{ url: t.url, title: (t.title || t.url).slice(0, 80) }, ...prev].slice(0, MAX_FAVORITES);
      persistFavorites(next);
      return next;
    });
  }, [store.activeTab]);
  const removeFavorite = useCallback((url: string) => {
    setFavorites(prev => {
      const next = prev.filter(f => f.url !== url);
      persistFavorites(next);
      return next;
    });
  }, []);

  // ── Importar / exportar favoritos (⋮ → Favoritos → Importar e exportar) ──
  // O main acha e lê os arquivos (Chrome/Edge/HTML); aqui só junta na lista plana, sem repetir URL.
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const [favIoOpen, setFavIoOpen] = useState(false);
  // ⋮ → "Favoritos ▸": submenu ao lado do menu (igual ao Chrome). Abre no clique ou parando o
  // mouse em cima; fecha passando pra outro item, com Esc ou fechando o ⋮.
  const [favMenuOpen, setFavMenuOpen] = useState(false);
  const favMenuOpenRef = useRef(false);
  favMenuOpenRef.current = favMenuOpen;
  const favHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favHoverCancel = useCallback(() => {
    if (favHoverTimer.current) { clearTimeout(favHoverTimer.current); favHoverTimer.current = null; }
  }, []);
  const favHover = useCallback((open: boolean, ms: number) => {
    favHoverCancel();
    favHoverTimer.current = setTimeout(() => { favHoverTimer.current = null; setFavMenuOpen(open); }, ms);
  }, [favHoverCancel]);
  useEffect(() => {
    if (menuOpen) return;
    favHoverCancel();
    setFavMenuOpen(false);
    setFavIoOpen(false);
  }, [menuOpen, favHoverCancel]);
  useEffect(() => {
    if (!menuOpen) return;
    // Esc fecha o submenu primeiro, depois o ⋮ (só quando o foco está na interface do Bah).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      favHoverCancel();
      if (favMenuOpenRef.current) setFavMenuOpen(false); else setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, favHoverCancel]);
  // Barra de favoritos: lista estável (a barra só remede quando a lista muda de verdade).
  const favBarItems = useMemo(() => favorites.slice(0, FAV_BAR_MAX), [favorites]);
  const [favBusy, setFavBusy] = useState(false);
  const [favSources, setFavSources] = useState<Array<{ id: 'chrome' | 'edge'; name: string }>>([]);
  useEffect(() => {
    if (!menuOpen) return;
    window.electronAPI?.bookmarksSources?.().then(s => setFavSources(Array.isArray(s) ? s : [])).catch(() => {});
  }, [menuOpen]);
  // Aviso depois do React pintar a lista nova (o alert bloqueia a página).
  const favNotice = (msg: string) => { setTimeout(() => window.alert(msg), 80); };
  const favErrorText = (code: string) => t(({
    'not-found': 'fav.err.notFound', empty: 'fav.err.empty', 'too-big': 'fav.err.tooBig',
    'bad-format': 'fav.err.badFormat', 'write-failed': 'fav.err.write',
  } as Record<string, string>)[code] || 'fav.err.read');
  const importFavorites = useCallback(async (from: 'chrome' | 'edge' | 'html') => {
    const api = window.electronAPI;
    if (!api || favBusy) return;
    setFavBusy(true);
    try {
      const r = from === 'html' ? await api.bookmarksImportHtml?.() : await api.bookmarksImportBrowser?.(from);
      if (!r) return;
      if (!r.ok) { if (r.error !== 'canceled') favNotice(favErrorText(r.error)); return; }
      // Importados entram no FIM: onde eles aparecem depende de quantos a pessoa já tinha.
      const start = favoritesRef.current.length;
      const m = mergeFavorites(favoritesRef.current, r.items);
      if (m.added && !persistFavorites(m.list)) { favNotice(t('fav.err.storage')); return; }
      if (m.added) setFavorites(m.list);
      const max = MAX_FAVORITES.toLocaleString();
      const lines: string[] = [];
      if (!m.added) {
        // Nada entrou: ou já estava tudo no Bah, ou a lista está cheia (não confundir os dois).
        lines.push(m.overLimit ? t('fav.importFull') : t('fav.importNone'));
      } else {
        lines.push(m.added === 1 ? t('fav.importDoneOne') : t('fav.importDone', { n: m.added.toLocaleString() }));
        lines.push(t(start < FAV_BAR_MAX ? 'fav.importWhere' : start < FAV_MENU_MAX ? 'fav.importWhereMenu' : 'fav.importWhereSearch'));
        if (m.duplicates) lines.push(m.duplicates === 1 ? t('fav.importDupOne') : t('fav.importDup', { n: m.duplicates.toLocaleString() }));
        if (m.overLimit) lines.push(m.overLimit === 1 ? t('fav.importOverOne', { max }) : t('fav.importOver', { n: m.overLimit.toLocaleString(), max }));
      }
      favNotice(lines.join('\n'));
    } catch { favNotice(t('fav.err.read')); }
    finally { setFavBusy(false); }
  }, [favBusy]);
  const exportFavorites = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.bookmarksExport) return;
    if (!favoritesRef.current.length) { favNotice(t('fav.exportEmpty')); return; }
    try {
      const r = await api.bookmarksExport(favoritesRef.current);
      if (r.ok) favNotice(r.count === 1 ? t('fav.exportDoneOne', { file: r.file }) : t('fav.exportDone', { n: r.count.toLocaleString(), file: r.file }));
      else if (r.error === 'empty') favNotice(t('fav.exportEmpty'));
      else if (r.error !== 'canceled') favNotice(favErrorText(r.error));
    } catch { favNotice(t('fav.err.write')); }
  }, []);

  // ── Histórico de navegação (alimenta o autocomplete da barra + tela Ctrl+H) ──
  const historyRef = useRef<Array<{ url: string; title: string; ts: number }>>([]);
  // Transcrição (legenda) de vídeo do YouTube em cache por id — alimenta o chat ('' = sem legenda).
  const transcriptCacheRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    try { const h = JSON.parse(localStorage.getItem('history.v1') || '[]'); if (Array.isArray(h)) historyRef.current = h; } catch {}
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState<Array<{ url: string; title: string; ts: number }>>([]);
  // ── Downloads (painel Ctrl+J) ──
  const [downloads, setDownloads] = useState<Array<{ at?: number; id?: string; kind?: string; engine?: boolean; connections?: number; map?: number[][]; filename: string; path?: string; url?: string; state: string; bytes?: number; totalBytes?: number; speedBps?: number; etaSec?: number; paused?: boolean; stalled?: boolean; reasonCode?: string; vcodec?: string; acodec?: string }>>([]);
  // Espelho do painel pro loop do agente (o state fica velho dentro do loop async): list_downloads.
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  // Gerenciador de downloads (Downloads → ⚙): várias conexões, igual ao IDM Caseiro.
  const [dlSettingsOpen, setDlSettingsOpen] = useState(false);
  const [dlEngine, setDlEngine] = useState<DlEngineSettings>(() => loadDlEngine());
  const [dlDir, setDlDir] = useState<string>('');
  const updateDlEngine = useCallback((patch: Partial<DlEngineSettings>) => {
    setDlEngine(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem('dlEngine', JSON.stringify(next)); } catch {}
      window.electronAPI?.setDownloadEngine?.(next);
      return next;
    });
  }, []);
  const chooseDlDir = useCallback(async () => {
    const dir = await window.electronAPI?.chooseDownloadDir?.();
    if (dir) { setDlDir(dir); try { localStorage.setItem('dlDir', dir); } catch {} }
  }, []);
  const resetDlDir = useCallback(async () => {
    try { localStorage.removeItem('dlDir'); } catch {}
    const dir = await window.electronAPI?.setDownloadDir?.(null);
    if (dir) setDlDir(dir);
  }, []);
  const [torrent, setTorrent] = useState<TorrentSheetData | null>(null);
  const [monitorsOpen, setMonitorsOpen] = useState(false);
  // ⏰ Tarefas agendadas (renderer/scheduler.ts): cada uma roda numa aba com sessão própria.
  const [schedOpen, setSchedOpen] = useState(false);
  const sched = useScheduler({
    openRunTab: (_task, reuse) => {
      if (reuse && tabsRef.current.some(x => x.id === reuse && !x.hidden)) { store.setActiveTabId(reuse); return reuse; }
      return store.addTab();
    },
    ensureRunSession: (tabId, task) => {
      if (!tabsRef.current.some(x => x.id === tabId)) return false;   // a aba nova ainda não chegou no estado
      const had = store.threadKeyOf(tabId) !== tabId;
      const sid = store.ensureSession(tabId, { command: task.command });
      if (sid === tabId) return false;
      // Nome reconhecível no chip ("⏰ News"); se a pessoa renomeou a sessão depois, fica o nome dela.
      if (!had) store.renameSession(sid, `⏰ ${task.name}`);
      return true;
    },
    focusTab: (id) => { if (tabsRef.current.some(x => x.id === id && !x.hidden)) store.setActiveTabId(id); },
    openPanel: () => store.setSidebarOpen(true),
  });
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
  const getSuggestions = useCallback((q: string): Array<{ url: string; title: string; display: string; prefix: boolean }> => {
    const query = q.trim().toLowerCase();
    if (!query || /^https?:\/\//i.test(q)) return [];   // já é uma URL completa → não sugere
    const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const normOf = (u: string) => u.replace(/^https?:\/\//i, '').replace(/^www\./, '');
    // Só completa typo de DOMÍNIO (sem espaço/barra) → "youtube.co" vira "youtube.com".
    const canPrefix = !query.includes(' ') && !query.includes('/');
    const seenHost = new Set<string>();
    const seenUrl = new Set<string>();
    const prefixHits: Array<{ url: string; title: string; display: string; prefix: boolean }> = [];
    const other: Array<{ url: string; title: string; display: string; prefix: boolean }> = [];
    const all = [...favorites, ...historyRef.current.map(h => ({ url: h.url, title: h.title }))];
    for (const c of all) {
      if (prefixHits.length + other.length >= 12) break;
      const host = hostOf(c.url);
      const norm = normOf(c.url);
      const title = c.title || c.url;
      if (canPrefix && host && host.startsWith(query) && host !== query && !seenHost.has(host)) {
        // match de prefixo de host → completa pro host LIMPO (raiz), estilo Chrome
        seenHost.add(host);
        prefixHits.push({ url: 'https://' + host, title: host, display: host, prefix: true });
      } else if (norm.toLowerCase().includes(query) || title.toLowerCase().includes(query)) {
        if (!seenUrl.has(c.url)) { seenUrl.add(c.url); other.push({ url: c.url, title, display: norm, prefix: false }); }
      }
    }
    return [...prefixHits, ...other].slice(0, 8);
  }, [favorites]);

  // Troca de idioma re-renderiza a UI SEM recarregar a página (o menu não fecha).
  const [, forceI18n] = useState(0);
  useEffect(() => onLangChange(() => {
    forceI18n(n => n + 1);
    window.electronAPI?.setUILanguage?.(getLang());
    // O botão "Baixar" dos vídeos fala o idioma da UI: manda os textos novos.
    try { window.electronAPI?.setYoutubeDlButton?.(localStorage.getItem('ytDlButton') !== '0', ytDlLabels()); } catch {}
  }), []);
  // Trocou o mecanismo de pesquisa (⋮) → placeholder da barra e o próprio menu se redesenham.
  // Ao abrir, o main recebe o escolhido (pro "Pesquisar no … por" do clique direito).
  useEffect(() => { syncSearchEngineToMain(); return onSearchEngineChange(() => forceI18n(n => n + 1)); }, []);
  // Janela de contexto do modelo (a detecção do engine: /props no llama.cpp, ou o tamanho configurado)
  // → orçamento da thread da sessão e o medidor do painel. Nuvem: desconhecida (orçamento padrão).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try { const r = await window.electronAPI?.contextWindow?.(store.localSettings.enabled); if (alive) setContextWindow(r?.tokens); } catch {}
    }, 1200);
    return () => { alive = false; clearTimeout(t); };
  }, [store.localSettings.enabled, store.localSettings.model, store.localSettings.baseUrl, store.localSettings.contextMode, store.localSettings.contextTokens]);

  // Login do Google (navegador real → importa sessão por CDP, automático). Reusado pelo
  // botão de vidro do painel e pelo item do menu ⋮.
  // Mostra "Conectado ao Google" no lugar do botão quando já existe sessão importada.
  const [googleLoggedIn, setGoogleLoggedIn] = useState(false);
  const checkGoogleLogin = useCallback(async () => {
    try { const r = await window.electronAPI?.googleCheckLogin?.(); setGoogleLoggedIn(!!r?.loggedIn); } catch {}
  }, []);
  // ── Limpar dados de navegação (menu ⋮ / Ctrl+Shift+Delete) ──
  // Histórico e lista de downloads são daqui (renderer); cookies/cache vão pro main, que só
  // mexe na sessão das abas. Os sites do período saem do histórico ANTES de apagá-lo.
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);   // ⋮ → 🕘 Histórico de conversas
  const closeClearData = useCallback(() => setClearDataOpen(false), []);
  const sitesInRange = useCallback((range: TimeRange) => originsVisited(historyRef.current, rangeSince(range, Date.now())).length, []);
  const runClearData = useCallback(async (c: ClearChoice): Promise<boolean> => {
    const since = rangeSince(c.range, Date.now());
    let ok = true;
    if (c.cookies || c.cache) {
      const origins = c.range === 'all' ? [] : originsVisited(historyRef.current, since);
      try {
        const r = await window.electronAPI?.clearBrowsingData?.({ range: c.range, cookies: c.cookies, cache: c.cache, origins });
        ok = !!r?.ok;
      } catch { ok = false; }
    }
    if (c.history) {
      const { kept, removed } = splitHistory(historyRef.current, since);
      historyRef.current = kept;
      try { if (kept.length) localStorage.setItem('history.v1', JSON.stringify(kept)); else localStorage.removeItem('history.v1'); } catch {}
      setHistoryView(kept.slice(0, 300));
      const gone = new Set(removed.map(h => h.url));
      store.forgetClosedTabs(u => c.range === 'all' || gone.has(u));
    }
    if (c.downloads) setDownloads(prev => keepDownloads(prev, since));
    // 🕘 Histórico de conversas do assistente (cifrado no main): o mesmo período.
    if (c.chats) { try { const r = await window.electronAPI?.chatHistoryClear?.(since === -Infinity ? null : since); if (!r?.ok) ok = false; } catch { ok = false; } }
    // Cookies do Google podem ter saído → o menu ⋮ volta a mostrar "Entrar no Google".
    if (c.cookies) checkGoogleLogin();
    return ok;
  }, [store.forgetClosedTabs, checkGoogleLogin]);
  useEffect(() => { checkGoogleLogin(); }, [checkGoogleLogin]);

  const handleGoogleLogin = useCallback(async () => {
    try {
      const result = await window.electronAPI?.googleLogin?.();
      if (!result?.ok) { return; }
      setGoogleLoggedIn(true);
      const wv = webviewRefs.current.get(store.activeTab?.id) as any;
      try { wv?.reload?.(); } catch {}
    } catch {}
  }, [store]);

  // "Trocar de conta": zera o perfil de login persistente e abre uma tela de login limpa.
  const handleGoogleSwitch = useCallback(async () => {
    try {
      const result = await window.electronAPI?.googleSwitchAccount?.();
      if (!result?.ok) { return; }
      setGoogleLoggedIn(true);
      const wv = webviewRefs.current.get(store.activeTab?.id) as any;
      try { wv?.reload?.(); } catch {}
    } catch {}
  }, [store]);

  // "Entrar neste site pelo navegador": abre o site atual no navegador do sistema pro usuário
  // logar uma vez, e importa a sessão daquele domínio pro Bah.
  const handleSiteLogin = useCallback(async () => {
    if (store.activeTab?.incognito) return;   // traria os cookies do site pro perfil normal (o item fica apagado)
    const url = store.activeTab?.url || '';
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    if (!/^https?:\/\//i.test(url) || !host) { window.alert(t('menu.siteLoginNoSite')); return; }
    if (!window.confirm(t('menu.siteLoginConfirm').replace('{site}', host))) return;
    try {
      const result = await window.electronAPI?.siteLogin?.(url);
      if (result?.ok) {
        window.alert(t('menu.siteLoginDone').replace('{n}', String(result.copied ?? 0)).replace('{site}', result.domain ?? host));
        const wv = webviewRefs.current.get(store.activeTab?.id) as any;
        try { wv?.reload?.(); } catch {}
        checkGoogleLogin();
      } else {
        window.alert(t('menu.siteLoginFail').replace('{error}', result?.error ?? '—'));
      }
    } catch (e: any) {
      window.alert(t('menu.siteLoginFail').replace('{error}', String(e?.message || e)));
    }
  }, [store, checkGoogleLogin]);

  const getActiveWebview = useCallback((): Electron.WebviewTag | null => {
    return webviewRefs.current.get(activeTabIdRef.current) ?? null;
  }, []);

  // Imprimir… (Ctrl+P / menu ⋮) e Salvar como PDF… (menu ⋮): sempre a página da ABA ATIVA,
  // nunca a interface do Bah. O main confere a aba e abre o diálogo; aqui só traduz o resultado.
  // PDF salvo aparece no painel de Downloads (abre sozinho), com "abrir arquivo" e "mostrar na pasta".
  const printNotice = (msg: string) => { setTimeout(() => window.alert(msg), 80); };
  const printPage = useCallback(async (mode: 'print' | 'pdf') => {
    const api = window.electronAPI;
    let wcId = 0;
    // a aba que a pessoa vê, não a de trabalho do agente
    try { wcId = (webviewRefs.current.get(userTabRef.current) as any)?.getWebContentsId?.() || 0; } catch {}
    if (!wcId) { printNotice(t('print.err.noTab')); return; }
    try {
      const r = mode === 'print' ? await api?.printPage?.(wcId) : await api?.savePagePdf?.(wcId);
      if (!r) return;
      if (r.ok) {
        if (mode === 'pdf') { setDlSettingsOpen(false); setDownloadsOpen(true); }
        return;
      }
      if (r.error === 'canceled' || r.error === 'busy') return;
      printNotice(t(({
        'no-tab': 'print.err.noTab', empty: 'print.err.noTab', internal: 'print.err.internal', crashed: 'print.err.crashed',
        'pdf-failed': 'print.err.pdfFailed', 'write-failed': 'print.err.write', timeout: 'print.err.timeout',
      } as Record<string, string>)[r.error] || (mode === 'print' ? 'print.err.failed' : 'print.err.pdfFailed')));
    } catch { printNotice(t(mode === 'print' ? 'print.err.failed' : 'print.err.pdfFailed')); }
  }, []);

  // "Ler esta página em voz alta" (menu ⋮). Toggle: fala → clica de novo → para. Raspa o
  // texto do artigo/página atual e manda pro TTS grátis (voz segue o idioma da interface).
  const toggleReadPage = useCallback(async () => {
    if (isSpeaking()) { stopSpeaking(); setPageSpeaking(false); return; }
    const wv = getActiveWebview();
    if (!wv) return;
    let text = '';
    try {
      text = await wv.executeJavaScript(`(function(){
        const main = document.querySelector('main, article, [role=main]') || document.body;
        return (main.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 4000);
      })()`);
    } catch {}
    if (!text) return;
    const ok = speak(text, () => setPageSpeaking(false));
    setPageSpeaking(ok);
  }, [getActiveWebview]);


  const navigate = useCallback((url: string) => {
    // Magnet colado na barra (não navega). O will-navigate do main não cobre loadURL
    // programático, então mandamos pro mesmo handleUri: card (cliente embutido) ou app do sistema.
    if (/^magnet:/i.test(url.trim())) {
      window.electronAPI?.torrentOpen?.(url.trim());
      return;
    }
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url) && !/^file:/i.test(url)) {
      finalUrl = url.includes('.') && !url.includes(' ')
        ? `https://${url}`
        : searchUrlFor(url);   // mecanismo escolhido no ⋮ (padrão: Google, mesmos parâmetros de antes)
    }
    // Aba sem JavaScript (página do computador aberta de fora): site digitado ou favorito abre numa
    // aba normal — nesta o site viria quebrado (os links dela o main já desvia igual).
    if (store.activeTab?.noScript && !/^file:/i.test(finalUrl)) { store.addTab(stripTrackingParams(finalUrl)); return; }
    store.updateTab(store.activeTabId, { isLoading: true });
    // URL colada com rastreio (fbclid/gclid/…) entra já limpa — will-navigate não
    // cobre loadURL (navegação programática), então o strip é aqui.
    getActiveWebview()?.loadURL(stripTrackingParams(finalUrl)).catch(() => {});
  }, [store, getActiveWebview]);
  // Favorito da barra / do "»": clique = aba atual; Ctrl+clique, botão do meio ou "Abrir em
  // nova aba" = aba nova atrás (igual ao Chrome).
  // (por ref: o navigate muda a cada render, e a barra é memo — não pode redesenhar à toa).
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const addBackgroundTab = store.addBackgroundTab;
  const openFavorite = useCallback((url: string, newTab: boolean) => {
    // Vendo uma aba anônima: o favorito em aba nova também abre anônimo.
    if (newTab) addBackgroundTab(url, opensIncognito('from-tab', userOnIncognito())); else navigateRef.current(url);
  }, [addBackgroundTab, userOnIncognito]);

  const goBack = useCallback(() => { getActiveWebview()?.goBack(); }, [getActiveWebview]);
  const goForward = useCallback(() => { getActiveWebview()?.goForward(); }, [getActiveWebview]);
  const reload = useCallback(() => { getActiveWebview()?.reload(); }, [getActiveWebview]);

  // Espelha o liga/desliga do modo IA Local pro MAIN (boot + toda mudança): trabalhos em
  // background (monitores) precisam respeitar "local não vaza pra nuvem" sem o renderer.
  useEffect(() => { window.electronAPI?.setLocalEnabled?.(store.localSettings.enabled); }, [store.localSettings.enabled]);

  // ── Buscar na página (Ctrl+F) — usa o findInPage nativo do webview ──
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findCount, setFindCount] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);
  // Aviso de "sessão do Google expirou": liga quando a aba ativa cai na tela de
  // login/erro do Google (sinal forte de sessão quebrada). Oferece reentrar em 1 clique.
  const [showGoogleRelogin, setShowGoogleRelogin] = useState(false);
  const [showCookieFix, setShowCookieFix] = useState(false);
  useEffect(() => {
    // Aba anônima não tem a sessão do perfil (é normal cair no login do Google): nada de aviso
    // de "sessão expirou" nem de consertar cookies — os dois mexem no perfil NORMAL.
    const u = store.activeTab?.incognito ? '' : (store.activeTab?.url || '');
    // No uso normal logado a URL é mail.google.com/…; cair na tela de login do
    // accounts.google.com dentro do webview embutido = sessão quebrada.
    const broken = /^https?:\/\/accounts\.google\.com\/(ServiceLogin|signin|v3\/signin|InteractiveLogin)/i.test(u);
    setShowGoogleRelogin(broken);   // dispensar (✕) fica dispensado até a URL mudar (dep abaixo)
    if (broken) setGoogleLoggedIn(false);   // sessão caiu → volta a oferecer "Entrar no Google"
    // Cookies inconsistentes do Google → tela "CookieMismatch". Oferece limpar os cookies
    // do Google e reimportar o login em 1 clique.
    setShowCookieFix(/^https?:\/\/accounts\.google\.com\/CookieMismatch/i.test(u));
  }, [store.activeTab?.url, store.activeTab?.incognito]);
  const fixGoogleCookies = useCallback(async () => {
    setShowCookieFix(false);
    try { await window.electronAPI?.clearGoogleCookies?.(); } catch {}
    setGoogleLoggedIn(false);
    // Recarrega numa base limpa do Google → sem os cookies quebrados, a tela some.
    try { (getActiveWebview() as any)?.loadURL('https://www.google.com/'); } catch {}
    // E já reimporta o login do Chrome: só limpar deixava a pessoa deslogada, tendo que
    // achar o "Entrar no Google" sozinha. Quem importou com a versão antiga (sem os
    // __Host- do accounts.google.com) cai aqui uma vez e sai consertado.
    await handleGoogleLogin();
  }, [getActiveWebview, handleGoogleLogin]);

  // Cron-Agent: quando um monitor bate a condição, toca um som curto (além da notificação
  // nativa do sistema, disparada no main) pra chamar a atenção mesmo minimizado.
  useEffect(() => {
    const off = window.electronAPI?.onMonitorAlert?.(() => {
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        const beep = (freq: number, at: number) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'sine'; o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
          g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
          o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.36);
        };
        beep(880, 0); beep(1174, 0.18);   // dois toques (dó-mi agudo)
        setTimeout(() => { try { ctx.close(); } catch {} }, 900);
      } catch {}
    });
    return () => { try { off?.(); } catch {} };
  }, []);
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
      case 'new-incognito-tab': void openIncognitoTab(); break;   // Ctrl+Shift+N
      case 'close-tab': store.closeTab(store.activeTabId); break;
      case 'reopen-tab': store.reopenClosedTab(); break;
      case 'focus-url': { const el = document.querySelector('.url-input') as HTMLInputElement | null; if (el) { el.focus(); el.select(); } break; }
      case 'reload': reload(); break;
      case 'find': setFindOpen(true); setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select(); }, 0); break;
      case 'back': goBack(); break;
      case 'forward': goForward(); break;
      case 'next-tab': if (visible.length) go(visible[(curIdx + 1) % visible.length]); break;
      case 'prev-tab': if (visible.length) go(visible[(curIdx - 1 + visible.length) % visible.length]); break;
      // Ctrl+Shift+PageUp/PageDown (Chrome): a aba ativa anda uma casa; nas pontas do grupo dela
      // (fixadas / outras) fica parada.
      case 'move-tab-left': if (curIdx >= 0) store.moveTab(store.activeTabId, curIdx - 1); break;
      case 'move-tab-right': if (curIdx >= 0) store.moveTab(store.activeTabId, curIdx + 1); break;
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
      case 'clear-data': setMenuOpen(false); setClearDataOpen(true); break;
      case 'print': printPage('print'); break;
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

  // Classificador de intenção por IA: lê o contexto da aba atual (url+título) e decide o caminho
  // da caixa (agir / página atual / web / chat). Chamada barata (resposta de UMA palavra, stateless).
  // Retorna null em qualquer falha/timeout → o AgentCommandBar usa o roteador determinístico.
  const classifyIntent = useCallback(async (msg: string, rctx?: { lastRun?: RouteContext['lastRun'] }): Promise<RoutedIntent | null> => {
    // ── Roteador local (Qwen2.5-1.5B no utilityProcess), quando pronto: decide PRIMEIRO, na nuvem e
    // no local. Entende erro de digitação e follow-up ("só abriu uma janela") melhor que as regras.
    // Só rotula; falhou / "other" / demorou → segue o caminho de antes, abaixo.
    // Saudação/agradecimento curto ("valeu!", "thanks") → chat na hora, antes até do roteador:
    // 0 latência, e um "obrigado" nunca pode virar tarefa do agente.
    if (isGreeting(msg.trim().toLowerCase())) return 'chat';
    if (routerReadyRef.current && window.electronAPI?.routerClassify) {
      const tabUrl = store.activeTab?.url || '';
      const ctx: RouteContext = {
        url: isNewTabPage(tabUrl) ? '' : tabUrl,
        title: (store.activeTab as any)?.title || '',
        lastRun: rctx?.lastRun ?? null,
      };
      const r = await raceTimeout(window.electronAPI.routerClassify(msg, ctx).catch(() => null), 5000, null);
      const intent = routeToIntent(parseRoute(r?.route), !!ctx.lastRun);
      if (intent) return intent;
      // O AgentCommandBar pulou as regras de "última tarefa" contando com o roteador → aplica aqui.
      if (ctx.lastRun) {
        if (reportsIncompleteRun(msg)) return 'fix';
        if (isAboutLastRun(msg)) return 'last_run';
      }
    }
    // ── Pré-classificador determinístico (0 token, 0 latência) ──
    // Padrões de ALTA precisão resolvem na hora os casos óbvios — a resposta começa já,
    // sem esperar o round-trip (até 6s) do classificador na nuvem. Só entra aqui o que é
    // inequívoco; qualquer dúvida segue pro classificador de sempre (conservador).
    try {
      const m = msg.trim().toLowerCase();
      if (isGreeting(m)) return 'chat';
      const hasUrl = /https?:\/\/|www\.[a-z0-9-]+|[a-z0-9-]+\.(com|org|net|gov|edu|io|co|br|app|dev|ai)\b/.test(m);
      const actionVerb = /\b(abra|abre|abrir|acesse|acessa|entre em|v[aá] (pra|para|em|no|na)|baixe|baixa|baixar|toque|toca|tocar|reproduza|clique|clica|clicar|compre|compra|comprar|pesquise|pesquisa|procure|busque|assine|assina|fa[çc]a login|logue|preencha|envie|mande|poste|crie|monte|gere|corte|open|go to|browse|browsing|navigate|visit|apply|download|play|click|buy|search for|subscribe|log ?in|fill|send|post|create|make|generate|cut|abre|descarga|reproduce|compra|busca|crea)\b/.test(m);
      if (!actionVerb && !hasUrl) {
        const questionStart = /^(o ?que|oq\b|qual|quais|quem|como|por ?qu[eê]|pra ?que|para ?que|quando|onde|cad[êe]|what|who|whose|how|why|when|where|which|cu[áa]l(es)?|qu[ée]\b|qui[ée]n|c[óo]mo|por ?qu[ée]|cu[áa]ndo|d[óo]nde)\b/.test(m);
        const questionEnd = /\?\s*$/.test(m);
        if (questionStart || questionEnd) {
          // Pergunta sobre o próprio assistente → chat (a identidade da engine responde).
          if (/\b(voc[êe]|vc|you|tu|usted)\b/.test(m)) return 'chat';
          const aboutPage = /\b(ess[ae]|est[ae]|dess[ae]|dest[ae]|ness[ae]|nest[ae]) (p[áa]gina|aba|site|v[íi]deo|texto|artigo)|this (page|tab|site|video|article)|esta (p[áa]gina|pesta[ñn]a|web|video)|\bresum[air]|\bsummar|traduz|translate|traduce/.test(m);
          // Demonstrativo apontando pra tela ("esse produto é bom?", "vale a pena?") COM uma
          // página real aberta → é sobre a página (anexa o conteúdo), não busca web. Preço tem
          // fluxo próprio (não sequestrar). Determinístico → não depende do round-trip lento.
          const url = store.activeTab?.url || '';
          const realPage = /^https?:\/\//.test(url) && !isNewTabPage(url);
          const priceish = /\b(quanto\s+custa|pre[çc]o|how\s+much|\bcost\b|barat)/i.test(m);
          if (aboutPage || (realPage && !priceish && pointsAtOpenScreen(m))) return 'page';
          return 'web';
        }
      }
    } catch {}
    // MODO LOCAL: o classificador da IA (stage B) rodaria no gpt-oss lento — até 6s de espera
    // (trava: "nem se mecheu") e ainda é mau classificador. Pula direto pro roteador
    // determinístico (0 token, instantâneo) → o local fica rápido e previsível. A nuvem
    // (classificador esperto e rápido) segue usando o stage B abaixo. Não toca o caminho nuvem.
    if (store.localSettings.enabled) return null;
    try {
      const url = store.activeTab?.url || '';
      const title = (store.activeTab as any)?.title || '';
      const prompt =
`Classify the user's message for a browser assistant into ONE label. Reply with ONLY the word.

ACTION = wants the browser to DO something (open/go to a site, click, buy, download, play a video, make a supercut, create a playlist, log in, fill/submit a form, subscribe).
PAGE = asking about the CURRENTLY OPEN tab/page/video (summarize this, what is this page/video about, info about this tab, what does it say, translate this page).
WEB = wants info that needs a web search (facts, news, prices/comparisons of things not currently open, "what is X", "who is Y").
CHAT = greeting or small talk.

Current tab URL: ${url || '(blank)'}
Current tab title: ${title || '(blank)'}
User message: """${msg}"""

Answer with one word: ACTION, PAGE, WEB, or CHAT.`;
      const r = await raceTimeout(
        window.electronAPI?.aiChat(prompt, '', true, store.localSettings.enabled) ?? Promise.resolve(undefined),
        6000,
        undefined,
      );
      const out = (r?.response || '').toUpperCase();
      if (out.includes('ACTION')) return 'action';
      if (out.includes('PAGE')) return 'page';
      if (out.includes('WEB')) return 'web';
      if (out.includes('CHAT')) return 'chat';
      return null;
    } catch {
      return null;
    }
  }, [store.activeTab, store.localSettings.enabled]);

  /** ONE capture per step, three consumers: change-detection hash + feed thumbnail,
   *  local OCR, and (when the vision gate allows) the model. Deriving them from the same
   *  NativeImage is what stops OCR and the model from describing different frames.
   *  The model image is downscaled JPEG (never upscaled); OCR keeps the full-res PNG,
   *  because vision encoders blur small type that Tesseract reads exactly. */
  const captureFrame = useCallback(async (o: { image: boolean; png: boolean; agentVision?: boolean; crop?: { x: number; y: number; w: number; h: number } | null }): Promise<{
    thumb?: string;
    image?: VisionImage;
    png?: string;
  } | undefined> => {
    const wv = getActiveWebview();
    if (!wv) return undefined;
    try {
      const img = await wv.capturePage();
      const size = img.getSize();
      const out: { thumb?: string; image?: VisionImage; png?: string } = {};
      out.thumb = img.resize({ width: 480, quality: 'good' }).toDataURL();
      if ((o.image || o.png) && size.width >= VISION_MIN_SIDE && size.height >= VISION_MIN_SIDE) {
        if (o.png) out.png = img.toDataURL();               // full-res frame for OCR
        if (o.image) {
          // The guest's own viewport (what elementFromPoint and clicks use), not the
          // <webview> element box, which diverges under page zoom.
          const vp = await Promise.race([
            wv.executeJavaScript('({w: window.innerWidth, h: window.innerHeight})') as Promise<{ w: number; h: number }>,
            new Promise<null>(r => setTimeout(() => r(null), 1500)),
          ]).catch(() => null);
          const cssW = vp?.w || wv.clientWidth || size.width;
          const cssH = vp?.h || wv.clientHeight || size.height;
          // Size off the CSS viewport: up to VISION_MAX_SIDE the screenshot pixels ARE the
          // CSS pixels, so click_at needs no scaling at all. Never upscaled.
          // Agent vision frames go up to VISION_AGENT_MAX_SIDE; other paths keep 1280.
          const cap = o.agentVision ? VISION_AGENT_MAX_SIDE : VISION_MAX_SIDE;
          // look_at: recorta a área pedida nos pixels NATIVOS do frame (Retina = 2x) — nítido,
          // em vez da página inteira encolhida. Nunca amplia além do nativo.
          if (o.crop) {
            const k = size.width / cssW;
            const cx = Math.max(0, Math.min(cssW - 1, o.crop.x)), cy = Math.max(0, Math.min(cssH - 1, o.crop.y));
            const cw = Math.max(1, Math.min(cssW - cx, o.crop.w)), ch = Math.max(1, Math.min(cssH - cy, o.crop.h));
            const piece = img.crop({ x: Math.round(cx * k), y: Math.round(cy * k), width: Math.round(cw * k), height: Math.round(ch * k) });
            const ps = piece.getSize();
            const pscale = Math.min(1, cap / Math.max(ps.width, ps.height));
            const pDataUrl = piece.resize({ width: Math.max(1, Math.round(ps.width * pscale)), height: Math.max(1, Math.round(ps.height * pscale)), quality: 'best' }).toDataURL();
            const pb64 = pDataUrl.slice(pDataUrl.indexOf(',') + 1);
            const pReal = encodedImageSize(base64Head(pb64));
            out.image = {
              dataUrl: pDataUrl,
              width: pReal?.width ?? Math.round(ps.width * pscale), height: pReal?.height ?? Math.round(ps.height * pscale),
              cssWidth: cw, cssHeight: ch, bytes: Math.floor(pb64.length * 3 / 4),
            };
            return out;
          }
          const scale = Math.min(1, cap / Math.max(cssW, cssH));
          const w = Math.max(1, Math.round(cssW * scale));
          const h = Math.max(1, Math.round(cssH * scale));
          // PNG aqui, nunca toJPEG(): neste renderer (sandbox) o toJPEG() derruba o processo
          // inteiro (medido: FATAL "V8 error: Empty MaybeLocal" → a janela do Bah apaga).
          // O processo principal converte pra JPEG antes de mandar pro modelo.
          const dataUrl = img.resize({ width: w, height: h, quality: 'good' }).toDataURL();
          const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          // Report the ENCODED size: on HiDPI the bitmap can differ from the requested DIP size.
          const real = encodedImageSize(base64Head(b64));
          out.image = {
            dataUrl,
            width: real?.width ?? w, height: real?.height ?? h,
            cssWidth: cssW, cssHeight: cssH, bytes: Math.floor(b64.length * 3 / 4),
          };
        }
      }
      return out;
    } catch {
      return undefined;
    }
  }, [getActiveWebview]);

  const captureScreenshot = useCallback(async (): Promise<string | undefined> => {
    return (await captureFrame({ image: false, png: false }))?.thumb;
  }, [captureFrame]);

  // ── PESQUISA RÁPIDA (estilo Perplexity/Comet) ──────────────────────────────
  // Para perguntas/pesquisas, NÃO dirige o navegador na cara do usuário: abre uma
  // aba em SEGUNDO PLANO no Google (Bing de fallback), raspa os snippets dos
  // resultados, manda pro modelo sintetizar e devolve a resposta + fontes pro
  // PAINEL onde o usuário digita. A aba dele não muda; ele não "lê a página".
  // Busca na web por baixo dos panos: tenta os buscadores em ordem (preferido primeiro; Google,
  // Bing, DuckDuckGo, Yahoo, Perplexity) numa aba OCULTA até um render ≥2 resultados. Quem mostrar
  // página de bloqueio fica marcado por 1h (pesquisa E agente pulam). Usada pela pesquisa rápida
  // e pela ação web_search do agente.
  const searchWebResults = useCallback(async (query: string): Promise<{ results: Array<{ title: string; snippet: string; url: string }>; engine?: string; blocked: boolean; error?: string }> => {
    const q = (query || '').trim();
    if (!q) return { results: [], blocked: false, error: 'Empty query.' };
    // Teste E2E: resultados fixos (main só devolve algo com NODE_ENV=test) — nada de buscador de verdade.
    const fixed = await window.electronAPI?.e2eSearchResults?.(q).catch(() => null);
    if (Array.isArray(fixed)) return { results: fixed.slice(0, 6), engine: 'E2E', blocked: false };
    const engines = engineOrder();
    // Perguntou numa aba anônima: a busca escondida também é anônima.
    const bgId = store.addHiddenTab(engines[0].url(q), opensIncognito('from-tab', aiOnIncognito()));
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
      if (!bgWv) return { results: [], blocked: false, error: 'Could not open the search right now.' };
      // Buscador pediu verificação (anti-robô)? Checa a página ATUAL antes de trocar de buscador.
      const looksBlocked = async () => {
        try {
          const txt = await raceTimeout(bgWv!.executeJavaScript(`location.href + ' ' + document.title + ' ' + (document.body ? document.body.innerText.slice(0,2000) : '')`, false), 3000, '');
          return SEARCH_BLOCK_RE.test(String(txt || ''));
        } catch { return false; }
      };
      let results = await scrape(bgWv);
      let engine = engines[0].label;
      let blocked = false;
      for (let i = 1; results.length < 2 && i <= engines.length; i++) {
        if (await looksBlocked()) { blocked = true; markBlocked(engines[i - 1].id); }
        if (i === engines.length) break;
        try { await bgWv.loadURL(engines[i].url(q)); } catch {}
        const more = await scrape(bgWv);
        if (more.length > results.length) { results = more; engine = engines[i].label; }
      }
      return { results, engine: results.length ? engine : undefined, blocked };
    } finally {
      try { store.closeTab(bgId); } catch {}   // remove a aba oculta (nunca foi vista)
    }
  }, [store]);

  const runWebResearch = useCallback(async (query: string): Promise<{ answer: string; sources: Array<{ title: string; url: string }>; isError?: boolean }> => {
    const q = (query || '').trim();
    if (!q) return { answer: 'Empty question.', sources: [], isError: true };
    const found = await searchWebResults(q);
    const { blocked, error } = found;
    // Página do PRÓPRIO buscador (search.google, google.com/search, bing.com/search…) não é fonte:
    // não diz nada sobre o assunto e aparecia como "Sources: search.google" duas vezes.
    const results = found.results.filter(x => !isSearchEnginePage(x.url));
    if (results.length === 0) {
      return {
        answer: error || (blocked
          ? 'Every search engine asked for a "confirm you are human" check, so I could not read the results. Try again later, or pick another engine in the menu (🔎 Search engine).'
          : 'I did not find useful results for this search right now. Could you rephrase?'),
        sources: [],
        isError: true,
      };
    }
    const snippetsBlock = results.map((x, i) => `[${i + 1}] ${x.title}\n${x.snippet || ''}\n(${x.url})`).join('\n\n');
    const prompt = `Pergunta do usuário: "${q}"\n\nResultados de busca da web (de HOJE):\n${snippetsBlock}\n\nResponda à pergunta de forma DIRETA e útil em ${uiLangName()}, usando SOMENTE estes resultados. Cite as fontes pelo nome do site entre parênteses (ex.: (Wikipedia)). Seja conciso: no máximo ~6 linhas ou uma lista curta. Se os resultados não responderem com clareza, diga o que dá pra concluir. NÃO escreva nenhuma linha [[ACTION:]].`;
    const r = await window.electronAPI?.aiChat(prompt, '', true, store.localSettings.enabled);   // stateless: não polui o histórico
    const ok = (r?.response || '').trim();
    // Falha da IA na síntese NÃO pode se disfarçar de resposta: vira aviso vermelho com
    // dica (era o caso em que a pessoa via o status ciclando e nunca um resultado claro).
    // O prompt pede pra não propor ação, mas o modelo local às vezes escreve [[ACTION: …]] mesmo assim:
    // nunca aparece cru na resposta.
    const clean = ok.replace(/\[\[\s*ACTION\s*:[^\]]*\]\]/ig, '').trim();
    const answer = clean || (r?.error ? `Error summarizing: ${r.error}` : 'Could not summarize the results.');
    return { answer, sources: results.map(x => ({ title: x.title, url: x.url })), isError: !clean };
  }, [store, searchWebResults]);

  // ── VITRINE DE NOVIDADES (placeholder dinâmico) ────────────────────────────
  // Puxa manchetes recentes pra ciclar no placeholder da caixa. Reusa o vertical de
  // Notícias do Google (udm=12) + o NEWS_EXTRACTOR_JS do google_news, numa aba OCULTA
  // (mesmo padrão da Pesquisa Rápida — não aparece, não vaza). Devolve só os títulos.
  // O tópico (contextual) e o cache ficam no AgentCommandBar.
  const fetchNewsHeadlines = useCallback(async (query: string): Promise<string[]> => {
    const q = (query || 'artificial intelligence').trim();
    const bgId = store.addHiddenTab(`https://www.google.com/search?q=${encodeURIComponent(q)}&udm=12&${googleLocaleParams()}`, opensIncognito('from-tab', aiOnIncognito()));
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

  // Menu do botão direito numa aba: cada item age na aba CLICADA (que pode não ser a ativa).
  // Chip / menu das sessões do agente (TabBar) → store.
  const onSessionCommand = useCallback((cmd: SessionCommand) => {
    switch (cmd.kind) {
      case 'rename': store.renameSession(cmd.id, cmd.name); break;
      case 'color': store.recolorSession(cmd.id, cmd.color); break;
      case 'join': store.joinTabToSession(cmd.tabId, cmd.sessionId); break;
      case 'leave': store.leaveTabSession(cmd.tabId); break;
      case 'new': {
        const tab = store.tabs.find(x => x.id === cmd.tabId);
        store.leaveTabSession(cmd.tabId);
        store.ensureSession(cmd.tabId, { url: tab?.url });
        break;
      }
      case 'new-tab': {
        const id = store.addTab();
        store.joinTabToSession(id, cmd.sessionId);
        break;
      }
    }
  }, [store]);
  const onTabCommand = (cmd: TabCommand, id: string) => {
    const tab = store.tabs.find(x => x.id === id && !x.hidden);
    if (!tab) return;
    switch (cmd) {
      // Na aba anônima, a nova à direita também é anônima (a cópia do "Duplicar" também: store).
      case 'new-right': store.addTabAfter(id, undefined, opensIncognito('from-tab', tab.incognito) ? { incognito: true } : undefined); break;
      case 'duplicate': store.duplicateTab(id); break;
      case 'reload':
        // Aba dormindo (Memory Saver) ou que voltou da última sessão não tem webview: acordar já carrega.
        if (tab.discarded) store.updateTab(id, { discarded: false, restored: false, lastActiveAt: Date.now() });
        else { try { webviewRefs.current.get(id)?.reload(); } catch {} }
        break;
      case 'pin': case 'unpin': store.setPinned(id, cmd === 'pin'); break;
      case 'mute': case 'unmute': siteMute.setMuted(tab.url, cmd === 'mute', tab.incognito); break;
      case 'close': store.closeTab(id); break;
      case 'close-others': store.closeTabs(closeOthersIds(store.tabs, id)); break;
      case 'close-right': store.closeTabs(closeRightIds(store.tabs, id)); break;
      case 'reopen': store.reopenClosedTab(); break;
    }
  };

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
            onMove={store.moveTab}
            onCommand={onTabCommand}
            isMuted={siteMute.isMuted}
            canReopen={store.hasClosedTabs}
            sessions={store.sessions}
            onSession={onSessionCommand}
            keptReason={id => (memKept[id] ? t('memsaver.kept', { reason: t(`memsaver.reason.${memKept[id]}`) }) : undefined)}
          />
        </div>
        <HwMonitor />
        <button
          className={`ai-toggle top-bar-ai ${store.sidebarOpen ? 'active' : ''}`}
          onClick={() => store.setSidebarOpen(!store.sidebarOpen)}
          title={t('ai.toggle')}
        >
          <svg width="18" height="18" viewBox="5 2 14 14" fill="currentColor"><path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6L5.7 8.8l4.6-1.7L12 2.5z"/></svg>
          <span>{t('ai.short')}</span>
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

      <div className={`address-bar-row${activeIncognito ? ' incognito' : ''}`}>
        <AddressBar
          // Aba nova (página do buscador) e aba anônima ainda em branco: barra vazia.
          url={isNewTabPage(store.activeTab.url) || (activeIncognito && isIncognitoBlank(store.activeTab.url)) ? '' : store.activeTab.url}
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
          incognito={activeIncognito}
        />
        <ExtensionsToolbar incognito={activeIncognito} getActiveWcId={() => {
          // A aba que a pessoa vê (não a de trabalho do agente). Lança até a webview anexar.
          try { const id = (webviewRefs.current.get(store.activeTabId) as any)?.getWebContentsId?.(); return typeof id === 'number' ? id : null; } catch { return null; }
        }} />
        <div className="menu-wrap">
          <button
            className={`menu-btn${downloads.some(d => d.state === 'started' || d.state === 'progress') ? ' dl-active' : ''}`}
            onClick={() => { setDownloadsOpen(o => !o); setDlSettingsOpen(false); }}
            title={t('downloads.open')}
          >
            {/* Seta normal; com download ativo, o anel de progresso do Chrome em volta dela. */}
            <DownloadButtonIcon downloads={downloads} />
          </button>
          {downloadsOpen && (
            <>
              <div className="menu-overlay" onClick={() => setDownloadsOpen(false)} />
              <div className="menu-panel downloads-panel">
                <div className="dl-head">
                  <span>⬇️ {dlSettingsOpen ? t('dlset.title') : t('downloads.title')}</span>
                  <span className="dl-head-actions">
                    {!dlSettingsOpen && downloads.length > 0 && <button className="history-clear" onClick={() => setDownloads([])}>{t('downloads.clear')}</button>}
                    {/* Engrenagem: configurações do gerenciador (várias conexões, pasta, tentativas). */}
                    <button className={`dl-gear${dlSettingsOpen ? ' on' : ''}`} title={dlSettingsOpen ? t('dlset.back') : t('dlset.open')} onClick={() => setDlSettingsOpen(o => !o)}>
                      {dlSettingsOpen ? '✕' : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      )}
                    </button>
                  </span>
                </div>
                {dlSettingsOpen ? (
                  <div className="dl-settings">
                    <label className="dl-set-switch">
                      <input type="checkbox" checked={dlEngine.enabled} onChange={e => updateDlEngine({ enabled: e.target.checked })} />
                      <span className="dl-set-txt">{t('dlset.enabled')}<small>{t('dlset.enabledHint')}</small></span>
                    </label>
                    <label className={`dl-set-row${dlEngine.enabled ? '' : ' off'}`}>
                      <span>{t('dlset.connections')}</span>
                      <select value={dlEngine.connections} disabled={!dlEngine.enabled} onChange={e => updateDlEngine({ connections: Number(e.target.value) })}>
                        {[1, 2, 4, 8, 16, 32].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <div className="dl-set-row dl-set-col">
                      <span>{t('dlset.folder')}</span>
                      <div className="dl-dir-line">
                        <span className="dl-dir-path" title={dlDir}>{dlDir || '…'}</span>
                        <button className="dl-set-btn" onClick={chooseDlDir}>{t('dlset.change')}</button>
                        {dlDir && <button className="dl-set-btn dl-set-icon" title={t('media.openFolderTitle')} onClick={() => window.electronAPI?.revealInFolder?.(dlDir)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>}
                      </div>
                      {!!localStorage.getItem('dlDir') && <button className="dl-set-link" onClick={resetDlDir}>{t('dlset.resetFolder')}</button>}
                    </div>
                    <details className="dl-set-adv">
                      <summary>{t('dlset.advanced')}</summary>
                      <label className="dl-set-row"><span>{t('dlset.retries')}</span>
                        <input type="number" min={0} max={30} value={dlEngine.maxRetries} onChange={e => updateDlEngine({ maxRetries: Number(e.target.value) })} /></label>
                      <label className="dl-set-row"><span>{t('dlset.minSegment')}</span>
                        <input type="number" min={0.25} max={64} step={0.25} value={dlEngine.minSegmentMB} onChange={e => updateDlEngine({ minSegmentMB: Number(e.target.value) })} /></label>
                      <label className="dl-set-row"><span>{t('dlset.connectTimeout')}</span>
                        <input type="number" min={3} max={120} value={dlEngine.connectTimeoutS} onChange={e => updateDlEngine({ connectTimeoutS: Number(e.target.value) })} /></label>
                      <label className="dl-set-row"><span>{t('dlset.readTimeout')}</span>
                        <input type="number" min={5} max={300} value={dlEngine.readTimeoutS} onChange={e => updateDlEngine({ readTimeoutS: Number(e.target.value) })} /></label>
                      <small className="dl-set-hint">{t('dlset.advancedHint')}</small>
                    </details>
                    <button className="dl-set-link" onClick={() => updateDlEngine({ ...DL_ENGINE_DEFAULTS })}>{t('dlset.defaults')}</button>
                  </div>
                ) : downloads.length === 0 ? (
                  <div className="history-empty">{t('downloads.empty')}</div>
                ) : (
                  <ul className="dl-list">
                    {downloads.map((d, i) => {
                      const pct = d.totalBytes ? Math.min(100, Math.round(((d.bytes || 0) / d.totalBytes) * 100)) : 0;
                      const active = d.state === 'started' || d.state === 'progress' || d.state === 'queued';
                      const label = d.state === 'queued' ? t('dl.queued')
                        : d.paused ? t('dl.paused')
                        : d.stalled && (d.state === 'started' || d.state === 'progress') ? t('dl.stalled')
                        : (d.state === 'started' || d.state === 'progress') ? t('dl.downloading')
                        : d.state === 'completed' ? t('dl.done')
                        : d.state === 'blocked' ? t('dl.blocked')
                        : d.state === 'cancelled' ? t('dl.cancelled')
                        : d.reasonCode === 'interrupted' ? t('dl.interrupted')
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
                          {/* Mapa do arquivo (igual ao IDM Caseiro): cada fatia pinta o que já baixou. */}
                          {active && d.engine && d.map && d.map.length > 1 ? (
                            <div className="dl-map" title={t('dl.mapTitle')}>
                              {d.map.map(([a, , w], k) => <span key={k} style={{ left: (a * 100) + '%', width: Math.max(0, (w - a) * 100) + '%' }} />)}
                            </div>
                          ) : null}
                          <div className="dl-row2">
                            <span className="dl-meta">
                              {fmtSize(d.bytes)}{d.totalBytes ? ' / ' + fmtSize(d.totalBytes) : ''}
                              {active && !d.paused && d.speedBps ? ' · ' + fmtSpeed(d.speedBps) : ''}
                              {active && !d.paused && d.etaSec != null ? ' · ' + fmtEta(d.etaSec) : ''}
                              {active && !d.paused && d.engine && d.connections ? ` · ${d.connections} ${t('dl.conns')}` : ''}
                              {d.state === 'failed' && d.reasonCode === 'not-merged' ? t('dl.notMerged') : ''}
                              {d.state === 'failed' && d.reasonCode === 'no-audio' ? t('dl.noAudio') : ''}
                              {d.state === 'completed' && (d.vcodec || d.acodec) ? (() => { const r = codecReport(d.vcodec, d.acodec); return r ? ` · ${r.label}${r.quicktime ? '' : ' — ' + t('dl.useVlcShort', { codec: r.blocker })}` : ''; })() : ''}
                            </span>
                            <span className="dl-actions">
                              {/* Vídeo do botão "Baixar" do YouTube (yt-dlp): não pausa; cancelar
                                  e tentar de novo vão pro job de vídeo, não pro download comum. */}
                              {d.id && active && d.kind !== 'video' && d.kind !== 'agent' && (
                                (d.paused || d.state === 'queued')
                                  ? <button title={t('dl.resume')} onClick={() => window.electronAPI?.resumeDownload?.(d.id!)}>▶</button>
                                  : <button title={t('dl.pause')} onClick={() => window.electronAPI?.pauseDownload?.(d.id!)}>⏸</button>
                              )}
                              {d.id && active && <button title={t('dl.cancel')} onClick={() => d.kind === 'video' ? window.electronAPI?.cancelVideoDownload?.(d.id!) : window.electronAPI?.cancelDownload?.(d.id!)}>✕</button>}
                              {(d.state === 'failed' || d.state === 'cancelled') && <button title={t('dl.retry')} onClick={() => d.kind === 'video' ? window.electronAPI?.retryVideoDownload?.(d.id || '') : window.electronAPI?.retryDownload?.(d.id || '', d.url)}>↻</button>}
                              {/* Ícones que dizem o que fazem: seta "abrir" = abre o arquivo; pasta = mostra
                                  na pasta; elo = copia o link. (Antes o 📂 abria o ARQUIVO e o 🗂 não parecia nada.) */}
                              {d.state === 'completed' && d.path && <button title={t('dl.openFile')} onClick={() => window.electronAPI?.openFile?.(d.path!)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></button>}
                              {d.path && <button title={t('dl.showInFolder')} onClick={() => window.electronAPI?.revealInFolder?.(d.path!)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>}
                              {d.url && <button title={t('dl.copyUrl')} onClick={() => { try { navigator.clipboard.writeText(d.url!); } catch {} }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>}
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
              <div
                className="menu-panel"
                onMouseOver={e => {
                  // Mouse foi pra OUTRO item do ⋮ → o submenu de favoritos fecha (com folga, igual ao Chrome).
                  const item = (e.target as HTMLElement).closest('.menu-item');
                  if (favMenuOpen && item && !item.classList.contains('menu-fav-trigger')) favHover(false, 300);
                }}
              >
                {/* Nova aba anônima (o "Nova janela anônima" do Chrome, em aba): Ctrl+Shift+N. */}
                <button className="menu-item" onClick={() => { setMenuOpen(false); void openIncognitoTab(); }} title={t('incog.menuTitle')}>
                  <span className="menu-ic">🕶️</span>
                  <span className="menu-label">{t('incog.newTab')}</span>
                  <span className="menu-kbd">{INCOGNITO_KEY}</span>
                </button>
                <div className="menu-sep" />
                <button
                  className={`menu-item menu-fav-trigger${favMenuOpen ? ' on' : ''}`}
                  onClick={() => { favHoverCancel(); setFavMenuOpen(true); }}
                  onMouseEnter={() => { if (!favMenuOpen) favHover(true, 200); else favHoverCancel(); }}
                  onMouseLeave={() => { if (!favMenuOpen) favHoverCancel(); }}
                  aria-haspopup="menu"
                  aria-expanded={favMenuOpen}
                >
                  <span className="menu-ic">⭐</span>
                  <span className="menu-label">{t('menu.favorites')}</span>
                  <span className="menu-chev">▸</span>
                </button>
                <div className="menu-sep" />
                <SearchEngineMenu />
                <button className="menu-item" onClick={() => cycleSearchEngine()} title={t('menu.searchEngineTitle')}>
                  <span className="menu-ic">🔎</span>
                  <span className="menu-label">{t('menu.searchEngine')}</span>
                  <span className="menu-switch on">{searchEngine === 'auto' ? t('menu.searchEngineAuto') : (ENGINES.find(e => e.id === searchEngine)?.label || 'Google')}</span>
                </button>
                <StartupMenu />
                <DefaultBrowserMenu />
                <button className="menu-item" onClick={() => toggleAdblock()} title={t('menu.adblockTitle')}>
                  <span className="menu-ic">🛡️</span>
                  <span className="menu-label">{t('menu.adblock')}</span>
                  <span className={`menu-switch ${adblockOn ? 'on' : ''}`}>{!adblockOn ? 'OFF' : (adblockActive ? 'ON' : 'BYPASS')}</span>
                </button>
                <button className="menu-item" onClick={() => toggleHwAccel()} title={t('menu.hwAccelTitle')}>
                  <span className="menu-ic">⚡</span>
                  <span className="menu-label">{t('menu.hwAccel')}</span>
                  <span className={`menu-switch ${hwAccelOn ? 'on' : ''}`}>{hwAccelOn ? 'ON' : 'OFF'}</span>
                </button>
                <MemorySaverMenu on={memSaverOn} onToggle={toggleMemSaver} level={memSaverLevel} onLevel={setMemSaverLevel}
                  keep={memSaverKeep} onKeep={setMemSaverKeep} currentUrl={store.activeTab.url} />
                {(['userTabs', 'history', 'clipboard'] as PermKind[]).map(k => (
                  <button key={k} className="menu-item" onClick={() => { setPerm(k, nextMode(getPerm(k))); setPermTick(x => x + 1); }} title={t('menu.agentPermTitle')}>
                    <span className="menu-ic">{k === 'userTabs' ? '🗂️' : k === 'clipboard' ? '📋' : '🕘'}</span>
                    <span className="menu-label">{t(k === 'userTabs' ? 'menu.agentPermTabs' : k === 'clipboard' ? 'menu.agentPermClipboard' : 'menu.agentPermHistory')}</span>
                    <span className={`menu-switch ${getPerm(k) === 'allow' ? 'on' : ''}`}>{t(`menu.perm.${getPerm(k)}` as any)}</span>
                  </button>
                ))}
                <button className="menu-item" onClick={() => toggleTorrentBuiltin()} title={t('menu.torrentBuiltinTitle')}>
                  <span className="menu-ic">🧲</span>
                  <span className="menu-label">{t('menu.torrentBuiltin')}</span>
                  <span className={`menu-switch ${torrentBuiltin ? 'on' : ''}`}>{torrentBuiltin ? 'ON' : 'OFF'}</span>
                </button>
                <button className="menu-item" onClick={() => toggleTorrentSeed()} title={t('menu.torrentSeedTitle')}>
                  <span className="menu-ic">🌱</span>
                  <span className="menu-label">{t('menu.torrentSeed')}</span>
                  <span className={`menu-switch ${torrentSeed ? 'on' : ''}`}>{torrentSeed ? 'ON' : 'OFF'}</span>
                </button>
                <button className="menu-item" onClick={() => setSwitchModelSilently(v => { const n = !v; try { localStorage.setItem('switchModelSilently', n ? '1' : '0'); } catch {} return n; })} title={t('menu.switchModelTitle')}>
                  <span className="menu-ic">🔁</span>
                  <span className="menu-label">{t('menu.switchModel')}</span>
                  <span className={`menu-switch ${switchModelSilently ? 'on' : ''}`}>{switchModelSilently ? 'ON' : 'OFF'}</span>
                </button>
                <button className="menu-item" onClick={() => toggleYtSkipAds()} title={t('menu.ytSkipAdsTitle')}>
                  <span className="menu-ic">👻</span>
                  <span className="menu-label">{t('menu.ytSkipAds')}</span>
                  <span className={`menu-switch ${ytSkipAds ? 'on' : ''}`}>{ytSkipAds ? 'ON' : 'OFF'}</span>
                </button>
                <button className="menu-item" onClick={() => toggleYtDlButton()} title={t('menu.ytDlButtonTitle')}>
                  <span className="menu-ic">⬇️</span>
                  <span className="menu-label">{t('menu.ytDlButton')}</span>
                  <span className={`menu-switch ${ytDlButton ? 'on' : ''}`}>{ytDlButton ? 'ON' : 'OFF'}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); window.electronAPI?.skillsOpenFolder?.(); }} title={t('menu.mySkillsTitle')}>
                  <span className="menu-ic">🧩</span>
                  <span className="menu-label">{t('menu.mySkills')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setDownloadsOpen(true); setDlSettingsOpen(true); }} title={t('menu.dlManagerTitle')}>
                  <span className="menu-ic">⚙️</span>
                  <span className="menu-label">{t('menu.dlManager')}</span>
                  <span className={`menu-switch ${dlEngine.enabled ? 'on' : ''}`}>{dlEngine.enabled ? `${dlEngine.connections}×` : 'OFF'}</span>
                </button>
                {folderGrants.length > 0 && (
                  <button className="menu-item" onClick={async () => { await window.electronAPI?.uploadRevokeAll?.(); setFolderGrants([]); }} title={t('menu.folderAccessTitle', { folders: folderGrants.map(g => g.path).join(', ') })}>
                    <span className="menu-ic">📂</span>
                    <span className="menu-label">{t('menu.folderAccess', { n: folderGrants.length })}</span>
                    <span className="menu-switch">{t('menu.folderRevoke')}</span>
                  </button>
                )}
                <button className="menu-item" onClick={() => toggleReadPage()} title={t('menu.readPageTitle')}>
                  <span className="menu-ic">{pageSpeaking ? '⏹️' : '🔊'}</span>
                  <span className="menu-label">{pageSpeaking ? t('menu.readPageStop') : t('menu.readPage')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); printPage('print'); }} title={t('menu.printTitle', { key: PRINT_KEY })}>
                  <span className="menu-ic">🖨️</span>
                  <span className="menu-label">{t('menu.print')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); printPage('pdf'); }} title={t('menu.savePdfTitle')}>
                  <span className="menu-ic">📄</span>
                  <span className="menu-label">{t('menu.savePdf')}</span>
                </button>
                <button className="menu-item" data-testid="menu-chat-history" onClick={() => { setMenuOpen(false); setChatHistoryOpen(true); }} title={t('chats.menuTitle')}>
                  <span className="menu-ic">🕘</span>
                  <span className="menu-label">{t('chats.menu')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setClearDataOpen(true); }} title={t('menu.clearDataTitle', { key: CLEAR_DATA_KEY })}>
                  <span className="menu-ic">🧹</span>
                  <span className="menu-label">{t('menu.clearData')}</span>
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setPasswordsOpen({}); }} title={t('pw.menuTitle')}>
                  <span className="menu-ic">🔑</span>
                  <span className="menu-label">{t('pw.menu')}</span>
                </button>
                {/* Entrar no Google / neste site trazem os cookies pro perfil NORMAL: numa aba anônima
                    não fariam sentido (e misturariam as duas) — ficam apagados, com o porquê. */}
                <button className="menu-item" disabled={activeIncognito} onClick={() => { setMenuOpen(false); handleGoogleLogin(); }} title={activeIncognito ? t('incog.loginOff') : t('menu.googleLoginTitle')}>
                  <span className="menu-ic">{googleLoggedIn ? '✓' : '🔑'}</span>
                  <span className={`menu-label${googleLoggedIn ? ' connected' : ''}`}>{googleLoggedIn ? t('menu.googleConnected') : t('menu.googleLogin')}</span>
                </button>
                {googleLoggedIn && (
                  <button className="menu-item" disabled={activeIncognito} onClick={() => { setMenuOpen(false); handleGoogleSwitch(); }} title={activeIncognito ? t('incog.loginOff') : t('menu.googleSwitchTitle')}>
                    <span className="menu-ic">🔄</span>
                    <span className="menu-label">{t('menu.googleSwitch')}</span>
                  </button>
                )}
                <button className="menu-item" disabled={activeIncognito} onClick={() => { setMenuOpen(false); handleSiteLogin(); }} title={activeIncognito ? t('incog.loginOff') : t('menu.siteLoginTitle')}>
                  <span className="menu-ic">🔓</span>
                  <span className="menu-label">{t('menu.siteLogin')}</span>
                </button>
                <button className="menu-item" data-testid="menu-scheduled" onClick={() => { setMenuOpen(false); setSchedOpen(true); }} title={t('sched.menuTitle')}>
                  <span className="menu-ic">⏰</span>
                  <span className="menu-label">{t('sched.title')}</span>
                  {sched.run?.status === 'waiting' && <span className="menu-kbd">{t('sched.waiting')}</span>}
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setMonitorsOpen(true); }} title={t('mon.menuTitle')}>
                  <span className="menu-ic">🛰️</span>
                  <span className="menu-label">{t('mon.title')}</span>
                </button>
              </div>
              {favMenuOpen && (
                <div className="menu-panel menu-flyout" onMouseEnter={favHoverCancel}>
                  <button className="menu-item" disabled={!/^https?:\/\//i.test(store.activeTab?.url || '')} onClick={() => {
                    const u = store.activeTab.url;
                    if (favorites.some(f => f.url === u)) removeFavorite(u); else saveFavorite();
                    setMenuOpen(false);
                  }}>
                    <span className="menu-ic">{favorites.some(f => f.url === store.activeTab?.url) ? '★' : '☆'}</span>
                    <span className="menu-label">{favorites.some(f => f.url === store.activeTab?.url) ? t('fav.removeThis') : t('fav.addThis')}</span>
                    <span className="menu-kbd">{BOOKMARK_KEY}</span>
                  </button>
                  <button className="menu-item" onClick={() => setFavIoOpen(o => !o)} title={t('fav.ioTitle')} aria-expanded={favIoOpen}>
                    <span className="menu-ic">↕️</span>
                    <span className="menu-label">{t('fav.io')}</span>
                    <span className="menu-chev">{favIoOpen ? '▾' : '▸'}</span>
                  </button>
                  {favIoOpen && (
                    <div className="menu-sub">
                      {favSources.map(s => (
                        <button key={s.id} className="menu-item" disabled={favBusy} onClick={() => importFavorites(s.id)}>
                          <span className="menu-ic">📥</span>
                          <span className="menu-label">{favBusy ? t('fav.busy') : t('fav.importFrom', { browser: s.name })}</span>
                        </button>
                      ))}
                      <button className="menu-item" disabled={favBusy} onClick={() => importFavorites('html')}>
                        <span className="menu-ic">📄</span>
                        <span className="menu-label">{favBusy ? t('fav.busy') : t('fav.importHtml')}</span>
                      </button>
                      <button className="menu-item" disabled={favBusy || favorites.length === 0} onClick={() => exportFavorites()}>
                        <span className="menu-ic">📤</span>
                        <span className="menu-label">{t('fav.export')}</span>
                      </button>
                    </div>
                  )}
                  <div className="menu-sep" />
                  {favorites.length === 0 ? (
                    <div className="menu-empty">{t('menu.noFavorites')}</div>
                  ) : (
                    <div className="menu-favlist">
                      {/* Só o começo: com milhares importados, desenhar tudo travaria o menu. O resto acha pela barra de endereço. */}
                      {favorites.slice(0, FAV_MENU_MAX).map(f => (
                        <div key={f.url} className="fav-item">
                          <button className="fav-open" onClick={() => { navigate(f.url); setMenuOpen(false); }} title={f.title ? `${f.title}\n${f.url}` : f.url}>
                            <SiteIcon url={f.url} title={f.title} />
                            <span className="fav-title">{f.title || f.url}</span>
                          </button>
                          <button className="fav-del" onClick={() => removeFavorite(f.url)} title={t('fav.remove')}>✕</button>
                        </div>
                      ))}
                      {favorites.length > FAV_MENU_MAX && (
                        <div className="menu-empty">{favorites.length - FAV_MENU_MAX === 1 ? t('fav.moreOne') : t('fav.more', { n: (favorites.length - FAV_MENU_MAX).toLocaleString() })}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {monitorsOpen && (
            <>
              <div className="menu-overlay" onClick={() => setMonitorsOpen(false)} />
              <MonitorsPanel onClose={() => setMonitorsOpen(false)} />
            </>
          )}
        </div>
      </div>

      {/* Barra de favoritos (estilo Chrome) — aparece quando há favoritos salvos. */}
      {favorites.length > 0 && (
        <BookmarksBar items={favBarItems} onOpen={openFavorite} onRemove={removeFavorite} lang={getLang()} />
      )}

      <div className={`main-content ${store.sidebarOpen ? 'ai-open' : ''}`}>
        <div className="webview-area">
          <WebViewContainer
            tabs={store.tabs}
            activeTabId={store.activeTabId}
            webviewRefs={webviewRefs}
            onUpdateTab={(id, patch) => {
              store.updateTab(id, patch);
              // Registra no histórico só páginas reais de abas VISÍVEIS (ignora abas de
              // busca em segundo plano da Pesquisa Rápida) e nunca de aba anônima — é o mesmo
              // histórico que a barra de endereço usa pra sugerir.
              if (patch.url) {
                const tab = tabsRef.current.find(t => t.id === id) ?? store.tabs.find(t => t.id === id);
                if (tab && !tab.hidden && mayRecord('history', tab.incognito)) recordHistory(patch.url, patch.title);
              }
            }}
            onNewTab={store.addTab}
          />
          {/* Aba anônima que ainda não abriu nada: a explicação (desenhada aqui, sem internet). */}
          {activeIncognito && isIncognitoBlank(store.activeTab.url) && <IncognitoPage />}
          <PermissionPrompt ask={permAsks.find(a => a.tabId === store.activeTabId)} onAnswer={answerPerm} />
          {schedOpen && <ScheduledTasksPanel sched={sched} onClose={() => setSchedOpen(false)} />}
          <MissedRunsCard sched={sched} />
          <JsDialogHost />
          <PasswordSavePrompt offer={pwOffers.find(o => o.tabId === store.activeTabId)} onAnswer={answerPwOffer} onReveal={revealPwOffer} />
          {pwSuggest && pwSuggest.tabId === store.activeTabId && (
            <PasswordSuggest
              suggest={pwSuggest}
              getWebview={() => webviewRefs.current.get(pwSuggest.tabId) as unknown as HTMLElement | undefined}
              onPick={(entryId) => pickPwSuggest(pwSuggest.id, entryId)}
              onManage={() => { const host = pwSuggest.host; setPwSuggest(null); setPasswordsOpen({ query: host }); }}
              onClose={closePwSuggest}
            />
          )}
          <AgentVisualOverlay state={agentVisual} ripples={ripples} metrics={agentVisual === 'idle' ? null : liveMetrics} />
          {torrent && (
            <TorrentSheet
              torrent={torrent}
              onSetSaving={(i) => setTorrent(cur => cur ? { ...cur, saving: { ...cur.saving, [i]: true } } : cur)}
              onClose={() => { if (torrent.id) window.electronAPI?.torrentRemove?.(torrent.id, true); setTorrent(null); }}
            />
          )}
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
          {showGuide && (
            <AppGuideBar
              onStartTour={() => setShowTour(true)}
              onDismiss={() => { setShowGuide(false); try { localStorage.setItem('guideSeen', '1'); } catch {} }}
            />
          )}
          {showGoogleRelogin && (
            <div className="relogin-bar">
              <span className="relogin-text">🔑 {t('relogin.title')}</span>
              <button className="relogin-btn" onClick={() => { setShowGoogleRelogin(false); handleGoogleLogin(); }}>{t('relogin.btn')}</button>
              <button className="relogin-x" onClick={() => setShowGoogleRelogin(false)} title={t('relogin.dismiss')}>✕</button>
            </div>
          )}
          {showCookieFix && (
            <div className="relogin-bar">
              <span className="relogin-text">🍪 {t('cookiefix.title')}</span>
              <button className="relogin-btn" onClick={fixGoogleCookies}>{t('cookiefix.btn')}</button>
              <button className="relogin-x" onClick={() => setShowCookieFix(false)} title={t('relogin.dismiss')}>✕</button>
            </div>
          )}
        </div>

        {isResizing && <div className="resize-overlay" />}
        {/* Kept mounted even when closed so a running task survives toggling the sidebar */}
        <div className={`agent-side-panel-host ${store.sidebarOpen ? '' : 'collapsed'}`} style={store.sidebarOpen ? { width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth } : undefined}>
          {store.sidebarOpen && (
            <div className="panel-resize-handle" onMouseDown={startPanelResize} title={t('panel.resize')} />
          )}
          <AgentCommandBar
            activeTabId={store.activeTabId}
            tabIds={store.tabs.map(t => t.sessionId || t.id).join(',')}
            threadKeyOf={store.threadKeyOf}
            onEnsureSession={(tabId, text) => { store.ensureSession(tabId, { command: text }); }}
            onCreateSchedule={(command, spec) => { const task = sched.add(command, spec); return task ? { nextAt: task.nextAt } : null; }}
            schedNow={sched.now}
            viewSession={(() => {
              const sid = store.activeTab?.sessionId;
              const s = sid ? store.sessions.find(x => x.id === sid) : undefined;
              return s ? { id: s.id, name: s.name, color: s.color, tabs: store.tabs.filter(t => t.sessionId === sid && !t.hidden).length } : null;
            })()}
            onRenameSession={store.renameSession}
            pageOpen={/^https?:\/\//.test(store.activeTab?.url || '') && !isNewTabPage(store.activeTab?.url)}
            activeTabTitle={store.activeTab?.title}
            activeTabUrl={store.activeTab?.url}
            activeIncognito={activeIncognito}
            agentMaxSteps={agentMaxSteps}
            onAgentStepsChange={(n) => {
              setAgentMaxSteps(n);
              try { localStorage.setItem('agentMaxSteps', String(n)); } catch {}
            }}
            onToggleAgentDrive={toggleAgentDrive}
            onInterject={interjectToAgent}
            takeUnreadInterjections={takeUnreadInterjections}
            agentTimeLimitMin={agentTimeLimitMin}
            onAgentTimeLimitChange={(n) => {
              setAgentTimeLimitMin(n);
              try { localStorage.setItem('agentTimeLimitMin', String(n)); } catch {}
            }}
            onSuggestQuestions={async () => {
              // Perguntas de exemplo SOBRE a aba aberta (painel vazio). Stateless de propósito:
              // é enfeite/descoberta, não pode entrar no histórico da conversa nem influenciar
              // a próxima resposta. Conteúdo cortado curto — 3 perguntas não precisam da página
              // inteira, e isso mantém a chamada barata.
              try {
                const content = (await getPageContent()) || '';
                if (content.trim().length < 80) return [];
                const prompt = [
                  'Below is the content of a web page the user is looking at.',
                  'Write exactly 3 SHORT questions (max 10 words each) that this user would plausibly ask ABOUT THIS PAGE.',
                  'They must be answerable from the page. Be specific to its actual content — no generic questions.',
                  `Write them in ${getLang() === 'pt' ? 'Portuguese' : getLang() === 'es' ? 'Spanish' : 'English'}.`,
                  'Output ONLY the 3 questions, one per line, with no numbering, quotes or extra text.',
                  '',
                  '=== PAGE ===',
                  content.slice(0, 4000),
                ].join('\n');
                const r = await raceTimeout(
                  window.electronAPI?.aiChat(prompt, '', true, store.localSettings.enabled) ?? Promise.resolve(undefined),
                  12000,
                  undefined,
                );
                const raw = (r?.response || '').replace(/<think>[\s\S]*?<\/think>/g, '');
                return raw
                  .split('\n')
                  .map(l => l.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').replace(/^["'“”]|["'“”]$/g, '').trim())
                  .filter(Boolean)
                  .slice(0, 3);
              } catch { return []; }
            }}
            agentDrive={agentDrive}
            routerReady={routerStatus.state === 'ready'}
            routerStatus={routerStatus}
            panelOpen={store.sidebarOpen}
            onExecute={async (command, onProgress, signal, opts) => {
              const taskTabId = activeTabIdRef.current;   // aba de origem desta tarefa (não muda se o agente abrir abas)
              // Tarefa que começa numa aba anônima é anônima até o fim: as abas que ela abrir nascem
              // anônimas e nada dela fica guardado (nem o registro da tarefa, nem os passos no
              // agent.log, no main). Marcado ANTES do registro começar.
              privateTaskRef.current = !!tabsRef.current.find(t => t.id === taskTabId)?.incognito;
              if (privateTaskRef.current) window.electronAPI?.setPrivateAi?.(true);
              const runLog = startAgentRun(command);
              agentDialogsStart();   // alert/confirm das abas do agente seguem a política dele (js-dialogs.ts)
              taskRunningRef.current = true;   // a partir daqui, trocas MANUAIS de aba não mexem na aba do agente
              agentBusyTabsRef.current.add(taskTabId);   // Economia de memória: a sessão desta tarefa não dorme
              interjectRef.current = { running: true, queue: [], abortStep: null };
              // Suspende o bypass do adblock enquanto o agente trabalha: senão ele lê os
              // anúncios do YouTube/Google como se fossem conteúdo e age no anúncio errado.
              try { await window.electronAPI?.adblockSetAgentBusy?.(true); } catch {}
              // Downloads velhos (manuais/da tarefa anterior) não entram na história DESTA — exceto o
              // FIM de um download do agente em background que terminou depois da tarefa anterior:
              // a IA precisa saber que ele acabou e ONDE o arquivo está.
              downloadEventsRef.current = downloadEventsRef.current.filter(d =>
                agentDlIdsRef.current.has(d.id || d.path || d.filename) && (d.state === 'completed' || d.state === 'failed'));
              for (const d of downloadEventsRef.current) agentDlIdsRef.current.delete(d.id || d.path || d.filename);
              try {
              if (isTrashDestroyerCommand(command)) {
                const wv = getActiveWebview();
                if (!wv) return { error: 'No active webview', results: [] };
                setAgentVisual('observing');
                onProgress({ kind: 'status', message: 'Trash Destroyer: reading the page DOM...' });
                try {
                  const result = await runTrashDestroyer(wv, command, onProgress, signal);
                  const rdone = result.done as { reason?: string; success?: boolean };
                  finishAgentRun(runLog, rdone.success ? 'success' : 'failed', rdone.reason);
                  return result;
                } finally {
                  setAgentVisual('idle');
                }
              }
              const MAX_STEPS = agentMaxSteps > 0 ? agentMaxSteps : Infinity;   // 0 = ∞ (menu ⋮)
              const allResults: Array<{ action: BrowserAction; result: any }> = [];
              const thoughts: string[] = [];
              macroTraceRef.current = [];                      // nova gravação por run
              // Modo "Deixar a IA dirigir": desliga TODOS os desvios determinísticos deste run
              // (macro-replay, quick actions, atalho inicial, assistentes de Gmail/YouTube) —
              // a IA observa e decide cada passo. Lido no início do run (toggle vale pro próximo).
              // Atalhos determinísticos são MULETA DE MODELO FRACO: existem pra poupar token e
              // acertar o óbvio quando o cérebro é limitado (modo local). Com API na nuvem o
              // modelo raciocina melhor que qualquer heurística — e a heurística de recortar
              // palavras chegava a PICAR a frase ("abra o site do g1 e me diga as 3 principais
              // notícias de hoje" virava a busca "site g1 e diga 3 principais", trazendo lixo).
              // Então o padrão inverte por modo: NUVEM = a IA decide; LOCAL = o botão decide.
              const aiDrive = agentDriveRef.current || !store.localSettings.enabled;
              const repeatIntent = parseRepeatIntent(command); // "repete N vezes"?
              // Contexto da conversa: o GOAL pode ser um follow-up do pedido anterior
              // ("e com a palavra bom dia?" = repetir a tarefa anterior com outro termo).
              // A thread da sessão (pedidos, respostas do chat, tarefas, fatos, 📌), já no orçamento dela.
              const threadKey = store.threadKeyOf(taskTabId);
              const convoCtx = threadPromptBlock(threadKey);
              const threadTok = estimateThreadTokens(convoCtx);
              let trimNoticeShown = false;
              // Roteador local deixa o pedido PRECISO antes do modelo grande (request-expansion.ts):
              // "clipes de top gun" → "…do filme Top Gun de 1986, não Top Gun: Maverick (2022)". Só pedidos de
              // achar/baixar mídia com uma obra; sem modelo, lento ou saída ruim → vale o texto original.
              let understood = '';
              if (routerReadyRef.current && window.electronAPI?.routerExpand && shouldExpandRequest(command)) {
                const x = await raceTimeout(window.electronAPI.routerExpand(command).catch(() => null), 4000, null);
                if (x?.expanded) {
                  understood = x.expanded;
                  // 'thought' fica no feed (o 'status' some sozinho): a pessoa vê o que o Bah entendeu.
                  onProgress({ kind: 'thought', message: `🔎 ${t('router.understoodAs', { text: understood })}` });
                }
              }
              const understoodLine = () => understoodNote(understood);
              let history = `${convoCtx ? `PREVIOUS REQUESTS THIS SESSION (newest last — the GOAL below may be a FOLLOW-UP reusing their intent, e.g. "e com a palavra X?" means: redo the previous task with X; "it", "that", "this one", "the job" in the GOAL = the newest "last thing acted on" unless the GOAL names something else):\n${convoCtx}\n\n` : ''}GOAL: ${command}${understoodLine()}`;
              let previousStateKey = '';
              let noEffectCount = 0;
              // Vision: mode + how many images this run already sent (token/latency budget).
              // The setting lives with the LOCAL endpoint (Settings → Local AI) and only the local
              // engine carries it; the cloud engine would answer mode_off to every frame we sent.
              // An explicit choice in Settings wins; otherwise vision needs a GPU that can run it.
              let visionMode: VisionMode = store.localSettings.enabled
                ? defaultVisionMode(store.localSettings, gpuInfo())
                : 'off';
              let imagesSent = 0;
              let lastVisionReason = 'none';
              let prevStepUrl = '';
              // Screenshot the model actually saw on the last LLM step (with the size main
              // measured), so click_at maps from its pixels to the live viewport.
              let modelShot: { width?: number; height?: number } | undefined;
              // DISJUNTOR: em ∞ não há teto de passos nem relógio, então uma IA teimosa
              // poderia repetir a mesma ação pra sempre (= fatura de API infinita rodando a
              // noite toda). O detector de loop abaixo só AVISA; isto aqui conta as
              // reincidências e ENCERRA. Zera a cada ação produtiva, então só dispara em
              // travamento real, não em uma repetição ocasional.
              let loopStrikes = 0;
              const MAX_LOOP_STRIKES = 6;
              let consecutiveExtracts = 0;   // freio anti-coleta (modelo fraco re-extrai sem reportar)
              let lastExtractedText = '';    // último texto extraído (fallback de resposta se travar)
              // Structured agent state — visible to AI on every step
              let plan: string[] = [];
              let taskModel = modelLabelRef.current;   // modelo que a tarefa está usando
              const memory: Array<{ key: string; value: any; source?: string; ts: number }> = [];
              let replanRequested = false;
              let lastSeenUrl = '';
              let stepsOnSameUrl = 0;
              let usedInitialShortcut = false;
              const commandLooksLikeImageTextRead = looksLikeTextReadIntent(command);
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
              // Deadline calibrado pros 25 passos originais → escala com a escolha (50=2x, 100=4x).
              // Em ∞ o relógio também sai: tarefa longa (a noite toda) não pode morrer por
              // deadline. Só o Stop encerra. Nos demais, escala igual a antes.
              // A trava de tempo EXPLÍCITA (Configurações) manda sobre tudo. Desligada (0),
              // mantém o comportamento derivado dos passos — ∞ quando os passos são ∞.
              const TASK_DEADLINE_MS = agentTimeLimitMin > 0
                ? agentTimeLimitMin * 60 * 1000
                : (MAX_STEPS === Infinity
                    ? Infinity
                    : (store.localSettings.enabled ? 20 : 5) * (MAX_STEPS / 25) * 60 * 1000);
              const taskStartedAt = Date.now();
              // Cuts the step that is RUNNING: main cancels the in-flight request, so the model
              // stops generating instead of finishing a step nobody asked for any more.
              const deadline = createDeadline(taskStartedAt, TASK_DEADLINE_MS);
              let activeActionId = '';   // in-flight request, so the deadline can cancel it
              const onDeadline = () => { try { window.electronAPI?.actionCancel?.(activeActionId); } catch {} };
              deadline.signal.addEventListener('abort', onDeadline, { once: true });
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
              // look_at: a próxima captura vai pro modelo como recorte ampliado desta área (1 passo).
              let pendingZoom: { x: number; y: number; w: number; h: number; label: string } | null = null;
              // get_html / extract_text: a leitura vai INTEIRA no próximo pedido (bloco próprio — PAGE HTML /
              // PAGE TEXT (extracted) — depois da lista de elementos e antes do PAGE TEXT, pra o corte de
              // contexto local cortar texto da página e histórico antes dela). O RECENT HISTORY só leva os
              // últimos 2500 caracteres e cortaria o começo; no histórico fica só uma linha. Vale 1 passo.
              let pendingReads: string[] = [];
              // Tokens dos blocos de leitura do último pedido: o medidor conta com eles, mas eles saem no
              // passo seguinte — descontados no orçamento da próxima leitura (senão a página 2 encolhe).
              let shownReadTokens = 0;
              // Orçamento de UMA leitura (shared/read-paging.ts): cresce com o contexto livre do modelo.
              const readBudgetNow = () => {
                const u = contextUsageOf(threadKey);
                const window = u?.window || contextWindowNow();
                const used = u ? meterState({ ...u, window }).used : 0;
                return readBudget({ window, used: Math.max(0, used - shownReadTokens), local: store.localSettings.enabled });
              };
              // Último bloco do extract_text: o freio anti-coleta o mostra de novo em vez de re-extrair.
              let lastExtractBlock = '';
              // extract_text com offset novo é PAGINAÇÃO, não re-extração: não conta pro freio anti-coleta.
              const extractPagesRead = new Set<string>();
              // Arquivos que a PESSOA escolheu nesta tarefa (upload): o agente só reusa estes, pelo cartão.
              const taskUploads: Array<{ token: string; names: string[] }> = [];
              // Tipo de pedido (pro freio do "encerrou sem listar o que achou").
              const commandWantsDownload = /\b(down?load\w*|downlaod\w*|donwload\w*|downoad\w*|dwnload\w*|baix[ae]\w*|baixar|descarg\w+)\b/i.test(command);
              // O download é o ÚLTIMO passo do pedido? Sim → a tarefa acaba quando ele começa. Não ("baixe e
              // instale", "baixe os dois e compare") → o Bah espera TODOS os downloads da tarefa terminarem
              // antes do próximo passo, senão o modelo acha que o arquivo já está lá.
              const downloadIsLastStep = commandWantsDownload && !commandWantsSeveralFiles(command) && !commandHasFollowUp(command);
              // Pedido de download: não deixa encerrar "com sucesso" antes de QUALQUER download
              // começar (o modelo lê a página "Thank you for downloading" como arquivo baixado).
              let noDownloadYetBlocks = 0;
              const commandIsShopping = namesStore(command) || /\b(buy|price|prices|cheapest|compare|deal|deals|product|products|under \$?\d+|pre[cç]os?|barat\w*|comprar)\b/i.test(command);
              const commandIsPeople = /\b(people|person|contacts?|who works|employees?|profiles?|recruiters?|founders?|ceo|cto|cfo|coo|vp|directors?|head of|managers? at|engineers? at|linkedin)\b/i.test(command);
              const commandIsTravel = /\b(hotels?|motels?|lodging|accommodations?|airbnb|hostels?|resorts?|ski trip|flights?|rental cars?|car rentals?|hot[eé]is|hospedagem|pousadas?|voos?|hoteles|vuelos|alojamiento)\b/i.test(command);
              const commandWantsSearch = /\b(find|search|look up|compare|cheapest|available|list|show me|procur\w*|busc\w*|pesquis\w*|encontr\w*)\b/i.test(command);
              // Peça compatível com um modelo (carregador/fonte/bateria pra "Lenovo IdeaPad 3 15ADA05").
              const commandIsParts = /\b(charger|chargers|adapter|adaptor|power (supply|adapter|brick)|ac adapter|battery|replacement|compatible|part number|fru|fonte|carregador|bateria|cargador)\b/i.test(command);
              // Skills de navegação: carregadas uma vez por tarefa; escolhidas a cada passo.
              const allSkills: Skill[] = await window.electronAPI?.skillsList?.().catch(() => []) ?? [];
              // Tarefa agendada (ninguém olhando): enviar/publicar/reservar também espera a pessoa (risk.ts).
              const unattended = !!opts?.unattended;
              // Carrinho de mercado ("add milk, eggs… to my Walmart cart"): skill grocery-cart, cartões de produto com
              // as refs de Add/+/−, a lista do pedido contra o carrinho, e o freio que deixa editar o carrinho.
              const commandIsCart = commandIsGrocery(command);
              const groceryList = commandIsCart ? parseGroceryList(command) : [];
              const groceryInCart = new Map<string, number>();   // nome do produto → quantidade vista ("in cart"/carrinho)
              const groceryOutOfStock = new Set<string>();      // produtos vistos esgotados nesta tarefa
              const groceryAvailable = new Set<string>();       // produtos vistos à venda (com Add ou já no carrinho)
              let groceryTiles: ProductTile[] = [];             // cartões desta página (pra saber o que um ADD põe)
              const offListWarned = new Set<string>();
              let cartRenderProblem: string | null = null;      // render_view encerra a tarefa: mesma conferência do done
              let cartPageSeen = false;
              let cartCheckBlocks = 0;
              const riskOpts = { unattended, cart: commandIsCart };
              // Site cuidadoso: quantas navegações o agente já fez nele NESTA tarefa (máx. 1).
              let carefulNavs = 0, carefulRefusals = 0;
              // A última coisa em que o agente agiu (texto do clique + página): o próximo pedido pode dizer "it/that".
              let lastTarget = '';
              // Download que começou NESTA tarefa (não um que terminou depois, vindo da anterior).
              const ofThisTask = (d: any) => !!d && (d.startedAt ?? 0) >= taskStartedAt;
              let vagueFinishBlocks = 0;   // pedido de busca encerrado sem listar o que achou
              let unfinishedBlocks = 0;    // encerrou dizendo que "vai continuar"
              let planNudged = false;      // tarefa em vários sites sem plano
              let lastEvalText = '';       // avaliação/pensamento do passo anterior (checagem de "popup")
              let popupComplaints = 0, popupComplaintsUrl = '';
              const commandMultiSite = /\b(\d+|several|multiple|many|various|vários|varios|diversos)\s+(sites|stores|shops|websites|sellers|retailers|insurers|portals|lojas|sites)\b|\b(compare|comparar)\b.*\b(sites|stores|shops|lojas)\b/i.test(command);
              // Abas desta tarefa: a de partida + as que o agente abriu. Abas da PESSOA e o histórico
              // passam pela permissão (perguntar / sempre / nunca — menu ou resposta na pergunta).
              const agentOpenedTabs = new Set<string>();
              const grantedTabs = new Set<string>([taskTabId]);
              const askPermission = async (kind: PermKind, what: string): Promise<boolean> => {
                const mode = getPerm(kind);
                if (mode === 'allow') return true;
                if (mode === 'deny') return false;
                const label = kind === 'userTabs' ? 'one of your tabs' : kind === 'clipboard' ? 'what you copied (clipboard)' : 'your browsing history';
                const answer = await new Promise<PermAnswer>((resolve) => {
                  onProgress({ kind: 'confirm', risk: 'permission', label, title: `🔐 The agent wants to use ${label}`,
                    message: `${what}\nYou can change this later in the menu.`,
                    choices: [
                      { label: '✅ Allow for this task', value: 'once' }, { label: '✅ Always allow', value: 'always' },
                      { label: 'Deny', value: 'deny' }, { label: '🚫 Always deny', value: 'never' },
                    ],
                    onChoose: (v: string) => resolve(v as PermAnswer), onConfirm: () => resolve('once'), onCancel: () => resolve('deny') });
                });
                throwIfCancelled();
                return applyAnswer(kind, answer);
              };
              let localHelpPauses = 0;   // a dead local model pauses for help, it does not kill the run
              let lastActionSummary = '';  // what the previous step did
              let lastActionOutcome = '';  // what the page looked like after it
              let selfFailCount = 0;       // consecutive self-reported failures
              let planShown = false;       // the preview appears once per run, not every step
              // Observation reuse: carry the post-action observation of step N into step N+1
              // when the page hasn't changed — otherwise every step pays the full AXTree
              // observation (2-8s on heavy pages) twice. carriedOcrText rides along so
              // Tesseract isn't re-run on an unchanged page either.
              let carriedObservation: ObservedState | null = null;
              let carriedOcrText = '';
              // The frame travels with the carried observation: capture + resize + encode costs
              // ~200-600ms for pixels that are identical when the page did not change.
              let carriedShot: VisionImage | undefined = undefined;
              let carriedThumb: string | undefined = undefined;
              let carriedPng: string | undefined = undefined;
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
                rawReason?: string,
                errCtx?: { errorCode?: string; retryable?: boolean },
              ) => {
                // The code goes to the run log: "failed" with no code tells the user nothing
                // and tells the next retry nothing.
                if (errCtx?.errorCode) {
                  try { setRunError(runLog, errCtx.errorCode, errCtx.retryable === true); } catch {}
                }
                // NUNCA terminar sem explicação: um motivo vazio virava "falhou" mudo na tela
                // (e no histórico), sem o usuário saber o que houve. Se veio vazio/undefined,
                // usa um texto honesto conforme o desfecho.
                const reason = String(rawReason || '').trim() || (
                  status === 'success' ? 'Done.'
                  : status === 'cancelled' ? 'Task canceled by the user.'
                  : status === 'max_steps' ? 'Step limit reached.'
                  : "The task stopped before finishing and the model gave no reason. Try rephrasing it."
                );
                // A thread da sessão guarda o RESUMO da tarefa (o próximo pedido pode ser um follow-up):
                // objetivo, os últimos passos que deram certo, desfecho e o último alvo — não cada passo.
                const runsKey = store.threadKeyOf(taskTabId);   // sessão da aba de origem (abas da sessão dividem)
                const keySteps = allResults.filter(r => r.result?.success !== false && r.action?.type !== 'done' && r.action?.type !== 'report')
                  .slice(-4).map(r => { try { return formatAction(r.action); } catch { return String(r.action?.type || ''); } });
                noteThreadTask(runsKey, { goal: command, status, outcome: reason.slice(0, 300), steps: keySteps, target: lastTarget || undefined });
                // Run com passos de página bem-sucedidos = receita reaproveitável.
                // (Replays não regravam: a receita original é a fonte da verdade.)
                // "report" encerra como sucesso mesmo quando o texto diz que não deu ("Unable to locate…"):
                // isso não é receita pra guardar.
                const reportsFailure = /\b(unable|could ?n[o']t|cannot|can't|failed to|not able to|was ?n[o']t able|gave up|give up|giving up|unfortunately|did ?n[o']t (manage|work|find)|(is|was|are) not allowing|does ?n[o']t allow|no progress|não consegui|não foi possível|no pude)\b/i.test(reason);
                if (status === 'success' && !reportsFailure && !repeatIntent && (history.match(/\nSTEP \d+:/g) || []).length >= 3) {
                  void offerSkillSave(command, history, onProgress);
                }
                if (status === 'success' && !repeatIntent && macroTraceRef.current.length > 0) {
                  saveLastMacro({ command, steps: [...macroTraceRef.current], savedAt: Date.now() });
                  onProgress({ kind: 'status', message: `🧠 Sequence recorded (${macroTraceRef.current.length} step(s)). Say "repeat" or "repeat 100 times" to re-run it without spending AI.` });
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
              // Typing runs char-by-char in the main process; on Stop, tell main to abort
              // the in-flight type so it doesn't keep typing into the page after cancel.
              const realTypeCancellable = async (id: number, text: string) => {
                const onAbort = () => { window.electronAPI?.abortTyping?.(); };
                signal?.addEventListener('abort', onAbort, { once: true });
                try { return await window.electronAPI?.realType?.(id, text); }
                finally { signal?.removeEventListener('abort', onAbort); }
              };
              // Depois que a pessoa ajudou (Continuar / página voltou ao normal): anota e recomeça do zero na página atual.
              const afterManualHelp = (request: ManualHelpRequest, currentUrl: string, note: string) => {
                const resumedWv = getActiveWebview();
                const afterUrl = resumedWv?.getURL?.() || currentUrl;
                appendAgentRunStep(runLog, {
                  manualHelp: {
                    kind: request.kind,
                    reason: request.reason,
                    beforeUrl: currentUrl,
                    afterUrl,
                  },
                  note,
                });
                history += `\n${manualHelpHistoryNote(request, currentUrl, afterUrl)}`;
                rememberActionForSite({
                  actionType: `human_help:${request.kind}`,
                  success: true,
                  url: afterUrl,
                  title: resumedWv?.getTitle?.(),
                  note: request.reason,
                });
                noEffectCount = 0;
                stepsOnSameUrl = 0;
                actionQueue = [];
                skipManualHelpDetectionOnce = true;
              };
              const waitForManualHelp = async (request: ManualHelpRequest, currentUrl: string) => {
                setAgentVisual('idle');
                appendAgentRunStep(runLog, {
                  manualHelp: {
                    kind: request.kind,
                    reason: request.reason,
                    beforeUrl: currentUrl,
                  },
                  note: request.instruction,
                });
                await new Promise<void>((resolve) => {
                  // Se o usuário apertar Parar durante a ajuda manual, o sinal de abort
                  // resolve a espera (senão o loop ficava preso pra sempre aguardando o
                  // "Continuar"). O throwIfCancelled logo abaixo converte isso em cancelamento limpo.
                  if (signal?.aborted) { resolve(); return; }
                  signal?.addEventListener('abort', () => resolve(), { once: true });
                  onProgress({
                    kind: 'manual_help',
                    message: request.reason,
                    instruction: request.instruction,
                    onContinue: resolve,
                  });
                });
                throwIfCancelled();
                afterManualHelp(request, currentUrl, 'Usuario clicou em Continuar depois da intervencao manual.');
              };
              // ── Watch/Takeover (shared/takeover.ts) ──────────────────────────────────────────────
              // A página quer uma PESSOA (checagem de robô de qualquer estilo / parede de login): o Bah passa
              // a aba pra ela (HANDOFF: cartão + aba na frente + som), ela resolve SOZINHA (TAKEOVER quando mexe
              // na página) e o agente volta por conta própria quando a página está normal de novo. Em tarefa
              // agendada (ninguém olhando) nunca espera. O agente NUNCA opera a checagem (guard em executeBrowserAction
              // e antes de cada ação abaixo).
              const takeoverTimeoutMs = (await window.electronAPI?.e2eTakeoverTimeout?.().catch(() => null)) || TAKEOVER_TIMEOUT_MS;
              const handedOffSites = new Map<string, TakeoverOutcome>();
              let humanHandoffs = 0;   // trava de laço: no máximo 6 hand-offs por tarefa   // 'captcha:host' / 'signin:host' → como terminou
              const watchTakeoverInput = (ids: number[], cb: (wcId: number) => void) => {
                try { window.electronAPI?.takeoverWatch?.(ids); } catch {}
                const off = window.electronAPI?.onTakeoverInput?.(cb);
                return () => { try { off?.(); } catch {} try { window.electronAPI?.takeoverWatch?.([]); } catch {} };
              };
              /** Passa a aba pra pessoa e espera. Devolve como terminou (cleared / handed_back / skipped / timeout / unattended). */
              const humanHandoff = async (request: ManualHelpRequest, humanKind: HumanCheckKind, w: Electron.WebviewTag, entry: { url: string; verdict: HumanCheckVerdict | null }): Promise<TakeoverOutcome> => {
                const host = paceHostOf(entry.url) || 'this site';
                const tabId = activeTabIdRef.current;
                appendAgentRunStep(runLog, { manualHelp: { kind: request.kind, reason: request.reason, beforeUrl: entry.url }, note: `handoff (${humanKind}${entry.verdict ? `: ${entry.verdict.why}` : ''})` });
                setAgentVisual('idle');
                deadline.suspend();   // a pessoa resolvendo não é o modelo demorando
                let fronted = false;
                const final = await runHandoff({
                  kind: humanKind, unattended, timeoutMs: takeoverTimeoutMs, signal,
                  items: [{ id: tabId, site: host, wv: w as any, entry }],
                  watchInput: watchTakeoverInput,
                  onState: (st, c) => {
                    if (st.mode !== 'agent' && !fronted) { fronted = true; try { store.setActiveTabId(tabId); } catch {} }
                    onProgress({ kind: 'takeover', phase: st.mode, humanKind, sites: [host], outcome: st.outcome, reason: request.reason, instruction: request.instruction, onHandBack: c.handBack, onSkip: c.skip });
                  },
                });
                deadline.resume();
                throwIfCancelled();
                const outcome = final.outcome || 'skipped';
                const key = `${humanKind}:${host}`;
                if (outcome === 'cleared' || outcome === 'handed_back') {
                  afterManualHelp(request, entry.url, outcome === 'cleared' ? 'A página voltou ao normal (a pessoa resolveu); o agente retomou sozinho.' : 'A pessoa devolveu o controle (Hand back).');
                  if (outcome === 'handed_back') handedOffSites.set(key, outcome);   // não pede de novo no mesmo site
                  history += outcome === 'cleared'
                    ? `\nHANDBACK: the person cleared the ${humanKind === 'captcha' ? 'human check' : 'sign-in'} on ${host}. Re-observe the page and continue the same step.`
                    : `\nHANDBACK: the person handed control back on ${host}. Re-observe the page and continue.`;
                } else {
                  handedOffSites.set(key, outcome);
                  const why = outcome === 'unattended' ? 'scheduled run, nobody to ask' : outcome === 'timeout' ? 'nobody cleared it in time' : 'the person chose to skip this site';
                  history += humanKind === 'captcha'
                    ? `\nHUMAN CHECK NOT CLEARED on ${host} (${why}): couldn't read — human check. Bah never operates a human check. Do not click, type or scroll on that page; get the information from another source, or finish and say you couldn't read ${host} — human check.`
                    : `\nSIGN-IN NOT DONE on ${host} (${why}). Never type a password or create an account. Continue without the account if the task allows, otherwise finish and say ${host} needs the user's sign-in.`;
                  appendAgentRunStep(runLog, { manualHelp: { kind: request.kind, reason: request.reason, beforeUrl: entry.url }, note: `handoff ended: ${outcome}` });
                  noEffectCount = 0;
                  actionQueue = [];
                }
                return outcome;
              };
              // FREIO: pausa e pergunta antes de ação de risco (pagamento/exclusão/cartão).
              // Resolve true = pode; false = cancelar. Aborta (false) se o usuário parar a tarefa.
              // A pessoa já respondeu ao freio neste passo: a recuperação não pergunta de novo ("Sensitive action
              // detected… asking the user") — depois de um "não" isso encerrava a tarefa com um aviso enganoso.
              let brakeAskedThisStep = false;
              const confirmRisky = (risk: { kind: string; label: string }): Promise<boolean> => {
                brakeAskedThisStep = true;
                setAgentVisual('idle');
                const verb = risk.kind === 'card data' ? 'fill in' : 'click';
                // Pessoa pensando não é o modelo lento: o relógio da tarefa dorme enquanto o cartão espera
                // (numa tarefa agendada ele pode esperar horas, até a pessoa voltar).
                deadline.suspend();
                return new Promise<boolean>((resolve) => {
                  let done = false;
                  const finish = (v: boolean) => { if (!done) { done = true; deadline.resume(); resolve(v); } };
                  if (signal) signal.addEventListener('abort', () => finish(false), { once: true });
                  onProgress({
                    kind: 'confirm',
                    risk: risk.kind,
                    label: risk.label,
                    message: `⚠️ Safety pause — this involves ${risk.kind}. I will ${verb} "${risk.label}". Do you want me to continue?`,
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
                onProgress({ kind: 'status', message: `✖️ Canceled by you: I did not do "${risk.label}".` });
                return { success: false, reason: 'user_cancelled', error: `You canceled — I did not do "${risk.label}".` };
              };
              try {
                throwIfCancelled();
                // ── REPLAY DE MACRO: "repete", "repete 1000 vezes", "a cada 5 min" ──
                // Reexecuta a última sequência gravada de forma 100% determinística:
                // zero chamadas de IA, não importa quantas repetições.
                // NÃO é gated por aiDrive: isto não é muleta de modelo fraco, é uma ORDEM
                // EXPLÍCITA do usuário ("repete 100 vezes") — e vale MAIS na nuvem, onde cada
                // repetição pela IA custaria dinheiro. Ficou desligado na nuvem por um tempo
                // (efeito colateral de fazer aiDrive=true com API), matando justamente o
                // recurso que sustenta "deixar rodando a noite toda" de graça.
                if (repeatIntent) {
                  const macro = loadLastMacro();
                  if (!macro) {
                    const msg = 'I have no recorded automation yet. Do the task once (e.g.: "go to site X and click Y") — I record the sequence, and then you can repeat it as many times as you want.';
                    finishRun('failed', msg);
                    return { thought: msg, results: allResults, done: { type: 'done', reason: msg, success: false } as BrowserAction };
                  }
                  const times = repeatIntent.times;
                  const pause = repeatIntent.intervalMs ?? 1200;
                  onProgress({ kind: 'status', message: `🔁 Automation: "${macro.command.slice(0, 70)}" — ${macro.steps.length} step(s) × ${times >= 100000 ? '∞ (until you stop)' : times}${repeatIntent.intervalMs ? `, every ${Math.round(repeatIntent.intervalMs / 1000)}s` : ''}. Zero AI.` });
                  // FREIO: se a automação inclui uma ação de risco (pagar/excluir/cartão),
                  // confirma UMA vez antes de repetir (não a cada repetição — seria absurdo).
                  const riskyStep = macro.steps.map(s => riskForAction(s as any, undefined, undefined, riskOpts)).find((r): r is RiskInfo => !!r);
                  if (riskyStep) {
                    const ok = await confirmRisky(riskyStep);
                    throwIfCancelled();
                    if (!ok) {
                      const msg = `Canceled — the automation includes a sensitive action ("${riskyStep.label}") and you did not confirm.`;
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
                    if (times > 1) onProgress({ kind: 'status', message: `🔁 Repeat ${rep + 1}${times < 100000 ? `/${times}` : ''}` });
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
                        const msg = `Automation broke on repeat ${rep + 1}, step ${j + 1} (${formatAction(a)}): ${r?.error || 'element not found'}. The site likely changed — do the task once more so I can re-record it.`;
                        finishRun('failed', msg);
                        return { thought: msg, results: allResults, done: { type: 'done', reason: msg, success: false } as BrowserAction };
                      }
                      if (a.type === 'navigate') { await waitForWebviewSettled(wv, ''); }
                      await sleepCancelable(700);
                    }
                    if (rep + 1 < times) await sleepCancelable(pause);
                  }
                  const okMsg = `Automation ran ${rep} time(s) without breaking (${macro.steps.length} step(s) each, zero AI).`;
                  finishRun('success', okMsg);
                  return { thought: okMsg, results: allResults, done: { type: 'done', reason: okMsg, success: true } as BrowserAction };
                }
                // QUICK INTENT: layperson media/file requests ("mp3 musica X", "baixe o
                // pdf de Y") → execute the right action at step 0 WITHOUT calling the AI.
                // weakModel: o atalho determinístico de PLAYLIST só entra quando a IA ativa é
                // FRACA. A IA é FORTE só quando há uma chave de nuvem de verdade configurada
                // (e não está no modo local). Espelha activeAiLabel(). Senão (local Ollama, ou
                // sem chave nenhuma) é FRACA → precisa do atalho.
                const s = store.aiSettings;
                const strongCloud = !store.localSettings.enabled && !!s.apiKey?.trim();
                const weakModel = !strongCloud;
                // MODO IMAGEM passa MESMO com a IA no comando: marcar a caixinha é ORDEM
                // EXPLÍCITA do usuário, não palpite de heurística. Sem esta exceção, marcar
                // "gerar imagem" e escrever "gato" virava uma busca na web — o pedido sumia.
                // (Mesmo caso do "repete N vezes": ordem explícita nunca é muleta de atalho.)
                // "Resuma minhas abas" também passa com a IA no comando: o modelo não lê aba por aba sem
                // trocar de aba (switch_tab, uma pergunta de permissão por aba); o executor lê todas de uma vez.
                // Comparar preço ENTRE LOJAS: o Bah visita cada loja (laço abaixo) — nem o atalho do Google
                // Shopping (agregador) nem a busca numa loja só.
                const storeCompare = !opts?.forceImage && isPriceComparison(command);
                let quickAction = storeCompare ? null : (aiDrive && !opts?.forceImage)
                  ? (wantsTabsSummary(command) ? { type: 'summarize_tabs', wake: wantsWakeTabs(command) } as QuickAction : null)
                  : detectQuickAction(command, { forceImage: !!opts?.forceImage, weakModel });
                // FOLLOW-UP sem IA: "e com a palavra bom dia?" / "agora com a frase X"
                // reaproveita a intenção do pedido anterior trocando só o termo.
                if (!aiDrive && !storeCompare && !quickAction && lastQuickActionRef.current) {
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
                    if (quickAction) onProgress({ kind: 'status', message: `🔗 Continuing the previous request with "${term}"` });
                  }
                }
                if (quickAction) lastQuickActionRef.current = quickAction;
                const initialShortcut = (aiDrive || quickAction || storeCompare) ? null : getInitialShortcutAction(command);
                if (quickAction) {
                  actionQueue.push({ action: quickAction as BrowserAction });
                  usedInitialShortcut = true;
                  onProgress({ kind: 'status', message: `⚡ Recognized intent: ${formatAction(quickAction as BrowserAction)}` });
                  console.log(`[Agent] quick action -> ${formatAction(quickAction as BrowserAction)}`);
                }
                if (initialShortcut) {
                  const wv = getActiveWebview();
                  if (!wv) { finishRun('failed', 'No active webview'); return { error: 'No active webview', results: allResults }; }
                  setAgentVisual('acting');
                  onProgress({ kind: 'status', message: `Known shortcut: ${initialShortcut.reason}` });
                  console.log(`[Agent] fast path -> ${initialShortcut.reason}`);
                  const beforeUrl = wv.getURL();
                  // FREIO: atalho aprendido também passa pela confirmação se for de risco.
                  const scCancel = await gateRisk(riskForAction(initialShortcut.action as any, undefined, beforeUrl, riskOpts));
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
                } else if (!quickAction && !commandHasExplicitUrl(command)) {
                  // Sem atalho (nuvem: a IA decide): o site nomeado da lista curada vira dica do 1º passo.
                  // Medido: "browse to linkedin…" → web_search("LinkedIn") (~25s) antes do navigate.
                  const siteHint = namedSiteHint(command);
                  if (siteHint) history += `\n${siteHint}`;
                }

                // PREÇO EM VÁRIAS LOJAS ("compare prices for AirPods Pro on Amazon and other stores"). A pessoa usa um
                // navegador: espera ver o Bah ir em cada loja, buscar lá e olhar o preço na página da loja. Antes o
                // modelo lia uma matéria de blog de ofertas e a apresentava como preços das lojas. Aqui o Bah planeja
                // as lojas e visita uma por uma (como a coleção de músicas): navega na busca da própria loja, confere
                // se a página é da loja e se não é erro/captcha/login, o modelo LÊ o preço (texto + print da página) e
                // o Bah confere que o preço está mesmo na página. Loja bloqueada → "couldn't read — motivo", segue.
                // Nunca dribla checagem de robô, nunca põe no carrinho, compra ou entra em conta.
                if (storeCompare) {
                  // País pelo locale do sistema (o painel de região, quando entrar, troca por searchCountry()).
                  const country = localeCountry();
                  const query = priceCompareQuery(command, country);
                  const e2eStores = await window.electronAPI?.e2ePriceStores?.().catch(() => null);   // só no teste e2e
                  const stores = e2eStores?.length ? e2eStores : pickStores(command, country);
                  // Linhas do feed por loja: 'thought' fica no feed (status some em 2s).
                  const rows: PriceRow[] = unknownNamedStores(command, country).map(name => ({ store: name, status: 'not_checked' as const, url: '', reason: "no verified address for this store (Bah never guesses store domains)" }));
                  onProgress({ kind: 'thought', message: `🛒 Comparing "${query}" at ${stores.map(s => s.label).join(', ')} — visiting each store's own site` });
                  console.log(`[PriceCompare] query="${query}" country=${country} stores=${stores.map(s => s.id).join(',')}`);
                  // Lê a página aberta: endereço, título, texto e links de produto (mesmo site).
                  const readPage = async (w: Electron.WebviewTag) => {
                    const r = await withTimeout(Promise.resolve(w.executeJavaScript(`(function(){
                      var t = (document.body && document.body.innerText) || '';
                      var links = [], seen = {};
                      var as = document.querySelectorAll('a[href]');
                      for (var i = 0; i < as.length && links.length < 250; i++) {
                        var a = as[i], txt = (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\\s+/g, ' ').trim();
                        if (txt.length < 8 || txt.length > 220 || seen[a.href]) continue;
                        if (a.hostname !== location.hostname) continue;
                        seen[a.href] = 1; links.push({ text: txt, href: a.href });
                      }
                      var hc = ${HUMAN_CHECK_SIGNALS_JS};
                      return { url: location.href, title: document.title || '', text: t.slice(0, 60000), links: links, frames: hc.frames, markers: hc.markers, passwordField: hc.passwordField };
                    })()`, false)), 8000, null as any).catch(() => null);
                    return (r || { url: w.getURL(), title: w.getTitle(), text: '', links: [] }) as { url: string; title: string; text: string; links: Array<{ text: string; href: string }>; frames?: string[]; markers?: string[]; passwordField?: boolean };
                  };
                  type StorePage = Awaited<ReturnType<typeof readPage>>;
                  const isHumanCheck = (pg: StorePage) => classifyHumanCheck(pg)?.kind === 'captcha';
                  // O modelo lê o preço: trechos do texto em volta do produto + o print da página (se o modelo enxerga).
                  const askModel = async (st: { label: string }, pg: { url: string; title: string; text: string }) => {
                    const shot = await withTimeout(captureFrame({ image: true, png: false }), 8000, undefined as any).catch(() => undefined);
                    const prompt = readPricePrompt({ store: st.label, query, url: pg.url, title: pg.title, snippets: pageSnippets(pg.text, query) });
                    setAgentVisual('thinking');
                    const r = await withTimeout(Promise.resolve(window.electronAPI?.aiChat?.(prompt, '', true, store.localSettings.enabled, undefined, undefined, undefined, shot?.image)), 120000, null as any).catch(() => null);
                    return parseReadReply(String(r?.response || ''));
                  };
                  // Lê a loja na página aberta (busca; sem preço → abre a página do PRODUTO e lê de novo).
                  // Checagem humana na página do produto → 'bot check / captcha' (vira espera pela pessoa abaixo).
                  const readStore = async (st: PriceStore, w: Electron.WebviewTag, first: StorePage): Promise<PriceRow> => {
                    let pg = first;
                    const read = await askModel(st, pg);
                    throwIfCancelled();
                    let row = checkRead(read, pg, st, query);
                    // Site "cuidadoso" (careful-sites.ts): uma navegação só — não abre o produto.
                    if (row.status !== 'read' && !read?.blocked && !isCarefulHost(st.domain)) {
                      const fits = (l: { text: string; href: string }) => titleMatchesQuery(l.text, query) && !looksLikeAccessory(l.text, query) && isStoreSource(l.href, st);
                      const want = (read?.title || '').toLowerCase().slice(0, 40);
                      const pick = (want && pg.links.find(l => fits(l) && l.text.toLowerCase().includes(want))) || pg.links.find(fits);
                      if (pick) {
                        onProgress({ kind: 'thought', message: `🛒 ${st.label}: no price in the results — opening the product page…` });
                        setAgentVisual('acting');
                        const b2 = w.getURL();
                        const nav2 = await executeBrowserAction(w, { type: 'navigate', url: pick.href } as BrowserAction);
                        await waitForWebviewSettled(w, b2);
                        await waitForSettle(w, { maxMs: 6000, minMs: 800 });
                        throwIfCancelled();
                        pg = await readPage(w);
                        allResults.push({ action: { type: 'navigate', url: pick.href } as BrowserAction, result: nav2 });
                        setHumanCheckFlag(w, classifyHumanCheck(pg));
                        const blocked = blockedReason(pg, st);
                        if (blocked) row = { store: st.label, status: 'blocked', url: pg.url, reason: blocked };
                        else { const row2 = checkRead(await askModel(st, pg), pg, st, query); if (row2.status === 'read' || row2.status === 'blocked') row = row2; }
                      }
                    }
                    return row;
                  };
                  const reportRow = (st: PriceStore, row: PriceRow) => {
                    console.log(`[PriceCompare] ${st.label}: ${row.status}${row.price ? ` ${row.price}` : ''}${row.reason ? ` — ${row.reason}` : ''} (${row.url})`);
                    onProgress({ kind: 'thought', message: row.status === 'read'
                      ? `✅ ${st.label}: ${row.price} — ${String(row.title).slice(0, 80)}`
                      : `⚠️ ${st.label}: couldn't read — ${row.reason}` });
                  };
                  // 1ª volta: cada loja na aba da tarefa. Checagem humana (press & hold, captcha, "Robot or human?")
                  // NÃO é lida nem tocada: a loja entra na lista de espera pela pessoa (2ª volta).
                  const storeRows: Array<PriceRow | null> = stores.map(() => null);
                  const waitingStores: Array<{ i: number; url: string }> = [];
                  for (let i = 0; i < stores.length; i++) {
                    throwIfCancelled();
                    const st = stores[i];
                    if (deadline.remainingMs() <= 0 || deadline.fired()) { storeRows[i] = { store: st.label, status: 'not_checked', url: storeSearchUrl(st, query), reason: 'task time limit reached' }; continue; }
                    const w = getActiveWebview();
                    if (!w) break;
                    onProgress({ kind: 'thought', message: `🛒 Checking ${st.label}… (${i + 1}/${stores.length})` });
                    setAgentVisual('acting');
                    const searchUrl = storeSearchUrl(st, query);
                    const beforeUrl = w.getURL();
                    const nav = await executeBrowserAction(w, { type: 'navigate', url: searchUrl } as BrowserAction);
                    await waitForWebviewSettled(w, beforeUrl);
                    await waitForSettle(w, { maxMs: 6000, minMs: 800 });
                    throwIfCancelled();
                    const pg = await readPage(w);
                    allResults.push({ action: { type: 'navigate', url: searchUrl } as BrowserAction, result: nav });
                    appendAgentRunStep(runLog, { step: i, urlBefore: beforeUrl, urlAfter: pg.url, titleAfter: pg.title, ...summarizeAction({ type: 'navigate', url: searchUrl } as BrowserAction), result: summarizeResult(nav), success: nav?.success !== false, note: `price compare: ${st.label}` });
                    setHumanCheckFlag(w, classifyHumanCheck(pg));
                    const blocked = nav?.success === false && !pg.text ? `the page didn't load (${String(nav?.error || '').slice(0, 60)})` : blockedReason(pg, st);
                    const row: PriceRow = blocked ? { store: st.label, status: 'blocked', url: pg.url || searchUrl, reason: blocked } : await readStore(st, w, pg);
                    if (row.status === 'blocked' && row.reason === BOT_CHECK_REASON) {
                      waitingStores.push({ i, url: row.url || searchUrl });
                      onProgress({ kind: 'thought', message: `🙋 ${st.label}: wants a person to confirm — ${unattended ? 'scheduled run, not waiting' : 'will hand it to you'}` });
                      continue;
                    }
                    storeRows[i] = row;
                    reportRow(st, row);
                  }
                  // 2ª volta (Watch/Takeover): UMA espera pra todas as lojas com checagem — cada uma na sua aba, a pessoa
                  // libera, o Bah lê a loja assim que ela volta ao normal. Tempo esgotado / pulou / tarefa agendada →
                  // "couldn't read — human check". O Bah nunca toca a checagem.
                  if (waitingStores.length) {
                    const humanRow = (i: number, url: string): PriceRow => ({ store: stores[i].label, status: 'blocked', url, reason: HUMAN_CHECK_REASON });
                    const items: Array<{ id: string; site: string; wv: any; entry: { url: string; verdict: HumanCheckVerdict | null }; i: number; tabId: string }> = [];
                    if (!unattended) {
                      for (const ws of waitingStores) {
                        const tabId = store.addBackgroundTab(ws.url, opensIncognito('from-tab', aiOnIncognito()));
                        store.joinOpenerSession(tabId, taskTabId);
                        agentOpenedTabs.add(tabId);
                        let tw: Electron.WebviewTag | undefined;
                        for (let k = 0; k < 40 && !(tw = webviewRefs.current.get(tabId)); k++) await sleep(150);
                        if (!tw) { storeRows[ws.i] = humanRow(ws.i, ws.url); continue; }
                        await waitForWebviewSettled(tw, '');
                        await waitForSettle(tw, { maxMs: 6000, minMs: 600 });
                        const pg = await readPage(tw);
                        const verdict = classifyHumanCheck(pg);
                        setHumanCheckFlag(tw, verdict);
                        items.push({ id: tabId, site: stores[ws.i].label, wv: tw, entry: { url: pg.url || ws.url, verdict }, i: ws.i, tabId });
                      }
                    } else {
                      for (const ws of waitingStores) items.push({ id: `store-${ws.i}`, site: stores[ws.i].label, wv: getActiveWebview(), entry: { url: ws.url, verdict: null }, i: ws.i, tabId: '' });
                    }
                    const readCleared = async (it: typeof items[number]) => {
                      const st = stores[it.i];
                      const w = it.wv as Electron.WebviewTag;
                      const prevAgentTab = activeTabIdRef.current;
                      activeTabIdRef.current = it.tabId;   // o print e as ações do agente vão pra aba da loja
                      try {
                        const pg = await readPage(w);
                        if (isHumanCheck(pg)) return humanRow(it.i, pg.url || it.entry.url);
                        setHumanCheckFlag(w, null);
                        const blocked = blockedReason(pg, st);
                        const row: PriceRow = blocked ? { store: st.label, status: 'blocked', url: pg.url, reason: blocked } : await readStore(st, w, pg);
                        return row.status === 'blocked' && row.reason === BOT_CHECK_REASON ? humanRow(it.i, row.url) : row;
                      } finally { activeTabIdRef.current = prevAgentTab; }
                    };
                    const front = (st: { items: Array<{ id: string; status: string }> }) => {
                      const next = st.items.find(x => x.status === 'waiting');
                      if (next) { try { store.setActiveTabId(next.id); } catch {} }
                    };
                    const sites = items.map(it => it.site);
                    const doneSites: string[] = [];
                    let fronted = false;
                    deadline.suspend();
                    setAgentVisual('idle');
                    const final = await runHandoff({
                      kind: 'captcha', unattended, timeoutMs: takeoverTimeoutMs, signal,
                      items, watchInput: watchTakeoverInput,
                      onState: (st, c) => {
                        if (st.mode !== 'agent' && !fronted) { fronted = true; front(st); }
                        onProgress({ kind: 'takeover', phase: st.mode, humanKind: 'captcha', sites, cleared: [...doneSites], outcome: st.outcome, onHandBack: c.handBack, onSkip: c.skip });
                      },
                      onCleared: async (item, st) => {
                        const it = items.find(x => x.id === item.id)!;
                        doneSites.push(it.site);
                        if (st.mode !== 'agent') front(st);   // a próxima loja esperando vai pra frente
                        const row = await readCleared(it);
                        storeRows[it.i] = row;
                        reportRow(stores[it.i], row);
                      },
                    });
                    deadline.resume();
                    throwIfCancelled();
                    for (const it of items) {
                      if (storeRows[it.i]) continue;
                      const status = final.items.find(x => x.id === it.id)?.status;
                      // Devolvida pela pessoa: lê agora se a página já está normal; senão, checagem humana.
                      const row = status === 'handed_back' ? await readCleared(it) : humanRow(it.i, it.entry.url);
                      storeRows[it.i] = row;
                      reportRow(stores[it.i], row);
                    }
                  }
                  for (const r of storeRows) if (r) rows.push(r);
                  const readCount = rows.filter(r => r.status === 'read').length;
                  let doneMsg = compareSummary(query, rows);
                  const rv = await window.electronAPI?.renderView?.(compareTableSpec(query, rows));
                  if (rv?.success && rv.url) {
                    // addBackgroundTab: mesma razão do compare_prices — o painel segue a aba ativa.
                    const newId = store.addBackgroundTab(rv.url, opensIncognito('from-tab', aiOnIncognito()));
                    store.joinOpenerSession(newId, taskTabId);
                    activeTabIdRef.current = newId;
                    doneMsg += ' The table with every store and its link opened in a tab.';
                  }
                  onProgress({ kind: 'status', message: `${readCount ? '✅' : '⚠️'} ${doneMsg}` });
                  finishRun(readCount ? 'success' : 'failed', doneMsg);
                  return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: readCount > 0 } as BrowserAction };
                }

                // "Os 3 maiores sucessos do X": a lista é conhecimento do modelo, não uma página. O 8B navegava
                // rankings por 20 min e nunca guardava a lista; aqui o Bah pergunta UMA vez, direto, e o passo 0
                // vira o store → cartão de confirmação e downloads pelo próprio Bah (bloco da COLEÇÃO no store).
                if (isTopNCollection(command)) {
                  const n = collectionCount(command);
                  onProgress({ kind: 'status', message: `🎵 Picking the ${n} best-known ones…` });
                  try {
                    const r = await withTimeout(Promise.resolve(window.electronAPI?.aiChat?.(topNListPrompt(command, n), undefined, undefined, store.localSettings.enabled)), 60000, null as any);
                    const items = parseTopNList(String(r?.response || ''), n);
                    if (items.length >= 2) {
                      actionQueue.unshift({ action: { type: 'store', key: 'tracks', value: items } as BrowserAction });
                      history += `\nCOLLECTION LIST (from the model's own knowledge, asked directly): ${items.join('; ')}`;
                    }
                  } catch { /* sem lista: o agente segue pelo caminho normal (skill + aviso COLLECTION) */ }
                }

                let stepDlButtons: Array<{ id: number; text?: string; aria?: string }> = [];   // os LIKELY DOWNLOAD BUTTON deste passo
                for (let step = 0; step < MAX_STEPS; step++) {
                  const stepStartedAt = Date.now();
                  brakeAskedThisStep = false;
                  throwIfCancelled();
                  // Etapa 6: global time budget — bail out gracefully instead of grinding 25 steps
                  // Same clock as the in-flight abort, so a human pause never burns the budget.
                  if (deadline.remainingMs() <= 0 || deadline.fired()) {
                    const done: BrowserAction = { type: 'done', success: false, reason: `Task time limit reached (${Math.round(TASK_DEADLINE_MS / 60000)} min). Stopping to avoid a loop.` };
                    finishRun('failed', done.reason);
                    return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                  }
                  // Mensagens que o usuário mandou com a tarefa rodando: viram parte do PEDIDO (o
                  // GOAL no topo do prompt), não só uma linha no meio do histórico. Testado: só no
                  // histórico, o modelo local trocou g1→UOL e dois passos depois voltou pro g1 do
                  // GOAL original. A IA adapta, muda de rumo ou encerra — decisão dela.
                  if (interjectRef.current.queue.length > 0) {
                    const oldGoal = `GOAL: ${command}`;
                    for (const u of interjectRef.current.queue.splice(0)) {
                      const msg = u.replace(/"/g, "'").slice(0, 600);
                      command = `${command}\nUSER UPDATE, sent while you were working - the user's NEWEST wish; where it conflicts with the request above, the update wins: "${msg}"`;
                      history += `\n\nUSER UPDATE (sent while you were working): "${msg}". This is the user's NEWEST wish and wins over the earlier request wherever they conflict - follow it from this step on. If it asks to stop or cancel the whole task, finish now with done.`;
                    }
                    // Troca o GOAL do topo. (Se o plano reescreveu o pedido antes, o GOAL do topo é
                    // outro texto e não acha — aí a linha no histórico basta.)
                    const at = history.indexOf(oldGoal);
                    if (at >= 0) history = history.slice(0, at) + `GOAL: ${command}` + history.slice(at + oldGoal.length);
                    onProgress({ kind: 'status', message: `↪ ${t('agent.interjected')}` });
                  }
                  // Etapa 6: prune unbounded history to keep token usage and memory in check
                  if (history.length > 8000) history = `GOAL: ${command}${understoodLine()}\n...[older steps trimmed]...\n` + history.slice(-6000);
                  const wv = getActiveWebview();
                  if (!wv) { finishRun('failed', 'No active webview'); return { error: 'No active webview', results: allResults }; }
                  if (commandLooksLikeGoogleLogin && step >= 8) {
                    const done: BrowserAction = {
                      type: 'done',
                      success: false,
                      reason: 'Google login was not completed quickly. There may be a block, popup, captcha or account choice that needs manual intervention.',
                    };
                    finishRun('failed', done.reason);
                    return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                  }
                  setAgentVisual('observing');
                  onProgress({ kind: 'status', message: `Step ${step + 1}: observing the page...` });
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
                  carriedShot = undefined;
                  carriedThumb = undefined;
                  carriedPng = undefined;
                  // Porteiro fechou um aviso de cookie/consent → avisa no feed (uma vez).
                  if (observation?.dismissed) {
                    onProgress({ kind: 'status', message: `🚪 Closed a cookie/consent notice (${observation.dismissed})` });
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
                  // Watch/Takeover: a página é uma checagem humana? Leitura PASSIVA dos sinais (frames de provedores,
                  // ids/classes, título, texto) → classificador genérico. Marca a aba pro guard (nenhuma ação que
                  // toque a página enquanto for checagem) e passa a aba pra pessoa.
                  const humanCheck = await classifyWebview(wv as any);
                  throwIfCancelled();
                  const hcVerdict = humanCheck.verdict?.kind === 'captcha' ? humanCheck.verdict : null;
                  setHumanCheckFlag(wv, hcVerdict);
                  if (hcVerdict) {
                    const host = paceHostOf(observation.url) || 'this site';
                    if (!handedOffSites.has(`captcha:${host}`) && humanHandoffs < 6) {
                      humanHandoffs++;
                      onProgress({ kind: 'status', message: `🙋 ${t('takeover.statusPaused', { site: host })}` });
                      const outcome = await humanHandoff({ kind: 'captcha', reason: t('takeover.reason', { site: host }), instruction: t('takeover.instruction') }, 'captcha', wv, { url: observation.url, verdict: hcVerdict });
                      if (outcome === 'cleared' || outcome === 'handed_back') { step--; continue; }   // re-observa e segue o MESMO passo
                    }
                    history += `\nHUMAN CHECK on ${host} (${hcVerdict.why}): only passive reads or leaving the page are allowed — clicks, typing, keys and scrolling on it are refused.`;
                    skipManualHelpDetectionOnce = false;
                  } else if (skipManualHelpDetectionOnce) {
                    skipManualHelpDetectionOnce = false;
                    history += '\nRESUME: User clicked Continue after manual help. Observe the current page and continue the task from here.';
                  } else {
                    let manualHelpNeed = detectManualHelpNeed(command, observation, stepsOnSameUrl, noEffectCount);
                    // Download atrás de conta (SolidWorks, Altium, Adobe, Office): para JÁ e a pessoa decide.
                    // A política geral só pausa tarefa "da conta"; "baixe o X" não parece uma — o agente
                    // seguia e tentava o formulário. Nunca digita senha nem cria conta. Não no 1º passo:
                    // a aba em que a pessoa estava pode ser qualquer login.
                    if (!manualHelpNeed && commandWantsDownload && step > 0) {
                      const wall = signInWall({ url: observation.url, title: observation.title, text: observation.text_sample, elements: observation.interactive_elements as any });
                      if (wall) {
                        const host = paceHostOf(observation.url) || 'this site';
                        manualHelpNeed = { kind: 'login', reason: t('dl.signinWall.reason', { host }), instruction: t('dl.signinWall.instruction') };
                        history += `\nSIGN-IN WALL (${wall}) on ${host}: the download needs the user's account. Bah paused and asked the user. Never type a password, never create an account.`;
                      }
                    }
                    // Checagem humana / login → Watch/Takeover (volta sozinho quando a página normaliza; tarefa
                    // agendada não espera). Paywall e afins: o "Continuar" de sempre.
                    const humanKind: HumanCheckKind | null = manualHelpNeed?.kind === 'captcha' ? 'captcha' : manualHelpNeed?.kind === 'login' ? 'signin' : null;
                    if (manualHelpNeed && humanKind) {
                      const host = paceHostOf(observation.url) || 'this site';
                      if (!handedOffSites.has(`${humanKind}:${host}`) && humanHandoffs < 6) {
                        humanHandoffs++;
                        onProgress({ kind: 'status', message: `Paused for manual help: ${manualHelpNeed.reason}` });
                        const entryVerdict = humanCheck.verdict?.kind === humanKind ? humanCheck.verdict : null;
                        const outcome = await humanHandoff(manualHelpNeed, humanKind, wv, { url: observation.url, verdict: entryVerdict });
                        if (outcome === 'cleared' || outcome === 'handed_back') continue;
                      }
                    } else if (manualHelpNeed) {
                      onProgress({ kind: 'status', message: `Paused for manual help: ${manualHelpNeed.reason}` });
                      deadline.suspend();   // a human thinking is not the model being slow
                      await waitForManualHelp(manualHelpNeed, observation.url);
                      deadline.resume();
                      continue;
                    }
                  }
                  if (!aiDrive && !unattended && commandLooksLikeSendEmail && isGmailUrl(observation.url) && parsedEmailDraft && !gmailDraftFilled) {
                    gmailComposeAttempted = true;
                    const compose = await tryComposeGmailDraft(wv, parsedEmailDraft);
                    if (compose.success) {
                      gmailDraftFilled = true;
                      onProgress({ kind: 'status', message: 'Gmail: draft filled automatically.' });
                      if (compose.sent) {
                        const done: BrowserAction = { type: 'done', success: true, reason: 'Email sent via Gmail.' };
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      observation = await withTimeout(observePageViaAXTree(wv), observeTimeoutMs, observation);
                      rememberObservedSite(observation);
                    } else {
                      onProgress({ kind: 'status', message: `Gmail: draft assistant could not fill it (${compose.reason || 'no detail'}).` });
                    }
                  }
                  if (!aiDrive && !unattended && commandLooksLikeYouTubeComment && isYouTubeWatchUrl(observation.url) && !youtubeCommentFilled && step >= 2) {
                    const assist = await tryRevealYouTubeCommentBox(wv);
                    if (assist.success) {
                      onProgress({ kind: 'status', message: 'YouTube: comment box located/activated.' });
                      const commentKey = makeYouTubeCommentKey(observation.url, youtubeCommentText);
                      if (submittedYouTubeComments.has(commentKey)) {
                        const done: BrowserAction = { type: 'done', success: true, reason: `Comment already sent in this task: "${youtubeCommentText}"` };
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      const submit = await tryFillAndSubmitYouTubeComment(wv, youtubeCommentText);
                      if (submit.success) {
                        submittedYouTubeComments.add(commentKey);
                        youtubeCommentFilled = true;
                        youtubeCommentSubmitted = true;
                        const done: BrowserAction = { type: 'done', success: true, reason: `Comment sent on YouTube: "${youtubeCommentText}"` };
                        finishRun('success', done.reason);
                        return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                      }
                      await new Promise(r => setTimeout(r, 1000));
                      observation = await withTimeout(observePageViaAXTree(wv), observeTimeoutMs, observation);
                      rememberObservedSite(observation);
                    }
                  }
                  // ONE frame for the whole step: hash+thumbnail, OCR and (if the vision gate
                  // allows) the model all read the same NativeImage.
                  const shotProvider = store.localSettings.enabled
                    ? (store.localSettings.provider === 'ollama' ? 'ollama' : 'openai-compatible')
                    : store.aiSettings.provider;
                  const visionDec = decideAgentShot({
                    mode: visionMode,
                    step,
                    // A real navigation, not "the observation was re-taken" (that is most steps).
                    pageChanged: !!prevStepUrl && observation.url !== prevStepUrl,
                    domTextLen: (observation.text_sample || '').length,
                    imagesSent,
                    command,
                    provider: shotProvider,
                    zoomRequested: !!pendingZoom,
                  });
                  lastVisionReason = visionDec.reason;
                  const zoomNow = visionDec.attach ? pendingZoom : null;
                  pendingZoom = null;
                  prevStepUrl = observation.url;
                  const ocrWillRun = !observationWasCarried && !commandLooksLikeGoogleLogin
                    && (commandLooksLikeImageTextRead || (observation.text_sample || '').length < 200);
                  // Capture runs in parallel with OCR (as before) — except in vision mode, where
                  // OCR must read the SAME frame the model gets, so the capture settles first.
                  // The full-res PNG is only worth encoding when it is awaited before OCR (vision
                  // steps); otherwise OCR takes its own capture exactly as it always did.
                  // Carried observation = same page, so reuse its frame instead of recapturing.
                  const reuseFrame = observationWasCarried && !!carriedShot && !zoomNow;
                  const frameP = reuseFrame
                    ? Promise.resolve({ thumb: carriedThumb, image: visionDec.attach ? carriedShot : undefined, png: (ocrWillRun && visionDec.attach) ? carriedPng : undefined })
                    : withTimeout(captureFrame({ image: visionDec.attach, png: ocrWillRun && visionDec.attach && !zoomNow, agentVision: true, crop: zoomNow }), 8000, undefined as any);
                  let screenshot: string | undefined;
                  let shotForModel: VisionImage | undefined;
                  let framePngForOcr: string | undefined;
                  let stateKeyBefore = '';
                  const settleShotBefore = async () => {
                    const fr = await frameP;
                    screenshot = fr?.thumb;
                    shotForModel = visionDec.attach ? fr?.image : undefined;
                    framePngForOcr = fr?.png;
                    stateKeyBefore = `${observation.url}|${observation.title}|${hashScreenshotDataUrl(screenshot)}`;
                  };
                  if (visionDec.attach) await settleShotBefore();

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
                    onProgress({ kind: 'status', message: `⚡ batch action (${actionQueue.length} remaining)` });
                    break;
                  }
                  if (fromQueue) await settleShotBefore();   // caminho da fila: pega o screenshot já

                  if (!fromQueue) {
                  setAgentVisual('thinking');
                  onProgress({ kind: 'status', message: `Step ${step + 1}: thinking...` });
                  // Trocou o modelo no meio da tarefa? Pausa ANTES da próxima chamada ao modelo e pergunta
                  // (ou segue direto, se a pessoa ligou "trocar sem perguntar"). Antes de montar o prompt
                  // deste passo: a nota da troca (ou o recomeço) já vale pra ele.
                  if (modelLabelRef.current !== taskModel) {
                    const from = taskModel, to = modelLabelRef.current;
                    let choice = 'continue';
                    if (!switchModelSilentlyRef.current) {
                      choice = await new Promise<string>((resolve) => {
                        onProgress({ kind: 'confirm', risk: 'model', label: 'model switch', title: '🔁 Model changed during this task',
                          message: `From: ${from}\nTo: ${to}\nHow should the task go on?`,
                          choices: [
                            { label: `▶️ Continue with ${to.slice(0, 40)}`, value: 'continue' },
                            { label: '🔄 Restart the task with it', value: 'restart' },
                            { label: '⏹ Stop', value: 'stop' },
                          ],
                          onChoose: (v: string) => resolve(v), onConfirm: () => resolve('continue'), onCancel: () => resolve('stop') });
                      });
                      throwIfCancelled();
                    }
                    taskModel = to;
                    if (choice === 'stop') {
                      const reason = `Stopped: the model was switched to ${to} during the task.`;
                      finishRun('cancelled', reason);
                      return { thought: thoughts.join('\n\n') || reason, results: allResults, done: { type: 'done', success: false, reason } as BrowserAction };
                    }
                    if (choice === 'restart') {
                      history = `GOAL: ${command}\nNOTE: the task was restarted with a different model (${to}); start over from the current page.`;
                      plan = [];
                      memory.length = 0;
                    } else {
                      history += `\nMODEL SWITCH: from now on the model is ${to} (was ${from}). Continue the task from here.`;
                    }
                    onProgress({ kind: 'status', message: `🔁 ${choice === 'restart' ? 'Restarting' : 'Continuing'} with ${to}` });
                  }

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
                      // framePngForOcr = the exact frame the model may get; OCR reads the same one.
                      // Teto de 25s: o OCR é extra, nunca pode segurar o passo (o main já corta o
                      // print em 8s e o Tesseract em 15s; isto cobre qualquer outro travamento).
                      const ocrResult = await withTimeout(window.electronAPI.takeOcr(ocrWcId, observation.text_sample, commandLooksLikeImageTextRead, framePngForOcr), 25000, null as any);
                      if (ocrResult?.ocrUsed && ocrResult.ocrText) {
                        ocrText = ocrResult.ocrText;
                        onProgress({ kind: 'status', message: `🔍 Local OCR: ${ocrText.length} chars (conf: ${ocrResult.confidence ?? '?'}%)` });
                      }
                    } catch { /* non-fatal */ }
                  }
                  carriedOcrText = ocrText;
                  await settleShotBefore();   // OCR rodou em paralelo com a captura
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
                      if (e.frame) attrs.push(`frame="${e.frame}"`);
                      if (e.disabled) attrs.push('disabled');
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
                  // Tarefa de aba normal não enxerga as abas anônimas (nome e endereço não vão pro
                  // modelo), igual a uma extensão no Chrome. O número fica, pra não trocar os índices.
                  const tabsList = tabsRef.current
                    .map((t, i) => (t.incognito && !privateTaskRef.current)
                      ? `[${i}] (incognito tab — not available to this task)`
                      : `[${i}]${t.id === activeTabIdRef.current ? ' (active)' : ''}${agentOpenedTabs.has(t.id) ? ' (agent tab)' : t.id === taskTabId ? ' (starting tab)' : grantedTabs.has(t.id) ? ' (your tab — allowed)' : getPerm('userTabs') === 'deny' ? ' (your tab — no access)' : ' (your tab — ask first)'} "${(t.title || 'Untitled').slice(0, 60)}" — ${t.url}`)
                    .join('\n');
                  const planBlock = plan.length
                    ? `PLAN (${plan.length} steps):\n${plan.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
                    : `PLAN: (none yet — for complex tasks, emit a 'plan' action FIRST listing the steps)`;
                  const memoryBlock = memory.length
                    ? `MEMORY:\n${memory.map(m => `  • ${m.key} = ${JSON.stringify(m.value)}${m.source ? ` (from ${m.source})` : ''}`).join('\n')}`
                    : 'MEMORY: (empty — use store action to save extracted data)';
                  // Estado AO VIVO dos downloads desta tarefa, no topo do prompt. Na história as linhas
                  // ficavam no fim (depois de elementos/texto/OCR, e cortadas primeiro no contexto
                  // local) — o modelo achava que nada andava.
                  const taskDls = [...agentDlIdsRef.current].map(k => dlLatestRef.current.get(k)).filter((d): d is NonNullable<typeof d> => !!d);
                  const downloadsBlock = taskDls.length
                    ? `DOWNLOADS (live status — the file downloads in the background; the page does not need to change):\n${taskDls.map(d => {
                        const of = `${fmtSize(d.bytes) || '0 B'}${d.totalBytes ? ' of ' + fmtSize(d.totalBytes) : ''}`;
                        if (d.state === 'completed') return `  • ${d.filename} — COMPLETED (${fmtSize(d.bytes)}), saved at ${d.path || 'the Downloads folder'}${ofThisTask(d) ? '' : ' (from a PREVIOUS task — not this request)'}${wrongOsNote(d.filename)}`;
                        if (d.state === 'failed' || d.state === 'cancelled') return `  • ${d.filename} — ${d.state.toUpperCase()}`;
                        if ((d as any).stalled) return `  • ${d.filename} — STALLED at ${of} (no data for ${(d as any).stalledForSec || 15}s)`;
                        const pct = d.totalBytes ? Math.floor(((d.bytes || 0) / d.totalBytes) * 100) + '%, ' : '';
                        return `  • ${d.filename} — DOWNLOADING ${pct}${of}${(d as any).speedBps ? ', ' + fmtSpeed((d as any).speedBps) : ''}${d.etaSec != null ? ', ETA ' + fmtEta(d.etaSec) : ''} — progressing normally in the background. ${downloadIsLastStep ? 'If this is the file the user asked for, the task is DONE: finish with done saying it is downloading (the user follows it on the download button). Do not wait for it' : 'Bah waits for it to finish before your next step'}; do not look for another source.`;
                      }).join('\n')}`
                    : commandWantsDownload ? 'DOWNLOADS: none started yet in this task.' : '';
                  // Download task: aponta o(s) botão(ões) de baixar DESTA página. O modelo pequeno lia
                  // "Agree to the EULA and Download" como página de confirmação e desistia.
                  // Fabricante escreve "Install Steam", "Get the app", "Try free"… (ver isDownloadControl);
                  // link direto pra instalador vem primeiro, e o do SO/CPU errado fica de fora.
                  // A lista da árvore de acessibilidade NÃO tem href: o destino de cada candidato vem do DOM
                  // e casa com o [id] por texto + posição (Steam: o "Install Steam" do menu vai pra uma página,
                  // o grande vai pro .dmg — sem o href o modelo clicava no do menu em loop).
                  const domCtls: PageControl[] = commandWantsDownload ? await withTimeout(wv.executeJavaScript(`(function(){
                    var re = /download|install|get|try|free|trial|baixar|descargar|instalar|agree|accept/i;
                    return Array.prototype.slice.call(document.querySelectorAll('a,button,[role=button],input[type=button],input[type=submit]')).map(function(b){
                      var r = b.getBoundingClientRect(); var t = (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
                      return r.width > 4 && r.height > 4 && t.length <= 60 && re.test(t) ? { text: t, href: b.href || '', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
                    }).filter(Boolean).slice(0, 60);
                  })()`), 2000, [] as PageControl[]).catch(() => [] as PageControl[]) : [];
                  const hrefOf = (e: { id: number; href?: string }) => e.href || (domCtls.find(c => c.href && matchControl(observation.interactive_elements, c)?.id === e.id)?.href) || '';
                  const dlButtons = commandWantsDownload
                    ? observation.interactive_elements
                      .filter(e => isDownloadControl(String(e.text || (e as any).aria || ''), hrefOf(e)))
                      .filter(e => { const f = installerFileOf(hrefOf(e)); return !f || !isWrongBuild(f); })
                      .sort((a, b) => Number(!!installerFileOf(hrefOf(b))) - Number(!!installerFileOf(hrefOf(a))))
                      .slice(0, 3)
                    : [];
                  stepDlButtons = dlButtons;
                  let groceryBlock = '';
                  if (commandIsCart) {
                    const cartPage = await withTimeout(wv.executeJavaScript(CART_PAGE_SCRIPT), 3000, null as CartPage | null).catch(() => null);
                    if (cartPage?.isCart) { cartPageSeen = true; groceryInCart.clear(); for (const l of cartPage.lines || []) groceryInCart.set(l.name, l.qty); }
                    const tiles: ProductTile[] = cartPage?.isCart ? [] : await withTimeout(wv.executeJavaScript(GROCERY_TILES_SCRIPT), 3000, [] as ProductTile[]).catch(() => [] as ProductTile[]);
                    groceryTiles = tiles || [];
                    // Algo mudou no carrinho desde a última visita à página do carrinho → tem que conferir de novo no fim.
                    for (const t of tiles || []) if ((t.inCart || 0) !== (groceryInCart.get(t.name) || 0) && (t.inCart > 0 || groceryInCart.has(t.name))) cartPageSeen = false;
                    for (const t of tiles || []) { if (t.inCart > 0) groceryInCart.set(t.name, t.inCart); else if (t.add) groceryInCart.delete(t.name); if (t.oos) groceryOutOfStock.add(t.name); else if (t.add || t.inCart > 0) groceryAvailable.add(t.name); }
                    groceryBlock = [formatListProgress(groceryList, groceryInCart, groceryOutOfStock, searchBoxRef(observation.interactive_elements), groceryAvailable),
                      cartPage?.isCart ? formatCartPage(cartPage, observation.interactive_elements) : formatProductTiles(tiles || [], observation.interactive_elements)].filter(Boolean).join('\n');
                  }
                  const dlButtonsBlock = dlButtons.length
                    ? `LIKELY DOWNLOAD BUTTON${dlButtons.length > 1 ? 'S' : ''} ON THIS PAGE (click to start the file; accepting the license/EULA is part of downloading):\n${dlButtons.map(e => { const f = installerFileOf(hrefOf(e)); return `  [${e.id}] "${String(e.text || (e as any).aria || '').trim().slice(0, 60)}"${f ? ` → ${f} (installer for this computer)` : ''}`; }).join('\n')}`
                    : '';
                  // Dica ao vivo de UI que trava modelo pequeno (vale pra qualquer site):
                  //  • diálogo modal aberto → a página de trás fica inerte e SOME da lista de elementos
                  //    (Booking: popup "sign in" e o agente digitava "Los Angeles" no e-mail do popup);
                  //  • sugestões de autocomplete visíveis → tem que escolher uma antes de buscar.
                  // A mesma passada lê os outros estados da página (calendário, EULA, seletor de SO, caixa de
                  // busca, abas, cartões, parede de login), pra quem escolhe orientação por tipo de página.
                  const uiState = await withTimeout(wv.executeJavaScript(`(function(){
                    var vis = function(e){ var r = e.getBoundingClientRect(); var cs = getComputedStyle(e); return r.width > 20 && r.height > 20 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
                    var dlg = Array.prototype.slice.call(document.querySelectorAll('[role=dialog],[role=alertdialog],dialog[open],[aria-modal=true]')).filter(vis)
                      .filter(function(d){ var r = d.getBoundingClientRect(); return r.width * r.height > innerWidth * innerHeight * 0.04; })[0];
                    // Painel flutuante sem role de diálogo (ex.: "Trending" do campo de busca, banner que cobre
                    // a página): fixo/absoluto, z-index alto, cobrindo ≥20% da tela, e que não é o cabeçalho.
                    // Mesma passada coleta também os candidatos a modal "caseiro" (div fixa sem ARIA, menor
                    // que 20% — ex.: o de download da HP) e se há um fundo escuro; quem decide é pickOverlay
                    // (shared/page-controls.ts), no renderer.
                    var overlays = [], backdrop = false, legacyHits = [];
                    if (!dlg) Array.prototype.slice.call(document.querySelectorAll('body *')).forEach(function(e){
                      var cs = getComputedStyle(e); if (!(cs.position === 'fixed' || cs.position === 'absolute')) return;
                      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return;
                      var z = parseInt(cs.zIndex, 10) || 0, r = e.getBoundingClientRect();
                      // Fundo escuro vazio ANTES da regra antiga: com z alto ele ganhava dela e virava um
                      // "diálogo" sem título (= nenhum aviso) escondendo o painel de verdade.
                      if (cs.position === 'fixed' && r.width * r.height >= innerWidth * innerHeight * 0.6 && (e.innerText || '').trim().length < 20 && !e.querySelector('button,a,input')) { backdrop = true; return; }
                      if (z >= 10 && r.height >= 120 && !(r.top < 0 && r.bottom < 120) && r.width * r.height > innerWidth * innerHeight * 0.20 && !(r.top <= 0 && r.height < 140)) { legacyHits.push(e); return; }
                      if (r.width < 40 || r.height < 40 || r.bottom <= 0 || r.top >= innerHeight) return;
                      var area = Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight) / (innerWidth * innerHeight);
                      if (area >= 0.015 && (cs.position === 'fixed' ? z >= 1 : z >= 100)) overlays.push({ el: e, z: z, area: area, top: r.top, height: r.height });
                    });
                    if (!dlg) dlg = legacyHits.sort(function(a, b){ return (parseInt(getComputedStyle(b).zIndex, 10) || 0) - (parseInt(getComputedStyle(a).zIndex, 10) || 0); })[0];
                    var btnsOf = function(el){ return Array.prototype.slice.call(el.querySelectorAll('button,a[href],[role=button],input[type=button],input[type=submit]')).filter(function(b){ var r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(b).visibility !== 'hidden'; }).slice(0, 8)
                      .map(function(b){ var r = b.getBoundingClientRect(); return { text: (b.getAttribute('aria-label') || b.innerText || b.value || b.title || '').replace(/\\s+/g, ' ').trim().slice(0, 60), href: b.href || '', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }).filter(function(b){ return b.text; }); };
                    var hitC = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
                    overlays = dlg ? [] : overlays.filter(function(o){ return !overlays.some(function(p){ return p !== o && p.el.contains(o.el); }); }).slice(0, 12).map(function(o){
                      return { z: o.z, area: o.area, top: o.top, height: o.height, viewportH: innerHeight, hitCenter: !!hitC && o.el.contains(hitC), legacy: false, buttons: btnsOf(o.el),
                        label: (o.el.getAttribute('aria-label') || (o.el.querySelector('h1,h2,h3,h4,[role=heading]') || {}).innerText || o.el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90) };
                    });
                    var label = dlg ? (dlg.getAttribute('aria-label') || (dlg.querySelector('h1,h2,h3,[role=heading]') || {}).innerText || dlg.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90) : '';
                    // Cupom/desconto no popup: guarda o trecho (quase todo popup só precisa sair do caminho).
                    var promo = dlg ? ((dlg.innerText || '').replace(/\\s+/g, ' ').match(/[^.!?]{0,80}(\\d+\\s?% off|promo ?code|coupon|discount code|use code|save \\$\\d+|\\$\\d+ off|cupom|c[oó]digo promocional|descuento)[^.!?]{0,80}/i) || [''])[0].trim() : '';
                    var closers = dlg ? Array.prototype.slice.call(dlg.querySelectorAll('button,[role=button],a')).filter(vis).map(function(b){ return (b.getAttribute('aria-label') || b.innerText || b.title || '').replace(/\\s+/g, ' ').trim(); })
                      .filter(function(t){ return /^(close|dismiss|×|x|no thanks|not now|maybe later|skip|cancel|fechar|cerrar|agora não)\\b|dismiss|close/i.test(t); }).slice(0, 3) : [];
                    var visRow = function(e){ var r = e.getBoundingClientRect(); var cs = getComputedStyle(e); return r.width > 20 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
                    var opts = Array.prototype.slice.call(document.querySelectorAll('[role=option],[role=listbox] li,[data-testid*=autocomplete] li')).filter(visRow).map(function(o){ return o.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80); }).filter(Boolean).slice(0, 6);
                    var ctlText = Array.prototype.slice.call(document.querySelectorAll('button,a,label,[role=button],input[type=checkbox],option,[role=tab]')).filter(visRow)
                      .map(function(e){ return (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(); }).join(' | ').slice(0, 20000);
                    var datepicker = !!Array.prototype.slice.call(document.querySelectorAll('input[type=date],[role=grid],[data-date],[class*=datepicker i],[class*=calendar i],[aria-label*=calendar i]')).filter(visRow)[0];
                    var eula = /\\b(eula|end[- ]user licen[cs]e|licen[cs]e agreement|agree to the (licen[cs]e|terms)|accept (the )?(licen[cs]e|terms))\\b/i.test(ctlText);
                    var osSel = /\\bwindows\\b/i.test(ctlText) && /\\b(mac ?os|os x|linux)\\b/i.test(ctlText);
                    var searchbox = !!Array.prototype.slice.call(document.querySelectorAll('input[type=search],[role=searchbox],[role=combobox],input[type=text],input:not([type])')).filter(visRow).filter(function(i){
                      var t = ((i.getAttribute('placeholder') || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.name || '') + ' ' + (i.type || '')).toLowerCase();
                      return /search|where|destination|city|going|find|location|keyword|query|looking for|i'm looking|what are you looking|busca|pesquis|buscar|destino|procur/.test(t);
                    })[0];
                    // Abas: tablist ARIA de verdade, ou ≥2 controles com nome típico de aba (Overview, Specifications…).
                    var tabWords = /^(overview|specifications|specs|tech specs|technical specifications|models|accessories|parts|reviews|details|documentation|downloads|features|support|description|q&a|vis[aã]o geral|especifica[cç][oõ]es|acess[oó]rios|avalia[cç][oõ]es|detalhes)$/i;
                    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role=tablist]')).filter(visRow).some(function(t){ return t.querySelectorAll('[role=tab]').length >= 2; })
                      || Array.prototype.slice.call(document.querySelectorAll('a,button,[role=tab],li')).filter(visRow).filter(function(e){ return tabWords.test((e.innerText || '').trim()); }).length >= 2;
                    // Cartões: ≥3 irmãos visíveis do mesmo tipo (tag + classe), cada um com link e um pouco de texto —
                    // lista de vagas, hotéis, produtos, e-mails… (ver skill card-list).
                    var cards = Array.prototype.slice.call(document.querySelectorAll('ul,ol,div,section,main')).some(function(p){
                      if (p.children.length < 3) return false;
                      var kids = Array.prototype.slice.call(p.children).filter(function(c){ var t = (c.textContent || '').length; return t > 20 && t < 3000 && c.querySelector('a[href],[role=link],button') && visRow(c); });
                      if (kids.length < 3) return false;
                      var sig = function(c){ return c.tagName + '.' + String(c.className || '').split(/\\s+/)[0]; };
                      var n = {}; kids.forEach(function(c){ n[sig(c)] = (n[sig(c)] || 0) + 1; });
                      return Object.keys(n).some(function(k){ return n[k] >= 3; });
                    });
                    // Parede de login: campo de senha à vista, página de login (título/endereço) ou aviso "entre para ver…".
                    var signin = Array.prototype.slice.call(document.querySelectorAll('input[type=password]')).filter(visRow).length > 0
                      || /\\b(log ?in|sign ?in|sign ?up)\\b|\\bentrar\\b|iniciar sesi[oó]n/i.test(document.title || '')
                      || /\\/(login|signin|sign-in|log-in|uas\\/login|auth|account\\/login)\\b/i.test(location.pathname)
                      || /\\b(sign in|log in|join|entre|fa[cç]a login|inicia sesi[oó]n) (to|para) (see|view|continue|access|apply|ver|continuar|acessar)\\b/i.test((document.body.innerText || '').slice(0, 4000));
                    return { promo: promo, dialog: label, closers: closers, buttons: dlg ? btnsOf(dlg) : [], overlays: overlays, backdrop: backdrop, options: opts, datepicker: datepicker, eula: eula, osSelector: osSel, searchbox: searchbox, tabs: tabs, cards: cards, signin: signin };
                  })()`).catch(() => null), 2000, null) as { dialog: string; closers: string[]; buttons?: PageControl[]; overlays?: OverlayCandidate[]; backdrop?: boolean; options: string[]; datepicker: boolean; eula: boolean; osSelector: boolean; searchbox: boolean; tabs: boolean; cards?: boolean; signin?: boolean; promo?: string } | null;
                  // Modal sem ARIA (div fixa por cima): vira o "dialog" daqui pra frente — o mesmo aviso
                  // e o Escape dos popups de sempre, mais a lista dos botões dele.
                  if (uiState && !uiState.dialog && uiState.overlays?.length) {
                    const ov = pickOverlay(uiState.overlays, !!uiState.backdrop);
                    if (ov) {
                      uiState.dialog = ov.label || 'untitled overlay';
                      uiState.buttons = ov.buttons;
                      uiState.closers = ov.buttons.map(b => b.text).filter(t => /^(close|dismiss|×|x|✕|no thanks|not now|maybe later|skip|cancel|fechar|cerrar|agora não)\b|dismiss|close/i.test(t)).slice(0, 3);
                    }
                  }
                  const elFor = (txt: string) => observation.interactive_elements.find(e => {
                    const t = String(e.text || e.aria || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    return t && (t === txt.toLowerCase() || t.startsWith(txt.toLowerCase().slice(0, 40)));
                  });
                  if (uiState?.promo && !memory.some(m => m.key === 'promo' && m.value === uiState.promo)) {
                    memory.push({ key: 'promo', value: uiState.promo, source: paceHostOf(observation.url), ts: Date.now() });
                    onProgress({ kind: 'status', message: `🏷️ Noted an offer from a popup: ${uiState.promo.slice(0, 80)}` });
                  }
                  // Os botões DO diálogo, com o [id] certo pela posição (o "Download" do modal × o da página atrás).
                  const dlgBtns = (uiState?.buttons || []).map(b => { const e = matchControl(observation.interactive_elements, b); return e ? `[${e.id}] "${b.text}"` : ''; }).filter(Boolean);
                  const dialogBlock = uiState?.dialog
                    ? `OPEN DIALOG/POPUP: "${uiState.dialog}".${dlgBtns.length ? ` Its own buttons: ${dlgBtns.join(', ')} — if one of them is what the task needs (e.g. the dialog's Download/Continue), click THAT [id], not a same-named button on the page behind.` : ''}${uiState.promo ? ` It mentions an offer — Bah saved it to MEMORY ("${uiState.promo.slice(0, 100)}"); mention it in your answer only if it applies to what the user wants.` : ''} While it is open the page behind it cannot be used (its fields/buttons are not in the list). Close it FIRST${uiState.closers.length ? ': ' + uiState.closers.map(c => { const e = elFor(c); return e ? `[${e.id}] "${c}"` : `"${c}"`; }).join(' or ') + ' — or press "Escape"' : ': press "Escape" (or click an empty part of the page)'} — unless this dialog IS what the task needs.`
                    // Realidade da página ATUAL: o modelo pequeno repete "travado num popup" de passos antigos.
                    : /\b(popup|pop-up|overlay|modal|dialog|blocking|blocked by)\b/i.test(lastEvalText)
                      ? `PAGE CHECK: Bah sees NO open popup/dialog on ${paceHostOf(observation.url) || 'this page'} right now — the page is usable. Do not repeat earlier observations; act on the current page.`
                      : '';
                  // O agente diz duas vezes seguidas que um popup bloqueia ESTA página e Bah vê um aberto:
                  // Bah aperta Escape por ele (fecha painel de busca/"Trending", menus, a maioria dos modais).
                  if (uiState?.dialog && /\b(popup|pop-up|overlay|modal|dialog|blocking|blocked by)\b/i.test(lastEvalText)) {
                    popupComplaints = popupComplaintsUrl === observation.url ? popupComplaints + 1 : 1;
                    popupComplaintsUrl = observation.url;
                    if (popupComplaints >= 2) {
                      popupComplaints = 0;
                      const wcIdE = (wv as any).getWebContentsId?.();
                      if (wcIdE != null) { try { await window.electronAPI?.realKey?.(wcIdE, 'Escape'); } catch {} }
                      history += `\nBAH PRESSED ESCAPE: the agent reported the same popup twice, so Bah pressed Escape to close it. Re-check the page.`;
                      onProgress({ kind: 'status', message: '⎋ Pressed Escape to close the popup.' });
                    }
                  }
                  const suggestBlock = uiState?.options?.length
                    ? `SUGGESTIONS LIST is open (autocomplete/drop-down) — click the matching one (click_ref) BEFORE searching; typed text alone is often not accepted:\n${uiState.options.map(o => { const e = elFor(o); return `  ${e ? `[${e.id}]` : '-'} "${o}"`; }).join('\n')}`
                    : '';
                  const pageStates = [
                    uiState?.dialog ? 'dialog' : '', uiState?.options?.length ? 'suggestions' : '',
                    uiState?.datepicker ? 'datepicker' : '', uiState?.eula ? 'eula' : '', uiState?.osSelector ? 'os-selector' : '',
                    uiState?.searchbox ? 'searchbox' : '', uiState?.tabs ? 'tabs' : '', uiState?.cards ? 'cards' : '', uiState?.signin ? 'signin' : '',
                  ].filter(Boolean);
                  const stepSkills = selectSkills(allSkills, {
                    url: observation.url, states: pageStates,
                    tasks: [commandWantsDownload ? 'download' : '', isMediaCollectionRequest(command) ? 'collection' : '', commandWantsSearch ? 'search' : '', commandIsTravel ? 'travel' : '', commandIsShopping && !commandIsCart ? 'shopping' : '', commandIsParts ? 'parts' : '', commandIsPeople ? 'people' : '', commandIsCart ? 'grocery' : ''].filter(Boolean),
                  });
                  const skillsBlock = formatSkillsBlock(stepSkills);
                  if (stepSkills.length) onProgress({ kind: 'status', message: `🧩 Skills: ${stepSkills.map(x => x.name).join(', ')}` });
                  // Abas que o agente usa seguem a política dele pra alert/confirm; o que aconteceu
                  // com os diálogos desde o último passo entra no histórico como linhas DIALOG:.
                  { let dlgWcId: number | undefined; try { dlgWcId = (wv as any).getWebContentsId?.(); } catch {}
                    agentDialogsTab(dlgWcId); }
                  history += drainDialogLog();
                  { const acct = noteAccountState(observation); const h = paceHostOf(observation.url);
                    // Fato da sessão: em que site a pessoa está (ou não) logada.
                    if (acct && h) noteThreadFact(threadKey, `account:${h}`, `${acct === 'signed-in' ? 'signed in' : 'signed out'} on ${h}`); }
                  // Buscador mostrando página de bloqueio/captcha: fica de fora por 1h (web_search e a linha SEARCH ENGINE pulam).
                  { const eng = engineForUrl(observation.url);
                    if (eng && SEARCH_BLOCK_RE.test(`${observation.url} ${observation.title} ${(observation.text_sample || '').slice(0, 1500)}`)) markBlocked(eng); }
                  const observedPayload = [
                    buildKnownSitesBlock(observation),
                    '',
                    agentSearchLine(),
                    accountStateLine(observation),
                    dialogBlock,
                    suggestBlock,
                    // Download: a máquina e o que escolher bem ao lado dos downloads (o bloco do sistema
                    // fica longe e o modelo pequeno pegava o .exe num Mac); e o aviso de agregador.
                    commandWantsDownload ? machineLine(MACHINE) : '',
                    commandWantsDownload ? thirdPartyNote(thirdPartyDownloadSite(observation.url)) : '',
                    downloadsBlock,
                    dlButtonsBlock,
                    groceryBlock,
                    skillsBlock,
                    '',
                    planBlock,
                    '',
                    memoryBlock,
                    '',
                    `TABS:\n${tabsList}`,
                    '',
                    `URL: ${observation.url}`,
                    `TITLE: ${observation.title}`,
                    `INTERACTIVE ELEMENTS (use the [N] id with click_ref/fill_ref):${observation.interactive_elements.some(e => e.frame) ? ' frame="…" marks elements inside an embedded frame (form, payment, booking widget) — click_ref/fill_ref work on them the same way.' : ''}`,
                    newElementCount > 0 ? `(${newElementCount} element(s) marked with '*' are NEW since your last action — e.g. a popup/modal/result that just appeared)` : '',
                    compactDom || '(none detected)',
                    '',
                    pendingReads.join('\n\n'),
                    `PAGE TEXT: ${observation.text_sample.slice(0, 1500)}`,
                    // Full OCR even when a frame is attached: main may still drop the image
                    // (capability/size/rejection) AFTER this payload is built, and then the OCR
                    // text is all the model has. The local context budget trims if needed.
                    ocrText ? `\nOCR TEXT (extracted locally from screenshot):\n${ocrText}` : '',
                    '',
                    `RECENT HISTORY:\n${history.slice(-2500)}`,
                  ].filter(s => s !== '').join('\n');
                  shownReadTokens = pendingReads.length ? estimateThreadTokens(pendingReads.join('\n\n')) : 0;
                  pendingReads = [];
                  // Anti-loop: track time on same URL
                  if (observation.url === lastSeenUrl) stepsOnSameUrl++;
                  else { stepsOnSameUrl = 1; lastSeenUrl = observation.url; }

                  if (step >= 20 && !replanRequested) replanRequested = true;
                  const stuckOnUrl = stepsOnSameUrl >= 5;
                  // Ritmo por site: página com cara de checagem anti-robô → esperas maiores neste host por 30 min.
                  { const h = paceHostOf(observation.url);
                    if (h && BOT_CHECK_RE.test(`${observation.title} ${(observation.text_sample || '').slice(0, 600)}`)) backoff(h); }
                  const pacingLine = isBackedOff(paceHostOf(observation.url))
                    ? `PACING: ${paceHostOf(observation.url)} flagged automated access — Bah now waits 15–30s between actions here for 30 minutes. Do only what is necessary on this site; prefer another source when the task allows.`
                    : '';
                  const prompt = [
                    history, '',
                    noEffectCount > 0 ? 'IMPORTANT: Your last action had no visible effect. Try another approach.' : '',
                    // Judge the last action before choosing the next one. Small models happily
                    // repeat a click that did nothing; making the judgement an explicit field
                    // turns that into a signal the loop can act on.
                    step > 0 ? [
                      `Previous action: ${lastActionSummary}.`,
                      `Observed after it: ${lastActionOutcome}.`,
                      "Set \"evaluation\" to success, failed or unclear followed by why, judged",
                      "ONLY from what is on the page NOW - not from what you intended.",
                      "If it failed, do NOT propose the same action again: change target,",
                      "method, or stop and tell the user what is blocking you.",
                    ].join(' ') : '',
                    selfFailCount >= 2 ? 'STUCK: you reported the last ' + selfFailCount + ' actions as failed. Do not repeat them. Pick a different route or emit done with an honest reason.' : '',
                    // Measured: without this the model narrated the page for steps and clicked nothing.
                    zoomNow && shotForModel ? `ZOOMED VIEW: the attached image is a sharp CROP of ${zoomNow.label} (viewport area x=${Math.round(zoomNow.x)}, y=${Math.round(zoomNow.y)}, ${Math.round(zoomNow.w)}x${Math.round(zoomNow.h)} px), not the whole page. Read it, then act with refs (click_ref / select_option / check) — do not use click_at on this crop.` : '',
                    shotForModel ? [
                      'A SCREENSHOT of the live page is attached to this request.',
                      'You are the ACTOR, not the narrator: answer with an ACTION that changes the page.',
                      'Never answer with a description of the screenshot, and never finish with done',
                      'unless the user goal is already complete on this page.',
                      'Click exactly what the image shows: poster art does not open a page, the PLAY (assistir/play) button does.',
                      'Coordinates use the viewport size stated above.',
                    ].join(' ') : '',
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
                    pacingLine,
                    replanRequested && step >= 20 ? 'REPLAN: You have used 20+ steps. If you have ANY useful data in MEMORY, call report() with what you have. Better partial answer than no answer.' : '',
                    `[STEP ${step + 1}/${MAX_STEPS === Infinity ? '∞' : MAX_STEPS}] Choose exactly one tool action. If the goal is complete, return done or report.`,
                  ].filter(Boolean).join('\n');
                  // ── Tier routing ──────────────────────────────────────────────
                  // Text (DOM + OCR) is the default context; a screenshot travels only when the
                  // vision mode/heuristics say so (see decideAgentShot + ai-engine:resolveVision).
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
                  const tierIcon = tier === 'local' ? '🏠 local' : tier === 'pro' ? '🧠 thinking deeper' : '⚡ flash';
                  console.log(`[Agent] step ${step + 1} → aiAction (tier=${tier}, ocrUsed=${!!ocrText})`);
                  // One actionId per step: on Stop the main process aborts the in-flight
                  // request. Without it the late result was dropped here while the GPU
                  // carried on generating.
                  const actionId = `a-${Date.now().toString(36)}-s${step}`;
                  activeActionId = actionId;
                  interjectRef.current.abortStep = () => { try { window.electronAPI?.actionCancel?.(actionId); } catch {} };
                  const onAbortStep = () => { try { window.electronAPI?.actionCancel?.(actionId); } catch {} };
                  if (signal) signal.addEventListener('abort', onAbortStep, { once: true });
                  // Vision: the frame decided above, if the gate allowed it. The main process
                  // re-checks capability/size and reports why not.
                  if (shotForModel) {
                    onProgress({ kind: 'status', message: `🖼️ screenshot to model: ${shotForModel.width}x${shotForModel.height} · ${Math.round((shotForModel.bytes ?? 0) / 1024)} KB` });
                  } else if (visionMode !== 'off' && step === 0) {
                    onProgress({ kind: 'status', message: `📄 text only this step (${lastVisionReason})` });
                  }
                  let result: any;
                  // Reset every LLM step: a text-only step has no picture to take coordinates from.
                  modelShot = undefined;
                  // Retry / degrade / pause - LOCAL only (cloud keeps failing fast, as before).
                  // 1) retry the step, 2) degrade: drop the screenshot, 3) pause and ask the user.
                  // The engine already resent transport failures; a slow server (the whole 300s
                  // budget used) gets ONE step retry, not two: each try can cost five minutes.
                  // Stop always wins: the abort listener stays wired across every try.
                  const isLocalStep = tier === 'local';
                  try {
                    for (let tries = 0; ; tries++) {
                      result = await raceCancel(window.electronAPI?.aiAction(prompt, observedPayload, shotForModel, tier, actionId));
                      if (!isLocalStep || !result?.error || result?.errorCode === 'CANCELLED' || result?.errorRetryable !== true) break;
                      const code = String(result?.errorCode ?? 'UNKNOWN');
                      const maxTries = /^TIMEOUT_(FIRST_CHUNK|TOTAL)$/.test(code) ? 2 : 3;
                      if (tries + 1 >= maxTries || deadline.fired()) break;
                      const wait = tries === 0 ? 2000 : 5000;
                      onProgress({ kind: 'status', message: `⏳ ${code} — retrying step ${step + 1} (${tries + 2}/${maxTries}) in ${wait / 1000}s` });
                      await raceCancel(new Promise<void>((res2) => setTimeout(res2, wait)));
                      throwIfCancelled();
                      // Degrade so the retry is cheaper than the attempt that just failed.
                      if (tries === 0 && shotForModel) {
                        shotForModel = undefined;
                        onProgress({ kind: 'status', message: '📄 retrying without the screenshot' });
                      }
                    }
                  } finally {
                    if (signal) signal.removeEventListener('abort', onAbortStep);
                  }
                  interjectRef.current.abortStep = null;
                  // Mensagem nova do usuário chegou ENQUANTO a IA pensava (o pedido foi cortado por
                  // isso, ou terminou junto): a resposta é de ANTES da mudança — descarta e refaz o
                  // passo, que começa pondo a mensagem no pedido. O Parar ganha de tudo.
                  if (interjectRef.current.queue.length > 0) { throwIfCancelled(); step--; continue; }
                  if (result?.vision?.attached && shotForModel) {
                    imagesSent++;   // only frames the model really received count against the budget
                    // Main measured the encoded size; that is the space the model's x,y live in.
                    modelShot = { width: result.vision.width ?? shotForModel.width, height: result.vision.height ?? shotForModel.height };
                  } else if (shotForModel) {
                    const why = result?.vision?.reason ?? (result?.error ? 'error' : 'unknown');
                    onProgress({ kind: 'status', message: `📄 model got text only (${why})` });
                    // Permanent for this run (setting, provider, model): stop capturing and
                    // shipping frames that will be refused every step.
                    if (STICKY_VISION_REASONS.has(why)) visionMode = 'off';
                  }
                  throwIfCancelled();
                  // The deadline cancels the in-flight request too; that is the time limit, not
                  // the user's Stop - go round so the deadline check reports it honestly.
                  if (result?.error && deadline.fired()) continue;
                  // Cancellation confirmed by main: a clean stop, not a task failure.
                  if (result?.error && (result?.errorCode === 'CANCELLED' || /CANCELLED|TASK_CANCELLED/.test(String(result.error)))) throw new Error('TASK_CANCELLED_BY_USER');
                  console.log(`[Agent] step ${step + 1} ← result:`, result?.error || `action=${result?.action?.type} engine=${result?._engine}`);
                  if (result?._engine) {
                    onProgress({ kind: 'status', message: `${tierIcon} → engine: ${result._engine}` });
                  }
                  // Resposta malformada do modelo (ação inválida/JSON quebrado) não é "modelo fora
                  // do ar": segue pro re-pergunta automático (até 3x, com a causa) mais abaixo, em
                  // vez de parar pedindo ajuda com "start your server" / "o modelo recusou".
                  const formatError = /Invalid or missing action|Invalid action from model|did not return valid structured JSON/i.test(String(result?.error || ''));
                  if (result?.error && !formatError) {
                    // Decide on codes, not prose. Ask the user (max twice per run) before failing.
                    const code = result?.errorCode ?? 'UNKNOWN';
                    const retryable = result?.errorRetryable === true;
                    onProgress({ kind: 'status', message: `Error [${code}${retryable ? ', retries exhausted' : ''}]: ${result.error}` });
                    if (isLocalStep && localHelpPauses < 2) {
                      localHelpPauses++;
                      deadline.suspend();
                      await waitForManualHelp({
                        kind: 'local_unavailable',
                        reason: `${code}: ${result.error}`,
                        instruction: retryable
                          ? 'The local model did not answer. Start it (or check its context window), then press Continue — this step runs again. Press Stop to end the task.'
                          : 'The local model refused this request. Press Stop, or change the model / screenshot setting, then press Continue.'
                      }, observation.url);
                      deadline.resume();
                      throwIfCancelled();
                      onProgress({ kind: 'status', message: '▶️ continuing after your help' });
                      step--;   // this step gets another go, with whatever the user fixed
                      continue;
                    }
                    finishRun('failed', result.error, { errorCode: code, retryable });
                    return { error: result.error, errorCode: code, retryable, thought: thoughts.join('\n'), results: allResults };
                  }
                  lastEvalText = `${result?.evaluation || ''} ${result?.thought || ''}`;
                  // browser-use style: surface the model's self-evaluation of its previous action.
                  if (result?.evaluation && step > 0) {
                    const evalStr = String(result.evaluation);
                    stepEvaluation = evalStr;
                    // The model judged its own last action. Two in a row means repeating a
                    // failing route, which is when the loop has to force a change.
                    selfFailCount = nextSelfFailCount(selfFailCount, classifySelfEval(evalStr));
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
                    // Os tokens já estavam nesta linha; só nunca viravam dinheiro. O chip 📊 é
                    // efêmero (some em ~2s), então o acumulado vai pro cabeçalho do painel —
                    // lá ele fica, que é o que importa pra quem deixou rodando a noite toda.
                    const c = costOf(m.model, u);
                    if (c) bumpSessionCost(c.usd, c.est);
                    const money = c && c.usd > 0 ? ` • ${fmtUsd(c.usd, c.est)}` : '';
                    onProgress({ kind: 'status', message: `📊 ${m.model} • ${inT} in / ${outT} out / ${cached} cached • ${sec}s${money}` });
                  }
                  // Medidor de contexto do painel: as partes desta chamada (estimadas) + o total que o
                  // provedor informou, quando informou. A página é a que foi de fato (cortada, se precisou).
                  {
                    const m = result?.metrics || {};
                    const pp = m.promptParts || {};
                    const skillsTok = estimateThreadTokens(skillsBlock);
                    const pageTok = Math.max(0, (typeof pp.page === 'number' ? pp.page : estimateThreadTokens(observedPayload)) - skillsTok) + (pp.image || 0);
                    const reported = Number(m.usage?.prompt_tokens ?? m.usage?.input_tokens ?? 0);
                    noteContextUsage(threadKey, {
                      window: m.contextTokens || contextWindowNow(),
                      parts: { instructions: (pp.system || 0) + Math.max(0, estimateThreadTokens(prompt) - threadTok), skills: skillsTok, thread: threadTok, page: pageTok },
                      reported: reported > 0 ? reported : undefined,
                    });
                    if (m.contextTrimmed && !trimNoticeShown) { trimNoticeShown = true; noteThreadTrimmed(threadKey, `task:${actionId}`); }
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
                    onProgress({ kind: 'status', message: `⚡ batch of ${result.actions.length} actions planned` });
                  }
                  } // end if (!fromQueue)
                  // click_role → click_ref do elemento que casa (passa pelos mesmos freios e verificações).
                  let roleMiss = '';
                  if (action?.type === 'click_role') {
                    const hits = matchRole(observation.interactive_elements, action.role, action.name);
                    const pick = hits[Math.max(1, action.nth || 1) - 1];
                    if (pick) { onProgress({ kind: 'status', message: `🎯 ${action.role}${action.name ? ` "${action.name}"` : ''}${action.nth ? ` #${action.nth}` : ''} → @${pick.id}` }); action = { type: 'click_ref', ref: pick.id }; }
                    else roleMiss = hits.length ? `only ${hits.length} ${action.role}(s) match "${action.name || ''}" — nth ${action.nth} does not exist` : `no ${action.role} labelled "${action.name || ''}" in INTERACTIVE ELEMENTS (scroll, use find, or pick a ref)`;
                  }
                  if (!action) {
                    finishRun('failed', 'AI did not return an action.');
                    return { error: 'AI did not return an action.', thought: thoughts.join('\n'), results: allResults };
                  }
                  // Etapa 6: repeated-action (loop) detection — same action proposed 3x in a row
                  const actionHash = formatAction(action);
                  // download/download_video ficam FORA: baixar de novo é loop de verdade.
                  const internalForDedupe = action.type === 'plan' || action.type === 'store'
                    || action.type === 'extract_text' || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'generate_image' || action.type === 'find_file'
                    || action.type === 'ask_ai' || action.type === 'read_aloud' || action.type === 'wait' || action.type === 'list_downloads'
                    || action.type === 'done' || action.type === 'report';
                  const priorRepeats = recentActionHashes.slice(-3).filter(h => h === actionHash).length;
                  recentActionHashes.push(actionHash);
                  if (recentActionHashes.length > 6) recentActionHashes.shift();
                  if (!internalForDedupe && priorRepeats >= 2) {
                    history += `\nLOOP DETECTED: You proposed "${actionHash}" ${priorRepeats + 1} times without progress. Do NOT repeat it — pick a different element, scroll, or change strategy entirely.`;
                    onProgress({ kind: 'status', message: `Loop detected: ${actionHash} repeated. Changing strategy.` });
                    noEffectCount = Math.max(noEffectCount, 2); // forces cloud 'pro' on next call
                    // Disjuntor: avisar não bastou por MAX_LOOP_STRIKES vezes → encerra em vez
                    // de girar pra sempre (essencial agora que ∞ não tem teto de passos/tempo).
                    if (++loopStrikes >= MAX_LOOP_STRIKES) {
                      const done: BrowserAction = {
                        type: 'done',
                        success: false,
                        reason: `Stopped: the AI kept repeating "${actionHash}" and could not make progress (${loopStrikes} attempts). Try rephrasing the task, or open the page manually and ask again.`,
                      };
                      finishRun('failed', done.reason);
                      return { thought: thoughts.join('\n\n') || done.reason, results: allResults, done };
                    }
                    continue;
                  }
                  loopStrikes = 0;   // ação nova/produtiva → zera o disjuntor
                  // ── FREIO ANTI-COLETA (crucial pro modelo LOCAL) ──────────────────
                  // extract_text é isento do loop-detector acima (re-extrair é "inofensivo").
                  // Mas modelo fraco (qwen local) re-extrai o mesmo texto várias vezes sem
                  // perceber que já tem a resposta → empaca sem dar report. Contamos extrações
                  // seguidas: na 2ª mandamos parar; e se persistir (ou já no local), ENCERRAMOS
                  // com a melhor resposta que o próprio modelo já escreveu (thought/eval).
                  // Página nova (offset ainda não lido nesta URL) é paginação, não re-extração.
                  const extractPage = action.type === 'extract_text' ? `${observation.url}#${action.offset || 0}` : '';
                  if (action.type === 'extract_text' && (action.offset || 0) > 0 && !extractPagesRead.has(extractPage)) consecutiveExtracts = 1;
                  else if (action.type === 'extract_text') consecutiveExtracts++;
                  else if (action.type !== 'store' && action.type !== 'plan' && action.type !== 'wait') consecutiveExtracts = 0;
                  // SÓ no modo LOCAL: o freio é pra compensar o juízo fraco do modelo local.
                  // O caminho da NUVEM (API) fica 100% intocado (ele já sabe quando parar).
                  if (store.localSettings.enabled && action.type === 'extract_text' && consecutiveExtracts >= 2) {
                    if (consecutiveExtracts >= 4) {
                      // Travado de vez na coleta → encerra com o TEXTO já extraído (conteúdo real,
                      // não o pensamento de planejamento). Pelo menos entrega a informação da página.
                      const answer = (lastExtractedText || '').replace(/\s+/g, ' ').trim().slice(0, 500)
                        || (stepThought || stepEvaluation || '').trim() || 'Read the page content.';
                      const done: BrowserAction = { type: 'done', success: true, reason: answer };
                      onProgress({ kind: 'status', message: `🛑 Stuck re-extracting — finished with the content already extracted.` });
                      finishRun('success', answer);
                      return { thought: thoughts.join('\n\n') || answer, results: allResults, done };
                    }
                    // 2ª/3ª extração seguida: NÃO re-extrai — manda reportar com o texto que já tem.
                    // O texto já lido volta no bloco PAGE TEXT (extracted) do próximo passo (no histórico só fica a linha).
                    if (lastExtractBlock) pendingReads.push(lastExtractBlock);
                    history += `\nSTOP GATHERING: You ALREADY extracted the page text (it is shown again in the PAGE TEXT (extracted) block). Do NOT call extract_text again for the same part. Answer the user's question NOW with report({"summary":"..."}) using that text.`;
                    onProgress({ kind: 'status', message: `🛑 I already have the text — asking for the answer (${consecutiveExtracts}×).` });
                    continue;
                  }
                  if (commandRequiresGmailPromotions && isPotentialDeleteAction(action, observation)) {
                    const inPromotions = isGmailPromotionsView(observation);
                    if (!inPromotions) {
                      history += '\nSAFETY BLOCK: Delete/remove action blocked because Gmail Promotions was not verified. Navigate to https://mail.google.com/mail/u/0/#category/promotions first.';
                      onProgress({ kind: 'status', message: 'Safety: blocked deletion outside the Gmail Promotions tab.' });
                      noEffectCount++;
                      continue;
                    }
                  }
                  if (commandLooksLikeYouTubeComment && (youtubeCommentFilled || youtubeCommentSubmitted) && action.type === 'navigate') {
                    history += '\nSAFETY BLOCK: Navigation blocked after typing a YouTube comment. Find and click the Comentar/Comment submit button instead.';
                    onProgress({ kind: 'status', message: 'Safety: blocked navigation after filling the comment. Looking for the Comment button.' });
                    noEffectCount++;
                    continue;
                  }
                  if (commandLooksLikeYouTubeComment && action.type === 'scroll') {
                    youtubeCommentScrolls++;
                    if (youtubeCommentScrolls >= 3 && isYouTubeWatchUrl(observation.url)) {
                      const assist = await tryRevealYouTubeCommentBox(wv);
                      if (assist.success) {
                        history += '\nYOUTUBE COMMENT ASSIST: Replaced another blind scroll with direct reveal/click of the comments box.';
                        onProgress({ kind: 'status', message: 'YouTube: avoided repeated scrolling and went straight to comments.' });
                        noEffectCount = 0;
                        continue;
                      }
                    }
                  }
                  throwIfCancelled();
                  // done SEM "success" (o modelo local nunca manda; mock/rotas sem o parser): decide pelo que
                  // a mensagem diz — sucesso, a não ser que admita falha. Antes caía em "failed" mesmo com a
                  // tarefa feita. "success": false explícito continua sendo falha.
                  if (action.type === 'done' && action.success !== true && action.success !== false) {
                    (action as any).success = !!String(action.reason || '').trim()
                      && !/\b(unable|could ?n[o']t|cannot|can't|failed|not (?:able|found|possible|available)|no viable|blocked|n[aã]o consegui|no pude)\b/i.test(String(action.reason || ''));
                  }
                  // Tarefa de download que JÁ entregou o arquivo: o done é sucesso, mesmo que o
                  // modelo não mande "success" (o local nunca manda → aparecia "done(failed: …)" num
                  // download completo). Antes do onProgress, que é quem desenha o rótulo.
                  if (action.type === 'done' && !action.success && commandWantsDownload) {
                    const mine = [...dlLatestRef.current.values()].filter(ofThisTask) as Array<{ state: string; filename: string }>;
                    const completed = mine.some(d => d.state === 'completed' && !isWrongBuild(d.filename));
                    const running = mine.some(d => d.state === 'started' || d.state === 'progress' || d.state === 'queued');
                    // ...e a mensagem final NÃO admite falha (meta pode ter mudado no meio — um ISO
                    // concluído antes não faz o pedido NOVO de drivers dar "success").
                    const admitsFailure = /\b(unable|could ?n[o']t|cannot|can't|failed|inaccessible|not (?:able|found|possible)|no viable|não consegui|no pude)\b/i.test(action.reason || '');
                    if (completed && !running && !admitsFailure) action.success = true;
                  }
                  // Encerrar dizendo que AINDA vai fazer algo ("Will now search other sites…") não é
                  // terminar: devolve pro agente seguir (até 2x por tarefa). Vale pra done e report.
                  if ((action.type === 'done' || action.type === 'report') && unfinishedBlocks < 2) {
                    const fin = String((action as any).reason || (action as any).summary || '');
                    if (/\b(will now|i will (now )?(search|check|look|continue|visit|go)|next,? i('| wi)ll|then (i('| wi)ll )?(search|check|visit)|vou (agora )?(buscar|procurar|verificar|continuar)|a seguir vou)\b/i.test(fin)) {
                      unfinishedBlocks++;
                      history += `\nNOT FINISHED: your final message says you will still do more ("${fin.slice(0, 120)}…"). Do that now instead of finishing — continue with the next site/step, then finish when everything is covered.`;
                      onProgress({ kind: 'status', message: '↪️ The agent said it would continue — continuing instead of finishing.' });
                      continue;
                    }
                  }
                  // Pedido em VÁRIOS sites sem plano depois de 2 passos: pede o checklist (modelo pequeno
                  // esquece os sites que faltam e encerra no primeiro).
                  if (commandMultiSite && !planNudged && step >= 2 && plan.length === 0 && action.type !== 'plan') {
                    planNudged = true;
                    history += `\nPLAN FIRST: this task covers several sites. Emit a plan action now listing each site/step, then work through it; finish only when every site is covered (or shown to have nothing).`;
                  }
                  // Carrinho: o Qwen3-VL-8B manda {"action":"fill_ref","text":"bananas"} sem ref ao passar pro próximo
                  // item (visto em todo ensaio). Com o campo de busca à vista e a lista do pedido, o alvo é óbvio:
                  // busca o próximo item da lista no campo de busca (o valor vem do pedido da pessoa, não do modelo).
                  if (commandIsCart && action.type === 'done' && /Invalid action from model: fill_ref needs a finite non-negative integer "ref"/.test(String(action.reason || ''))) {
                    const sRef = searchBoxRef(observation.interactive_elements);
                    const nextIt = nextListItem(groceryList, groceryInCart, groceryOutOfStock, groceryAvailable);
                    if (sRef != null && nextIt) {
                      action = { type: 'fill_ref', ref: sRef, value: nextIt.text } as BrowserAction;
                      history += `\nBAH FIXED THE ACTION: fill_ref had no ref — Bah searched the next list item "${nextIt.text}" in the search box [${sRef}].`;
                    }
                  }
                  onProgress({ kind: 'action', action });
                  if (action.type === 'done') {
                    // Robustness: a malformed model response is parsed into a sentinel 'done'.
                    // Don't kill the whole task on one bad output — re-prompt a few times.
                    if (/Invalid or missing action|Invalid action from model|did not return valid structured JSON/i.test(action.reason) && invalidActionRetries < 3) {
                      invalidActionRetries++;
                      // The specific cause ("click_ref needs an integer ref") teaches far
                      // more than "was not valid" - models usually get it right next try.
                      history += `\nFORMAT ERROR: ${action.reason.slice(0, 300)} Reply with ONE JSON object exactly: keys "evaluation", "thought", "action" (a tool name string) plus that tool's flat params. Try again now.`;
                      onProgress({ kind: 'status', message: `Malformed model response — retrying (${invalidActionRetries}/3)` });
                      noEffectCount = Math.max(noEffectCount, 1);
                      continue;
                    }
                    // Retries esgotados num erro de JSON: troca a mensagem críptica por
                    // orientação. No grátis (sem chave), empurra pra DeepSeek pro agente.
                    if (/Invalid or missing action|Invalid action from model|did not return valid structured JSON/i.test(action.reason)) {
                      action.reason = (!store.aiSettings.apiKey && !store.localSettings.enabled)
                        ? 'The free model struggled with this multi-step task. For the full agent, add a DeepSeek key in settings (cheap) — the free tier is best for chat and image generation.'
                        : 'The model kept returning an invalid response for this task. Try rephrasing it, or run it again.';
                    }
                    // Vale também com success=false: o modelo local manda done "failed" com o texto
                    // "download successfully completed". O que conta é o que ele AFIRMA pro usuário.
                    const claimsDone = action.success === true || (
                      /\b(success\w*|complete\w*|finished|downloaded|baixad\w*|conclu\w*)\b/i.test(action.reason || '')
                      && !/\b(unable|could ?n[o']t|cannot|can't|failed to|não consegui|no pude)\b/i.test(action.reason || ''));
                    if (commandWantsDownload && claimsDone && noDownloadYetBlocks < 2) {
                      const anyDownload = [...dlLatestRef.current.values()]
                        .some(d => ofThisTask(d) && d.state !== 'failed');   // cancelado = tratado (agente ou pessoa decidiu)
                      if (!anyDownload) {
                        noDownloadYetBlocks++;
                        history += `\nNOT DONE YET: no download has started in this task (no DOWNLOAD STARTED line). A "thank you for downloading" page is NOT the file — it usually starts the download a few seconds after loading. Use { "action": "wait", "ms": 5000 } and look for DOWNLOAD STARTED; if none appears, use the download action with a direct file URL. Do not claim the file was downloaded.`;
                        onProgress({ kind: 'status', message: '⏳ No download has started yet — waiting for it before finishing.' });
                        continue;
                      }
                    }
                    // Carrinho: encerrar sem ter aberto o carrinho (o modelo relatava o que "achava" que tinha posto).
                    // Uma vez, manda abrir e conferir. Nada adicionado = é uma pergunta à pessoa: deixa sair.
                    const cartProblem = commandIsCart && cartCheckBlocks < 3
                      ? cartFinishProblem({ list: groceryList, inCart: groceryInCart, outOfStock: groceryOutOfStock, available: groceryAvailable, cartPageSeen, report: String(action.reason || '') }) : null;
                    if (cartProblem) {
                      cartCheckBlocks++;
                      history += `\n${cartProblem}`;
                      onProgress({ kind: 'status', message: '🛒 Checking the cart before finishing.' });
                      continue;
                    }
                    // Pedido de BUSCA (pessoas, produtos, hotéis, resultados) encerrado com uma frase vaga
                    // ("os resultados estão visíveis") — uma vez, pede a lista do que está na página.
                    // Só leitura: não exige carregar outra página (vale também em site cuidadoso).
                    if (vagueFinishBlocks < 1 && (commandIsPeople || commandWantsSearch || commandIsShopping || commandIsTravel || commandIsCart) && !commandWantsDownload) {
                      const r = String(action.reason || '');
                      const hasList = /\n\s*(?:[-*•]|\d+[.)])\s|\|/.test(r) || (r.match(/\d/g) || []).length >= 3 || r.length > 260;
                      if (!hasList) {
                        vagueFinishBlocks++;
                        history += `\nSUMMARIZE FIRST: the user wants the actual results, not "they are visible". List what this page shows (people: name, title, company, location; jobs: title, company, location, pay; products/hotels: name, price, rating), mark the best matches and why. Use extract_text on THIS page if you have not — do not load another page. Then finish with done (or render_view for a table).`;
                        onProgress({ kind: 'status', message: '📝 Asking for the actual results before finishing.' });
                        continue;
                      }
                    }
                    // Rede de segurança: a tarefa acaba com um download DELA ainda baixando → a
                    // resposta final diz isso (o modelo costuma ler "STARTED" como "baixou").
                    {
                      const running = [...agentDlIdsRef.current]
                        .map(k => dlLatestRef.current.get(k))
                        .filter((d): d is NonNullable<typeof d> => !!d && (d.state === 'started' || d.state === 'progress' || d.state === 'queued'));
                      if (running.length) {
                        const lines = running.map(d => `⏳ ${d.filename}: still downloading — ${fmtSize(d.bytes)}${d.totalBytes ? ' of ' + fmtSize(d.totalBytes) : ''}${d.etaSec != null ? ', ETA ' + fmtEta(d.etaSec) : ''}${d.path ? ' → ' + d.path : ''}`);
                        action.reason = `${action.reason || ''}\n\nNote: the download is NOT finished yet — it continues in the background (Downloads panel, Cmd/Ctrl+J):\n${lines.join('\n')}`;
                      }
                    }
                    if (commandLooksLikeSendEmail && action.success && !gmailDraftFilled) {
                      history += '\nSAFETY BLOCK: Gmail email task cannot be marked done because the local helper did not verify a filled/sent draft.';
                      onProgress({ kind: 'status', message: 'Gmail: blocked false completion; draft/send was not verified.' });
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
                    finishRun(action.success ? 'success' : 'failed', action.reason);
                    return { thought: thoughts.join('\n\n') || action.reason, results: allResults, done: action };
                  }
                  // ── 2ª CAMADA DE SEGURANÇA (LEVE): ação SOCIAL só com pedido explícito ──
                  // Curtir/descurtir/compartilhar/inscrever/publicar/comentar mexem na CONTA
                  // REAL da pessoa, mas não são destrutivas como pagar/excluir — um diálogo a
                  // cada uma seria irritante. Regra: se o usuário NÃO pediu, simplesmente não
                  // clica; avisa o modelo e segue a tarefa de verdade. Aqui (antes de TODO o
                  // despacho) cobre click_ref, click_text e click_at de uma vez só.
                  // Motivo real: mandado "abra um vídeo sobre gatos", o modelo local clicou em
                  // CURTIR no vídeo, na conta logada do usuário.
                  {
                    const socEl = (action as any).ref != null
                      ? observation.interactive_elements.find(e => e.id === (action as any).ref)
                      : undefined;
                    const blocked = socialActionToBlock(action as any, socEl, command);
                    if (blocked) {
                      const msg = `Skipped "${blocked}" — you didn't ask for it, so I won't touch your account.`;
                      onProgress({ kind: 'status', message: `🛡️ ${msg}` });
                      history += `\nBLOCKED: refused to click a "${blocked}" control — the user did NOT ask for it. NEVER click like/dislike/share/subscribe/publish/comment unless explicitly requested. Continue the ACTUAL task.`;
                      allResults.push({ action, result: { success: false, error: msg } });
                      noEffectCount = Math.max(noEffectCount, 1);
                      continue;
                    }
                  }
                  // Download: click_text com o rótulo de um LIKELY DOWNLOAD BUTTON vira click_ref nele. O
                  // click_text pega a 1ª ocorrência — na Steam o "Install Steam" do menu, que só leva à página
                  // (o modelo local repetia em loop; visto no ensaio real).
                  if (action.type === 'click_text' && stepDlButtons.length) {
                    const want = String((action as any).text || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const hit = stepDlButtons.find(e => String(e.text || e.aria || '').replace(/\s+/g, ' ').trim().toLowerCase() === want);
                    if (hit) { action = { type: 'click_ref', ref: hit.id } as BrowserAction; history += `\nBAH: "${want}" is the download button [${hit.id}] — clicked that one (not a same-named menu link).`; }
                  }
                  // Login/cadastro/SSO SÓ quando a pessoa pediu algo de conta. O modelo tentava "contornar" popup
                  // de login clicando "Sign in with Google" — buscar em site de reserva/loja não exige conta.
                  if (action.type === 'click_ref' || action.type === 'click_text' || action.type === 'dblclick') {
                    const tgtText = action.type === 'click_text' ? String((action as any).text || '')
                      : String((observation.interactive_elements.find(e => e.id === (action as any).ref) as any)?.text || (observation.interactive_elements.find(e => e.id === (action as any).ref) as any)?.aria || '');
                    if (tgtText.trim()) lastTarget = `"${tgtText.replace(/\s+/g, ' ').trim().slice(0, 120)}" on ${paceHostOf(observation.url) || observation.url}`;
                    if (/^\W*(sign ?in|log ?in|sign ?up|register|create (an )?account|join( now)?|continue with (google|apple|facebook|microsoft|email)|sign in with|log in with|entrar|fazer login|cadastr|iniciar sesi[oó]n|reg[ií]strate)\b/i.test(tgtText.trim())
                        && !/\b(sign ?in|log ?in|login|account|conta|cuenta|my profile|logged|signed in|register|sign ?up|cadastr|entrar na)\b/i.test(command) && !commandLikelyNeedsAccount(command)) {
                      history += `\nNOT SIGNING IN: "${tgtText.slice(0, 50)}" starts a sign-in/sign-up, and the user did not ask for anything that needs an account. Close the popup (its close button or press "Escape") and continue without an account — searching does not need one. If the site truly blocks without an account, try another site.`;
                      onProgress({ kind: 'status', message: `🔒 Not signing in ("${tgtText.slice(0, 40)}") — the task doesn't need an account.` });
                      continue;
                    }
                  }
                  // Site cuidadoso (termos proíbem automação, ex.: LinkedIn): UMA navegação por pedido +
                  // leitura. Clique/digitação/scroll/paginação ficam com a pessoa — recusa com explicação.
                  {
                    const targetHost = action.type === 'navigate' ? paceHostOf(/^https?:\/\//i.test(String((action as any).url || '')) ? String((action as any).url) : `https://${String((action as any).url || '')}`) : paceHostOf(observation.url);
                    if (isCarefulHost(targetHost)) {
                      const refuse = (why: string) => {
                        history += `\nCAREFUL SITE (${targetHost}): ${why} The user continues by hand — summarize what is visible (extract_text) and finish with done/report telling them the next step.`;
                        onProgress({ kind: 'status', message: `🛡️ ${targetHost} forbids automated browsing — ${why}` });
                      };
                      // O modelo pequeno insistia no mesmo clique recusado (6× "Jobs") e a tarefa morria como
                      // "repetição", sem dizer o porquê. Segunda recusa → para e diz à pessoa o que fazer à mão.
                      const stopCareful = () => {
                        const signInWall = /\b(log ?in|sign ?in|sign ?up|join)\b/i.test(observation.title || '') || /\/(login|signup|uas\/login|checkpoint)\b/i.test(observation.url || '');
                        const msg = `🛡️ ${targetHost} is in careful mode: its terms forbid automated browsing, so Bah only opens and reads pages there — no clicking or typing.`
                          + (signInWall ? ' Sign in yourself in this tab (once — the session stays), then ask again.' : '')
                          + ' Continue by hand from here.';
                        const done: BrowserAction = { type: 'done', success: false, reason: msg };
                        finishRun('failed', msg);
                        return { thought: thoughts.join('\n\n') || msg, results: allResults, done };
                      };
                      if (action.type === 'navigate') {
                        if (carefulNavs >= 1) { if (++carefulRefusals >= 2) return stopCareful(); refuse('only one page load per request is allowed here.'); continue; }
                        carefulNavs++;
                      } else if (!CAREFUL_ALLOWED.has(action.type)) {
                        if (++carefulRefusals >= 2) return stopCareful();
                        refuse(`"${action.type}" is not done automatically on this site.`);
                        continue;
                      }
                    }
                  }
                  // HARD RULE: numa página de checagem humana o agente nunca opera nada (clicar, segurar, digitar,
                  // teclar, rolar…). Só leitura passiva ou sair da página. Só a pessoa resolve a checagem.
                  {
                    const refusal = guardAgentAction(action.type, humanCheckFlag(wv), paceHostOf(observation.url) || 'this site');
                    if (refusal) {
                      history += `\nREFUSED: ${refusal}`;
                      onProgress({ kind: 'status', message: `🛡️ ${refusal}` });
                      allResults.push({ action, result: { success: false, reason: 'human_check', error: refusal } });
                      noEffectCount = Math.max(noEffectCount, 1);
                      actionQueue = [];
                      continue;
                    }
                  }
                  // Ritmo por site: ações que tocam a página esperam uma pausa ALEATÓRIA de 1–5s no mesmo
                  // host (15–30s depois que o site mostrou checagem anti-robô). Ações internas não esperam.
                  // Fica ANTES do cursor/ondinha, pra eles aparecerem na hora do clique de verdade.
                  const touchesPage = ['navigate', 'click_ref', 'click_text', 'click_at', 'fill', 'fill_ref', 'type', 'press', 'select_option', 'check', 'uncheck', 'back', 'forward', 'reload', 'hover', 'dblclick', 'focus', 'drag', 'scroll', 'upload', 'insert_text', 'keydown', 'keyup'].includes(action.type);
                  const paceHost = action.type === 'navigate' ? paceHostOf(/^https?:\/\//i.test(String((action as any).url || '')) ? String((action as any).url) : `https://${String((action as any).url || '')}`) : paceHostOf(observation.url);
                  if (touchesPage && paceHost) {
                    const waitMs = paceDelay(paceHost);
                    if (waitMs > 0) {
                      if (waitMs > 3000) onProgress({ kind: 'status', message: `🐢 Pacing ${paceHost}: waiting ${Math.ceil(waitMs / 1000)}s` });
                      const until = Date.now() + waitMs;
                      while (Date.now() < until) { await new Promise(r => setTimeout(r, Math.min(500, until - Date.now()))); throwIfCancelled(); }
                    }
                    recordHit(paceHost);
                  }
                  setAgentVisual('acting');
                  const wvEl = (wv as any) as HTMLElement;
                  const wvRect = wvEl?.getBoundingClientRect?.();
                  // O overlay do agente fica POR CIMA da área da página (position:absolute; inset:0 no mesmo
                  // contêiner): a origem é o canto do overlay, não o da janela. Somar o deslocamento da janela
                  // (barra de abas + endereço ≈ 100 px) desenhava o cursor/ondinha ~100 px abaixo do clique real.
                  const ovRect = (document.querySelector('.agent-overlay') as HTMLElement | null)?.getBoundingClientRect?.();
                  const offX = (wvRect?.left ?? 0) - (ovRect?.left ?? 0);
                  const offY = (wvRect?.top ?? 0) - (ovRect?.top ?? 0);
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
                      const risk = classifyRisk(action.type, target.text, target.placeholder, target.aria, riskOpts);
                      let cancelled = false;
                      if (risk) {
                        const ok = await confirmRisky(risk);
                        throwIfCancelled();
                        if (!ok) {
                          cancelled = true;
                          toolResult = { success: false, reason: 'user_cancelled', error: `You canceled — I did not do "${risk.label}".` };
                          onProgress({ kind: 'status', message: `✖️ Canceled by you: I did not touch "${risk.label}".` });
                        }
                      }
                      // Carrinho: ADD de um produto que nenhum item que falta na lista pede (substituto de um esgotado,
                      // ou o botão do vizinho) — barra uma vez por produto e explica; repetir de propósito passa.
                      if (!cancelled && commandIsCart && action.type === 'click_ref') {
                        const off = offListAdd(groceryTiles, observation.interactive_elements, action.ref, groceryList, groceryInCart);
                        if (off && !offListWarned.has(off)) {
                          offListWarned.add(off);
                          cancelled = true;
                          toolResult = { success: false, reason: 'not_on_list', error: `Not clicked: that ADD puts "${off.slice(0, 80)}" in the cart, and no item still missing from the SHOPPING LIST asks for it. Out of stock items are never replaced without asking the user. Go to the NEXT list item (search box). If the user really wants this product, click it again.` };
                          onProgress({ kind: 'status', message: `🛒 Not adding "${off.slice(0, 60)}" — it isn't on the list.` });
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
                        // Bounded: the offscreen fallback runs click_text via executeJavaScript,
                        // which would never resolve on a hung page. Same 12s cap as the general path.
                        r = isOffscreen && target.text
                          ? await withTimeout(
                              executeBrowserAction(wv, { type: 'click_text', text: target.text }),
                              12000,
                              { success: false, error: `click_text timed out — page scripts are unresponsive. Re-observe or navigate elsewhere.` })
                          : target.frameNode?.key.startsWith('oopif:')
                            // Iframe de OUTRO processo: sendInputEvent para no <iframe>; clica pela sessão CDP do frame.
                            ? await window.electronAPI?.frameClick?.(wcId, target.frameNode.key, target.frameNode.id)
                            : await window.electronAPI?.realClick?.(wcId, clickX, clickY, target.backendNodeId);
                      }
                      if (action.type === 'fill_ref' && target.frameNode) {
                        // Campo dentro de iframe: preenche no nó do documento do iframe (o foco do iframe se perde
                        // quando a UI do Bah atualiza; tecla real ia pro <iframe>, não pro campo).
                        const f = await window.electronAPI?.frameFill?.(wcId, target.frameNode.key, target.frameNode.id, action.value);
                        if (!f?.ok) r = { success: false, error: f?.error || 'could not fill the field inside the frame' };
                        else if (f.value !== action.value) r = { success: false, error: `The field inside the frame shows "${String(f.value).slice(0, 60)}" instead — it may reformat or reject input.` };
                        else r = { success: true, info: { ref: action.ref, filledVia: `frame ${target.frame}` } };
                      } else if (action.type === 'fill_ref') {
                        await new Promise(rr => setTimeout(rr, 200));
                        // Select existing content via JS (works for inputs and contenteditable)
                        await withTimeout(
                          wv.executeJavaScript(`(function(){const el=document.activeElement;if(!el)return;try{if(el.select)el.select();else if(el.setSelectionRange)el.setSelectionRange(0,(el.value||'').length);else{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);}}catch(e){}})()`),
                          3000, null);
                        await new Promise(rr => setTimeout(rr, 80));
                        await realTypeCancellable(wcId, action.value);
                        throwIfCancelled();
                        if (commandLooksLikeYouTubeComment && action.value.trim()) youtubeCommentFilled = true;
                      }
                      toolResult = r ?? { success: true };
                      }
                      } // fim do if(!cancelled) — freio de segurança
                    }
                  } else if (action.type === 'click_at' && wcId != null) {
                    // The model answers in SCREENSHOT pixels (stated in the prompt); map them onto
                    // the live viewport (measured now — the window may have been resized) and clamp
                    // inside it. Without a frame this step the numbers are taken as viewport px.
                    const vp = await withTimeout(
                      wv.executeJavaScript('({w: window.innerWidth, h: window.innerHeight})') as Promise<{ w: number; h: number }>,
                      1500, null as any,
                    ).catch(() => null);
                    const viewport = { width: vp?.w || wv.clientWidth || 0, height: vp?.h || wv.clientHeight || 0 };
                    const { x: cx, y: cy } = mapShotPointToViewport(Number(action.x) || 0, Number(action.y) || 0, modelShot, viewport);
                    if (cx !== Math.round(action.x) || cy !== Math.round(action.y)) {
                      onProgress({ kind: 'status', message: `click mapped to viewport: ${Math.round(action.x)},${Math.round(action.y)} -> ${cx},${cy}` });
                    }
                    // FREIO: resolve o rótulo do elemento SOB a coordenada e confirma se for de risco.
                    // Same point that will be clicked — checking anywhere else defeats the gate.
                    const lblAt = await withTimeout(wv.executeJavaScript(`(function(x,y){try{const e=document.elementFromPoint(x,y);if(!e)return '';const t=e.closest('a,button,[role=button],[role=link]')||e;return (t.innerText||t.textContent||t.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,80);}catch(_){return '';}})(${cx},${cy})`), 3000, '');
                    const cancelAt = await gateRisk(riskForAction(action as any, { text: String(lblAt || '') }, undefined, riskOpts));
                    toolResult = cancelAt ?? await window.electronAPI?.realClick?.(wcId, cx, cy);
                  } else if (action.type === 'click_text' && wcId != null) {
                    // FREIO DE SEGURANÇA: confirma antes de clicar em pagamento/exclusão.
                    const riskT = classifyRisk('click_text', action.text, undefined, undefined, riskOpts);
                    let cancelledT = false;
                    if (riskT) {
                      const ok = await confirmRisky(riskT);
                      throwIfCancelled();
                      if (!ok) {
                        cancelledT = true;
                        toolResult = { success: false, reason: 'user_cancelled', error: `You canceled — I did not click "${action.text}".` };
                        onProgress({ kind: 'status', message: `✖️ Canceled by you.` });
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
                    toolResult = await realTypeCancellable(wcId, action.text);
                    throwIfCancelled();
                    if (commandLooksLikeYouTubeComment && action.text.trim()) youtubeCommentFilled = true;
                  } else if (action.type === 'press' && wcId != null) {
                    // FREIO: Enter (press) numa página de checkout pode submeter pagamento.
                    // Esta é a 1ª branch que pega press — sem o gate aqui, o freio do `else`
                    // lá embaixo nunca rodava pra press.
                    const c = await gateRisk(riskForAction(action as any, undefined, wv?.getURL?.() || '', riskOpts));
                    toolResult = c ?? await window.electronAPI?.realKey?.(wcId, action.key);
                  } else if (action.type === 'plan') {
                    plan = action.steps || [];
                    // Show the plan before acting on it. The user can approve, rewrite the
                    // goal in their own words, or stop - all cheaper than 15 steps going the
                    // wrong way. Once per run: asking every step is nagging.
                    const previewOn = (() => { try { return localStorage.getItem('planPreview') !== '0'; } catch { return true; } })();
                    if (previewOn && !planShown && plan.length > 0) {
                      planShown = true;
                      const PLAN_AUTORUN_MS = 30000;
                      const decision = await new Promise<'run' | 'cancel' | string>((resolve) => {
                        let settled = false;
                        let autoRun: ReturnType<typeof setTimeout> | null = null;
                        const hold = () => { if (autoRun) { clearTimeout(autoRun); autoRun = null; } };
                        const fin = (v: 'run' | 'cancel' | string) => { if (!settled) { settled = true; hold(); resolve(v); } };
                        // Ninguém mexeu em 30s → executa sozinho. Sem isto a tarefa ficava parada pra
                        // sempre no cartão quando a pessoa mandava e ia fazer outra coisa — o uso normal
                        // de um agente. "Mudar o texto" segura a contagem (onHold).
                        autoRun = setTimeout(() => fin('run'), PLAN_AUTORUN_MS);
                        signal?.addEventListener('abort', () => fin('cancel'), { once: true });
                        onProgress({
                          kind: 'plan_preview',
                          goal: command,
                          steps: plan.slice(0, 8).map((st) => String(st)),
                          autoRunMs: PLAN_AUTORUN_MS,
                          onApprove: () => fin('run'),
                          onEdit: (g) => fin(g),
                          onCancel: () => fin('cancel'),
                          onHold: hold,
                        });
                      });
                      if (decision === 'cancel') {
                        finishRun('cancelled', 'Cancelled before acting.');
                        return { thought: 'Task cancelled before acting.', results: allResults, done: { type: 'done', success: false, reason: 'Cancelled before acting.' } };
                      }
                      if (typeof decision === 'string') {
                        // Rewritten goal: the model re-plans from the user's own wording.
                        command = decision;
                        understood = '';   // a expansão era do pedido antigo
                        history += '\nGOAL EDITED BY USER: ' + decision.slice(0, 400);
                      }
                    }
                    toolResult = { success: true, info: { steps: plan.length } };
                  } else if (action.type === 'store') {
                    memory.push({ key: action.key, value: action.value, source: action.source, ts: Date.now() });
                    // COLEÇÃO: o modelo achou e guardou a lista de faixas → o Bah baixa uma a uma (download-steps.ts).
                    // O modelo pequeno não sustenta esse laço sozinho (rodava em círculo e caía em captcha).
                    const collectionItems = isMediaCollectionRequest(command) ? listItems(action.value) : [];
                    if (collectionItems.length >= 2) {
                      const audioOnly = collectionWantsAudioOnly(command);
                      // Ano da obra: o que o modelo grande conferiu e guardou ("work": "Top Gun (1986)") > o pedido > a
                      // expansão do roteador local (palpite de um modelo pequeno). "Top Gun" de 1986, não o Maverick.
                      const work = String(memory.find(m => m.key === 'work')?.value ?? '');
                      const subject = collectionSubject(command) || collectionSubject(understood);
                      const year = subjectYear(subject, work, command, understood);
                      const noun = audioOnly ? 'songs' : 'music videos';
                      const choice = await new Promise<string>((resolve) => {
                        onProgress({ kind: 'confirm', risk: 'choice', label: noun,
                          title: `🎬 ${collectionItems.length} ${noun} found`,
                          message: `${collectionItems.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nDownload them all? Bah downloads one at a time; follow them on the download button.`,
                          choices: [
                            { label: audioOnly ? '🎵 Download all' : '🎬 Best quality (large files)', value: 'best' },
                            ...(audioOnly ? [] : [{ label: '📼 Smaller files (≤480p)', value: 'low' }]),
                            { label: 'Cancel', value: 'cancel' },
                          ],
                          onChoose: (v: string) => resolve(v), onConfirm: () => resolve('best'), onCancel: () => resolve('cancel') } as any);
                      });
                      throwIfCancelled();
                      if (choice === 'cancel') {
                        const msg = `Found ${collectionItems.length} ${noun} (${collectionItems.join(', ')}) — not downloaded, as you asked.`;
                        finishRun('success', msg);
                        return { thought: msg, results: allResults, done: { type: 'done', success: true, reason: msg } as BrowserAction };
                      }
                      const rows: string[] = [];
                      deadline.suspend();   // esperar downloads não é o modelo demorando
                      try {
                        for (let i = 0; i < collectionItems.length; i++) {
                          throwIfCancelled();
                          const item = collectionItems[i];
                          onProgress({ kind: 'status', message: `⬇️ ${i + 1}/${collectionItems.length} ${item}…` });
                          const r = await window.electronAPI?.downloadVideo?.(`ytsearch1:${collectionQuery(item, subject, audioOnly, year)}`, audioOnly, 1, choice === 'low' ? 'low' : 'best');
                          const file = r?.success ? ((r.paths && r.paths[0]) || r.path || '').split(/[\\/]/).pop() : '';
                          rows.push(`${r?.success ? '✅' : '❌'} ${i + 1}. ${item}${r?.success ? (file ? ` — ${file}` : '') : ` — ${String(r?.error || 'failed').slice(0, 80)}`}`);
                        }
                      } finally { deadline.resume(); }
                      const ok = rows.filter(r => r.startsWith('✅')).length;
                      const report = `Downloaded ${ok} of ${collectionItems.length} ${noun}${subject ? ` from ${subject}${year ? ` (${year})` : ''}` : ''}:\n\n${rows.join('\n')}`;
                      onProgress({ kind: 'status', message: `✅ ${ok}/${collectionItems.length} ${noun} downloaded` });
                      finishRun(ok ? 'success' : 'failed', report);
                      return { thought: report, results: allResults, done: { type: 'done', success: ok > 0, reason: report } as BrowserAction };
                    }
                    // LOCAL: modelo fraco GUARDA a resposta com `store` e depois divaga sem
                    // reportar. Se o pedido é "me diga/qual/explique" e o valor guardado é uma
                    // frase substancial, ENTREGA na hora. Só no local (a nuvem reporta sozinha).
                    if (store.localSettings.enabled) {
                      const val = typeof action.value === 'string' ? action.value : '';
                      const wantsAnswer = /\b(me\s+diga|diga|me\s+fal\w+|qual|quais|o\s+que|quanto|quem|quando|onde|explique|explica|resuma|em\s+uma\s+frase|responda|defina)\b/i.test(command);
                      if (wantsAnswer && val.trim().length > 60) {
                        const answer = val.trim().slice(0, 600);
                        onProgress({ kind: 'status', message: `✅ ${answer.slice(0, 120)}` });
                        finishRun('success', answer);
                        return { thought: thoughts.join('\n\n') || answer, results: allResults, done: { type: 'done', success: true, reason: answer } as BrowserAction };
                      }
                    }
                    toolResult = { success: true, info: { stored: action.key, total_keys: memory.length } };
                  } else if (action.type === 'download') {
                    // Agent-driven download (image/pdf/...) → user's Downloads folder via main process
                    // Roda em background (worker thread no main): volta assim que COMEÇA, com o caminho
                    // final. Progresso/fim chegam pelos eventos de download (DOWNLOAD PROGRESS/COMPLETED).
                    const dl = await window.electronAPI?.downloadUrl?.(action.url, action.filename);
                    toolResult = dl ?? { success: false, error: 'download API unavailable' };
                    // O 'started' desse download já entrou nos eventos; a linha abaixo o substitui.
                    const startedId = dl?.success ? dl.info?.id : undefined;
                    if (startedId) downloadEventsRef.current = downloadEventsRef.current.filter(d => !(d.id === startedId && d.state === 'started'));
                    if (dl?.success && dl.info) {
                      const size = dl.info.totalBytes ? fmtSize(dl.info.totalBytes) : 'unknown size';
                      history += `\nDOWNLOAD STARTED in the background: ${dl.info.path} (${size}). Updates will appear as DOWNLOAD PROGRESS / STALLED / COMPLETED / FAILED lines.`;
                      onProgress({ kind: 'status', message: `💾 Downloading: ${dl.info.path.split(/[\\/]/).pop()} (${size})` });
                    }
                  } else if (action.type === 'ask_ai') {
                    // Responde uma pergunta usando a NOSSA IA (DeepSeek/Ollama) — instantâneo,
                    // confiável, SEM CAPTCHA. (Antes raspava o duck.ai, que agora bloqueia bots.)
                    const q = action.question;
                    if (!q || q.length < 3) {
                      toolResult = { success: false, error: 'ask_ai needs a question.' };
                    } else {
                      setAgentVisual('thinking');
                      onProgress({ kind: 'status', message: `🤖 Asking the AI: "${q.slice(0, 80)}"` });
                      let answered = false;
                      try {
                        const r = await window.electronAPI?.aiChat?.(q, undefined, undefined, store.localSettings.enabled);
                        if (r?.response && r.response.trim()) {
                          history += `\n\nAI ANSWER to "${q}":\n${r.response}\n(Use this to answer the user.)`;
                          onProgress({ kind: 'status', message: `🤖 Answered (${r.response.length} chars).` });
                          toolResult = { success: true, info: { provider: 'own-ai', chars: r.response.length, preview: r.response.slice(0, 120) } };
                          answered = true;
                        }
                      } catch { /* cai pro fallback */ }
                      if (!answered) {
                        // Fallback GRÁTIS: Gemini web (gemini.google.com/app) — funciona deslogado.
                        // Se pedir CAPTCHA/login, NÃO resolvemos (anti-robô) — desiste limpo.
                        onProgress({ kind: 'status', message: `🌐 Asking Gemini (free) on the web…` });
                        const g = await askWebGemini(wv, q);
                        if (g.success && g.answer) {
                          history += `\n\nGEMINI (web) ANSWER to "${q}":\n${g.answer}\n(Use this to answer the user.)`;
                          onProgress({ kind: 'status', message: `🤖 Gemini answered (${g.answer.length} chars).` });
                          toolResult = { success: true, info: { provider: 'gemini-web', chars: g.answer.length, preview: g.answer.slice(0, 120) } };
                        } else if (g.reason === 'captcha') {
                          toolResult = { success: false, error: 'Gemini web asked for verification/login (anti-bot) and I cannot solve that. Set up your own AI (DeepSeek/Ollama/Gemini API) in settings and I answer directly.' };
                          onProgress({ kind: 'status', message: '⚠️ Gemini web asked for verification — I cannot solve that (anti-bot). Use your own AI in settings.' });
                        } else {
                          toolResult = { success: false, error: `Could not answer: ${g.error || 'AI unavailable'}. Set up your own AI in settings.` };
                        }
                      }
                    }
                  } else if (action.type === 'find_file') {
                    // "Ache um PDF/planilha/etc de X" → Google filetype: operator → direct file URLs.
                    const ft = (action.filetype || 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf';
                    const gq = `${action.query} filetype:${ft}`;
                    onProgress({ kind: 'status', message: `📁 Looking for file (${ft.toUpperCase()}): "${action.query}"` });
                    try { await wv.loadURL(`https://www.google.com/search?${googleLocaleParams()}&pws=0&q=${encodeURIComponent(gq)}`); } catch {}
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
                      onProgress({ kind: 'status', message: `📁 ${links.length} ${ft.toUpperCase()} file(s) found.` });
                      toolResult = { success: true, info: { count: links.length, filetype: ft, top: links[0] } };
                    } else {
                      toolResult = { success: false, error: `No direct .${ft} file found for "${action.query}". Try another word or filetype.` };
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
                      toolResult = { success: false, error: 'Nothing to read on the page.' };
                    } else {
                      // Shared TTS helper (voice follows the UI language; long text kept alive).
                      const ok = speak(speakText, () => setPageSpeaking(false));
                      if (ok) {
                        setPageSpeaking(true);
                        onProgress({ kind: 'status', message: `🔊 Reading aloud (${speakText.length} chars)…` });
                        toolResult = { success: true, info: { chars: speakText.length } };
                      } else {
                        toolResult = { success: false, error: 'TTS unavailable on this system.' };
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
                      const noun = action.audio_only ? 'song' : 'video';
                      // Mensagem neutra: nunca ecoa a URL/origem (ex.: link do YouTube).
                      // Mostra só o que o usuário pediu (a query), nunca de ONDE veio.
                      onProgress({ kind: 'status', message: count > 1
                        ? `🎵 Downloading ${count} ${noun}s${isSearch ? ` "${action.query}"` : ''}…`
                        : (action.audio_only
                            ? `🎵 Downloading song${isSearch ? ` "${action.query}"` : ''}…`
                            : `🎬 Downloading video${isSearch ? ` "${action.query}"` : ''}…`) });
                      const qual = action.quality === 'low' ? 'low' : action.quality === 'best' ? 'best' : undefined;
                      if (action.query) {
                        lastQuickActionRef.current = { type: 'download_video', query: action.query, audio_only: action.audio_only, count, quality: qual };
                      }
                      const callAt = Date.now();
                      const vrP = window.electronAPI?.downloadVideo?.(target, action.audio_only, count, qual);
                      // UM vídeo e nada mais na fila: a tarefa acaba quando o download COMEÇA (primeiros bytes),
                      // não quando termina — senão o painel fica "trabalhando" só esperando. O anel do botão de
                      // downloads mostra o progresso e o fim. Se o yt-dlp falhar antes de começar, segue o
                      // caminho de sempre (fallbacks abaixo).
                      if (vrP && count === 1 && actionQueue.length === 0 && downloadIsLastStep) {
                        const startedDl = await new Promise<any>(resolve => {
                          let settled = false;
                          const finish = (v: any) => { if (!settled) { settled = true; clearInterval(iv); resolve(v); } };
                          vrP.then(() => finish(null), () => finish(null));
                          const iv = setInterval(() => {
                            const d = [...dlLatestRef.current.values()].find((x: any) => x.kind === 'video' && (x.startedAt ?? 0) >= callAt
                              && (x.state === 'progress' || x.state === 'started') && ((x.bytes || 0) > 0));
                            if (d) finish(d);
                          }, 500);
                        });
                        if (startedDl) {
                          const size = startedDl.totalBytes ? ` (~${fmtSize(startedDl.totalBytes)})` : '';
                          const what = startedDl.filename && startedDl.filename !== 'download' ? startedDl.filename : (action.query || (action.audio_only ? 'the song' : 'the video'));
                          const msg = `⬇️ Downloading ${what}${size} to Downloads — follow its progress on the download button.`;
                          onProgress({ kind: 'status', message: msg });
                          finishRun('success', msg);
                          return { thought: msg, results: [...allResults, { action, result: { success: true, info: { started: true } } }], done: { type: 'done', reason: msg, success: true } as BrowserAction };
                        }
                      }
                      const vr = await vrP;
                      if (vr?.success) {
                        // A finished media download IS the goal — auto-complete the task here.
                        // Don't let a weaker model second-guess success (it was reporting
                        // done(failed) on a saved file). Instant, deterministic, ends clean.
                        const files = (vr.paths && vr.paths.length ? vr.paths : (vr.path ? [vr.path] : []))
                          .map(p => p.split(/[\\/]/).pop());
                        const nFiles = files.length || 1;
                        const list = files.join(', ') || vr.title;
                        const doneMsg = (nFiles > 1
                          ? (action.audio_only
                              ? `${nFiles} songs downloaded and saved to Downloads: ${list}`
                              : `${nFiles} videos downloaded and saved to Downloads: ${list}`)
                          : `${action.audio_only ? 'Song downloaded and saved' : 'Video downloaded and saved'} to Downloads: ${list}`)
                          + (vr.warning === 'source-has-no-audio' ? ' (note: the original video has no sound track)' : '');
                        // miniaturas clicáveis no feed (clique → abre a pasta Downloads)
                        const fullPaths = (vr.paths && vr.paths.length ? vr.paths : (vr.path ? [vr.path] : []));
                        if (fullPaths.length) {
                          const dlDir = fullPaths[0].split(/[\\/]/).slice(0, -1).join('/');
                          onProgress({ kind: 'media', mediaKind: action.audio_only ? 'audio' : 'video', paths: fullPaths, dir: dlDir, total: fullPaths.length, label: `${fullPaths.length} ${action.audio_only ? (fullPaths.length > 1 ? 'songs' : 'song') : (fullPaths.length > 1 ? 'videos' : 'video')}` });
                        }
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { paths: vr.paths, title: vr.title } } });
                        // Auto-finish ONLY when nothing else is queued AND this download was the whole
                        // request. A batch of named songs (actions:[download_video A, B, C]) must run them all;
                        // "…and then X" goes on to X; a COLLECTION ("all the music videos from the movie…") goes on
                        // to the next track of the list it stored.
                        if (actionQueue.length === 0 && (downloadIsLastStep || !commandWantsDownload)) {
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        history += actionQueue.length
                          ? `\nDOWNLOADED: ${list}. Continue with the remaining queued downloads.`
                          : isMediaCollectionRequest(command)
                            ? `\nDOWNLOADED: ${list}. The request covers more than this one item: continue with the NEXT item of the list you stored (download_video with its "Artist – Title" query); finish only when every item is downloaded or reported as unavailable.`
                            : `\nDOWNLOADED: ${list}. The request continues after this download: do the rest of it now.`;
                        toolResult = { success: true, info: { paths: vr.paths } };
                      } else {
                        // ── FALLBACK CHAIN (self-healing, Gemini): yt-dlp falhou →
                        // varre a página por mídia DIRETA (<video>/<audio>/<source> ou
                        // links .mp4/.mp3) e tenta o download na marra antes de desistir.
                        let recovered = false;
                        if (!isSearch && window.electronAPI?.downloadUrl) {
                          try {
                            onProgress({ kind: 'status', message: '⚠️ yt-dlp failed — looking for direct media on the page…' });
                            const media: string[] = await withTimeout(wv.executeJavaScript(MEDIA_SCAN_JS), 5000, [] as any);
                            for (const mUrl of (media || []).slice(0, 4)) {
                              const dr = await window.electronAPI.downloadUrl(mUrl);
                              if (dr?.success) {
                                const name = dr.info?.path ? dr.info.path.split(/[\\/]/).pop() : mUrl.split('/').pop();
                                const doneMsg = `Media downloaded directly from the page (fallback): ${name}`;
                                onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                                allResults.push({ action, result: { success: true, info: dr.info } });
                                if (actionQueue.length === 0) {
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
                          toolResult = { success: false, error: (vr?.error || 'Video download failed.') + ' The direct-media fallback also did not find a downloadable file on the page.' };
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
                      const doneMsg = `▶️ Played the video on this page.`;
                      onProgress({ kind: 'status', message: doneMsg });
                      allResults.push({ action, result: { success: true, info: { url: curUrlOV } } });
                      if (actionQueue.length === 0) {
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { url: curUrlOV } };
                    } else {
                    onProgress({ kind: 'status', message: `🎬 Looking for a video of "${vq}" (skipping Shorts)…` });
                    const v = await window.electronAPI?.resolveVideo?.(vq);
                    if (v?.ok && v.url) {
                      const beforeUrl = wv.getURL();
                      await executeBrowserAction(wv, { type: 'navigate', url: `${v.url}&autoplay=1` } as BrowserAction);
                      await waitForWebviewSettled(wv, beforeUrl);
                      await forcePlayVideo(wv);   // abre TOCANDO (sem o usuário clicar)
                      const doneMsg = `Opened the video: ${v.title || v.url}`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { url: v.url, title: v.title } } });
                      if (actionQueue.length === 0) {
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
                      onProgress({ kind: 'status', message: `🔎 Did not find it directly; opened YouTube search to pick a video (no Shorts).` });
                      toolResult = { success: false, error: v?.error || 'could not resolve a video directly' };
                    }
                    } // fim do else (não era "esse vídeo" da página atual)
                  } else if (action.type === 'create_playlist') {
                    // Duas rotas de resolução:
                    // (a) songs[] nomeadas (pelo MODELO forte, ou pelo atalho com lista de vírgulas);
                    // (b) SÓ artista+count (atalho 0-token, SÓ no modo local — na nuvem o modelo cura).
                    // Depois: CRIA a playlist de verdade na conta (salva) e toca; se não conseguir
                    // salvar (ex.: não logado), o fallback só toca a fila temporária (watch_videos).
                    setAgentVisual('acting');
                    // Sem teto de 25 — o loop de salvar adiciona uma a uma e para no Stop; 100 é só
                    // salvaguarda contra lista alucinada. Na prática vai "até a IA acabar as músicas".
                    const songs = (action.songs || []).map(s => String(s).trim()).filter(Boolean).slice(0, 400);
                    const plArtist = String((action as any).artist || '').trim();
                    let ids: string[] = [];
                    let plFail = '';
                    if (songs.length >= 2) {
                      onProgress({ kind: 'status', message: `🎵 Building the playlist — finding ${songs.length} songs on YouTube (skipping Shorts)…` });
                      const resolved = (await window.electronAPI?.resolveVideos?.(songs)) || [];
                      const ok = resolved.filter(r => r.id);
                      // Dedup: duas buscas parecidas podem resolver pro MESMO vídeo — repetido
                      // na lista, o passo de salvar clicaria a linha já marcada e REMOVERIA.
                      ids = [...new Set(ok.map(r => r.id as string))];
                      if (ids.length < 2) plFail = `Only found ${ids.length} video(s) of the ${songs.length} songs — cannot build the playlist.`;
                    } else if (plArtist.length >= 2) {
                      const wantN = Math.min(Math.max(Number((action as any).count) || 10, 2), 50);
                      // CURADORIA sem depender do JSON de acao (que o gpt-oss erra): peco pro
                      // modelo so LISTAR os titulos — tarefa de texto simples, confiavel ate no
                      // modelo fraco (gpt-oss local, por exemplo). Depois a "mao" resolve cada
                      // um no YouTube. Se a lista vier
                      // vazia/ruim, FALLBACK = busca top-N do artista (sempre funciona).
                      onProgress({ kind: 'status', message: `🎵 Picking ${wantN} "${plArtist}" songs…` });
                      let vids: Array<{ id: string; title: string }> = [];
                      try {
                        const listPrompt = `List exactly ${wantN} well-known songs by ${plArtist}. Output ONLY the song titles, one per line — no numbering, no commentary, no extra text.`;
                        const lr = await raceTimeout(window.electronAPI?.aiChat?.(listPrompt, '', true, store.localSettings.enabled) ?? Promise.resolve(undefined), 15000, undefined);
                        const named = String((lr as any)?.response || '').split(/\n+/)
                          .map(l => l.replace(/^\s*[-*•\d.)\]]+\s*/, '').replace(/^["'“”]|["'“”]$/g, '').trim())
                          .filter(l => l.length >= 2 && l.length <= 80 && !/^(here|aqui|claro|sure|okay|sorry|these|of course|estas|essas)\b/i.test(l))
                          .slice(0, wantN)
                          .map(t => `${plArtist} ${t}`);
                        if (named.length >= 2) {
                          onProgress({ kind: 'status', message: `🎵 Finding ${named.length} songs on YouTube (skipping Shorts)…` });
                          const resolved = (await window.electronAPI?.resolveVideos?.(named)) || [];
                          vids = resolved.filter(r => r.id).map(r => ({ id: r.id as string, title: r.title || r.query || plArtist }));
                        }
                      } catch { /* cai no fallback abaixo */ }
                      if (vids.length < 2) {
                        onProgress({ kind: 'status', message: `🎵 Top ${wantN} "${plArtist}" tracks on YouTube…` });
                        const rm = await window.electronAPI?.resolveManyVideos?.(plArtist, wantN);
                        vids = (rm?.ok && rm.videos) ? rm.videos.map(v => ({ id: v.id, title: v.title || plArtist })) : [];
                      }
                      ids = [...new Set(vids.map(v => v.id))];   // dedup (mesmo motivo da rota songs)
                      if (ids.length < 2) plFail = `Couldn't find enough "${plArtist}" songs on YouTube.`;
                    } else {
                      plFail = 'I need at least 2 songs to build the playlist.';
                      history += '\nCREATE_PLAYLIST: poucas músicas. Reemita create_playlist com a lista de títulos (use seu conhecimento do artista).';
                    }
                    if (plFail) {
                      toolResult = { success: false, error: plFail };
                    } else {
                        // A URL watch_videos só serve pra TOCAR no fim (o YouTube limita ~50 ids nela).
                        // A playlist SALVA recebe todas as músicas (adicionadas uma a uma abaixo) —
                        // então capar aqui só afeta a reprodução de confirmação, não o que foi salvo.
                        const plUrl = `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(',')}`;
                        const beforeUrl = wv.getURL();
                        // Nome + privacidade: da action (detector/modelo já extraiu limpo) ou do
                        // comando cru. Lookahead PARA em com/with/e/and/que — senão o nome viraria
                        // "Treino com 8 músicas do Eminem" (o rabo inteiro do comando).
                        const nameM = command.match(/\b(?:nome|chamad[ao]|chame\s+de|t[ií]tulo|titulo|named?|called|llamad[ao])\s*:?\s*["'“”]?([^\n"'“”,]{1,40}?)(?=\s+(?:com|with|con|que|e\s|and\s|y\s|privad\w*|particular|secret\w*|private)|["'“”,]|$)/i);
                        const plName = (action.name && action.name.trim()) || (nameM ? nameM[1].trim() : '');
                        const wantPrivate = action.private === true || /\b(particular|privad[ao]|secret[ao]|private|s[oó]\s+(?:pra|para)\s+mim)\b/i.test(command);
                        // "CRIAR playlist" = criar DE VERDADE, salva na conta. A ação só é
                        // create_playlist quando o comando teve verbo de criar → SALVAMOS por
                        // padrão (watch_videos sozinho é só uma fila temporária, "abre uma lista").
                        // Nome autogerado do artista/1ª música se o usuário não deu um.
                        const rawName = (plName || plArtist || songs[0] || 'Minha playlist').replace(/\s+/g, ' ').trim();
                        const saveName = (rawName.charAt(0).toUpperCase() + rawName.slice(1)).slice(0, 60);
                        allResults.push({ action, result: { success: true, info: { count: ids.length, url: plUrl } } });
                        onProgress({ kind: 'status', message: `🎶 Creating the playlist "${saveName}"${wantPrivate ? ' (private)' : ''} in your YouTube account — adding ${ids.length} songs…` });
                        // Cria a playlist COM o 1º vídeo (vai direto pra página watch limpa — sem o
                        // round-trip antigo pela watch_videos, que só tocava 1s e cortava) e adiciona
                        // os demais um a um (você vê o navegador montar a lista, música a música).
                        await executeBrowserAction(wv, { type: 'navigate', url: `https://www.youtube.com/watch?v=${ids[0]}` } as BrowserAction);
                        await waitForWebviewSettled(wv, beforeUrl);
                        await new Promise(r => setTimeout(r, 1300));
                        const created = await trySaveNamedPlaylist(wv, saveName, wantPrivate);
                        if (created.ok) {
                          let added = 1;
                          for (let k = 1; k < ids.length; k++) {
                            throwIfCancelled();
                            await executeBrowserAction(wv, { type: 'navigate', url: `https://www.youtube.com/watch?v=${ids[k]}` } as BrowserAction);
                            await waitForWebviewSettled(wv, '');
                            await new Promise(r => setTimeout(r, 900));
                            const a = await tryAddToExistingPlaylist(wv, saveName);
                            if (a.ok) added++;
                            onProgress({ kind: 'status', message: `➕ "${saveName}": ${added}/${ids.length} songs…` });
                          }
                          // Volta pra tocar a playlist inteira (confirmação visual).
                          await executeBrowserAction(wv, { type: 'navigate', url: plUrl } as BrowserAction);
                          await waitForWebviewSettled(wv, '');
                          await forcePlayVideo(wv);
                          // HONESTIDADE sobre visibilidade: o YouTube cria como Particular por
                          // padrão e o app NÃO mexe no toggle (frágil, removido de propósito).
                          // Pediu "pública"? Divulga que saiu privada e onde mudar — antes o app
                          // ficava calado e a pessoa achava que tinha saído pública.
                          const askedPublic = /\b(p[uú]blic[ao]|public)\b/i.test(command);
                          const priv = askedPublic
                            ? ' (saved as Private — YouTube\'s default; make it public in the playlist settings)'
                            : (wantPrivate ? ' (private)' : '');
                          // created.ok JÁ prova que a playlist foi criada e salva na conta →
                          // é SUCESSO (o pedido "criar" foi cumprido), mesmo que alguma faixa
                          // não tenha entrado — a mensagem diz honestamente "X of N".
                          const doneMsg = `✅ Playlist "${saveName}"${priv} created in your account with ${added} of ${ids.length} songs${added < ids.length ? ' (some failed to add)' : ''}. Playing now.`;
                          onProgress({ kind: 'status', message: doneMsg });
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        } else {
                          // Não deu pra SALVAR (mais provável: não logado no YouTube; ou a página
                          // mudou — o passo que travou vai no texto pra diagnóstico). A música TOCA
                          // mesmo assim (a fila watch_videos), pra não sair de mãos vazias.
                          await executeBrowserAction(wv, { type: 'navigate', url: plUrl } as BrowserAction);
                          await waitForWebviewSettled(wv, '');
                          await forcePlayVideo(wv);
                          const doneMsg = `🎶 I lined up ${ids.length} songs and they're playing, but I couldn't SAVE the playlist to your account (stopped at "${created.step}"). Sign in to YouTube (⋮ menu → Sign in with Google) and ask again to create it for real.`;
                          onProgress({ kind: 'status', message: doneMsg });
                          finishRun('failed', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: false } as BrowserAction };
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
                    onProgress({ kind: 'status', message: `🎬 Looking for ${want} videos of "${vq}" (skipping Shorts)…` });
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
                      for (const v of vids) { try { const nid = store.addTab(v.url, opensIncognito('from-tab', aiOnIncognito())); store.joinOpenerSession(nid, taskTabId); opened.push(nid); } catch {} }
                      store.setActiveTabId(originTabId);
                      activeTabIdRef.current = originTabId;
                      opened.forEach(id => { pausedCutTabsRef.current.set(id, 0); armCutTab(id); });
                      const doneMsg = `Opened ${vids.length} tab(s) with videos of "${vq}": ${vids.map(v => v.title).slice(0, 5).join(' · ')}`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { count: vids.length } } });
                      if (actionQueue.length === 0) {
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { count: vids.length } };
                    } else {
                      const su = `https://www.youtube.com/results?search_query=${encodeURIComponent(vq)}`;
                      await executeBrowserAction(wv, { type: 'navigate', url: su } as BrowserAction);
                      history += `\nOPEN_VIDEOS: não resolvi vídeos direto (${rmv?.error || '?'}). Abri a busca — abra ${want} vídeos DE VERDADE (NÃO Shorts) em abas.`;
                      onProgress({ kind: 'status', message: `🔎 Did not find it directly; opened YouTube search.` });
                      toolResult = { success: false, error: `open_videos: ${rmv?.error || 'could not resolve directly'}` };
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
                    onProgress({ kind: 'status', message: `🎯 Looking for ${want} video(s) where "${action.phrase}" is said… (caption search, ~30s)` });
                    const vc = await window.electronAPI?.searchVideoCuts?.(action.phrase, want);
                    if (vc?.success && vc.cuts?.length) {
                      // Abre TODAS em segundo plano (pausadas/mudas) e volta pra aba
                      // original — o usuário clica em cada aba quando quiser o play.
                      const originTabId = activeTabIdRef.current;
                      const opened: string[] = [];
                      for (const c of vc.cuts) {
                        { const nid = store.addTab(`https://www.youtube.com/watch?v=${c.videoId}&t=${c.seconds}s`, opensIncognito('from-tab', aiOnIncognito())); store.joinOpenerSession(nid, taskTabId); opened.push(nid); }
                      }
                      store.setActiveTabId(originTabId);
                      activeTabIdRef.current = originTabId;
                      opened.forEach((id, i) => { pausedCutTabsRef.current.set(id, vc.cuts[i].seconds); armCutTab(id); });
                      const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                      const listing = vc.cuts.map(c => `"${(c.title || c.videoId).slice(0, 50)}" @${fmt(c.seconds)}`).join(', ');
                      const doneMsg = `${vc.cuts.length} tab(s) opened in the background, paused at the exact second where "${action.phrase}" is said — click a tab and the video plays right at that moment. ${listing} (source: ${vc.source === 'filmot' ? 'Filmot' : 'YouTube captions'})`;
                      onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                      allResults.push({ action, result: { success: true, info: { cuts: vc.cuts } } });
                      if (actionQueue.length === 0) {
                        finishRun('success', doneMsg);
                        return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                      }
                      toolResult = { success: true, info: { cuts: vc.cuts } };
                    } else {
                      toolResult = { success: false, error: vc?.error || `Could not find videos where "${action.phrase}" is said.` };
                    }
                  } else if (action.type === 'compare_prices') {
                    // "por fora" igual ao yt-dlp: vai direto no Google Shopping (que
                    // agrega ML/Amazon/Magalu/KaBuM), deixa o WEBVIEW renderizar o JS,
                    // e o "scanner" raspa os preços do DOM → tabela ordenada. Sem o
                    // agente clicando. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const q = action.query;
                    onProgress({ kind: 'status', message: `🛒 Comparing prices for "${q}" — Google Shopping (Mercado Livre, Amazon, Magalu…)…` });
                    const shopUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=28&${googleLocaleParams()}`;
                    const beforeUrl = wv.getURL();
                    await executeBrowserAction(wv, { type: 'navigate', url: shopUrl } as BrowserAction);
                    await waitForWebviewSettled(wv, beforeUrl);
                    await waitForSettle(wv, { maxMs: 4000, minMs: 300 });   // espera o Shopping ASSENTAR (não tempo fixo)
                    let items: Array<{ title: string; price: number; store: string; url: string }> = [];
                    try { items = await withTimeout(wv.executeJavaScript(PRICE_EXTRACTOR_JS, false), 9000, [] as any); } catch { /* página hostil */ }
                    const rawValid = (items || []).filter(x => x && x.price > 0 && x.title);
                    // ── FILTRO DE PLAUSIBILIDADE ────────────────────────────────────────────
                    // O extrator pega o 1º "R$" do bloco, que nem sempre é o preço do produto:
                    // cashback, desconto, frete e parcela solta viram "ofertas" ridículas — e,
                    // como a lista é ordenada do mais barato, o LIXO virava a manchete
                    // ("iPhone 16 por R$ 3,21"). Descartamos o que está absurdamente abaixo da
                    // MEDIANA (< 25%): num comparativo do MESMO produto, esses valores nunca
                    // são o preço real. Mediana (não média) pra um único outlier não puxar o corte.
                    const priceList = rawValid.map(x => x.price).sort((a, b) => a - b);
                    const median = priceList.length
                      ? priceList[Math.floor(priceList.length / 2)]
                      : 0;
                    const floor = median * 0.25;
                    const valid = median > 0 ? rawValid.filter(x => x.price >= floor) : rawValid;
                    const dropped = rawValid.length - valid.length;
                    if (dropped > 0) console.warn(`[ComparePrices] ${dropped} oferta(s) descartada(s) abaixo de R$ ${floor.toFixed(2)} (provável parcela/cashback/frete).`);
                    if (valid.length >= 2) {
                      const sorted = valid.sort((a, b) => a.price - b.price).slice(0, 30);
                      const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      const spec = {
                        title: `Prices: ${q}`,
                        subtitle: 'Google Shopping (Mercado Livre, Amazon, Magalu, KaBuM and more) — sorted cheapest first',
                        columns: ['Product', 'Price (R$)', 'Store'],
                        rows: sorted.map(x => [x.title, fmt(x.price), x.store || '—']),
                        links: sorted.map(x => x.url || undefined),
                        chart: { type: 'bar' as const, label: 'Price (R$)', labels: sorted.slice(0, 12).map(x => x.title.slice(0, 22)), values: sorted.slice(0, 12).map(x => x.price) },
                        sourceNote: `Source: Google Shopping — ${new Date().toLocaleString('pt-BR')}. Prices vary; confirm on the store before buying.`,
                      };
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        const c = sorted[0];
                        // addBackgroundTab (NÃO addTab): a tabela abre na barra de abas, mas
                        // sem roubar o foco — senão o painel da IA (que segue a aba ATIVA)
                        // ficava em branco, escondendo esta própria resposta.
                        const newId = store.addBackgroundTab(rv.url, opensIncognito('from-tab', aiOnIncognito()));
                        store.joinOpenerSession(newId, taskTabId);
                        activeTabIdRef.current = newId;
                        const doneMsg = `${sorted.length} offers for "${q}". Cheapest: ${c.title} — R$ ${fmt(c.price)}${c.store ? ` (${c.store})` : ''}. Comparison table opened in a tab.`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { count: sorted.length, cheapest: c } } });
                        if (actionQueue.length === 0) {
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { count: sorted.length } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Failed to build the price table.' };
                      }
                    } else {
                      // Scanner não pegou (consent wall / layout novo): deixa o agente
                      // ler a página do Shopping que já está aberta, em vez de travar.
                      history += `\nPRICE COMPARE: auto-extraction from Google Shopping returned nothing for "${q}". The Shopping page IS OPEN — use extract_text to read the visible prices and answer, or report the cheapest you can see.`;
                      toolResult = { success: false, error: 'Could not scrape the prices automatically. The Google Shopping page is open — I will read it.' };
                    }
                  } else if (action.type === 'summarize_tabs') {
                    // Resumo das abas abertas da pessoa. Anônimas e páginas internas ficam fora; as
                    // dormindo (Memory Saver) só aparecem como "dormindo" — acordar todas de uma vez
                    // custaria RAM/rede que a pessoa não pediu (acorda só se ela pedir). Ler aba que não é
                    // da tarefa passa pela permissão das abas (perguntar / sempre / nunca). Auto-done.
                    setAgentVisual('acting');
                    const sel = selectTabsForSummary(tabsRef.current, { wake: !!action.wake });
                    let readable = sel.toRead;
                    let noAccess: typeof readable = [];
                    const decision = tabsAccessDecision(getPerm('userTabs'), readable.map(x => x.id), grantedTabs);
                    const mayRead = decision === 'read'
                      || (decision === 'ask' && await askPermission('userTabs', `Read the text of your ${readable.length} open tab(s) to summarize them.`));
                    if (mayRead) readable.forEach(x => grantedTabs.add(x.id));
                    else { noAccess = readable.filter(x => !grantedTabs.has(x.id)); readable = readable.filter(x => grantedTabs.has(x.id)); }
                    onProgress({ kind: 'status', message: `🗂️ Reading ${readable.length} tab(s)…` });
                    // Acordar (só quando pedido): tira o "dormindo" e espera a <webview> montar e carregar.
                    for (const tb of readable) {
                      if (!(tb.discarded || tb.restored)) continue;
                      store.updateTab(tb.id, { discarded: false, restored: false, lastActiveAt: Date.now() });
                    }
                    const readTab = async (id: string): Promise<string | null> => {
                      for (let i = 0; i < 30 && !webviewRefs.current.get(id); i++) await sleep(300);
                      const w = webviewRefs.current.get(id) as any;
                      if (!w) return null;
                      for (let i = 0; i < 30; i++) { try { if (!w.isLoading()) break; } catch { break; } await sleep(300); }
                      try {
                        // Texto da aba pelo executeJavaScript da <webview> (página que bloqueia script devolve null: "não deu pra ler").
                        const txt = await withTimeout(w.executeJavaScript(`(document.body ? document.body.innerText : '').slice(0, 6000)`), 8000, null as any);
                        return typeof txt === 'string' ? txt : null;
                      } catch { return null; }
                    };
                    const texts: Array<TabText & { id: string; ok: boolean }> = [];
                    for (const tb of readable) {
                      throwIfCancelled();
                      const txt = await readTab(tb.id);
                      const live = tabsRef.current.find(x => x.id === tb.id) ?? tb;
                      texts.push({ id: tb.id, title: live.title || tb.title, url: live.url || tb.url, text: txt || '', ok: txt != null });
                    }
                    const okTexts = texts.filter(x => x.ok);
                    let parsed = { perTab: okTexts.map(() => ''), overall: '' };
                    if (okTexts.length) {
                      onProgress({ kind: 'status', message: `🧠 Summarizing ${okTexts.length} tab(s)…` });
                      const r = await raceTimeout(window.electronAPI?.aiChat(buildTabsSummaryPrompt(okTexts, uiLangName()), '', true, store.localSettings.enabled) ?? Promise.resolve(undefined), 90000, undefined);
                      throwIfCancelled();
                      parsed = parseTabsSummary(String(r?.response || ''), okTexts);
                      if (!parsed.overall && r?.error) parsed.overall = `(${r.error})`;
                    }
                    const summaryOf = new Map(okTexts.map((x, i) => [x.id, parsed.perTab[i]]));
                    const entries = [
                      ...texts.map(x => ({ id: x.id, title: x.title, url: x.url, state: x.ok ? 'read' as const : 'unreadable' as const, summary: summaryOf.get(x.id) || '' })),
                      ...noAccess.map(x => ({ id: x.id, title: x.title, url: x.url, state: 'no_access' as const, summary: '' })),
                      ...sel.asleep.map(x => ({ id: x.id, title: x.title, url: x.url, state: 'asleep' as const, summary: '' })),
                    ];
                    onProgress({ kind: 'tabs_summary', tabs: entries, overall: parsed.overall,
                      skippedIncognito: sel.skippedIncognito, skippedInternal: sel.skippedInternal,
                      onOpen: (id: string) => { if (tabsRef.current.some(x => x.id === id)) store.setActiveTabId(id); } });
                    const doneMsg = parsed.overall
                      || (entries.length ? `${okTexts.length} tab(s) read${sel.asleep.length ? `, ${sel.asleep.length} asleep` : ''}${noAccess.length ? `, ${noAccess.length} without access` : ''}.` : 'No open web pages to summarize.');
                    allResults.push({ action, result: { success: true, info: { read: okTexts.length, asleep: sel.asleep.length, noAccess: noAccess.length } } });
                    finishRun('success', doneMsg);
                    return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                  } else if (action.type === 'google_news') {
                    // Vertical Notícias do Google (udm=12) — raspa as manchetes do DOM
                    // renderizado e monta um painel clicável. Determinístico → auto-done.
                    setAgentVisual('acting');
                    const q = action.query;
                    onProgress({ kind: 'status', message: `📰 Searching news for "${q}" on Google…` });
                    const newsUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=12&${googleLocaleParams()}`;
                    const beforeUrl = wv.getURL();
                    await executeBrowserAction(wv, { type: 'navigate', url: newsUrl } as BrowserAction);
                    await waitForWebviewSettled(wv, beforeUrl);
                    await waitForSettle(wv, { maxMs: 3500, minMs: 250 });   // espera as manchetes ASSENTAREM
                    let news: Array<{ title: string; source: string; when: string; url: string }> = [];
                    try { news = await withTimeout(wv.executeJavaScript(NEWS_EXTRACTOR_JS, false), 9000, [] as any); } catch { /* hostil */ }
                    const valid = (news || []).filter(x => x && x.title && x.title.length > 12).slice(0, 30);
                    if (valid.length >= 2) {
                      const spec = {
                        title: `News: ${q}`,
                        subtitle: `The ${valid.length} most recent headlines — click to open the article`,
                        columns: ['Manchete', 'Fonte', 'Quando'],
                        rows: valid.map(x => [x.title, x.source || '—', x.when || '']),
                        links: valid.map(x => x.url || undefined),
                        sourceNote: `Source: Google News — ${new Date().toLocaleString('pt-BR')}`,
                      };
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        // addBackgroundTab: mesma razão do compare_prices acima.
                        const newId = store.addBackgroundTab(rv.url, opensIncognito('from-tab', aiOnIncognito()));
                        store.joinOpenerSession(newId, taskTabId);
                        activeTabIdRef.current = newId;
                        const doneMsg = `${valid.length} news for "${q}". Top: ${valid[0].title}${valid[0].source ? ` (${valid[0].source})` : ''}. Panel opened in a tab.`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { count: valid.length } } });
                        if (actionQueue.length === 0) {
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { count: valid.length } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Failed to build the news panel.' };
                      }
                    } else {
                      history += `\nNEWS: auto-extraction returned nothing for "${q}". The Google News page IS OPEN — use extract_text to read the headlines and report them.`;
                      toolResult = { success: false, error: 'Could not scrape the headlines. The news page is open — I will read it.' };
                    }
                  } else if (action.type === 'render_view' && commandIsCart && cartCheckBlocks < 3
                    && (cartRenderProblem = cartFinishProblem({ list: groceryList, inCart: groceryInCart, outOfStock: groceryOutOfStock, available: groceryAvailable, cartPageSeen,
                      report: JSON.stringify([(action as any).title, (action as any).subtitle, (action as any).rows, (action as any).source_note]) }))) {
                    // Tabela final de carrinho com item faltando/curto, carrinho não conferido ou esgotado não citado.
                    cartCheckBlocks++;
                    history += `\n${cartRenderProblem}`;
                    onProgress({ kind: 'status', message: '🛒 Checking the cart before finishing.' });
                    toolResult = { success: false, reason: 'not_done', error: cartRenderProblem };
                  } else if (action.type === 'render_view' || action.type === 'stock_movers') {
                    // A "mágica" visual: dados → página bonita (tabela ordenável +
                    // gráfico) aberta numa aba. Determinístico → auto-done.
                    setAgentVisual('acting');
                    let spec: any = null;
                    let failMsg = '';
                    if (action.type === 'stock_movers') {
                      const dirWord = action.direction === 'losers' ? 'that fell the most' : 'that rose the most';
                      onProgress({ kind: 'status', message: `📈 Fetching today's ${dirWord} stocks (direct source, no browsing)…` });
                      const sm = await window.electronAPI?.stockMovers?.(action.direction, action.count);
                      if (sm?.success && sm.spec) spec = sm.spec;
                      else failMsg = sm?.error || 'Stock quote sources are unavailable right now.';
                    } else {
                      spec = {
                        title: action.title, columns: action.columns, rows: action.rows,
                        subtitle: action.subtitle, chart: action.chart, sourceNote: action.source_note,
                      };
                    }
                    if (spec) {
                      const rv = await window.electronAPI?.renderView?.(spec);
                      if (rv?.success && rv.url) {
                        // addBackgroundTab: mesma razão do compare_prices acima.
                        const newId = store.addBackgroundTab(rv.url, opensIncognito('from-tab', aiOnIncognito()));
                        store.joinOpenerSession(newId, taskTabId);
                        activeTabIdRef.current = newId;
                        const doneMsg = `Done: "${spec.title}" opened in a new tab (${spec.rows?.length ?? 0} rows, sortable table + chart).`;
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { url: rv.url, rows: spec.rows?.length } } });
                        if (actionQueue.length === 0) {
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { url: rv.url } };
                      } else {
                        toolResult = { success: false, error: rv?.error || 'Failed to build the data page.' };
                      }
                    } else {
                      toolResult = { success: false, error: failMsg };
                    }
                  } else if (action.type === 'generate_image') {
                    // GERAR IMAGEM (texto→imagem) via Pollinations (grátis, sem chave).
                    // Sem CORS aqui (main process) → sem proxy; salva em Downloads + miniaturas.
                    setAgentVisual('acting');
                    const q = (action.prompt || '').trim();
                    const want = Math.min(Math.max(Number(action.count) || 1, 1), 4);
                    if (q.length < 2) {
                      toolResult = { success: false, error: 'generate_image needs a prompt.' };
                    } else {
                      onProgress({ kind: 'status', message: `🎨 Generating ${want > 1 ? `${want} images` : 'an image'} of "${q}"…` });
                      const gr = await window.electronAPI?.generateImage?.(q, want);
                      if (gr?.success && gr.saved > 0) {
                        const folder = gr.dir ? gr.dir.split(/[\\/]/).pop() : q;
                        const doneMsg = `${gr.saved} image${gr.saved > 1 ? 's' : ''} of "${q}" generated and saved to Downloads/${folder}/`;
                        onProgress({ kind: 'media', mediaKind: 'image', paths: gr.paths || [], dir: gr.dir || '', total: gr.saved, label: `${gr.saved} image(s) of "${q}"` });
                        onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                        allResults.push({ action, result: { success: true, info: { saved: gr.saved, dir: gr.dir } } });
                        if (actionQueue.length === 0) {
                          finishRun('success', doneMsg);
                          return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                        }
                        toolResult = { success: true, info: { saved: gr.saved } };
                      } else {
                        toolResult = { success: false, error: gr?.error || 'Could not generate the image.' };
                      }
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
                      toolResult = { success: false, error: 'harvest_images needs a topic.' };
                    } else {
                      onProgress({ kind: 'status', message: `🪄 Harvesting ${want} images of "${q}" (high quality)…` });
                      let urls: string[] = [];
                      // Raspa numa ABA OCULTA (same-origin evita 403, mas NÃO abre o buscador
                      // na cara do usuário — igual à Pesquisa Rápida). A aba some no fim.
                      const imgBgId = store.addHiddenTab(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, opensIncognito('from-tab', aiOnIncognito()));
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
                              onProgress({ kind: 'status', message: `🪄 Topping up with Bing Images…` });
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
                        toolResult = { success: false, error: `Could not harvest image URLs for "${q}".` };
                      } else {
                        onProgress({ kind: 'status', message: `⬇️ Downloading ${urls.length} images in parallel…` });
                        const hr = await window.electronAPI?.harvestImages?.(urls, q);
                        if (hr?.success && hr.saved > 0) {
                          const folder = hr.dir ? hr.dir.split(/[\\/]/).pop() : q;
                          const doneMsg = `Magic done! ${hr.saved} images of "${q}" saved to Downloads/${folder}/`;
                          // miniaturas clicáveis no feed (clique → abre a pasta)
                          onProgress({ kind: 'media', mediaKind: 'image', paths: hr.paths || [], dir: hr.dir || '', total: hr.saved, label: `${hr.saved} images of "${q}"` });
                          onProgress({ kind: 'status', message: `✅ ${doneMsg}` });
                          allResults.push({ action, result: { success: true, info: { saved: hr.saved, dir: hr.dir } } });
                          if (actionQueue.length === 0) {
                            finishRun('success', doneMsg);
                            return { thought: doneMsg, results: allResults, done: { type: 'done', reason: doneMsg, success: true } as BrowserAction };
                          }
                          toolResult = { success: true, info: { saved: hr.saved } };
                        } else {
                          toolResult = { success: false, error: hr?.error || 'Failed to download the harvested images.' };
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
                      onProgress({ kind: 'status', message: `🖼️ Searching images (high-res, free): "${q}"` });
                      const sr = await window.electronAPI?.searchImages?.(q, action.min_width, action.count);
                      if (sr?.success && sr.images.length) {
                        const listing = sr.images.map((im, i) => `[img${i}] ${im.width}x${im.height} (${im.source}, ${im.license || 'lic?'}) ${im.url}`).join('\n');
                        history += `\n\nIMAGES FOUND (direct full-res URLs, ready to download):\n${listing}\n`;
                        onProgress({ kind: 'status', message: `🖼️ ${sr.images.length} images found (largest: ${sr.images[0].width}x${sr.images[0].height}).` });
                        toolResult = { success: true, info: { count: sr.images.length, largest: `${sr.images[0].width}x${sr.images[0].height}`, top: sr.images[0].url } };
                      } else {
                        toolResult = { success: false, error: sr?.error || `No image found for "${q}".` };
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
                    // Extract main visible text (filter scripts/styles, headings + paragraphs). The page script
                    // returns the whole text (bounded); the page [offset, offset + max) is cut here, on line /
                    // whitespace boundaries, sized by the read budget (shared/read-paging.ts).
                    const rm = resolveReadMax(action.max_chars, readBudgetNow());
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
                      // ── RESGATE DE DADOS NÃO-PROSA ────────────────────────────────────
                      // A poda acima é feita pra ARTIGO: só h1-h6/p/li/blockquote entram, e
                      // botões/formulários/aside são removidos. Em página de PRODUTO o preço
                      // mora em span/div dentro desses blocos removidos → sumia por completo.
                      // O agente então "não achava o preço", re-extraía, rolava a página e
                      // acabava indo buscar no Google Shopping (42s e o produto errado),
                      // enquanto o valor estava ali na tela o tempo todo.
                      // Se o corpo tem valores em dinheiro que o texto extraído perdeu,
                      // anexamos os visíveis — barato, e devolve a visão que faltava.
                      var body = clean(document.body.innerText);
                      var money = body.match(/(?:R\\$|US\\$|\\$|€|£)\\s?\\d[\\d.,]*/g) || [];
                      if (money.length && !/(?:R\\$|US\\$|€|£)/.test(md)) {
                        var uniq = [], seenM = {};
                        for (var m=0; m<money.length && uniq.length<15; m++){
                          var v = clean(money[m]);
                          if (!seenM[v]) { seenM[v] = 1; uniq.push(v); }
                        }
                        if (uniq.length) md += '\\n\\nVALORES VISÍVEIS NA PÁGINA (na ordem em que aparecem): ' + uniq.join(' · ');
                      }
                      return md.slice(0, 400000);
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
                        const page = pageOfText(String(text), action.offset, rm.max);
                        const info: PageInfo = { tool: 'extract_text', page, askedMax: action.max_chars, capped: rm.capped ? rm.max : undefined };
                        if (page.pastEnd) toolResult = { success: false, error: pastEndMessage(info) };
                        else {
                          // A página inteira vai no bloco PAGE TEXT (extracted) do próximo passo (não só a cauda de
                          // 2500 caracteres do RECENT HISTORY); no histórico, a linha com o intervalo, o começo e a próxima chamada.
                          lastExtractBlock = pageTextBlock(title, url, info);
                          pendingReads.push(lastExtractBlock);
                          extractPagesRead.add(`${observation.url}#${page.start}`);
                          const head = page.text.replace(/\s+/g, ' ').trim().slice(0, 200);
                          const next = page.more ? ` More: ${nextCall('extract_text', { max: rm.capped ? undefined : action.max_chars }, page.end)}.` : '';
                          history += `\nEXTRACTED TEXT from ${title} (${url}): ${rangeLine(info)}${rm.capped ? ` (capped at ${rm.max} by the model's free context)` : ''} — shown in full once, in the PAGE TEXT (extracted) block of the next step; store() what you need. Starts: "${head}${page.text.length > 200 ? '…' : ''}".${next}`;
                          lastExtractedText = page.text;   // guardado pro fallback do freio anti-coleta
                          toolResult = { success: true, info: { url, title, chars: page.text.length, from: page.start, to: page.end, total: page.total, more: page.more } };
                        }
                      }
                    } catch (e: any) {
                      toolResult = { success: false, error: String(e?.message || e) };
                    }
                  } else if (action.type === 'report' && commandIsCart && cartCheckBlocks < 3
                    && (cartRenderProblem = cartFinishProblem({ list: groceryList, inCart: groceryInCart, outOfStock: groceryOutOfStock, available: groceryAvailable, cartPageSeen,
                      report: String((action as any).summary || '') }))) {
                    // report também encerra: mesma conferência do done (o 8B quase sempre encerra com report).
                    cartCheckBlocks++;
                    history += `\n${cartRenderProblem}`;
                    onProgress({ kind: 'status', message: '🛒 Checking the cart before finishing.' });
                    toolResult = { success: false, reason: 'not_done', error: cartRenderProblem };
                  } else if (action.type === 'report') {
                    // Final synthesized answer to user — exits loop.
                    // Modelo fraco às vezes manda report com summary VAZIO ("qual a capital
                    // da Austrália?" terminava em SUCESSO mudo, sem texto nenhum na tela).
                    // Cai no melhor conteúdo que já temos; sem nada, é falha honesta — nunca
                    // "sucesso" em branco.
                    const reported = String(action.summary || '').trim()
                      || (lastExtractedText || '').replace(/\s+/g, ' ').trim().slice(0, 500)
                      || String(stepThought || stepEvaluation || '').trim();
                    if (!reported) {
                      const msg = "I finished, but the model didn't write an answer. Try rephrasing the question.";
                      appendAgentRunStep(runLog, {
                        step: step + 1,
                        urlBefore: observation.url,
                        urlAfter: observation.url,
                        titleAfter: observation.title,
                        ...summarizeAction(action),
                        result: { reported: '' },
                        success: false,
                        note: 'empty report',
                      });
                      finishRun('failed', msg);
                      return { error: msg, thought: thoughts.join('\n\n'), results: allResults };
                    }
                    appendAgentRunStep(runLog, {
                      step: step + 1,
                      urlBefore: observation.url,
                      urlAfter: observation.url,
                      titleAfter: observation.title,
                      ...summarizeAction(action),
                      result: { reported },
                      success: true,
                    });
                    finishRun('success', reported);
                    return {
                      thought: thoughts.join('\n\n'),
                      results: [...allResults, { action, result: { reported } }],
                      done: { type: 'done', reason: reported, success: true } as any,
                    };
                  } else if (action.type === 'history_search') {
                    if (!(await askPermission('history', `Search your browsing history for "${action.query.slice(0, 80)}".`))) {
                      toolResult = { success: false, error: 'The user did not allow the agent to read their browsing history.' };
                    } else {
                      const words = action.query.toLowerCase().split(/\s+/).filter(Boolean);
                      const hits = historyRef.current
                        .map(h => ({ h, score: words.filter(w => `${h.title} ${h.url}`.toLowerCase().includes(w)).length }))
                        .filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.h.ts - a.h.ts).slice(0, 10).map(x => x.h);
                      history += hits.length
                        ? `\nHISTORY MATCHES for "${action.query}" (pages the user visited, newest first among equals):\n${hits.map((h, i) => `  ${i + 1}. ${h.title || '(no title)'} — ${h.url} (${new Date(h.ts).toLocaleDateString()})`).join('\n')}`
                        : `\nHISTORY: no visited page matches "${action.query}".`;
                      toolResult = { success: true, info: { matches: hits.length } };
                    }
                  } else if (action.type === 'switch_tab') {
                    const target = tabsRef.current[action.tab];
                    if (target && target.incognito && !privateTaskRef.current) {
                      toolResult = { success: false, error: `Tab ${action.tab} is an incognito tab: not available to this task.` };
                    } else if (target && !(grantedTabs.has(target.id) || agentOpenedTabs.has(target.id)
                      || await askPermission('userTabs', `Switch to your tab "${(target.title || target.url).slice(0, 80)}" for this task.`))) {
                      toolResult = { success: false, error: `The user did not allow the agent to use their tab "${(target.title || '').slice(0, 60)}". Work in the starting tab or open a new tab.` };
                    } else if (target) {
                      grantedTabs.add(target.id);
                      store.setActiveTabId(target.id);
                      activeTabIdRef.current = target.id;
                      toolResult = { success: true, info: { switchedTo: action.tab } };
                    }
                    else toolResult = { success: false, error: `Tab ${action.tab} not found` };
                    await sleep(1500);
                  } else if (action.type === 'new_tab') {
                    if (!/^https?:\/\//i.test(action.url || '')) {
                      toolResult = { success: false, error: `Blocked: the agent only opens http(s) pages, not "${action.url}".` };
                    } else {
                    const newId = store.addTab(action.url, opensIncognito('from-tab', aiOnIncognito()));   // tarefa de aba anônima → aba anônima
                    store.joinOpenerSession(newId, taskTabId);   // aba do agente entra na sessão da tarefa
                    agentOpenedTabs.add(newId);
                    grantedTabs.add(newId);
                    store.updateTab(newId, { agentTask: true });
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
                  } else if (action.type === 'get') {
                    const el = observation.interactive_elements.find(e => e.id === action.ref);
                    const wcIdG = (wv as any).getWebContentsId?.();
                    if (!el || wcIdG == null) toolResult = { success: false, error: `No element with ref @${action.ref} — re-observe the page.` };
                    else {
                      const r = await window.electronAPI?.inspect?.(wcIdG, el.frameNode ? { key: el.frameNode.key, id: el.frameNode.id } : el.backendNodeId != null ? { backendNodeId: el.backendNodeId } : { x: el.x, y: el.y });
                      if (r?.ok && r.state) { history += `\nGET @${action.ref}: ${JSON.stringify(r.state)}`; toolResult = { success: true, info: { ref: action.ref } }; }
                      else toolResult = { success: false, error: r?.error || 'could not read the element' };
                    }
                  } else if ((action.type === 'keydown' || action.type === 'keyup' || action.type === 'insert_text') && wcId != null) {
                    toolResult = action.type === 'insert_text'
                      ? await window.electronAPI?.insertText?.(wcId, action.text)
                      : await window.electronAPI?.keyState?.(wcId, action.key, action.type === 'keydown');
                  } else if (action.type === 'click_role') {
                    toolResult = { success: false, error: roleMiss || 'no matching element' };
                  } else if (action.type === 'close_tab') {
                    const target = tabsRef.current[action.tab];
                    if (target && target.incognito && !privateTaskRef.current) {
                      toolResult = { success: false, error: `Tab ${action.tab} is an incognito tab: not available to this task.` };
                    } else if (target && !agentOpenedTabs.has(target.id)) {
                      toolResult = { success: false, error: 'Only tabs the agent opened in this task can be closed — this one belongs to the user.' };
                    } else if (target) {
                      // Se a aba fechada é a aba de TRABALHO do agente, o freio anti-troca-de-aba
                      // (taskRunningRef) impede o espelhamento de corrigir o ref → ele apontaria pra
                      // aba MORTA e o passo seguinte quebraria (getActiveWebview null). Então
                      // atualizamos na mão pra próxima aba ativa (mesma regra do store.closeTab: a
                      // vizinha que sobrou NA BARRA — nunca uma aba escondida).
                      const wasActive = target.id === activeTabIdRef.current;
                      store.closeTab(target.id);
                      if (wasActive) {
                        const nextId = nextActiveAfterClose(tabsRef.current, new Set([target.id]), target.id);
                        if (nextId) activeTabIdRef.current = nextId;
                      }
                      toolResult = { success: true, info: { closed: action.tab } };
                    } else toolResult = { success: false, error: `Tab ${action.tab} not found` };
                  } else if (action.type === 'web_search') {
                    // Busca por texto em vários buscadores (pula os bloqueados) — o agente recebe a lista
                    // e decide qual link abrir, sem cair na página de captcha do buscador.
                    onProgress({ kind: 'status', message: `🔎 Searching: "${action.query.slice(0, 80)}"` });
                    const sr = await searchWebResults(action.query);
                    throwIfCancelled();
                    if (sr.results.length) {
                      history += `\nWEB RESULTS for "${action.query}" (via ${sr.engine}) — open the best one with navigate:\n${sr.results.map((x, i) => `  ${i + 1}. ${x.title} — ${x.url}${x.snippet ? `\n     ${x.snippet.slice(0, 160)}` : ''}`).join('\n')}`;
                      toolResult = { success: true, info: { engine: sr.engine, results: sr.results.length } };
                    } else {
                      toolResult = { success: false, error: sr.error || (sr.blocked ? 'All search engines are blocking this connection right now — go directly to a site you know (e.g. the vendor or booking site).' : 'No results — try other words.') };
                    }
                  } else if (action.type === 'look_at') {
                    // Só marca a área; o recorte vai na próxima captura (decideAgentShot força a imagem).
                    if (action.ref != null) {
                      const target = observation.interactive_elements.find(e => e.id === action.ref);
                      const wcIdZ = (wv as any).getWebContentsId?.();
                      if (!target) {
                        toolResult = { success: false, error: `No element with ref @${action.ref} — re-observe the page.` };
                      } else {
                        let cx = target.x, cy = target.y;
                        if (target.backendNodeId != null && wcIdZ != null && window.electronAPI?.verifyClick) {
                          const v = await window.electronAPI.verifyClick(wcIdZ, target.backendNodeId).catch(() => null);   // rola até ele
                          if (v && typeof v.x === 'number' && typeof v.y === 'number') { cx = v.x; cy = v.y; }
                        }
                        const vp = await withTimeout(wv.executeJavaScript('({w: innerWidth, h: innerHeight})').catch(() => null), 1500, null) as { w: number; h: number } | null;
                        const W = Math.min(720, vp?.w || 720), H = Math.min(460, vp?.h || 460);
                        const x = Math.max(0, Math.min((vp?.w || cx + W / 2) - W, cx - W / 2)), y = Math.max(0, Math.min((vp?.h || cy + H / 2) - H, cy - H / 2));
                        pendingZoom = { x, y, w: W, h: H, label: `the area around @${action.ref} "${String(target.text || target.aria || '').slice(0, 40)}"` };
                        toolResult = { success: true, info: { zoom: `@${action.ref}` } };
                      }
                    } else {
                      pendingZoom = { x: action.x!, y: action.y!, w: action.w!, h: action.h!, label: 'the requested area' };
                      toolResult = { success: true, info: { zoom: `${action.x},${action.y} ${action.w}x${action.h}` } };
                    }
                    if (toolResult.success) history += `\nZOOM: the next screenshot will be a sharp crop of ${pendingZoom!.label}.`;
                  } else if (action.type === 'find') {
                    // Busca na página INTEIRA (fora da tela e além do limite da lista), rola o melhor
                    // resultado pra vista — ele aparece na lista de elementos do próximo passo.
                    const res = await withTimeout(wv.executeJavaScript(`(function(want){
                      var w = String(want).trim().toLowerCase();
                      var sel = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],h1,h2,h3,h4,th,td,li';
                      var seen = new Set(), hits = [];
                      document.querySelectorAll(sel).forEach(function(el){
                        var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
                        var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
                        var t = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
                        if (!t || t.length > 200 || t.toLowerCase().indexOf(w) < 0) return;
                        var ctl = el.closest('a,button,label,select,[role=button],[role=link],[role=checkbox]') || el;
                        if (seen.has(ctl)) return; seen.add(ctl);
                        var exact = t.toLowerCase() === w ? 0 : 1, isCtl = /^(A|BUTTON|INPUT|SELECT|LABEL)$/.test(ctl.tagName) || ctl.getAttribute('role') ? 0 : 1;
                        hits.push({ el: ctl, t: t.slice(0, 80), tag: ctl.tagName.toLowerCase(), rank: exact * 2 + isCtl + t.length / 1000, y: Math.round(r.top + scrollY) });
                      });
                      hits.sort(function(a, b){ return a.rank - b.rank; });
                      if (hits[0]) hits[0].el.scrollIntoView({ block: 'center', inline: 'nearest' });
                      return { count: hits.length, hits: hits.slice(0, 8).map(function(h){ return { tag: h.tag, text: h.t, pageY: h.y }; }) };
                    })(${JSON.stringify(action.text)})`).catch((e: any) => ({ count: 0, hits: [], error: String(e?.message || e) })), 5000, { count: 0, hits: [], error: 'page did not respond' }) as { count: number; hits: Array<{ tag: string; text: string; pageY: number }>; error?: string };
                    if (res.count > 0) {
                      toolResult = { success: true, info: { matches: res.count, scrolledTo: res.hits[0].text } };
                      history += `\nFIND "${action.text}": ${res.count} match(es). Scrolled to <${res.hits[0].tag}> "${res.hits[0].text}" — it is now on screen and in INTERACTIVE ELEMENTS (use its [id]).${res.hits.length > 1 ? ' Other matches: ' + res.hits.slice(1).map(h => `<${h.tag}> "${h.text}"`).join('; ') : ''}`;
                    } else {
                      toolResult = { success: false, error: res.error || `"${action.text}" was not found anywhere on this page — try other words, or another page.` };
                    }
                  } else if (action.type === 'hover' || action.type === 'dblclick' || action.type === 'focus' || action.type === 'drag') {
                    // Ponteiro além do clique: alvo rolado pra vista e medido (verifyClick), input real.
                    const wcIdP = (wv as any).getWebContentsId?.();
                    const locate = async (ref: number) => {
                      const el = observation.interactive_elements.find(e => e.id === ref);
                      if (!el) return null;
                      let x = el.x, y = el.y;
                      if (el.backendNodeId != null && wcIdP != null && window.electronAPI?.verifyClick) {
                        const v = await window.electronAPI.verifyClick(wcIdP, el.backendNodeId).catch(() => null);
                        if (v && typeof v.x === 'number' && typeof v.y === 'number') { x = v.x; y = v.y; }
                      }
                      return { x, y, backendNodeId: el.backendNodeId };
                    };
                    const a = await locate(action.ref);
                    const b = action.type === 'drag' ? await locate(action.to_ref) : null;
                    if (!a || wcIdP == null || (action.type === 'drag' && !b)) {
                      toolResult = { success: false, error: `No element with ref @${!a ? action.ref : (action as any).to_ref} — re-observe the page.` };
                    } else {
                      const r = await window.electronAPI?.pointer?.(wcIdP, { kind: action.type, x: a.x, y: a.y, x2: b?.x, y2: b?.y, backendNodeId: a.backendNodeId });
                      toolResult = r?.success ? { success: true, info: { [action.type]: action.ref } } : { success: false, error: r?.error || `${action.type} failed` };
                      if (action.type !== 'hover' && action.type !== 'focus') await waitForWebviewSettled(wv, wv.getURL());
                    }
                  } else if (action.type === 'forward' || action.type === 'reload') {
                    const beforeUrl = wv.getURL();
                    if (action.type === 'forward' && !wv.canGoForward()) {
                      toolResult = { success: false, error: 'There is no next page in this tab.' };
                    } else {
                      try { action.type === 'forward' ? wv.goForward() : wv.reload(); } catch {}
                      await waitForWebviewSettled(wv, action.type === 'reload' ? '' : beforeUrl);
                      toolResult = { success: true, info: { url: wv.getURL() } };
                    }
                  } else if (action.type === 'back') {
                    if (!wv.canGoBack()) {
                      toolResult = { success: false, error: 'There is no previous page in this tab.' };
                    } else {
                      const beforeUrl = wv.getURL();
                      try { wv.goBack(); } catch {}
                      await waitForWebviewSettled(wv, beforeUrl);
                      toolResult = { success: true, info: { url: wv.getURL() } };
                    }
                  } else if (action.type === 'check' || action.type === 'uncheck') {
                    // Lê o estado, clica com input real SÓ se precisa mudar, e confere depois.
                    const want = action.type === 'check';
                    const target = observation.interactive_elements.find(e => e.id === action.ref);
                    const wcIdC = (wv as any).getWebContentsId?.();
                    if (!target || wcIdC == null) {
                      toolResult = { success: false, error: `No element with ref @${action.ref} — re-observe the page.` };
                    } else {
                      let cx = target.x, cy = target.y;
                      if (target.backendNodeId != null && window.electronAPI?.verifyClick) {
                        const v = await window.electronAPI.verifyClick(wcIdC, target.backendNodeId).catch(() => null);
                        if (v && typeof v.x === 'number' && typeof v.y === 'number') { cx = v.x; cy = v.y; }
                      }
                      const readState = () => withTimeout(wv.executeJavaScript(`(function(x, y){
                        var el = document.elementFromPoint(x, y); if (!el) return null;
                        var box = (el.matches && el.matches('input[type=checkbox],input[type=radio]')) ? el
                          : (el.closest && (el.closest('[role=checkbox],[role=radio],[role=switch]') || (el.closest('label') && el.closest('label').querySelector('input[type=checkbox],input[type=radio]'))))
                          || (el.querySelector && el.querySelector('input[type=checkbox],input[type=radio]'));
                        if (!box && el.tagName === 'LABEL' && el.control) box = el.control;
                        if (!box) return null;
                        return box.tagName === 'INPUT' ? !!box.checked : box.getAttribute('aria-checked') === 'true';
                      })(${Math.round(cx)}, ${Math.round(cy)})`).catch(() => null), 3000, null) as Promise<boolean | null>;
                      const before = await readState();
                      if (before === null) {
                        toolResult = { success: false, error: `@${action.ref} is not a checkbox/radio — use click_ref instead.` };
                      } else if (before === want) {
                        toolResult = { success: true, info: { already: want ? 'checked' : 'unchecked' } };
                      } else {
                        await window.electronAPI?.realClick?.(wcIdC, cx, cy, target.backendNodeId);
                        await new Promise(r => setTimeout(r, 300));
                        const after = await readState();
                        toolResult = after === want
                          ? { success: true, info: { now: want ? 'checked' : 'unchecked' } }
                          : { success: false, error: `Clicked @${action.ref} but it is still ${after ? 'checked' : 'unchecked'}.` };
                      }
                    }
                  } else if (action.type === 'list_files' || action.type === 'read_file') {
                    // Só pastas que a PESSOA liberou nesta sessão (diálogo do SO). Sem nenhuma: pergunta.
                    let grants = await window.electronAPI?.uploadGrants?.() ?? [];
                    if (!grants.length) {
                      const ok = await new Promise<boolean>((resolve) => onProgress({ kind: 'confirm', risk: 'files', label: 'folder access',
                        title: '📂 The agent wants to look for a file on your computer',
                        message: 'Allow ONE folder for this session (e.g. where your résumés are). The agent can list and read files only inside it, until you quit Bah or revoke it in the menu.',
                        yesLabel: '📂 Choose folder…', noLabel: 'Not now', onConfirm: () => resolve(true), onCancel: () => resolve(false) }));
                      throwIfCancelled();
                      if (ok) { await window.electronAPI?.uploadGrantFolder?.(); grants = await window.electronAPI?.uploadGrants?.() ?? []; }
                    }
                    if (!grants.length) toolResult = { success: false, error: 'The user did not allow a folder. Use upload without "file" so they pick the file themselves.' };
                    else if (action.type === 'list_files') {
                      const r = await window.electronAPI?.uploadListFiles?.();
                      const words = (action.query || '').toLowerCase().split(/\s+/).filter(Boolean);
                      const files = (r?.files || []).filter(f => !words.length || words.some(w => f.file.toLowerCase().includes(w)));
                      history += `\nFILES the user allowed (${grants.map(g => g.folder).join(', ')}) — ${files.length} shown:\n${files.slice(0, 150).map(f => `  ${f.file} (${Math.max(1, Math.round(f.size / 1024))} KB, ${f.modified})`).join('\n') || '  (no matching files)'}`;
                      toolResult = { success: true, info: { files: files.length } };
                    } else {
                      const r = await window.electronAPI?.uploadReadFile?.(action.file);
                      if (r?.ok) { history += `\nFILE ${action.file}:\n${r.text}`; toolResult = { success: true, info: { chars: r.text?.length || 0 } }; }
                      else toolResult = { success: false, error: r?.error || 'could not read the file' };
                    }
                  } else if (action.type === 'upload') {
                    // Arquivo SÓ do diálogo do SO, escolhido pela pessoa (ou reusado dela nesta tarefa).
                    const target = observation.interactive_elements.find(e => e.id === action.ref);
                    const wcIdUp = (wv as any).getWebContentsId?.();
                    if (!target || wcIdUp == null) {
                      toolResult = { success: false, error: `No element with ref @${action.ref} — re-observe the page.` };
                    } else {
                      const site = paceHostOf(wv.getURL()) || 'this site';
                      const field = (target.text || target.aria || 'upload field').slice(0, 60);
                      // Arquivo de uma pasta que a pessoa liberou nesta sessão: o agente escolhe, sem cartão.
                      let direct: { ok: boolean; token?: string; names?: string[]; error?: string } | null = null;
                      const wanted = ([] as string[]).concat((action.file as any) ?? []).map(String).filter(Boolean);
                      if (wanted.length) direct = await window.electronAPI?.uploadTokenFor?.(wanted) ?? null;
                      const choice = direct?.ok && direct.token ? direct.token : direct ? 'bad-file' : await new Promise<string>((resolve) => onProgress({ kind: 'confirm', risk: 'upload', label: 'upload',
                        title: `📎 The agent wants to upload a file to ${site}`,
                        message: `Field: "${field}". You choose the file in your own file dialog — the agent never picks files from your computer. Nothing is sent until the site's form is submitted.`,
                        choices: [
                          ...taskUploads.map(u => ({ label: `📎 Use ${u.names.join(', ').slice(0, 60)}`, value: u.token })),
                          { label: '📁 Choose file…', value: 'pick' }, { label: '📂 Allow a folder (this session)', value: 'folder' }, { label: 'Cancel', value: 'no' },
                        ],
                        onChoose: (v: string) => resolve(v), onConfirm: () => resolve('pick'), onCancel: () => resolve('no') }));
                      throwIfCancelled();
                      let token = !['pick', 'no', 'folder', 'bad-file'].includes(choice) ? choice : '';
                      let folderNote = '';
                      if (choice === 'folder') {
                        const g = await window.electronAPI?.uploadGrantFolder?.();
                        folderNote = g?.ok ? `The user allowed the folder "${g.folder}" for this session. Call list_files, pick the right file (read_file to compare), then upload again with "file".` : '';
                      }
                      if (choice === 'pick') {
                        const p = await window.electronAPI?.uploadPick?.({ multiple: !!action.multiple, title: `Upload to ${site}: ${field}` });
                        if (p?.ok && p.token) { token = p.token; taskUploads.push({ token, names: p.names || [] }); }
                      }
                      if (folderNote) toolResult = { success: true, info: { note: folderNote } };
                      else if (choice === 'bad-file') toolResult = { success: false, error: direct?.error || 'file not found' };
                      else if (!token) toolResult = { success: false, error: 'The user did not choose a file. Ask them (done with a question) or continue without the upload.' };
                      else {
                        const r = await window.electronAPI?.uploadSet?.(wcIdUp, target.backendNodeId ?? null, token, target.backendNodeId == null ? { x: target.x, y: target.y } : undefined);
                        toolResult = r?.ok
                          ? { success: true, info: { attached: r.names, note: `${(r.names || []).join(', ')} is attached to the field. Check the page shows it, then continue the form.${r.dropped ? ` (field takes one file; ${r.dropped} not attached)` : ''}` } }
                          : { success: false, error: r?.error || 'upload failed' };
                        if (r?.ok) onProgress({ kind: 'status', message: `📎 Attached ${(r.names || []).join(', ')}` });
                      }
                    }
                  } else if (action.type === 'select_option') {
                    // <select> nativo (ex.: SO/versão no site de driver): escolhe no nó via CDP.
                    const target = observation.interactive_elements.find(e => e.id === action.ref);
                    const wcIdSel = (wv as any).getWebContentsId?.();
                    if (!target) {
                      toolResult = { success: false, error: `No element with ref @${action.ref} — re-observe the page.` };
                    } else {
                      const beforeUrl = wv.getURL();
                      // Com nó da árvore de acessibilidade → CDP no próprio nó. Observação pelo DOM (sem
                      // backendNodeId) → acha o <select> na posição do elemento, na página.
                      const r = target.backendNodeId != null && wcIdSel != null
                        ? await window.electronAPI?.selectOption?.(wcIdSel, target.backendNodeId, action.option)
                        : await withTimeout(wv.executeJavaScript(`(function(x, y, want){
                            var el = document.elementFromPoint(x, y);
                            var sel = el && (el.tagName === 'SELECT' ? el : (el.closest && el.closest('select')) || (el.querySelector && el.querySelector('select')));
                            if (!sel) return { ok: false, error: 'not a <select> drop-down — click it, then click the option' };
                            var opts = Array.prototype.slice.call(sel.options);
                            var norm = function(s){ return String(s || '').trim().toLowerCase(); };
                            var w = norm(want);
                            var o = opts.find(function(x){ return norm(x.text) === w; }) || opts.find(function(x){ return norm(x.value) === w; })
                              || opts.find(function(x){ return norm(x.text).indexOf(w) >= 0; }) || opts.find(function(x){ return w.indexOf(norm(x.text)) >= 0 && norm(x.text).length > 2; });
                            var list = opts.map(function(x){ return x.text.trim(); }).filter(Boolean).slice(0, 40);
                            if (!o) return { ok: false, error: 'no option matching "' + want + '"', options: list };
                            sel.focus(); sel.value = o.value; o.selected = true;
                            sel.dispatchEvent(new Event('input', { bubbles: true }));
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                            return { ok: true, selected: o.text.trim(), options: list };
                          })(${Math.round(target.x)}, ${Math.round(target.y)}, ${JSON.stringify(action.option)})`).catch((e: any) => ({ ok: false, error: String(e?.message || e) })),
                          5000, { ok: false, error: 'page did not respond' }) as any;
                      if (r?.ok) {
                        await waitForWebviewSettled(wv, beforeUrl);   // muitos combos recarregam a página/lista
                        toolResult = { success: true, info: { selected: r.selected } };
                        history += `\nSELECTED "${r.selected}" in drop-down @${action.ref}.`;
                      } else {
                        toolResult = { success: false, error: `${r?.error || 'select failed'}${r?.options?.length ? ` — available options: ${r.options.map((o: string) => `"${o}"`).join(', ')}` : ''}` };
                      }
                    }
                  } else if (action.type === 'get_html') {
                    // Estrutura da página (HTML limpo) quando a lista de elementos é ambígua. Leitura passiva: o
                    // main carimba o [N] da lista num atributo com nonce (o script lê e apaga), o script anda no
                    // DOM pelo mesmo executeJavaScript do extract_text (recua pro mundo isolado em página sem
                    // script) e a limpeza/segredos/corte ficam em shared/html-clean.ts.
                    onProgress({ kind: 'status', message: t('feed.readingSource') });
                    const wcIdH = (wv as any).getWebContentsId?.();
                    const refAttr = `data-bah-ref-${Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('')}`;
                    if (wcIdH != null && humanCheckFlag(wv)?.kind !== 'captcha' && window.electronAPI?.markRefs) {
                      const marks = observation.interactive_elements.filter(e => !e.frameNode && !e.frame)
                        .map(e => (e.backendNodeId != null ? { ref: e.id, backendNodeId: e.backendNodeId } : { ref: e.id, x: e.x, y: e.y }));
                      await withTimeout(window.electronAPI.markRefs(wcIdH, refAttr, marks).catch(() => null), 4000, null);
                    }
                    const got = await withTimeout(wv.executeJavaScript(collectHtmlScript(action.selector || '', refAttr))
                      .catch((e: any) => ({ ok: false, error: String(e?.message || e) })), 6000, null) as CollectResult | null;
                    if (got == null) toolResult = { success: false, error: 'get_html timed out — page scripts are unresponsive. Use the element list / OCR TEXT instead.' };
                    else if (!got.ok && (got.notFound || got.invalid)) toolResult = { success: false, error: selectorNotFoundMessage(action.selector || '', got.candidates, got.invalid) };
                    else if (!got.ok || !got.tree) toolResult = { success: false, error: got.error || 'get_html could not read the page' };
                    else {
                      // Tamanho da leitura: o padrão (6000 local / 12000 janela grande) ou o `max` pedido, até o
                      // orçamento do contexto livre (shared/read-paging.ts). offset pagina o HTML limpo.
                      const rm = resolveReadMax(action.max, readBudgetNow());
                      const ser = serializeHtml(got.tree, { max: rm.max, offset: action.offset, cut: got.cut, selector: action.selector, askedMax: action.max, capped: rm.capped ? rm.max : undefined });
                      const where = action.selector ? `"${action.selector}"` : 'the page body';
                      if (ser.page.pastEnd) toolResult = { success: false, error: pastEndMessage({ tool: 'get_html', page: ser.page, walkCut: got.cut }) };
                      else {
                        pendingReads.push(pageHtmlBlock(where, wv.getURL(), ser.html, ser.range).trim());
                        const next = ser.page.more ? ` More: ${nextCall('get_html', { selector: action.selector, max: rm.capped ? undefined : action.max }, ser.page.end)}.` : '';
                        history += `\nGET_HTML ${where}: ${ser.range}${rm.capped ? ` (capped at ${rm.max} by the model's free context)` : ''} — shown once in the PAGE HTML block of the next step; act on its [#N] refs with click_ref/fill_ref.${next}`;
                        toolResult = { success: true, info: { chars: ser.page.text.length, from: ser.page.start, to: ser.page.end, total: ser.total, more: ser.page.more } };
                      }
                    }
                  } else if (action.type === 'dialog') {
                    // Arma a resposta do PRÓXIMO alert/confirm desta aba (vale 60 s).
                    let wcIdDlg: number | undefined;
                    try { wcIdDlg = (wv as any).getWebContentsId?.(); } catch {}
                    agentDialogsTab(wcIdDlg);
                    if (wcIdDlg != null) {
                      armDialog(wcIdDlg, action.accept, action.text);
                      toolResult = { success: true, info: { armed: action.accept ? `accept${action.text != null ? ` with "${action.text}"` : ''}` : 'dismiss', note: 'Now do the action that opens the dialog.' } };
                    } else toolResult = { success: false, error: 'The tab is not ready yet; try again after the page loads.' };
                  } else if (action.type === 'wait' && (action.text || action.gone || action.url || action.load)) {
                    // Espera por CONDIÇÃO (texto aparece/some, URL, carregamento) — termina assim que for verdade.
                    const cap = Math.min(Math.max(Number(action.timeout) || 15_000, 1000), 60_000);
                    const t0 = Date.now();
                    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ');
                    const urlOk = (u: string) => {
                      const want = action.url!;
                      if (!want.includes('*')) return u.includes(want);
                      const re = new RegExp('^' + want.split('**').map(p => p.split('*').map(q => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
                      return re.test(u) || re.test(u.replace(/^https?:\/\/[^/]+/, ''));
                    };
                    let met = false, why = '';
                    if (action.load === 'networkidle' && wcId != null) {
                      const r = await window.electronAPI?.waitNetworkIdle?.(wcId, 500, cap);
                      met = !!r?.ok; why = r?.error || '';
                    } else {
                      while (Date.now() - t0 < cap) {
                        throwIfCancelled();
                        const body = action.text || action.gone
                          ? norm(String(await withTimeout(wv.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => ''), 3000, '')))
                          : '';
                        met = (!action.text || body.includes(norm(action.text)))
                          && (!action.gone || !body.includes(norm(action.gone)))
                          && (!action.url || urlOk(wv.getURL()))
                          && (action.load !== 'load' || !wv.isLoading());
                        if (met) break;
                        await new Promise(r => setTimeout(r, 300));
                      }
                    }
                    const what = action.text ? `text "${action.text}"` : action.gone ? `"${action.gone}" to disappear` : action.url ? `URL ${action.url}` : `page ${action.load}`;
                    toolResult = met ? { success: true, info: { waitedFor: what, waitedMs: Date.now() - t0 } }
                      : { success: false, error: `Waited ${Math.round((Date.now() - t0) / 1000)}s for ${what} — not yet.${why ? ' ' + why : ''} Re-check the page; it may need another action.` };
                  } else if (action.type === 'wait' && !action.selector) {
                    // `wait` simples não toca a página: dorme aqui (máx. 60s). Antes passava pelo
                    // teto de 12s das ações de página → wait(15000) "dava timeout" com a mensagem
                    // "page scripts are unresponsive" e o modelo abandonava uma página saudável.
                    // Termina antes se um download desta tarefa acabar (completou/falhou).
                    const watched = [...agentDlIdsRef.current].filter(k => {
                      const st = dlLatestRef.current.get(k)?.state;
                      return st === 'started' || st === 'progress' || st === 'queued';
                    });
                    // Com download desta tarefa rodando, o wait é paciente: dura até o download acabar
                    // ou ETA+10s (máx. 60s), mesmo que o modelo peça 5s — senão ele espera picado e
                    // conclui que "esperar não adianta".
                    const etas = watched.map(k => dlLatestRef.current.get(k)?.etaSec).filter((e): e is number => typeof e === 'number');
                    const patientMs = watched.length ? (etas.length ? Math.max(...etas) * 1000 + 10_000 : 60_000) : 0;
                    const ms = Math.min(Math.max(Number(action.ms) || 1000, patientMs, 0), 60_000);
                    const t0 = Date.now();
                    let endedBy: string | null = null;
                    while (Date.now() - t0 < ms) {
                      await new Promise(r => setTimeout(r, 250));
                      throwIfCancelled();
                      const fin = watched.map(k => dlLatestRef.current.get(k)).find(d => d && (d.state === 'completed' || d.state === 'failed'));
                      if (fin) { endedBy = `${fin.filename} ${fin.state}`; break; }
                    }
                    toolResult = { success: true, info: { waitedMs: Date.now() - t0, ...(endedBy ? { endedEarly: `download ${endedBy}` } : {}) } };
                  } else if ((action.type === 'save_pdf' || action.type === 'screenshot') && wcId != null) {
                    const r = action.type === 'save_pdf' ? await window.electronAPI?.savePdf?.(wcId, action.name) : await window.electronAPI?.pageScreenshot?.(wcId, action.full !== false, action.name);
                    toolResult = r ?? { success: false, error: 'not available' };
                    if (r?.success) onProgress({ kind: 'status', message: `💾 Saved ${r.info.path}` });
                  } else if (action.type === 'clipboard') {
                    // Escrever é livre (o agente entregando um resultado). Ler o que a PESSOA copiou passa pela
                    // permissão 'clipboard' (perguntar / sempre / nunca — menu ou resposta na pergunta).
                    if (action.write != null) toolResult = await window.electronAPI?.clipboardWriteText?.(action.write);
                    else if (!(await askPermission('clipboard', 'Read the text you last copied (clipboard).'))) toolResult = { success: false, error: 'The user did not allow reading their clipboard.' };
                    else { const txt = await window.electronAPI?.clipboardReadText?.() ?? ''; history += `\nCLIPBOARD (what the user copied): ${txt || '(empty)'}`; toolResult = { success: true, info: { chars: txt.length } }; }
                  } else if (action.type === 'list_downloads') {
                    // A fila do painel de Downloads (Cmd/Ctrl+J), como o agente precisa: id pra
                    // controlar, estado, progresso, caminho e quem começou.
                    const all = downloadsRef.current;
                    const isActive = (d: { state: string }) => d.state === 'started' || d.state === 'progress' || d.state === 'queued';
                    const rows = [...all.filter(isActive), ...all.filter(d => !isActive(d))].slice(0, 20).map(d => {
                      const key = d.id || d.path || d.filename;
                      const st = d.state === 'queued' ? 'QUEUED' : d.paused ? 'PAUSED' : d.stalled && isActive(d) ? 'STALLED' : isActive(d) ? 'DOWNLOADING'
                        : d.state === 'failed' && d.reasonCode ? `FAILED (${d.reasonCode})` : d.state.toUpperCase();
                      const pct = d.totalBytes ? ` ${Math.floor(((d.bytes || 0) / d.totalBytes) * 100)}%,` : '';
                      const size = ` ${fmtSize(d.bytes) || '0 B'}${d.totalBytes ? ' of ' + fmtSize(d.totalBytes) : ''}`;
                      const live = isActive(d) && !d.paused ? `${d.speedBps ? ', ' + fmtSpeed(d.speedBps) : ''}${d.etaSec != null ? ', ETA ' + fmtEta(d.etaSec) : ''}` : '';
                      const who = agentDlIdsRef.current.has(key) ? 'agent' : 'user';
                      return `  [${d.id || '-'}] ${d.filename} — ${st}${pct}${size}${live}${d.path ? ' → ' + d.path : ''} (started by ${who}${d.kind === 'video' ? ', video' : ''})`;
                    });
                    const active = all.filter(isActive).length;
                    history += `\nDOWNLOADS LIST (${active} active, ${all.length} total; use the [id] with cancel_download / pause_download / resume_download / retry_download):\n${rows.length ? rows.join('\n') : '  (no downloads)'}`;
                    onProgress({ kind: 'status', message: `📥 Downloads: ${active} active, ${all.length} total` });
                    toolResult = { success: true, info: { active, total: all.length } };
                  } else if (action.type === 'cancel_download' || action.type === 'pause_download' || action.type === 'resume_download' || action.type === 'retry_download') {
                    // Acha por id exato, senão pelo nome do arquivo (preferindo o ativo).
                    const all = downloadsRef.current;
                    const q = action.id.toLowerCase();
                    const isActive = (d: { state: string }) => d.state === 'started' || d.state === 'progress' || d.state === 'queued';
                    const byName = all.filter(d => (d.filename || '').toLowerCase().includes(q));
                    const d = all.find(x => (x.id || '').toLowerCase() === q) || byName.find(isActive) || byName[0];
                    const verb = action.type.replace('_download', '');
                    if (!d || !d.id) {
                      toolResult = { success: false, error: `No download matches "${action.id}". Call list_downloads to see the ids.` };
                    } else if (action.type === 'cancel_download' && !isActive(d)) {
                      toolResult = { success: false, error: `${d.filename} is not active (${d.state}) — nothing to cancel.` };
                    } else if ((action.type === 'pause_download' || action.type === 'resume_download') && (d.kind === 'video' || d.kind === 'agent')) {
                      toolResult = { success: false, error: `${d.filename} cannot be paused/resumed (${d.kind} download) — only cancelled.` };
                    } else if (action.type === 'retry_download' && d.state !== 'failed' && d.state !== 'cancelled') {
                      toolResult = { success: false, error: `${d.filename} is ${d.state} — only failed or cancelled downloads can be retried.` };
                    } else {
                      // Cancelar um download que a PESSOA começou passa pelo freio de segurança.
                      const mine = agentDlIdsRef.current.has(d.id);
                      let allowed = true;
                      if (action.type === 'cancel_download' && !mine) {
                        allowed = await confirmRisky({ kind: 'a download you started', label: `cancel ${d.filename}` });
                        throwIfCancelled();
                      }
                      if (!allowed) {
                        toolResult = { success: false, reason: 'user_cancelled', error: `You declined — ${d.filename} keeps downloading.` };
                      } else {
                        const api = window.electronAPI;
                        if (action.type === 'cancel_download') agentCancelledRef.current.add(d.id);
                        const r: any = action.type === 'cancel_download'
                          ? (d.kind === 'video' ? await api?.cancelVideoDownload?.(d.id) : await api?.cancelDownload?.(d.id))
                          : action.type === 'pause_download' ? await api?.pauseDownload?.(d.id)
                          : action.type === 'resume_download' ? await api?.resumeDownload?.(d.id)
                          : (d.kind === 'video' ? await api?.retryVideoDownload?.(d.id) : await api?.retryDownload?.(d.id, d.url));
                        const ok = r?.ok !== false && r?.success !== false;
                        toolResult = ok ? { success: true, info: { [verb]: d.filename, id: d.id } } : { success: false, error: `Could not ${verb} ${d.filename}.` };
                        if (ok) {
                          history += `\nDOWNLOAD ${verb.toUpperCase()}: ${d.filename} [${d.id}].`;
                          onProgress({ kind: 'status', message: `📥 ${verb}: ${d.filename}` });
                        }
                      }
                    }
                  } else {
                    // FREIO unificado: QUALQUER ação de risco que chega aqui pede confirmação —
                    // inclui o `fill`/`fill_ref` (dado de cartão), que antes escapava porque o
                    // gate só checava `press`. riskForAction devolve null pra ação inofensiva,
                    // então o caminho normal (scroll/click/fill comum) não muda.
                    const riskCancel = await gateRisk(riskForAction(action as any, undefined, wv.getURL?.() || '', riskOpts));
                    // Bounded: on hung pages any executeJavaScript-based action (scroll,
                    // click_text fallback, fill...) would otherwise never resolve.
                    toolResult = riskCancel ?? await withTimeout(executeBrowserAction(wv, action),
                      action.type === 'wait' ? Math.min(Number(action.timeout) || 5000, 60_000) + 3000 : 12000,
                      { success: false, error: `${action.type} timed out — page scripts are unresponsive. Use OCR TEXT or navigate to a DIFFERENT site.` });
                  }
                  // Carrinho: digitou o próximo item no campo de busca da loja → Bah aperta Enter. O modelo pequeno
                  // digitava "bagels" e clicava o Add de um produto da busca ANTERIOR (ainda na tela).
                  if (commandIsCart && action.type === 'fill_ref' && toolResult?.success !== false && String((action as any).value || '').trim()
                    && action.ref === searchBoxRef(observation.interactive_elements)) {
                    const wcIdS = (wv as any).getWebContentsId?.();
                    if (wcIdS != null) {
                      try { await window.electronAPI?.realKey?.(wcIdS, 'Enter'); } catch {}
                      history += `\nBAH PRESSED ENTER: the search for "${String((action as any).value).slice(0, 60)}" was submitted for you.`;
                    }
                  }
                  // Internal actions (plan/store/extract_text) never change the page — skip the
                  // settle + re-observe machinery (10-20s on heavy pages) and reuse the current state.
                  const pageNeutralAction = action.type === 'plan' || action.type === 'store' || action.type === 'extract_text'
                    || action.type === 'look_at' || action.type === 'web_search' || action.type === 'history_search' || action.type === 'list_files' || action.type === 'read_file' || action.type === 'dialog' || action.type === 'get' || action.type === 'get_html' || action.type === 'save_pdf' || action.type === 'screenshot' || action.type === 'clipboard'
                    || action.type === 'list_downloads' || action.type === 'cancel_download' || action.type === 'pause_download' || action.type === 'resume_download' || action.type === 'retry_download'
                    || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'generate_image' || action.type === 'download' || action.type === 'download_video'
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
                  // Dado da tarefa (store/plan/report) não vira "como usar o site" — ver isTaskDataAction.
                  if (!isTaskDataAction(action.type)) rememberActionForSite({
                    actionType: action.type,
                    success: toolResult?.success !== false,
                    url: afterObservation.url,
                    title: afterObservation.title,
                    element: targetForMemory,
                    note: formatAction(action),
                  });
                  // Internal-state actions (plan/store/extract) don't change the page — don't penalize them
                  const internalAction = action.type === 'plan' || action.type === 'store' || action.type === 'extract_text'
                    || action.type === 'look_at' || action.type === 'find' || action.type === 'web_search' || action.type === 'history_search' || action.type === 'list_files' || action.type === 'read_file' || action.type === 'dialog' || action.type === 'get' || action.type === 'get_html' || action.type === 'save_pdf' || action.type === 'screenshot' || action.type === 'clipboard'
                    || action.type === 'list_downloads' || action.type === 'cancel_download' || action.type === 'pause_download' || action.type === 'resume_download' || action.type === 'retry_download'
                    || action.type === 'extract_images' || action.type === 'search_images' || action.type === 'harvest_images' || action.type === 'generate_image' || action.type === 'download' || action.type === 'download_video'
                    || action.type === 'read_aloud' || action.type === 'wait';
                  if (internalAction) {
                    // keep noEffectCount unchanged
                  } else {
                    noEffectCount = hadVisibleEffect ? 0 : noEffectCount + 1;
                  }
                  previousStateKey = stateKeyAfter;
                  // Carry the post-action observation into the next step (consumed there if the URL still matches).
                  carriedObservation = afterObservation;
                  lastActionSummary = formatAction(action).slice(0, 120);
                  lastActionOutcome = (hadVisibleEffect
                    ? `page changed: ${afterObservation.title || afterObservation.url}`
                    : 'page did not change') + (afterObservation.text_sample
                    ? ` | text: ${String(afterObservation.text_sample).slice(0, 90)}` : '');
                  // Reuse is only safe when nothing moved: a stale frame makes the model aim at
                  // pixels that are no longer there.
                  if (stateKeyAfter === stateKeyBefore && shotForModel) {
                    carriedShot = shotForModel;
                    carriedThumb = screenshotAfter;
                    carriedPng = framePngForOcr;
                  } else {
                    carriedShot = undefined;
                    carriedThumb = undefined;
                    carriedPng = undefined;
                  }
                  // Site-initiated downloads triggered by this action (clicking a "baixar"
                  // button fires will-download; the page itself doesn't change). Tell the AI
                  // the click WORKED so it doesn't repeat it, and clear the no-effect penalty.
                  // Um passo pode juntar vários ticks de progresso: só o ÚLTIMO de cada download entra —
                  // várias linhas "ainda não terminou" deixavam o modelo achar que nada andava.
                  // O "download começou" chega DEPOIS do clique voltar (o Chromium só avisa quando o servidor
                  // responde). Numa tarefa de download, um clique espera até 2,5 s por ele — senão o passo seguinte
                  // já roda sem saber do download (e a tarefa nem acaba quando ele começa, nem espera por ele).
                  if (commandWantsDownload && downloadEventsRef.current.length === 0
                      && (action.type === 'click_ref' || action.type === 'click_text' || action.type === 'click_at' || action.type === 'click_role' || action.type === 'navigate')) {
                    for (let w = 0; w < 25 && downloadEventsRef.current.length === 0; w++) await new Promise(r => setTimeout(r, 100));
                  }
                  const dlEvents = (() => {
                    const all = downloadEventsRef.current.splice(0);
                    const lastProg = new Map<string, number>();
                    all.forEach((d, i) => { if (d.state === 'progress' && !d.stalled) lastProg.set(d.id || d.path || d.filename, i); });
                    return all.filter((d, i) => d.state !== 'progress' || d.stalled || lastProg.get(d.id || d.path || d.filename) === i);
                  })();
                  if (dlEvents.length > 0) {
                    for (const d of dlEvents) {
                      const latest = dlLatestRef.current.get(d.id || d.path || d.filename) as any;
                      const prevTask = latest && (latest.startedAt ?? 0) < taskStartedAt ? ' (from a PREVIOUS task — not this request)' : '';
                      // Arquivo errado pra esta máquina, ou baixado de agregador de "free download" (não do fabricante).
                      const dlFrom = d.state === 'started' && commandWantsDownload ? thirdPartyDownloadSite(String((d as any).url || '')) || thirdPartyDownloadSite(observation.url) : '';
                      const osNote = (d.state === 'started' || d.state === 'completed' ? wrongOsNote(d.filename) : '') + (dlFrom ? ' ' + thirdPartyNote(dlFrom) : '');
                      const of = `${fmtSize(d.bytes) || '0 B'}${d.totalBytes ? ' of ' + fmtSize(d.totalBytes) : ''}`;
                      const line = d.state === 'completed'
                        ? `DOWNLOAD COMPLETED: ${d.filename} (${fmtSize(d.bytes)}) saved at ${d.path || 'the Downloads folder'} — the file is ready to use at that path. This is SUCCESS — do not download it again.`
                        : d.state === 'progress' && d.stalled
                        ? `DOWNLOAD STALLED: ${d.filename} — no data for ${d.stalledForSec || 15}s at ${of}. It is aborted after 60s without data; you may wait, or retry/try another source.`
                        : d.state === 'progress'
                        ? `DOWNLOAD PROGRESS: ${d.filename} — ${d.totalBytes ? Math.floor(((d.bytes || 0) / d.totalBytes) * 100) + '%, ' : ''}${of}${d.speedBps ? ', ' + fmtSpeed(d.speedBps) : ''}${d.etaSec != null ? ', ETA ' + fmtEta(d.etaSec) : ''}. Downloading normally in the background — ${downloadIsLastStep ? 'if this is what the user asked for, finish with done now (say it is downloading)' : 'Bah waits for it to complete before your next step'}; do NOT start another copy or look for another source.`
                        : d.state === 'duplicate'
                        ? `DOWNLOAD NOT STARTED (duplicate): ${d.filename} is ALREADY downloading — the second copy was refused. The first one continues in the background${downloadIsLastStep ? ': finish with done saying it is downloading' : ' and Bah waits for it'}.`
                        : d.state === 'failed' && d.stalled
                        ? `DOWNLOAD FAILED (stalled): ${d.filename} — the server stopped sending data after ${of}; the partial file was removed. Retry once, or try another mirror/source.`
                        : d.state === 'failed'
                        ? `DOWNLOAD FAILED: ${d.filename}${d.reason ? ' — ' + d.reason : ''} — try another link/source.`
                        : d.state === 'cancelled'
                        ? (d.id && agentCancelledRef.current.has(d.id)
                          ? `DOWNLOAD CANCELLED (by your cancel_download): ${d.filename}; the partial file was removed.`
                          : `DOWNLOAD CANCELLED by the user: ${d.filename}. Do not restart it unless asked.`)
                        : `DOWNLOAD STARTED (in progress — NOT finished yet): ${d.filename}${d.totalBytes ? ' (' + fmtSize(d.totalBytes) + ')' : ''}${d.path ? ' → ' + d.path : ''}. It downloads in the background. ${downloadIsLastStep ? 'If this is the file the user asked for, the task is DONE: finish with done saying it is DOWNLOADING (not downloaded) — the user follows it on the download button.' : 'Bah waits for it to COMPLETE before your next step; the rest of the request continues after DOWNLOAD COMPLETED.'}`;
                      history += `\n${prevTask ? line.replace(/^(DOWNLOAD [A-Z ()_]+?):/, `$1${prevTask}:`) : line}${osNote}`;
                      onProgress({ kind: 'status', message: `💾 ${line.slice(0, 140)}${isWrongBuild(d.filename) ? ' ⚠️ ' + t('dl.wrongBuild') : dlFrom ? ' ⚠️ ' + t('dl.thirdParty') : ''}` });
                    }
                    if (dlEvents.some(d => d.state === 'completed' || d.state === 'started')) noEffectCount = 0;
                    // O download que a pessoa pediu COMEÇOU → a tarefa acabou: avisa que está baixando e encerra.
                    // O resto (progresso, fim) aparece no botão de downloads — não segura o painel "trabalhando".
                    // Fica de fora: pedido de VÁRIOS arquivos, arquivo do SO/processador errado e download parado.
                    if (downloadIsLastStep && actionQueue.length === 0) {
                      const started = dlEvents.find(d => (d.state === 'started' || (d.state === 'progress' && !d.stalled))
                        && ((dlLatestRef.current.get(d.id || d.path || d.filename) as any)?.startedAt ?? 0) >= taskStartedAt
                        && !wrongOsNote(d.filename));
                      if (started) {
                        const size = started.totalBytes ? ` (${fmtSize(started.totalBytes)})` : '';
                        const msg = `⬇️ Downloading ${started.filename}${size} to ${started.path ? started.path.split(/[\\/]/).slice(0, -1).join('/') || 'Downloads' : 'Downloads'} — follow its progress on the download button.`;
                        onProgress({ kind: 'status', message: msg });
                        finishRun('success', msg);
                        return { thought: thoughts.join('\n\n') || msg, results: allResults, done: { type: 'done', reason: msg, success: true } as BrowserAction };
                      }
                    } else if (commandWantsDownload && !downloadIsLastStep) {
                      // Pedido continua depois do download (ou são vários): o BAH espera todos os downloads desta
                      // tarefa (sem gastar chamada de modelo), mostrando o que espera; o modelo só volta com as
                      // linhas DOWNLOAD COMPLETED — assim o próximo passo sabe que o arquivo existe e onde está.
                      const mine = () => [...agentDlIdsRef.current].map(k => dlLatestRef.current.get(k) as any)
                        .filter(d => !!d && (d.startedAt ?? 0) >= taskStartedAt);
                      const running = () => mine().filter(d => (d.state === 'started' || d.state === 'progress' || d.state === 'queued') && !d.stalled);
                      if (running().length) {
                        deadline.suspend();   // esperar download não é o modelo demorando
                        try {
                          while (running().length) {
                            throwIfCancelled();
                            const parts = mine().map(d => d.state === 'completed' ? `${d.filename} ✓`
                              : `${d.filename}${d.totalBytes ? ' ' + Math.floor(((d.bytes || 0) / d.totalBytes) * 100) + '%' : ''}${d.etaSec != null ? ` (ETA ${fmtEta(d.etaSec)})` : ''}`);
                            onProgress({ kind: 'status', message: `⏳ Waiting for downloads: ${parts.join(', ')}` });
                            await new Promise(r => setTimeout(r, 2000));
                          }
                        } finally { deadline.resume(); }
                        for (const d of mine()) {
                          history += d.state === 'completed'
                            ? `\nDOWNLOAD COMPLETED: ${d.filename} (${fmtSize(d.bytes)}) saved at ${d.path || 'the Downloads folder'} — the file is ready; continue with the rest of the request.`
                            : `\nDOWNLOAD ${String(d.state).toUpperCase()}${d.stalled ? ' (stalled)' : ''}: ${d.filename}${d.reason ? ' — ' + d.reason : ''}`;
                        }
                        noEffectCount = 0;
                      }
                    }
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
                  // Coleção sem lista guardada: o modelo pequeno ficava navegando em rankings/Wikipedia (20 min no "top 3 do
                  // Michael Jackson") e nunca entregava a lista pro Bah baixar. A partir do passo 4, a cada 3, cobra o store.
                  if (step >= 4 && step % 3 === 1 && isMediaCollectionRequest(command) && !memory.some(m => m.key === 'tracks' || listItems(m.value).length >= 2)) {
                    history += '\nCOLLECTION: stop browsing. Store the list NOW from what you already know or saw: {"action":"store","key":"tracks","value":["Title — Artist", …]} (as many entries as the user asked for). Bah then downloads each one itself.';
                  }

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
                    commandWantsDownload,
                    cartTask: commandIsCart,
                    brakeAsked: brakeAskedThisStep,
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
                    // O "input" do par (observação → ação): o que o agente viu pra escolher.
                    observation: { url: observation.url, title: observation.title, elements: observation.interactive_elements },
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
                        // Checagem humana / login → Watch/Takeover; já passou por ela neste site (pulada/expirou) → segue
                        // com a instrução de recuperação no histórico, sem perguntar de novo.
                        if (kind !== 'paywall') {
                          const humanKind: HumanCheckKind = kind === 'captcha' ? 'captcha' : 'signin';
                          const host = paceHostOf(afterObservation.url) || 'this site';
                          if (!handedOffSites.has(`${humanKind}:${host}`) && humanHandoffs < 6) {
                            humanHandoffs++;
                            const after = await classifyWebview(wv as any);
                            if (humanKind === 'captcha') setHumanCheckFlag(wv, after.verdict?.kind === 'captcha' ? after.verdict : null);
                            await humanHandoff({
                              kind,
                              reason: recoveryVerdict.reason,
                              instruction: kind === 'captcha' ? t('takeover.instruction') : 'Sign in yourself in this tab: click the username field to pick a login saved in Bah\'s password manager, or type it. Bah continues by itself once you are signed in. (I never see your password.)',
                            }, humanKind, wv, { url: afterObservation.url, verdict: after.verdict?.kind === humanKind ? after.verdict : null });
                          }
                          continue;
                        }
                        await waitForManualHelp({
                          kind,
                          reason: recoveryVerdict.reason,
                          instruction: 'If you have access, sign in manually. Then click Continue so I can try to take it from here.',
                        }, afterObservation.url);
                        continue;
                      }
                      const done: BrowserAction = { type: 'done', success: false, reason: recoveryVerdict.reason };
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
                finishRun('max_steps', 'Step limit reached');
                // Bater o limite de passos é FALHA, não conclusão: devolve error (a barra mostra
                // como problema, sem o sino de "pronto"), em vez de um thought que parece relatório.
                return { thought: thoughts.join('\n\n'), results: allResults, error: "I couldn't finish this within the step limit. Try rephrasing it, or break it into smaller steps." };
              } catch (err: any) {
                if (err?.message === 'TASK_CANCELLED_BY_USER') {
                  const done: BrowserAction = { type: 'done', success: false, reason: 'Task canceled by the user.' };
                  finishRun('cancelled', done.reason);
                  return { thought: done.reason, results: allResults, done };
                }
                // `??` NÃO pega string vazia: um Error com message '' virava falha muda.
                finishRun('failed', String(err?.message || err || '').trim() || 'Unexpected error while running the task.');
                throw err;
              } finally {
                deadline.clear();
                setAgentVisual('idle');
              }
              } finally {
                // tarefa acabou (sucesso, erro OU cancelamento): solta o freio e a aba do
                // agente volta a seguir a aba que o usuário está vendo agora.
                taskRunningRef.current = false;
                agentBusyTabsRef.current.delete(taskTabId);
                agentDialogsStop();
                taskEndedAtRef.current = Date.now();
                for (const t of tabsRef.current) if (t.agentTask) store.updateTab(t.id, { agentTask: false });
                if (privateTaskRef.current) { privateTaskRef.current = false; window.electronAPI?.setPrivateAi?.(false); }
                // O que chegou depois do último passo (a IA já tinha decidido terminar) fica na
                // fila: a barra pega e roda como o próximo pedido — mensagem nunca some.
                interjectRef.current = { running: false, queue: interjectRef.current.queue, abortStep: null };
                activeTabIdRef.current = userTabRef.current;
                // Devolve o bypass pro humano (player do YouTube volta a funcionar).
                try { await window.electronAPI?.adblockSetAgentBusy?.(false); } catch {}
              }
            }}
            onSendChat={async (msg, docText, streamId, skipPageContext, docIsFile) => {
              const chatTabId = store.threadKeyOf(store.activeTabId);   // a conversa pertence à SESSÃO desta aba (ou a ela, sem sessão)
              // A thread da sessão (a mesma que o agente lê), já no orçamento. Quem grava a troca nela é o
              // AgentCommandBar, depois da resposta.
              const threadText = threadPromptBlock(chatTabId);
              const threadTok = estimateThreadTokens(threadText);
              const noteChatUsage = (r: { ctx?: { system: number } } | undefined, pageText: string, cap = 8000) => {
                // O main corta o contexto da página em 8000 caracteres (o documento em 24000): a página cede, a thread nunca.
                if (pageText.length > cap) noteThreadTrimmed(chatTabId, `chat:${store.activeTab?.url || ''}`);
                noteContextUsage(chatTabId, {
                  window: contextWindowNow(),
                  parts: { instructions: (r?.ctx?.system || 0) + estimateThreadTokens(msg), thread: threadTok, page: estimateThreadTokens(pageText.slice(0, cap)) },
                });
              };
              // Document attached → the question is about the FILE: use its extracted text
              // as context (skip the page/transcript) and answer with the selected model.
              if (docText) {
                // docText = self-contained doc context (rawContext). Non-stateless so the doc
                // stays in THIS tab's history → follow-up questions still work after the chip clears.
                // keepDoc: um ARQUIVO anexado fica lembrado pelo main pras perguntas seguintes (não cabe na thread);
                // o resumo da última tarefa (pergunta sobre ela) não.
                const r = await window.electronAPI?.aiChat(msg, '', false, store.localSettings.enabled, chatTabId, docText, streamId, undefined, { text: threadText, keepDoc: !!docIsFile });
                noteChatUsage(r, docText, 24000);
                const reply = (r?.response || '').trim() || (r?.error ? `Error: ${r.error}` : 'No response.');
                return { reply, isError: !!r?.error };
              }
              // Usuário desligou o chip "lendo esta página" → pergunta genérica, sem a aba
              // junto (evita a página sequestrar a resposta e não gasta token com ela).
              let pageContent = skipPageContext ? '' : await getPageContent();
              // Se a aba é um vídeo do YouTube, anexa a TRANSCRIÇÃO (legenda) ao contexto pra
              // a IA conversar sobre o que é DITO, não só título/descrição. Cache por vídeo.
              const vid = skipPageContext ? null : youtubeWatchId(store.activeTab.url);
              if (vid && window.electronAPI?.getTranscript) {
                let tr = transcriptCacheRef.current.get(vid);
                if (tr === undefined) {
                  const r = await window.electronAPI.getTranscript(store.activeTab.url).catch(() => null);
                  tr = (r && r.ok && r.text) ? r.text : '';
                  transcriptCacheRef.current.set(vid, tr);
                }
                if (tr) pageContent += `\n\n[TRANSCRIÇÃO/LEGENDA DO VÍDEO ATUAL — use isto pra responder sobre o que é DITO no vídeo]\n${tr}`;
              }
              const chatShotDec = decideChatShot({
                // Vision is a local-endpoint setting; the cloud engine would refuse the frame.
                mode: store.localSettings.enabled ? resolveVisionMode(store.localSettings) : 'off',
                message: msg,
                pageTextLen: (pageContent || '').length,
                hasDoc: false,
                provider: store.localSettings.enabled
                  ? (store.localSettings.provider === 'ollama' ? 'ollama' : 'openai-compatible')
                  : store.aiSettings.provider,
              });
              let chatShot: VisionImage | undefined;
              if (chatShotDec.attach) {
                const fr = await captureFrame({ image: true, png: false });
                chatShot = fr?.image;
                if (!chatShot) console.log(`[chat] vision skipped: ${chatShotDec.reason} (capture failed)`);
              }
              const result = await window.electronAPI?.aiChat(msg, pageContent, undefined, store.localSettings.enabled, chatTabId, undefined, streamId, chatShot, threadText);
              noteChatUsage(result, pageContent || '');
              const raw = result?.response ?? (result?.error ? `Error: ${result.error}` : 'No response.');
              // Caixa unificada: o modo resposta pode propor uma ação numa linha
              // [[ACTION: ...]]. Extraímos a proposta e a removemos do texto exibido —
              // ela vira o botão "⚡ Fazer isso" (e um "sim" do usuário também a executa).
              // IMPORTANTE: a proposta é lida SÓ da resposta (fora do <think>…</think>) —
              // um modelo de raciocínio divagando "[[ACTION:…]]" no pensamento não vira botão.
              const answerOnly = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '');
              const m = answerOnly.match(/\[\[\s*ACTION\s*:\s*([^\]]+?)\s*\]\]/i);
              // "[[ACTION: none]]" (o modelo dizendo que não há ação) não vira botão "⚡ Fazer isso: none".
              const proposed = m ? m[1].trim() : '';
              const suggestedCommand = proposed && !/^(none|n\/?a|null|nothing|nada|ninguna|nenhuma|no action|-+)\.?$/i.test(proposed) ? proposed : undefined;
              const reply = raw.replace(/\[\[\s*ACTION\s*:[^\]]*\]\]/ig, '').trim() || raw.trim();
              return { reply, suggestedCommand, isError: !!result?.error };
            }}
            onResearch={runWebResearch}
            onClassify={classifyIntent}
            onFetchHeadlines={fetchNewsHeadlines}
            // Aba anônima: sem o botão "Entrar no Google" (importaria a sessão pro perfil normal).
            onGoogleLogin={activeIncognito ? undefined : handleGoogleLogin}
            googleLoggedIn={googleLoggedIn}
            isStartupTab={!!store.activeTab?.startup}
            // Link da resposta da IA: na aba anônima, abre anônimo também.
            onOpenUrl={(url: string) => { const id = store.addTab(url, opensIncognito('from-tab', aiOnIncognito())); activeTabIdRef.current = id; }}
            onClose={() => store.setSidebarOpen(false)}
            aiSettings={store.aiSettings}
            onSettingsChange={async (settings) => {
              // Aguarda a persistência REAL (cifrar + gravar): fechar o app logo após
              // Salvar não pode perder a config nova (a gravação é encadeada no store).
              await store.setAISettings(settings);
              await window.electronAPI?.setAIProvider(settings.provider, settings.apiKey, settings.baseUrl, settings.model);
            }}
            sessionCost={sessionCost}
            localSettings={store.localSettings}
            onLocalSettingsChange={async (ls) => {
              await store.setLocalSettings(ls);
              await window.electronAPI?.setLocalWarmup?.(!!ls.warmup);
              if (ls.enabled) {
                await window.electronAPI?.setLocalProvider?.(ls.provider, ls.authKey ?? '', ls.baseUrl, ls.model, localOptsForMain(ls));
              }
            }}
            onSwitchToCloud={() => {
              // Saída de 1 clique de um modo IA Local travado (Ollama off) → volta pra nuvem
              // (o provedor configurado nas Configurações). aiChat roteia pela flag por chamada.
              store.setLocalSettings({ ...store.localSettings, enabled: false });
            }}
          />
        </div>
          {showTour && (
            <BeginnerTour
              onClose={() => { setShowTour(false); try { localStorage.setItem('tourSeen', '1'); } catch {} }}
            />
          )}
      </div>

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
      {chatHistoryOpen && <ChatHistoryPanel onClose={() => setChatHistoryOpen(false)} onResume={(e, reopen) => store.resumeSession(e, reopen)} />}
      {clearDataOpen && <ClearDataDialog onClose={closeClearData} sitesInRange={sitesInRange} onClear={runClearData} />}
      {/* ⋮ → Senhas (ou "Gerenciar senhas…" da lista em cima do campo, já filtrado pelo site). */}
      {passwordsOpen && <PasswordsPanel initialQuery={passwordsOpen.query} onClose={() => setPasswordsOpen(null)} />}
      {/* dead second AgentCommandBar removed */}
    </div>
  );
}

// Páginas de RESULTADO de busca cujos links são notoriamente embrulhados por wrapper/
// overlay — clicar por coordenada "não surte efeito" e o agente entra em loop (bug #1).
// Só os resultados (Google com q=, Bing /search, DDG, YouTube /results); páginas de
// destino e watch do YouTube ficam de fora (clique normal).
// ID do vídeo do YouTube na URL (watch?v=, youtu.be/, /shorts/, /embed/) — pra puxar a legenda.
function youtubeWatchId(u: string): string | null {
  try {
    const url = new URL(u);
    const h = url.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return (url.pathname.slice(1).match(/^[A-Za-z0-9_-]{11}/) || [null])[0];
    if (/youtube\.com$/.test(h)) {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}/.test(v)) return v.slice(0, 11);
      const m = url.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// Arquivo de OUTRO sistema (o agente baixou o .exe de Windows num Mac), CPU errada (arm64 num Mac
// Intel não roda) ou tipo de pacote errado no Linux: vale pra qualquer site de driver/instalador.
// O perfil de verdade vem do main (machine:info); até ele chegar, o palpite pelo navigator (só o SO).
const NAV_PLATFORM = typeof navigator !== 'undefined' ? navigator.platform || '' : '';
let MACHINE: MachineProfile = machineProfile({ platform: /^Win/i.test(NAV_PLATFORM) ? 'win32' : /Mac/i.test(NAV_PLATFORM) ? 'darwin' : /Linux/i.test(NAV_PLATFORM) ? 'linux' : 'other', arch: 'other' });
try { window.electronAPI?.machineInfo?.().then(m => { if (m?.platform) MACHINE = machineProfile(m); }).catch(() => {}); } catch {}
/** Nota pro agente: erro (SO/CPU/pacote errado — não roda aqui) ou aviso (roda emulado). '' = serve. */
function wrongOsNote(filename: string): string {
  return checkBuild(filename, MACHINE).note;
}
/** Só o erro de verdade: um download "concluído" que não roda aqui não conta como sucesso. */
function isWrongBuild(filename: string): boolean {
  return checkBuild(filename, MACHINE).level === 'error';
}

// Formatadores do painel de downloads (tamanho, velocidade, tempo restante).
function fmtSize(b?: number): string {
  if (!b) return '';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';   // vídeo 4K passa de 1 GB
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

// Preferências do gerenciador de downloads (Downloads → ⚙) — as mesmas do IDM Caseiro.
interface DlEngineSettings { enabled: boolean; connections: number; maxRetries: number; minSegmentMB: number; connectTimeoutS: number; readTimeoutS: number }
const DL_ENGINE_DEFAULTS: DlEngineSettings = { enabled: true, connections: 8, maxRetries: 6, minSegmentMB: 1, connectTimeoutS: 10, readTimeoutS: 20 };
function loadDlEngine(): DlEngineSettings {
  try { return { ...DL_ENGINE_DEFAULTS, ...JSON.parse(localStorage.getItem('dlEngine') || '{}') }; } catch { return { ...DL_ENGINE_DEFAULTS }; }
}

// Textos do botão "Baixar" que o main injeta nas páginas com vídeo — no idioma da UI.
function ytDlLabels(): Record<string, string> {
  const keys = ['btn', 'title', 'loading', 'audio', 'started', 'listFailed', 'live', 'retry', 'preparing', 'merging', 'done', 'failed', 'reveal', 'video', 'drm', 'needTool', 'dec'];
  return Object.fromEntries(keys.map(k => [k, t(`ytdl.${k}`)]));
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
async function trySaveNamedPlaylist(wv: Electron.WebviewTag, name: string, makePrivate = false): Promise<{ ok: boolean; step?: string; err?: string; private?: boolean }> {
  const js = `(async function(name, makePrivate){
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function norm(s){return (s||'').replace(/\\s+/g,' ').trim();}
    function setVal(el,val){try{el.focus();var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,val);}catch(e){el.value=val;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
    // rótulo de "Salvar/Save/Guardar" em pt/en/es (aria-label OU texto do botão)
    var SAVE_RE=/salvar na playlist|salvar em playlist|save to playlist|save video|guardar en (?:la )?(?:lista|playlist)|a[nñ]adir a (?:la )?(?:lista|playlist)|add to playlist/i;
    try{
      var save=Array.prototype.slice.call(document.querySelectorAll('button,yt-button-shape,[role=button]')).find(function(b){var a=(b.getAttribute&&b.getAttribute('aria-label'))||'';return SAVE_RE.test(a)||SAVE_RE.test(norm(b.textContent));});
      if(!save) return {ok:false,step:'save-btn'};
      (save.closest('button,[role=button]')||save).click(); await wait(1700);
      var nova=Array.prototype.slice.call(document.querySelectorAll('ytd-popup-container *,tp-yt-paper-dialog *,[role=dialog] *')).find(function(e){return e.childElementCount===0 && /^\\s*(nova playlist|criar (?:nova )?playlist|new playlist|create (?:new )?playlist|nueva lista(?: de reproducci[oó]n)?|crear (?:nueva )?(?:lista|playlist))\\s*$/i.test(e.textContent||'');});
      if(!nova) return {ok:false,step:'nova-playlist'};
      (nova.closest('[role=option],tp-yt-paper-item,ytd-add-to-playlist-create-renderer,button,a,[role=button]')||nova).click();
      await wait(1700);
      var ta=document.querySelector('tp-yt-paper-dialog[opened] textarea, tp-yt-paper-dialog textarea, ytd-popup-container textarea, [role=dialog] textarea, textarea[placeholder*="t\\u00edtulo" i], textarea[placeholder*="titulo" i], textarea[placeholder*="title" i], textarea[placeholder*="nombre" i]');
      if(!ta) return {ok:false,step:'title-input'};
      setVal(ta,name); await wait(800);
      var dlg=ta.closest('tp-yt-paper-dialog')||ta.closest('[role=dialog]')||document;
      // Visibilidade já vem "Particular" (privada) por PADRÃO no YouTube (verificado no DOM
      // real 2026-07) → sem toggle frágil. Botão "Criar" habilita sozinho após o título.
      var criar=Array.prototype.slice.call(dlg.querySelectorAll('button,tp-yt-paper-button,yt-button-shape,[role=button]')).find(function(b){return /^\\s*(criar|create|crear)\\s*$/i.test(norm(b.textContent));});
      if(!criar) return {ok:false,step:'criar-btn'};
      (criar.closest('button,[role=button]')||criar).click(); await wait(2200);
      // CONFIRMA que criou de verdade antes de dizer ok: o diálogo de criação tem que
      // ter FECHADO (rede caindo após o clique deixava o app dizer "criada" sem nada).
      // "Fechado" cobre as DUAS UIs: nova (o nó da caixa é REMOVIDO) e Polymer (o diálogo
      // só é ESCONDIDO, o nó fica → offsetParent vira null). Poll de ~4s pra rede lenta.
      function dlgClosed(){ return !document.contains(ta) || ta.offsetParent===null; }
      for(var w=0; w<8 && !dlgClosed(); w++){ await wait(500); }
      if(!dlgClosed()) return {ok:false,step:'still-open'};
      return {ok:true,private:makePrivate};
    }catch(e){return {ok:false,step:'exception',err:String(e&&e.message)};}
  })(${JSON.stringify(name)}, ${makePrivate ? 'true' : 'false'})`;
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
    var SAVE_RE=/salvar na playlist|salvar em playlist|save to playlist|save video|guardar en (?:la )?(?:lista|playlist)|a[nñ]adir a (?:la )?(?:lista|playlist)|add to playlist/i;
    try{
      var save=Array.prototype.slice.call(document.querySelectorAll('button,yt-button-shape,[role=button]')).find(function(b){var a=(b.getAttribute&&b.getAttribute('aria-label'))||'';return SAVE_RE.test(a)||SAVE_RE.test(norm(b.textContent));});
      if(!save) return {ok:false,step:'save-btn'};
      (save.closest('button,[role=button]')||save).click(); await wait(1600);
      var rows=Array.prototype.slice.call(document.querySelectorAll('yt-list-item-view-model,ytd-playlist-add-to-option-renderer,[role=option]'));
      var target=null;
      for(var i=0;i<rows.length;i++){ if(clean(rows[i].textContent).toLowerCase()===name.toLowerCase()){target=rows[i];break;} }
      if(!target){ var rx=new RegExp('^'+name.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&'),'i'); target=rows.find(function(r){return rx.test(clean(r.textContent));}); }
      if(!target) return {ok:false,step:'find-row',have:rows.map(function(r){return clean(r.textContent).slice(0,20);}).slice(0,8)};
      // JÁ MARCADA? Clicar de novo DESMARCA (toggle) — removeria a música em vez de
      // adicionar. Checa aria-checked no PRÓPRIO target (a linha costuma carregar o estado)
      // OU num descendente. (A dedup de ids na origem é a defesa principal; isto é reforço.)
      var chk=(target.getAttribute && target.getAttribute('aria-checked')!==null) ? target : target.querySelector('[role=checkbox],[aria-checked]');
      if(chk && (chk.getAttribute('aria-checked')==='true' || chk.checked===true)){
        var close0=document.querySelector('tp-yt-paper-dialog [aria-label*="Fechar" i],ytd-popup-container [aria-label*="Fechar" i],tp-yt-paper-dialog #close-button button');
        if(close0)close0.click(); else { try{document.body.click();}catch(e){} }
        return {ok:true,step:'already-in'};
      }
      // UI nova (yt-list-item-view-model): a linha inteira é o clicável (verificado no DOM real
      // 2026-07 — não há [role=checkbox]; o wrapper é .ytListItemViewModelLayoutWrapper).
      (target.querySelector('[role=checkbox],.ytListItemViewModelLayoutWrapper,.ytListItemViewModelMainContainer,a,button')||target).click();
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
    const done: BrowserAction = { type: 'done', success: false, reason: 'Could not extract the main text from this page.' };
    return { thought: done.reason, results: [], done };
  }

  onProgress({ kind: 'status', message: 'Trash Destroyer: summarizing in 3 points...' });
  const summary = await summarizeForTrashDestroyer(article, command);

  throwIfCancelled();
  onProgress({ kind: 'status', message: 'Trash Destroyer: removing ads, popups and visual noise...' });
  const injected = await raceTimeout(wv.executeJavaScript(`
    (function(payload) {
      ${TRASH_DESTROYER_RENDER_SCRIPT}
      return window.__trashDestroyer.render(payload);
    })(${JSON.stringify({ ...article, summary })})
  `), 10000, { success: false, error: 'inject timed out' });

  const reason = injected?.success
    ? `Clean page: ${summary.length} topics, ${article.removedCount ?? 0} noise elements detected.`
    : `Failed to transform the page: ${injected?.error ?? 'unknown error'}`;
  const done: BrowserAction = { type: 'done', success: !!injected?.success, reason };
  return {
    thought: 'Detected a summarize + visual cleanup request and used the dedicated live DOM manipulation flow.',
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
      `Resuma a pagina abaixo em exatamente 3 topicos curtos, em ${uiLangName()}.`,
      'Cada topico deve ter no maximo 140 caracteres.',
      'Nao use numeracao; retorne apenas uma linha por topico.',
      '',
      `Comando do usuario: ${command}`,
      `Titulo: ${article.title ?? ''}`,
      `URL: ${article.url ?? ''}`,
      '',
      article.text.slice(0, 9000),
    ].join('\n');
    // Função de módulo (sem o hook `store`): lê a preferência de IA local direto do
    // localStorage, que é onde o store a persiste. Antes usava `store` fora de escopo →
    // lançava ReferenceError, caía no catch e devolvia sempre o fallback (resumo sem IA).
    let localEnabled = false;
    try { localEnabled = !!JSON.parse(localStorage.getItem('localSettings') || '{}').enabled; } catch {}
    const res = await raceTimeout(window.electronAPI?.aiChat(prompt, '', undefined, localEnabled) ?? Promise.resolve(undefined), 14000, undefined);
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
  while (picked.length < 3) picked.push('The main text was isolated for distraction-free reading.');
  return picked.map(s => s.length > 150 ? `${s.slice(0, 147).trim()}...` : s);
}

// "Salvar como skill": depois de uma tarefa que deu certo, oferece transformar o que funcionou num
// SKILL.md do usuário. O MODELO só rascunha; salvar e compartilhar são cliques da pessoa (skill é
// instrução pro modelo — nunca entra sem revisão).
const SKILLS_REPO_NEW_FILE = 'https://github.com/alexvilelabah/bah-browser/new/main/skills';
async function offerSkillSave(command: string, history: string, onProgress: (e: AgentProgressEvent) => void): Promise<void> {
  const ask = (title: string, message: string, yesLabel: string, noLabel: string) => new Promise<boolean>((resolve) => {
    onProgress({ kind: 'confirm', risk: 'skill', label: title, title, message, yesLabel, noLabel, onConfirm: () => resolve(true), onCancel: () => resolve(false) } as any);
  });
  if (!(await ask('💾 Save as skill?', 'This task worked. Turn what worked into a reusable skill? Bah drafts it with your model — you review it before anything is saved.', '✍️ Draft skill', 'Not now'))) return;
  onProgress({ kind: 'status', message: '✍️ Drafting a skill from this task…' });
  const prompt = `You write SKILL.md files for a browser agent. From the task below, write ONE skill that captures what WORKED, so the agent does it right next time. Prefer a GENERAL rule (a kind of page or task); only name a site in "sites" if the steps really are specific to it.

Output ONLY the file, exactly this shape:
---
name: kebab-case-name
description: one line
sites: [example.com]        (optional — omit the line if general)
states: [${SKILL_STATES.join(', ')}]   (optional — only those that apply)
tasks: [${SKILL_TASKS.join(', ')}]       (optional — only those that apply)
priority: 40
---
1. numbered steps, written with the agent's actions (navigate, click_ref, fill_ref, select_option, check, find, look_at, extract_text, render_view, download, wait)

Rules: at least one of sites/states/tasks; body under ${SKILL_MAX_WORDS - 40} words; keep URL patterns that worked (e.g. search/results URLs with parameters); leave out dead ends and failed attempts; no personal data.

TASK: ${command}

WHAT HAPPENED (agent history, newest last):
${history.slice(-6000)}`;
  const r = await window.electronAPI?.aiChat?.(prompt, '', true, true).catch(() => null);
  let md = String(r?.response || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  const start = md.indexOf('---'); if (start > 0) md = md.slice(start);
  const v = validateSkill(md);
  if (!v.ok) {
    onProgress({ kind: 'status', message: `✖️ The drafted skill is not valid (${v.error}). Nothing was saved.` });
    return;
  }
  if (!(await ask('📝 Skill draft — review', md, '💾 Save', 'Discard'))) { onProgress({ kind: 'status', message: 'Skill discarded.' }); return; }
  const saved = await window.electronAPI?.skillsSave?.(md);
  if (!saved?.ok) { onProgress({ kind: 'status', message: `✖️ Could not save the skill: ${saved?.error || 'unknown error'}` }); return; }
  onProgress({ kind: 'status', message: `🧩 Skill "${saved.name}" saved (${saved.path}). It is used from the next task. Edit or delete it any time: menu → 🧩 My skills.` });
  if (await ask('🌍 Share with the Bah project?', `Propose "${saved.name}" for everyone? This opens GitHub with the file pre-filled; nothing is sent unless you submit it there. General rules are preferred over recipes for one site.`, '🌍 Open on GitHub', 'Keep private')) {
    const url = `${SKILLS_REPO_NEW_FILE}/${encodeURIComponent(saved.name!)}?filename=SKILL.md&value=${encodeURIComponent(md + '\n')}`;
    try { await window.electronAPI?.openExternal?.(url); } catch {}
  }
}

// Module-level bounded await — for helpers outside the agent-loop closure.
// On hung pages (ad/video scripts holding the main thread) executeJavaScript never
// resolves; every page-touching await must be raced against a budget.
function isGreeting(m: string): boolean {
  return m.length <= 30 && /^(oi+|ol[áa]|e a[íi]|opa|eae|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|hi|hello|hey|thanks|thank you|hola|buenos d[íi]as|buenas|gracias)[\s!,.?]*$/.test(m);
}

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
    title: document.querySelector('h1')?.innerText?.trim() || document.title || 'Clean reading',
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
      document.title = 'Clean reading - ' + (payload.title || 'Summary');
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
            <div class="td-brand"><span class="td-mark"></span><span>Trash Destroyer</span></div>
            <button class="td-restore" type="button">Restore page</button>
          </div>
          <section class="td-hero">
            <div class="td-kicker">\${esc(payload.host)} - instant reading mode</div>
            <h1>\${esc(payload.title)}</h1>
            \${payload.subtitle ? '<p class="td-sub">' + esc(payload.subtitle) + '</p>' : ''}
            <div class="td-stats">
              <span class="td-pill">\${esc(payload.removedCount || 0)} noise elements detected</span>
              <span class="td-pill">3-point summary</span>
              <span class="td-pill">DOM rebuilt locally</span>
            </div>
          </section>
          <section class="td-summary">
            \${bullets.map((b, i) => '<article class="td-card"><span class="td-num">POINT ' + String(i + 1).padStart(2,'0') + '</span><p>' + esc(b) + '</p></article>').join('')}
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
    // Parser de preço AGNÓSTICO DE LOCALE. O Google renderiza conforme o hl= da busca: em
    // pt-BR vem "R$ 3.219,00" (ponto=milhar) e em en vem "R$ 3,219.00" (vírgula=milhar).
    // O parser antigo só entendia pt-BR, então no modo en ele lia "3,21" de "3,219.00" —
    // TODOS os preços saíam divididos por mil e a tabela inteira ficava errada.
    // Regra robusta: o ÚLTIMO separador é o decimal, salvo quando tem exatamente 3 dígitos
    // depois dele e nenhum outro separador — aí é milhar ("3.219" e "3,219" = 3219).
    var toNum = function(s){
      var m = s.match(/R\\$\\s?([\\d.,\\s]+)/); if(!m) return null;
      var raw = m[1].replace(/\\s/g,'').replace(/[.,]+$/,'');
      if(!raw || !/\\d/.test(raw)) return null;
      var lastDot = raw.lastIndexOf('.'), lastCom = raw.lastIndexOf(',');
      var dec = Math.max(lastDot, lastCom), n;
      if (dec === -1) { n = raw; }
      else {
        var tail = raw.length - dec - 1;
        var other = (dec === lastDot) ? lastCom : lastDot;
        if (tail === 3 && other === -1) { n = raw.replace(/[.,]/g,''); }
        else { n = raw.slice(0, dec).replace(/[.,]/g,'') + '.' + raw.slice(dec + 1); }
      }
      var f = parseFloat(n); return isFinite(f) ? f : null;
    };
    var STORE = /(Mercado\\s*Livre|Amazon|Magazine\\s*Luiza|Magalu|Americanas|Kabum|Casas\\s*Bahia|Ponto(?:frio)?|Shoptime|Pichau|Terabyte|Carrefour|AliExpress|Shopee|Fast\\s*Shop|Extra|Submarino|Girafa|Dell|Kalunga)/i;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('div, li, a'));
    var out = [], seen = {};
    for (var i=0;i<nodes.length;i++){
      var el = nodes[i];
      var txt = (el.innerText||'').trim();
      if (txt.length < 8 || txt.length > 280) continue;
      var pm = txt.match(/R\\$/g); if (!pm || pm.length > 2) continue;
      if (!priceRe.test(txt)) continue;
      // Preço do produto = o MAIOR quando o bloco tem parcelamento ("12x R$ 399,91"): a
      // parcela é sempre fração do total, e pegar o 1º "R$" fazia a parcela virar "o preço".
      // Sem marca de parcela, mantém o 1º (evita cair no "de R$ X por R$ Y" riscado).
      var price = toNum(txt);
      if (/\\d+\\s*x\\s*(de\\s*)?R\\$/i.test(txt)) {
        var all = txt.match(new RegExp(priceRe.source, 'g')) || [];
        for (var k = 0; k < all.length; k++) { var pv = toNum(all[k]); if (pv && (!price || pv > price)) price = pv; }
      }
      if (!price || price < 3) continue;
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
      // Redirecionadores do DuckDuckGo (uddg=) e do Yahoo (/RU=…/RK=) → o link real do site.
      try { var u0 = new URL(href); if (/duckduckgo\\.com$/.test(u0.hostname) && u0.searchParams.get('uddg')) href = u0.searchParams.get('uddg'); } catch(e){}
      var ru = /\\/RU=([^/]+)\\/RK=/.exec(href); if (ru) { try { href = decodeURIComponent(ru[1]); } catch(e){} }
      // Bing: bing.com/ck/a?...&u=a1<base64url do link real>.
      try { var ub = new URL(href); var bu = ub.searchParams.get('u'); if (/(^|\\.)bing\\.com$/.test(ub.hostname) && bu && bu.indexOf('a1') === 0) { var b64 = bu.slice(2).replace(/-/g, '+').replace(/_/g, '/'); while (b64.length % 4) b64 += '='; var dec = atob(b64); if (/^https?:/.test(dec)) href = dec; } } catch(e){}
      try { host = new URL(href).hostname; } catch(e){ continue; }
      if (/(^|\\.)google\\.|gstatic|googleusercontent|(^|\\.)bing\\.com|go\\.microsoft|microsofttranslator|duckduckgo\\.com|(^|\\.)yahoo\\.com$|yimg\\.com/.test(host)) continue;
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
    if (!m) return { error: 'missing vqd' };
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
      if(!el) return { ok:false, error:'Gemini field did not appear' };
      el.focus();
      try {
        if(el.tagName==='TEXTAREA'){ const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(el,q); el.dispatchEvent(new Event('input',{bubbles:true})); }
        else { document.execCommand('insertText',false,q); el.dispatchEvent(new InputEvent('input',{bubbles:true,data:q,inputType:'insertText'})); }
      } catch(e){ return { ok:false, error:'failed to type' }; }
      await sleep(500);
      // 2) enviar (botão Enviar/Send; senão Enter)
      const btn=[...document.querySelectorAll('button,[role=button]')].find(b=>{ const a=((b.getAttribute('aria-label')||'')+' '+(b.innerText||'')).toLowerCase(); return /enviar|send|submit/.test(a) && !b.disabled && b.offsetParent!==null; });
      if(btn){ btn.click(); } else { ['keydown','keypress','keyup'].forEach(tp=>el.dispatchEvent(new KeyboardEvent(tp,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}))); }
      // 3) extrair: texto após o último "o gemini disse"/"gemini said", esperando estabilizar
      const extract=()=>{ const body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' '); const low=body.toLowerCase(); let i=low.lastIndexOf('o gemini disse'); let mk='o gemini disse'; const ie=low.lastIndexOf('gemini said'); if(ie>i){i=ie;mk='gemini said';} if(i<0) return ''; let a=body.slice(i+mk.length).trim(); a=a.split(/o gemini (é|e) uma ia|gemini can make mistakes|enviar feedback|mostrar rascunhos|new flash|verifique as informa/i)[0].trim(); return a; };
      let ans='', stable=0;
      for(let k=0;k<24;k++){ await sleep(1000); if(blocked()) return {ok:false,blocked:true}; const a=extract(); if(a && a===ans){ stable++; if(stable>=3) break; } else { ans=a; stable=0; } }
      return { ok: ans.length>0, answer: ans.slice(0,4000), error: ans.length?undefined:'no response' };
    })(${JSON.stringify(question)})`), 90000, { ok: false, error: 'timed out while asking Gemini' });
    if (res?.blocked) return { success: false, reason: 'captcha', error: 'Gemini asked for verification/login.' };
    if (res?.ok) return { success: true, answer: res.answer };
    return { success: false, error: res?.error || 'no response' };
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
