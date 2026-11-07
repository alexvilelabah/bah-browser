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

### Agent cursor (what the user sees)

`components/AgentVisualOverlay.tsx` draws an agent cursor over the page that glides on an arc
(`src/shared/agent-cursor-path.ts`, ~450 ms, ease-in-out; it jumps straight there with reduce-motion)
from its last position to each click, and the click ripple appears where it stops. The overlay is
`position:absolute; inset:0` over the page area, so positions are measured from the overlay's own
corner; adding the page's offset in the whole window (as before) drew the cursor and ripple about
100 px below the real click. `tests/e2e/agent-cursor.spec.ts` compares the drawn cursor and ripple
with the click the page received. It drives the real agent loop with `E2E_MOCK_SCRIPT` (a JSON list
of actions the mocked model returns, one per step; test-only, needs `E2E_MOCK_AI=1`).

### Real mouse events follow the drawn arc (what the page sees)

`input:click` in `main.ts` sends real `mouseMove` events (`webContents.sendInputEvent`) along
`arcPath()` from `src/shared/agent-cursor-path.ts` — the same arc, side, easing and ~450 ms as the
drawn cursor — from where the pointer stopped after the last click in that tab (`lastPointer`) to
the target, then re-measures the target and clicks its centre, with no random offset. Before, the
page got a short straight approach with random jitter while the overlay drew something else. This
does not try to pass as a person: a session recorder (HotJar and the like) shows the same smooth
arcs every time, recognisable as Bah's agent. The agent-cursor e2e checks the page received 10+
moves that end on the click and bow away from the straight line.

---

## `src/main/` — privileged process

