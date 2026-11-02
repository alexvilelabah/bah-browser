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
| `agent-download-worker.ts`, `download-progress.ts` | The agent's `download` action: one `worker_threads` worker per download; progress cadence + stall policy. See [Downloads & torrents](#downloads--torrents) |
| `torrent-manager.ts`, `torrent/engine.mjs` | **Optional** built-in torrent client (off by default): IPC bridge + the engine, isolated in a `utilityProcess` that only starts when used. See [Downloads & torrents](#downloads--torrents) |
| `media-downloader.ts` | `yt-dlp` / `ffmpeg` wrapper (video/audio download) |
| `proxy.ts`, `proxy-config.ts` | Proxy for **every** session (system / manual http·https·socks5 / PAC / direct), 407 sign-in prompt with keychain-encrypted saved credentials, `proxy:*` IPC. Main-process `fetch` is routed through the `persist:browser` session's `session.fetch`, and agent downloads that need a proxy use `session.downloadURL`, so one setting covers everything |
| `site-permissions.ts` (+ `src/shared/site-permissions.ts`) | Permission handlers for the sites' sessions: sensitive permissions denied until the user answers the Bah bar (once / always / never, per origin), background/hidden tabs auto-denied, unknown permissions denied |
| `frames.ts` | Iframe content for the agent (embedded job/payment/booking forms): accessibility trees of same-process frames (by `frameId`) and cross-origin frames (flattened CDP sessions via `Target.setAutoAttach`), coordinates mapped to the page viewport; elements are listed with `frame="host"`. Fills set the value on the node inside its frame (focus-independent); clicks in cross-origin frames use CDP `Input` on the frame's session (`sendInputEvent` stops at the `<iframe>`) |
| `js-dialogs.ts` (+ `src/renderer/js-dialogs.ts`, `components/JsDialogHost.tsx`) | Page `alert`/`confirm` in tabs: replaces Electron's blocking native box (internal `-run-dialog`) with Bah's dialog for the user, and the agent policy on its tabs (armed `dialog` action > alert closes > ordinary confirm accepted > payment/delete confirm asks the user); `beforeunload` on agent tabs leaves when the agent navigates. `prompt()` is not available in Electron (it throws) |
| `upload.ts` | Agent `upload` (OS file dialog → token; file field by node/label/position, or the OS picker intercepted with `Page.setInterceptFileChooserDialog` during the action; `DOM.setFileInputFiles`) and session folder grants for `list_files` / `read_file` / `upload { file }` (realpath-checked) |
| `region.ts` (+ `src/shared/region.ts`, `src/renderer/region-state.ts`) | 🌍 Region & time: network exit country (Cloudflare trace, Auto mode only, 10-min cache), shopping region, time zone for sites via CDP `Emulation.setTimezoneOverride` (resets on restart unless kept); agent region line, search `gl=`/`cc=`, `suggest_time_zone` confirm card |
| `proxy-base.ts` | Bridge between Bah's proxy settings and Chrome extensions' `chrome.proxy` (VPN extensions): an extension in control wins (as in Chrome); when it lets go, the tabs return to the proxy configured in Bah, not a fixed "system"; Bah's WebRTC leak policy is the extensions' baseline |
| `system-ca.ts` | Reads the OS root certificate store and adds it to Node's default CAs (`tls.setDefaultCACertificates`) — main process and download worker — for TLS-inspecting corporate proxies |
| `video-cuts.ts`, `transcript.ts` | Local video features (locate where a phrase is spoken, transcripts) — native ffmpeg |
| `image-harvester.ts` | Bulk image download + AI image generation (Pollinations), with limits |
| `ocr-engine.ts`, `page-capture.ts` | On-device OCR (Tesseract) + screenshots |
| `data-view.ts` | Renders data tables/charts to a local page (no CDN) |
| `validate.ts` | Path-safety helpers (`isInsideAllowedRoot`, etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Popup/overlay handling and dismissal |
| `job-queue.ts` | Serialises long-running jobs |

### Downloads & torrents

Every download is written to disk as it arrives (never buffered in RAM), has **no size cap and
no file-type blocklist**, and lands in the Downloads folder (or the folder picked in
Downloads → ⚙).

| Path | Entry point | Writes to disk via |
|---|---|---|
| Link / page download (click, address bar) | Electron `will-download` → [`download-manager.ts`](src/main/download-manager.ts) | Multi-connection engine or Chromium's own downloader (both stream) |
| Agent `download` action | `download:url` IPC in `main.ts` (renderer: `electronAPI.downloadUrl`) → a **worker thread** ([`agent-download-worker.ts`](src/main/agent-download-worker.ts)) | `fs.createWriteStream` on the final file |
| Video / audio | `yt-dlp` + `ffmpeg` ([`media-downloader.ts`](src/main/media-downloader.ts)) | the tools themselves |
| Files inside a torrent (built-in client ON) | `torrent:save-file` → [`torrent/engine.mjs`](src/main/torrent/engine.mjs) | `fs.createWriteStream` |

#### Link / page downloads (`download-manager.ts`)

1. `will-download` fires; a `.torrent` goes to the torrent card if the built-in client is ON (see below).
2. The save path is chosen up front (`uniqueDownloadPath` — never overwrites, adds ` (1)`, ` (2)`...),
   so there is no native "Save as" dialog.
3. The URL is probed (final URL after redirects, with the tab's UA/Referer/cookies; redirects to another
   host are refused so cookies don't leak). If the server supports ranges, the file is **≥ 2 MB** and
   isn't HTML, the multi-connection engine ([`multi-download.ts`](src/main/multi-download.ts)) takes over:
   up to 8 connections by default (1–32, Downloads → ⚙), writing segments into a `<file>.bahpart`
   with positional writes, renamed to the final name when complete. Otherwise Chromium downloads it normally.
4. If the engine can't even start, the download falls back to Chromium on the same list row.
5. Pause / resume / cancel / queue (max 5 at once) and live speed/ETA go to the Downloads panel (Ctrl+J).
   Leftover `.bahpart` files from a crash or quit are deleted on startup and when the folder changes.

#### Agent `download` action — background, worker thread

The download runs **off the main process's event loop**, in a `worker_threads` worker started per
download from [`agent-download-worker.ts`](src/main/agent-download-worker.ts) (unpacked from the asar,
see `asarUnpack`). `main.ts` only starts the worker and relays its messages.

1. Only `http(s)` URLs. Sent with browser-like headers (Chrome UA, `Accept-Language`, `Referer` = the
   URL's origin). TLS-lenient retry on a broken certificate chain; one retry after 2.5 s on HTTP 429/403.
2. File name: the `filename` argument, else the URL's last path segment, else `download`; an extension
   is guessed from `Content-Type` if missing (`.bin` as last resort). Never overwrites (` (1)`, ` (2)`...).
3. **Returns as soon as the download starts** (headers received, file created) with
   `{ id, path, totalBytes, background: true }` — the agent learns the final path immediately and keeps
   working. An HTTP error before the start comes back as a normal failed action.
4. The body is **always read as a stream** (a web `ReadableStream` goes through `Readable.fromWeb`) and
   written chunk by chunk with back-pressure (`drain`). Memory stays flat regardless of size — a 6.5 GB
   ISO was verified at ~1 GB peak app RSS.
5. **No size cap and no total time limit** — see stalls below. On error, cancel or an empty body the
   partial file is deleted.
6. Everything after the start arrives as `agent:download-event` (`kind: 'agent'`) — the same channel as
   the other downloads, so the Downloads panel shows a live row (✕ cancels it via `download:cancel` →
   `cancelExternal`; no pause).

**Progress cadence** ([`download-progress.ts`](src/main/download-progress.ts), `ProgressTracker`): the
worker ticks every **1 s** (that's what the panel shows). Speed is smoothed over ~5 s and
ETA = remaining ÷ speed is recomputed every tick, so the cadence adapts as speed changes. Only ticks
flagged `notify: true` reach the agent's history:

| ETA | Agent gets a `DOWNLOAD PROGRESS` line every |
|---|---|
| ≤ 2 min | 1 s |
| 2–10 min | 5 s |
| > 10 min | 15 s |
| unknown (no `Content-Length`, or no speed yet) | 5 s |

Start, completion, failure, cancellation and stall changes are always sent immediately.

**Stalls** are detected in code, not by the AI (a model call per check would be slow and costly, and
"no bytes for N seconds" is an exact measurement). The AI only decides what to do next.

| No data for | What happens | Agent sees |
|---|---|---|
| 15 s | row marked **Stalled** (once; no repeats while stalled); clears if data resumes | `DOWNLOAD STALLED: … at X of Y` |
| 60 s | download aborted, partial file deleted | `DOWNLOAD FAILED (stalled): … Retry once, or try another mirror/source.` |

**Telling the AI it finished:** the completion line carries the **full local path** —
`DOWNLOAD COMPLETED: <name> (<size>) saved at <path> — the file is ready to use at that path`. Download
lines are added to the agent's history after each step. If a background download finishes **after the
task ended**, its completed/failed event is kept and delivered at the start of the **next** agent task
(other old download events are dropped then). The system prompt (`ai-engine.ts`) tells the agent never to
claim success before `COMPLETED`, to `wait` for short downloads, and to hand long ones back to the user
(Downloads panel) instead of waiting.

**Download tools for the agent** (`App.tsx`, agent loop; parsed/validated in `page-agent.ts`):
`list_downloads` returns the Downloads panel queue (active first: `[id]`, state, %, size, speed, ETA,
path, started by agent/user). `cancel_download` / `pause_download` / `resume_download` /
`retry_download` take that id **or the file name**, and reuse the panel's own handlers. Pause/resume
only for normal downloads (not agent or video ones); retry only for failed/cancelled ones; cancelling a
download the **user** started goes through the safety-brake confirmation. Tested end to end with a
scripted mock model (`E2E_MOCK_SCRIPT`, see `ai:action` in `main.ts`).

Verified with a local test server: the action returned in ~80 ms; a 200 MB file finished byte-exact with
1 s updates; main-process IPC latency stayed at 2–4 ms during the download; stall flagged at ~16 s and
failed at 60 s with the partial file removed; cancel removed the partial file.

**Torrents** are controlled by the menu switch **🧲 Built-in torrent client** (`localStorage`
`torrentBuiltin`, sent to main with `torrent:set-builtin` at startup and on toggle).
**Default: OFF.**

| Input | Built-in **OFF** (default) | Built-in **ON** |
|---|---|---|
| `.torrent` link (click, popup, address bar, agent) | Saved to Downloads as a normal file | Opens the "Save or Play" torrent card |
| `magnet:` link / pasted magnet | Handed to the OS's default torrent app (`shell.openExternal`) | Opens the torrent card |
| Torrent engine process | Never started | Started on the first torrent opened |

Where it's decided (all in the main process, so every entry point behaves the same):

- `torrentManager.handleUri()` ([`torrent-manager.ts`](src/main/torrent-manager.ts)) — card if ON; magnet → OS app if OFF.
- `will-navigate` / `setWindowOpenHandler` in `main.ts` — always route `magnet:`; route `.torrent` only when ON.
- `interceptDownload` (download-manager dep, wired in `main.ts`) — when ON, a `.torrent` that reaches
  `will-download` by any path (e.g. typed in the address bar) is cancelled and sent to the card instead.
- Pasted magnets in the address bar go through `torrent:open` → `handleUri()` (the renderer never decides).

The separate **🌱 Share torrents (seed)** switch (default OFF) only matters when the built-in client is ON.

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

**Agent at a login form** (`loginWaitStep`, `waitForExtensionLogin` in `App.tsx`). On an account task:

- With a password-manager extension, Bah waits up to 8 s for the extension's own auto-login. If the form
  disappears or the page shows signed-in, the agent continues.
- Bitwarden's "Autofill on page load" only fills. If the extension filled the password, Bah presses the
  form's Sign in once.
- 1Password never fills on its own, so Bah does not wait for it.
- Otherwise Bah pauses with a card naming the extension's setting: LastPass "Auto-login" (site item →
  Edit → Advanced Settings), Bitwarden "Autofill on page load" (Settings → Autofill, also per login), or
  1Password's pick-and-submit.
- The agent never types credentials. Bah asks the page only whether the password field is empty (yes/no)
  and never reads the value.

**Extension UI is not part of the page** (`shared/extension-ui.ts`). The agent never sees or clicks
`chrome-extension://` iframes, or the marked injection roots under which LastPass and 1Password draw
their icons and menus:

- they are removed from the main accessibility tree (`cdp:axtree`) and from the iframe trees
  (`cdp:frames-ax`);
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

## Agent sessions (tab chips + shared conversation)

A **session** is the line of work the assistant follows: one tab, or a group of tabs that share one
conversation. A tab gets a session the first time the assistant is used on it (`ensureSession`): the
name comes from the request ("Job hunt", "Groceries", "Trip"…), the colour is one not in use. On the tab
strip it shows like a Chrome tab group — a coloured chip with the name before the session's tabs, the
same colour underlining each of them; the panel shows the same chip (click to rename). Tabs the agent
opens during a task, and links opened in a new tab from a session tab, join that session; the tab's
right-click menu adds it to another session, starts a new one or removes it; dragging a tab between two
tabs of a session joins it, dragging it away leaves.
The conversation is keyed by **thread key** = session id (or the tab id when the tab has none): the
panel feed (`AgentCommandBar` `feedsByTab`), the main process chat memory (`ai-engine.ts`
`conversationHistories`, moved with `ai:move-history`) and the recent-requests memory the agent prompt
starts with (`recentRunsRef`). When a tab's key changes, its conversation moves with it
(`bah:move-thread`). Rules: `src/shared/agent-sessions.ts` (tested in `tests/unit/agent-sessions.test.ts`);
state: `store.ts`; UI: `TabBar.tsx`, `AgentCommandBar.tsx`; end to end: `tests/e2e/agent-sessions.spec.ts`.
Sessions live in memory for now (restore + chat history come next).

## Command routing & follow-ups

The box under the assistant decides per message: agent task, answer about the page, web answer or chat
(`routeCommand` in `AgentCommandBar.tsx`; with a cloud AI a one-word classifier in `App.tsx`
`classifyIntent` goes first, with a local AI the word rules decide). Before any of that:
- a **question about the last run** ("did you click it?", "what happened?") → chat with a log of that
  run (`src/renderer/last-run.ts` `lastRunDigest`), never a web search;
- a **report that the last run fell short** ("one window was opened, but not the second") → back to the
  agent (`reportsIncompleteRun`), which gets the previous requests and how they ended;
- a message that **starts with an action verb** ("search for…", "find…", "browse to…") → agent
  (`src/renderer/route-words.ts`); questions keep going to the web answer.
Each finished run records the last thing it acted on, and the prompt says "it / that one" means it.
"N <anything> … each / different" opens N videos even with a typo (`site-knowledge.ts`, tested by
bundling in `tests/unit/quick-video.test.ts`). Web answers drop search-engine pages from their sources
and never show a raw `[[ACTION: …]]` tag; a suggested action of "none" is not shown as a button.

**Plain-text files in dark mode.** Chromium's text viewer turns the text light in a dark scheme, but a
site that sends `Content-Security-Policy: default-src 'none'; sandbox` (Hugging Face, GitHub raw) never
gets the matching dark background → white on white. `main.ts` inserts a user stylesheet
(`PLAIN_TEXT_VIEWER_CSS`, matching only the viewer's `<meta>` + `<pre>` layout) so background and text
follow the same scheme (`tests/e2e/plain-text-dark.spec.ts`).

**Pages that forbid scripts.** That same CSP turns off the page's JavaScript, and with it every
`<webview>.executeJavaScript` Bah uses to read pages (text sample, `extract_text`, page state, job
listings, forms). `src/renderer/page-eval.ts` wraps `executeJavaScript` on every tab once
(`WebViewContainer`): it tries the page world; if that fails, a trivial probe tells a real script error
(passed on, never re-run) from a page that blocks scripts (→ the same code runs in Bah's **isolated
world** 1047 through `page:eval-isolated` in `main.ts`, the mechanism extension content scripts use,
remembered until the tab's address changes). Tests: `tests/unit/page-eval.test.ts`,
`tests/e2e/no-js-page.spec.ts`.

## Navigation skills (`skills/*/SKILL.md`)

Short, tested recipes the agent gets **only when they apply**, instead of one ever-growing system prompt
(a small local model follows a short, relevant prompt far better). Format is compatible with the
`SKILL.md` used by Browse.sh / agent-browser: YAML-ish front matter + a markdown body (≤ 220 words).

```markdown
---
name: eula-accept            # must equal the folder name
description: Accept a standard software license as part of a requested download.
states: [eula]               # page states Bah detects (see below)
tasks: [download]            # task types: download, search
sites: [booking.com]         # optional: hosts (subdomains match)
priority: 35                 # tie-breaker, higher first
---
1. ...steps written in terms of Bah's actions (click_ref, check, select_option, find, look_at...)
```

A skill is used when **every** list it declares matches; each step injects at most 3, most specific
first (site > page state > task), as a `SKILLS FOR THIS PAGE` section near the top of the prompt.

| Page state | Detected when (`App.tsx`, per step) |
|---|---|
| `dialog` | a visible modal (`role=dialog`, `aria-modal`, `<dialog open>`) covers ≥4% of the viewport |
| `suggestions` | a visible autocomplete/listbox with options |
| `datepicker` | `input[type=date]`, `role=grid`, calendar/datepicker widgets |
| `eula` | controls mention EULA / license agreement / accept the terms |
| `os-selector` | controls offer Windows **and** macOS/Linux |
| `searchbox` | a visible search / destination / city field |
| `tabs` | a tab strip (`role=tablist`, or ≥2 controls named like Overview / Specifications / Reviews / Accessories…) |
| `cards` | ≥3 sibling cards of the same kind, each with a link (job/hotel/product lists) |
| `signin` | a visible password field, a login page (title/path), or a "sign in to see/continue…" wall |

Task types come from the request: `download` (download words, typos included), `search` (find/search/
compare/cheapest/list...), `travel` (hotels, lodging, flights...), `shopping` (stores, prices, buy...), `parts`
(charger/adapter/battery/compatible...), `people`, `jobs`. Per-site **account state** (signed in / signed out, read from the page each step and remembered per site for the session — `agent-login-policy.ts`) goes in the prompt as an `ACCOUNT:` line. **Bundled skills are general rules, not recipes for named sites** —
site-specific recipes belong in user/contributed skills.
User skills live in `<userData>/skills/` (menu → 🧩 My skills); after a successful task Bah offers to draft one
("Save as skill" → review → Save → optional GitHub proposal). See [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md). Code: parser + selection `src/shared/skills.ts` (unit-tested in
`tests/unit/skills.test.ts`, which also checks every bundled skill parses, has triggers and stays short),
loader + `skills:list` IPC `src/main/skills-loader.ts` (re-reads files in dev; packaged via
`electron-builder.yml` `files`). Bundled skills: `popup-dismiss`, `autocomplete-pick`, `date-picker`,
`site-search`, `page-tabs`, `download-chain`, `eula-accept`, `os-selector`, `product-specs`, `compatible-part`,
`shopping-compare`, `used-listings`, `travel-search`, `people-search`, `job-apply`, `card-list`, `sign-in`.

---

## Build & release

> **E2E on macOS:** launch Electron with `--use-mock-keychain`. The password vault (`safeStorage`) otherwise opens a Keychain prompt for the unsigned dev build in a fresh test profile, and the synchronous call freezes the main process (Playwright then times out with no error).

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
