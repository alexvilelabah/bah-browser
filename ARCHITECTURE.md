# Architecture & repository map

**English** · [Português](ARCHITECTURE.pt-BR.md)

A guide for reading the codebase. Pair it with [SECURITY.md](SECURITY.md) (threat model +
audit checklist). The whole of `src/` is ~30 files — small enough to read in a sitting.

Bah is an Electron app with two processes joined by a preload bridge. Web pages load inside
a `<webview partition="persist:browser">`. The agent **observes** a page, **decides** one
action, and **performs** it with **real OS input events** (not synthetic DOM events), so
sites behave exactly as they would for a human.

---

## The two processes + the bridge

- **Renderer** (`src/renderer/`) — the React UI **and the agent's decision loop**. Runs
  sandboxed (`contextIsolation`, no `nodeIntegration`); it can only reach the OS through the
  preload bridge.
- **Main** (`src/main/`) — privileged (Node): windows, the `<webview>` session, real input
  injection, downloads, AI HTTP calls, ffmpeg/yt-dlp, OCR.
- **Preload** (`src/preload/preload.ts`) — the **only** bridge between them. One short file,
  a fixed list of IPC channels. See [SECURITY.md](SECURITY.md).

---

## Live path of one command (the hot path)

1. You type in the box → [`AgentCommandBar.tsx`](src/renderer/components/AgentCommandBar.tsx)
   (`routeCommand`) decides: **deterministic quick action**, **AI-classify**, or **chat**.
2. An agent task calls `onExecute` ([`App.tsx`](src/renderer/App.tsx), ~line 862) → the
   ReAct loop. **The live agent loop lives in `App.tsx`.**
3. Each step resolves ONE action from either
   [`detectQuickAction`](src/renderer/site-knowledge.ts) (0-token shortcuts, no AI) **or**
   the AI ([`ai-engine.ts`](src/main/ai-engine.ts)).
4. The action runs: real click/type/key go renderer → preload → `main.ts`
   (`sendInputEvent`); in-page operations go through
   [`page-executor.ts`](src/renderer/page-executor.ts).
5. Before executing, the **safety brake** ([`risk.ts`](src/renderer/risk.ts)) gates
   pay / buy / delete / card-data actions and asks you to confirm.

> Deterministic-first is the design philosophy: common requests (open a video, download,
> generate an image, compare prices, news) are handled in `detectQuickAction` with **zero
> AI tokens**; the model is only called when real reasoning is needed.

---

## `src/main/` — privileged process

| File | Responsibility |
|---|---|
| `main.ts` | App bootstrap, window, `<webview>` session, **all IPC handlers**, real input (`sendInputEvent`), adblock, downloads wiring, safe-browsing, hardware-accel toggle |
| `ai-engine.ts` | Every cloud/local AI call (DeepSeek / Mistral / NVIDIA NIM / Ollama) + the system prompt and tool list |
| `site-locale.ts` | **Single source** for the language sites receive (Accept-Language / navigator.languages / --lang follow the UI choice) |
| `page-agent.ts` | Cloud-side reasoning helpers for the agent |
| `download-manager.ts` | Native download manager: pause/resume/cancel/queue/ETA, guarded `open-file` |
| `media-downloader.ts` | `yt-dlp` / `ffmpeg` wrapper (video/audio download) |
| `video-cuts.ts`, `transcript.ts` | Local video features (locate where a phrase is spoken, transcripts) — native ffmpeg |
| `image-harvester.ts` | Bulk image download + AI image generation (Pollinations), with limits |
| `ocr-engine.ts`, `page-capture.ts` | On-device OCR (Tesseract) + screenshots |
| `data-view.ts` | Renders data tables/charts to a local page (no CDN) |
| `validate.ts` | Path-safety helpers (`isInsideAllowedRoot`, etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Popup/overlay handling and dismissal |
| `job-queue.ts` | Serialises long-running jobs |

---

## Chrome Web Store install and password-manager extensions

**Installing from the store ("Add to Bah").** The Chrome Web Store now decides on its *server* whether the
browser is Google Chrome. Its page script asks `chrome.webstorePrivate.getFullChromeVersion()` and, for
142.0.7430 and later, stops reading the user agent and trusts only a flag the server ships with the page
(`IJ_values`). That flag is false for every non-Chrome browser. Bah's store preload, `webstorePrivate`
and `userAgentData` brands (including "Google Chrome") were all in place; changing `sec-ch-ua` does not
flip the flag either. So the page shows "Switch to Chrome" and hides its button. Bah does **not** pretend
to be Chrome to get past this (no forged headers, no fake version). Instead, on a store detail page
(`shared/extension-store.ts`, exact origin) the toolbar shows Bah's own **Add to Bah** button.
`extensions:install-from-store` takes the id from the tab's URL (never from an argument) and downloads the
public `.crx` from the same update endpoint the store uses, through the tabs' session and its proxy.
`parseCrx3` checks that the package's key hashes to its declared id and to the page's id. Bah then asks
the same "Add X?" question as the store and loads through the gated loader (access approval, removed
list).

**Running LastPass, Bitwarden and 1Password.** When tested with their public packages (never signed in),
the Bitwarden background died at `chrome.webNavigation.onCommitted` and LastPass at
`chrome.windows.onFocusChanged`: a TypeError on start-up stops the whole extension, including field menus
and the popup. The shim (`extension-shim-preload.ts`) now adds the missing pieces, served from
`chrome-extensions.ts`:

- `webNavigation`: events from the tabs' frames, only to subscribers, only for pages the extension may
  see. `frameId` 0 is the main frame and others use `frameTreeNodeId`. Also `getFrame`/`getAllFrames`.
- `windows`: Bah is one window, id 1. `windows.create` opens a tab.
- `idle`: "locked" follows the OS screen lock, so vaults that lock with the computer still lock.
- `offscreen`: one hidden window per extension, showing only that extension's own page (used for the
  clipboard and DOMParser). Bah also provides `runtime.getContexts` for that document.