| File | Responsibility |
|---|---|
| `main.ts` | App bootstrap, window, `<webview>` session, **all IPC handlers**, real input (`sendInputEvent`), adblock, downloads wiring, safe-browsing, hardware-accel toggle |
| `ai-engine.ts` | Every cloud/local AI call (DeepSeek / Mistral / NVIDIA NIM / Ollama) + the system prompt and tool list |
| `site-locale.ts` | **Single source** for the language sites receive (Accept-Language / navigator.languages / --lang follow the UI choice) |
| `chrome-identity.ts` | **Single source** for the browser identity sites see: User-Agent, `sec-ch-ua` client hints, `navigator.userAgentData`, header order (applied by `main.ts` through CDP) |
| `page-agent.ts` | Cloud-side reasoning helpers for the agent |
| `download-manager.ts` | Native download manager: pause/resume/cancel/queue/ETA, guarded `open-file` |
| `agent-download-worker.ts`, `download-progress.ts` | The agent's `download` action: one `worker_threads` worker per download; progress cadence + stall policy. See [Downloads & torrents](#downloads--torrents) |
| `torrent-manager.ts`, `torrent/engine.mjs` | **Optional** built-in torrent client (off by default): IPC bridge + the engine, isolated in a `utilityProcess` that only starts when used. See [Downloads & torrents](#downloads--torrents) |
| `media-downloader.ts` | `yt-dlp` / `ffmpeg` wrapper (video/audio download) |
| `video-cuts.ts`, `transcript.ts` | Local video features (locate where a phrase is spoken, transcripts) — native ffmpeg |
| `image-harvester.ts` | Bulk image download + AI image generation (Pollinations), with limits |
| `ocr-engine.ts`, `page-capture.ts` | On-device OCR (Tesseract) + screenshots |
| `data-view.ts` | Renders data tables/charts to a local page (no CDN) |
| `validate.ts` | Path-safety helpers (`isInsideAllowedRoot`, etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Popup/overlay handling and dismissal |
| `js-dialogs.ts` (+ `src/renderer/js-dialogs.ts`, `components/JsDialogHost.tsx`) | Page `alert`/`confirm` in tabs: replaces Electron's blocking native box (internal `-run-dialog`) with Bah's dialog for the user, and the agent policy on its tabs (armed `dialog` action > alert closes > ordinary confirm accepted > payment/delete confirm asks the user); `beforeunload` on agent tabs leaves when the agent navigates. `prompt()` is not available in Electron (it throws) |
| `job-queue.ts` | Serialises long-running jobs |
| `frames.ts` (+ `src/shared/frames.ts`) | Iframe content for the agent (embedded job/payment/booking forms): accessibility trees of same-process frames (by `frameId`) and cross-origin frames (flattened CDP sessions via `Target.setAutoAttach`), coordinates mapped to the page viewport; elements are listed with `frame="host"`. Fills set the value on the node inside its frame (focus-independent); clicks in cross-origin frames use CDP `Input` on the frame's session (`sendInputEvent` stops at the `<iframe>`). Extension-injected `chrome-extension://` frames are left out |

### Browser identity (what sites see)

Sites used to flag Bah as a bot often enough that agent tasks failed; part of the reason was an
identity that contradicted itself. Bah now presents as what it is — a current Chrome-based browser
on the user's own computer — with every signal agreeing. Nothing here solves a CAPTCHA or gets
around a block.

- **One source.** `chrome-identity.ts` builds the User-Agent, the `sec-ch-ua` headers and the
  `navigator.userAgentData` values from the same data. `main.ts` applies them **inside the engine**
  with CDP `Emulation.setUserAgentOverride` when a tab is created (and again if the debugger
  re-attaches), together with the languages from `site-locale.ts`. Pages read the final values from
  the first script on; nothing is patched in JavaScript afterwards. Before, the header said one Chrome
  version and brand order while the page script said another, and a page could read the real value
  before the patch ran — a mismatch detectors look for.
- **Version.** `CURRENT_CHROME_MAJOR` (bump it when stable Chrome moves, about every 4 weeks) in the
  reduced `NNN.0.0.0` format real Chrome sends; Electron's Chromium is usually a few versions behind.
  The engine's version is used instead when it is newer.
- **Real OS and architecture.** The UA platform token and `sec-ch-ua-platform` follow the real OS (it
  used to say Windows everywhere, so driver/installer sites offered Windows files on a Mac);
  `getHighEntropyValues()` reports the real CPU architecture.
- **Headers in Chrome's order;** brand hints only on https and localhost, as Chrome does.
  `sec-ch-ua-arch`/`bitness` are not added to every request (Chrome sends them only when a site asks).
- **`navigator.webdriver` is left to the engine.** A normal launch reports `false`, like Chrome. The
  old patch replaced it with `undefined`, a value no real Chrome has. Launches driven by Playwright
  (e2e tests, demo recordings) report `true` — judge bot-check rates from a normal launch.
- **Real GPU, cores and memory.** The page script used to report "Intel Iris 6100", 8 cores and 8 GB
  on every machine, while the page's own workers saw the real values. Now nothing is overridden
  (`tests/e2e/hardware-identity.spec.ts`).
- **Diagnostics:** `BAH_DEBUG_IDENTITY=1` logs what each page sees (webdriver, UA, brands, languages)
  to `agent.log`. `tests/e2e/browser-identity.spec.ts` checks that header and JavaScript agree.
- **Known limit:** the full version is `NNN.0.0.0`, not a real build, and the engine may be a few
  versions older than the Chrome it reports; a detector can notice missing newer features.

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
   written chunk by chunk with back-pressure (`drain`). Memory stays flat regardless of size.
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
claim success before `COMPLETED`.

**Download tools for the agent** (`App.tsx`, agent loop; parsed/validated in `page-agent.ts`):
`list_downloads` returns the Downloads panel queue (active first: `[id]`, state, %, size, speed, ETA,
path, started by agent/user). `cancel_download` / `pause_download` / `resume_download` /
`retry_download` take that id **or the file name**, and reuse the panel's own handlers. Pause/resume
only for normal downloads (not agent or video ones); retry only for failed/cancelled ones; cancelling a
download the **user** started goes through the safety-brake confirmation.

**When a download task ends** (`App.tsx`, rules in [`download-steps.ts`](src/renderer/download-steps.ts)):
- One file and nothing after it ("download X"): the task ends as soon as that download starts, with
  "⬇️ Downloading <file> (size) to <folder> — follow its progress on the download button". After a click
  in a download task, Bah waits up to 2.5 s for the download to start before the next step.
- Several files ("both", "all", "3 videos") or a step after it ("…and install it", "…then summarize"):
  Bah itself waits (no model calls; the task deadline is paused) until every download of the task
  completes or fails, shows "⏳ Waiting for downloads: a.dmg 45% (ETA …)", and gives the model
  `DOWNLOAD COMPLETED` lines with the saved paths before the next step.
- An app-download page ("Get the app", "Download for Mac") is not treated as a dead end in a download
  task (`commandWantsDownload` in `agent-recovery.ts`).
- The toolbar download button shows a Chrome-style ring with the combined progress of the active
  downloads; it spins when the size is unknown, greys out when all are paused and flashes when
  everything is done ([`download-ring.ts`](src/renderer/download-ring.ts), `components/DownloadButtonIcon.tsx`).

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
| `pacing.ts` | Per-site pacing between agent actions (random 1–5 s; 15–30 s for 30 min after a bot check) |

### Per-site pacing

`pacing.ts`, used by the agent loop in `App.tsx`. Before each action that touches a page (navigate,
clicks, fill/type, press, scroll), the agent waits until the next allowed time for that host; after
the action the next gap is drawn at random between **1 and 5 s**, so no run of actions has a regular
rhythm (a steady click every 2–4 s was what got the agent treated as a bot on shopping sites). When an
observed page looks like a bot check (`BOT_CHECK_RE`: "robot check", "unusual traffic", "verify you
are human", "just a moment", captcha…), that host gets **15–30 s** gaps for **30 minutes**, and the
prompt tells the model to do only what is necessary there and to prefer another source. Other hosts
and internal actions (extract, store, report…) are not delayed; Stop still cancels during a wait.
Pacing only slows the agent down; it does not solve or skip the check.

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