- `commands`: the manifest's shortcut list, with no keys bound.
- `permissions`: `contains` / `getAll` answer from the manifest. Optional grants are refused.
- `tabs.getCurrent`: returns `undefined` in a popup, and the tab when an extension page is open in a tab. Bitwarden's popup picks its width from this call.

The LastPass and Bitwarden popups fix their size in the body's CSS, and `preferred-size-changed` never arrived for them, so they stayed at 25×25. The popup is now measured a few times after it loads and grows to fit (max 800×600, as in Chrome).

**Who is installed** (`shared/password-extensions.ts`): detection uses the Web Store IDs, which come from
the extension's public key, so another extension cannot claim them. A name alone does not count.

**Bah's own manager steps back.** Default on, with a switch in the Passwords panel. While one of these
extensions is enabled, Bah's manager offers neither its logins list nor "Save password?" in normal tabs;
two managers competing over the same field is the surprise to avoid. Private tabs keep Bah's manager,
because extensions don't run there (same as Chrome).

**Agent at a login form** (`extensionLoginGuidance` in `App.tsx`). When the agent pauses at a login form
and one of these extensions is enabled (normal tabs only), the pause card names the extension's setting:
LastPass "Auto-login" (site item → Edit → Advanced Settings), Bitwarden "Autofill on page load" (Settings →
Autofill, also per login), or 1Password's pick-and-submit. The agent never types credentials.

**Extension UI is not part of the page** (`shared/extension-ui.ts`). The agent never sees or clicks
`chrome-extension://` iframes, or the marked injection roots under which LastPass and 1Password draw
their icons and menus:

- they are removed from the page's accessibility tree (`cdp:axtree`);
- the cookie-banner sweeper (`overlays:dismiss`) skips them.

Clicking a password manager's menu would hand out a credential on the AI's initiative.

**Reading or setting per-site auto-login: no supported route.** None of the three documents a supported
way for another program to read or change their per-site auto-login or autofill:

- No extension messaging API: none has `externally_connectable`.
- Their CLIs (`lpass`, `bw`, `op`) need the user's unlocked vault.
- Their enterprise policies live in the vendor's admin console, not readable by a browser. Electron has
  no `storage.managed` either.

Reading their private storage or patching them is off-limits: it crosses into the vault, and it would
break on every update. So Bah only *guides*, and names the setting.

---

## `src/renderer/` — UI + agent loop

| File | Responsibility |
|---|---|
| `App.tsx` | Top-level app; **the live agent ReAct loop** (`onExecute`) |
| `components/AgentCommandBar.tsx` | The unified command box, the activity feed, and settings |
| `components/` | `AddressBar`, `TabBar`, `WebViewContainer`, `AgentVisualOverlay` |
| `site-knowledge.ts` | Deterministic 0-token quick actions (`detectQuickAction`) |
| `page-executor.ts` | Executes browser actions inside the page |
| `risk.ts` | The safety-brake classifier (`riskForAction`) |
| `agent-recovery.ts`, `agent-login-policy.ts` | Stuck-state recovery + login/captcha detection |
| `agent-run-logger.ts` | Opt-in run logging (local training-data collector) |
| `store.ts` | UI/settings state (localStorage) |
| `i18n.ts` | Hand-rolled en / pt / es; **English is the default** |
| `macros.ts` | Record/replay of deterministic macros |

---

## Build & release

- **Build:** Renderer = Vite + `tsc` typecheck; Main = `tsc`. An i18n parity gate
  (`scripts/i18n-check.mjs`) **fails the build** if en/pt/es drift out of sync.
- **Package:** electron-builder (NSIS installer). [`build/afterPack.js`](build/afterPack.js)
  flips a conservative set of Electron Fuses on the binary.
- **Auto-update:** electron-updater pulls GitHub releases on launch (the installed app
  pulls; nothing is pushed to it).

## Removed / vestigial

- `AISidebar.tsx` and `VideoEditorPanel.tsx` were removed (they were not imported). The live
  assistant UI is `AgentCommandBar`.
- The local video editor (`video-editor.ts`: trim / remove silence / extract audio) and the
  download-clips `supercut.ts` were removed — nobody drove them. Finding where a phrase is
  spoken survives as `open_video_cuts` (opens each video paused at the exact second).
