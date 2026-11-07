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
| `media-downloader.ts`, `media-parts.ts` | `yt-dlp` / `ffmpeg` wrapper (video/audio download); parts/merge/interrupted-download logic. See [Downloads & torrents](#downloads--torrents) |
| `video-cuts.ts`, `transcript.ts` | Local video features (locate where a phrase is spoken, transcripts) — native ffmpeg |
| `image-harvester.ts` | Bulk image download + AI image generation (Pollinations), with limits |
| `ocr-engine.ts`, `page-capture.ts` | On-device OCR (Tesseract) + screenshots |
| `data-view.ts` | Renders data tables/charts to a local page (no CDN) |
| `validate.ts` | Path-safety helpers (`isInsideAllowedRoot`, etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Popup/overlay handling and dismissal |
| `js-dialogs.ts` (+ `src/renderer/js-dialogs.ts`, `components/JsDialogHost.tsx`) | Page `alert`/`confirm` in tabs: replaces Electron's blocking native box (internal `-run-dialog`) with Bah's dialog for the user, and the agent policy on its tabs (armed `dialog` action > alert closes > ordinary confirm accepted > payment/delete confirm asks the user); `beforeunload` on agent tabs leaves when the agent navigates. `prompt()` is not available in Electron (it throws) |
| `job-queue.ts` | Serialises long-running jobs |
| `frames.ts` (+ `src/shared/frames.ts`) | Iframe content for the agent (embedded job/payment/booking forms): accessibility trees of same-process frames (by `frameId`) and cross-origin frames (flattened CDP sessions via `Target.setAutoAttach`), coordinates mapped to the page viewport; elements are listed with `frame="host"`. Fills set the value on the node inside its frame (focus-independent); clicks in cross-origin frames use CDP `Input` on the frame's session (`sendInputEvent` stops at the `<iframe>`). Extension-injected `chrome-extension://` frames are left out |
| `upload.ts` | Agent `upload` (OS file dialog → token; file field by node/label/position, or the OS picker intercepted with `Page.setInterceptFileChooserDialog` during the action; `DOM.setFileInputFiles`) and session folder grants for `list_files` / `read_file` / `upload { file }` (realpath-checked) |

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
claim success before `COMPLETED`, to `wait` for short downloads, and to hand long ones back to the user
(Downloads panel) instead of waiting. A plain `{ "ms": N }` wait is slept in the renderer (up to 60 s) and
ends early when a download of this task completes or fails.

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

#### "Download <software> for this computer" (installers and drivers)

Steam, a printer driver, Office, SolidWorks… the agent must get the **vendor's official** build that runs
**on this machine**. The pure logic lives in [`src/shared/software-download.ts`](src/shared/software-download.ts)
(unit tests in `tests/unit/software-download.test.ts`); [`src/main/machine-info.ts`](src/main/machine-info.ts)
reads the system once (`process.platform`/`arch`, `getSystemVersion()`, Rosetta via
`app.runningUnderARM64Translation`, `/etc/os-release` on Linux) and serves it to the renderer as `machine:info`.

- **Machine profile → the agent.** `machineProfile()` gives OS name + version (macOS codename, Windows 10 vs 11
  by build, Linux distro and `.deb`/`.rpm`), CPU (Intel x64 / Apple Silicon / ARM64 / 32-bit) and `pickHint()`:
  one sentence of what to choose (Intel Mac → "Intel / x64 / Universal .dmg or .pkg, not arm64-only"; Windows
  x64 → ".exe/.msi x64"; Linux → package type). It is in the system prompt (`USER'S COMPUTER`) and, for
  download tasks, a `THIS COMPUTER: … PICK: …` line next to `DOWNLOADS` in every step.
- **Checking the file that started.** `checkBuild(filename)` classifies by extension and name tokens
  (`arm64`/`aarch64`/`apple-silicon`, `x64`/`x86_64`/`amd64`/`intel`, `universal`, `win`/`mac`/`darwin`/`linux`).
  `error` = will not run here (wrong OS, arm64 build on an Intel Mac, `.rpm` on Ubuntu) → `WRONG OS` / `WRONG CPU` /
  `WRONG PACKAGE` on the `DOWNLOAD STARTED` line (and in `DOWNLOADS`), and such a download never counts as success.
  `warn` = runs but not native (Intel build on Apple Silicon via Rosetta, x86 on Windows x64) → a soft note.
- **Third-party "free download" sites** (Softonic, FileHippo, Uptodown, CNET…): `thirdPartyDownloadSite()` flags
  the page and downloads from them with `THIRD-PARTY DOWNLOAD SITE` (outdated or bundleware installers) and
  sends the agent back to the vendor. Which domain *is* official is left to the agent (web search) and to
  `site-knowledge.ts`.
- **The download button, whatever its words.** `isDownloadControl(label, href)`: "Download…" always
  counts; vendor wording ("Install Steam", "Get the app", "Install now", "Try free") only when it leads to an
  installer file or is a plain button. App-store and extension-store links never count. The agent's element
  list comes from the accessibility tree and has no `href`, so the candidates' targets are read from the DOM
  and matched to the `[id]`s by text and position (`matchControl`, [`src/shared/page-controls.ts`](src/shared/page-controls.ts)).
  `LIKELY DOWNLOAD BUTTON` shows the target file, leaves out wrong-OS/CPU files, and a `click_text` with the
  same label is turned into a `click_ref` on that button. Without this, Steam's menu "Install Steam" (which only
  reloads the page) was clicked in a loop.
- **ARIA-less modals.** The `uiState` pass also collects fixed/high-z panels; `pickOverlay` scores them by
  covering the viewport centre, a backdrop, z-index and action buttons. An empty backdrop no longer wins the
  old "≥ 20% of the screen" rule. The `OPEN DIALOG/POPUP` line lists the dialog's own buttons with their `[id]`s
  (HP's download modal: the modal's "Download" vs the page's). `tests/unit/page-scripts-syntax.test.ts` parses
  every page script in `App.tsx`; a single-backslash regex in one had silently disabled all of `uiState`.
- **Sign-in walls.** In a download task (after the first step), `signInWall()` — a password field, an auth host
  (`login.*`, `auth.*`, `login.microsoftonline.com`…), a `/signin`/`/register` path, or "sign in to download" text —
  pauses the agent with the manual-help card (`dl.signinWall.*`): the user signs in themselves or stops. The agent
  never types passwords or creates accounts. A "Sign in" link in a site header does not count.
- **Never runs anything.** Nothing opens a download on its own: `download:open-file` only runs on the user's
  click (Downloads panel, result tile), and the agent has no "open file" action. The `software-download` skill
  (`skills/software-download/SKILL.md`) also tells the model never to open or run the installer.

Tested with `tests/e2e/software-download.spec.ts` (synthetic vendor pages: auto-detect button, OS/CPU list,
printer model picker with an ARIA-less modal, a Steam-like page whose only download control says "Install Steam", sign-in wall).
#### Video / audio (`media-downloader.ts`, `media-parts.ts`)

yt-dlp downloads a high-resolution video as two **component files** — `Title [id].f313.webm` (picture
only) and `Title [id].f140.m4a` (sound only) — and then ffmpeg joins them into `Title [id].mp4`. With
`--no-part` the parts carry those names while they are being written, so a part must never be taken
for the result:

1. yt-dlp runs with `--no-quiet` (the `--print after_move:filepath` alone switches on quiet mode and hides
   the `Destination:` / `Merging formats into` lines). Those lines are the exact list of files **this**
   download wrote; nothing else is ever deleted.
2. After each run, `classifyRun` ([`media-parts.ts`](src/main/media-parts.ts)) decides: success only with a
   final file that exists and is not a `.f<id>.` part. Parts left over (non-zero exit, or exit 0 without a
   merge) mean **"the audio and video parts were not joined"** — a failure, and the parts are removed. If
   both parts are complete (100% in the progress, or yt-dlp exited 0), Bah joins them itself with
   `ffmpeg -c copy` (mp4 when the codecs fit, otherwise mkv) instead of failing.
3. A normal video request (not mp3) is checked with `ffprobe` from the same ffmpeg folder. No audio
   stream → one retry with `-f "bv*+ba/b[acodec!=none]" --force-overwrites`; if the source has no audio
   format at all the file is kept and the agent is told it has no sound; otherwise it is a failure.
4. Quit / crash: yt-dlp runs in its own process group (`detached`), so it does not die with Bah. On
   `before-quit`, `stopAllMediaDownloads()` kills every yt-dlp group. Each download is recorded in
   `userData/media-downloads.json` (folder, start time, files written, pid, what "retry" needs); a
   finished file leaves the record as soon as it is printed. At the next launch
   `recoverInterruptedDownloads()` stops a leftover yt-dlp, deletes only the recorded files that are in
   that download's folder and not older than it, and the Downloads list shows the download as
   **Interrupted** with ↻.

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
| `agent-permissions.ts` | What the agent may use besides its own task tabs — your other tabs and your history: Ask (default) / Always / Never |
| `shared/html-clean.ts` | `get_html`: the in-page DOM walk (`collectHtmlScript`, run through `executeJavaScript` so it falls back to the isolated world on no-script pages) and the pure cleaner/serializer (`serializeHtml`): attribute allowlist, secret values redacted, script/style/svg bodies dropped, `data:` URLs shortened, `[#N]` element-list refs (stamped by `cdp:mark-refs` in `main/frames.ts` under a nonce attribute, removed after the read), `[hidden]` marks; paged by `offset` on tag boundaries (`serializeHtml` → `shared/read-paging.ts`). The HTML goes in the next prompt only, framed as page data, not instructions |
| `shared/read-paging.ts` | How much one `get_html` / `extract_text` read returns and paging through the rest. `readBudget`: clamp(free context tokens × 0.4 × 3.5 chars/token, 4,000, 60,000), free = window − last prompt (context meter) − 4,096 answer reserve; default 6,000 on windows under 64k, 12,000 above; `max` up to the budget, an over-ask is served at the budget and says so. `pageHtml` / `pageText`: pages on tag / line boundaries that tile exactly, each stating "chars A–B of N" and ending with the exact next call. The one-step PAGE HTML / PAGE TEXT (extracted) blocks (end markers; the cloud observation slice grows by their length) and the action normalisers |
| `agent-run-logger.ts` | Opt-in run logging (local training-data collector) |
| `store.ts` | UI/settings state (localStorage) |
| `i18n.ts` | Hand-rolled en / pt / es; **English is the default** |
| `macros.ts` | Record/replay of deterministic macros |
| `pacing.ts` | Per-site pacing between agent actions (random 1–5 s; 15–30 s for 30 min after a bot check) |
| `search-engines.ts` | Search engine order for quick research and the agent's `web_search`, and which engines are blocked right now |
| `known-sites.ts` | Curated site name → official URL map (no guessed domains) |
| `stores.ts` | "Did the request name a place to buy?" (`namesStore`), by the shape of the request, no store list |
| `command-history.ts` | ↑/↓ in the command box recall earlier commands |

### Search engines, request routing and named sites

**Search engines.** Quick research and the agent's `web_search` action open the search in a hidden
tab and read the results (title, URL, snippet). `search-engines.ts` gives the order: Google → Bing →
DuckDuckGo → Yahoo → Perplexity, or the engine picked in ⋮ → 🔎 "Search engine for AI" first. An engine
that shows a block page ("unusual traffic", captcha, "verify you are human"…) is skipped for an hour;
that is noticed both by the hidden search and when the agent itself lands on such a page. The agent
prompt gets a `SEARCH ENGINE:` line with the current order. DuckDuckGo, Yahoo and Bing redirect links
are decoded to the real site address. The address bar keeps its own engine (⋮ → Search engine); the
AI choice is stored under its own key (`agentSearchEngine`) and, while unset, follows the address-bar
engine when the agent knows it. `web_search` is allowed on careful sites (`CAREFUL_ALLOWED`).

**Routing.** Before the word rules send a message to the web answer, `AgentCommandBar.tsx` sends these
to the agent: downloads (common typos included), bookings with a date (hotel, flight, rental car…),
a named place to buy plus a shopping verb (`namesStore`: "… at/on/from <name>" or a domain, not
times or "from the movie …"), and part lookups ("compatible charger for <model>"). The Google
Shopping shortcut stands aside when a store is named; the Amazon and Wikipedia shortcuts follow the
system locale instead of Brazil.

**Named sites go straight to their official address.** `src/renderer/known-sites.ts` is a short,
hand-checked map of well-known sites (LinkedIn, Indeed, GitHub, Amazon for your country, Walmart, Whole
Foods, YouTube, Gmail, Google…) → official URL. When a command names one ("browse to linkedin, find a
job…"), the agent's first prompt gets a `NAMED SITE:` line with the address and the rule "navigate,
don't web_search the name"; every prompt lists the map under `OFFICIAL SITES`; with a local AI the fast
path opens it directly (`getInitialShortcutAction`). Names that are also common words ("indeed",
"target") only count after "go to / on / at / abra…". A name that is not on the list is never turned
into a guessed domain (typosquatting): it still goes through `web_search`. Tests:
`tests/unit/known-sites.test.ts`, `tests/unit/named-site-shortcut.test.ts`, `tests/e2e/named-site.spec.ts`.

**Follow-ups and the last run.** Before the word rules (and before the classifier, when the local
router is not ready):
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

**"Summarize my open tabs".** `wantsTabsSummary` (`src/renderer/tabs-summary.ts`) turns the request
into the `summarize_tabs` action, even with the AI in charge (otherwise the model would visit every tab
with `switch_tab`). The executor in `App.tsx` picks the tabs (`selectTabsForSummary`: no incognito tabs,
no internal pages such as `about:`, `file:` or Bah's own player; sleeping tabs are listed as asleep and
only woken when the user asks, e.g. "including the sleeping ones"), checks the **your tabs** permission
once for the set (`tabsAccessDecision`: ask / always / never from the menu; the task's own tab needs
none), reads each tab's text with `<webview>.executeJavaScript` and makes one stateless model call for a
per-tab line plus an overall summary. A tab whose page blocks scripts is listed as "could not read". The
panel shows a card with one link per tab that switches to it. Tests: `tests/unit/tabs-summary.test.ts`,
`tests/e2e/tabs-summary.spec.ts`.

**Plain-text files in dark mode.** Chromium's text viewer turns the text light in a dark scheme, but a
site that sends `Content-Security-Policy: default-src 'none'; sandbox` (Hugging Face, GitHub raw) never
gets the matching dark background → white on white. `main.ts` inserts a user stylesheet
(`PLAIN_TEXT_VIEWER_CSS`, matching only the viewer's `<meta>` + `<pre>` layout) so background and text
follow the same scheme (`tests/e2e/plain-text-dark.spec.ts`).

### Local router (Qwen2.5-1.5B, optional)

When the routing model is downloaded, a small local LLM labels **every** message before anything
reaches the big model — in cloud *and* local mode — and the word rules above become the fallback.
- **Model:** `Qwen/Qwen2.5-1.5B-Instruct-GGUF` `q4_k_m` (Apache-2.0, 1,117,320,736 bytes, sha256
  `6a1a2eb6…9407e`) in `<userData>/models/`. Never bundled: the assistant settings show a card
  ("Download the 1.1 GB routing model?"); `router:download` runs only after that click, resumes a
  `.part` with `Range`, and checks size + sha256 before renaming (`src/main/router/model-download.ts`).
- **Engine:** `src/main/router/engine.mjs` (esbuild bundle, `node-llama-cpp` external) in a
  `utilityProcess`, started 3 s after the window shows, only if the file is there. `gpu: 'auto'`
  (Metal / Vulkan / CPU; integrated GPUs on Vulkan stay on CPU: `isIntegratedGpu`, Vulkan whose memory
  is all shared with system RAM); if it fails to load it retries once on CPU, then `router:status` = `error`
  and the word rules route. A crash only kills that process. node-llama-cpp tests its native binary in a
  child process on Windows/Linux; from a utility process that fork would start another Bah (the
  `RunAsNode` fuse is off), so the engine forwards that fork to `router-manager.ts`, which opens the
  test file as another utility process.
- **Prompt** (`src/shared/router-routes.ts`, idea from Arch-Router, none of its weights or text): routes
  `{name, description}` with descriptive keys the model writes (`browser_task`, `about_this_page`,
  `web_question`, `greeting_or_chat`, `explain_last_task`, `redo_last_task`, `other`), rules and a few
  examples. That system prompt is the fixed prefix, evaluated once; per message only
  `Open page / Last task / Message` is processed. Output is held by a JSON-schema grammar to
  `{"route": "<one key>"}`. LAST_RUN vs FIX is then settled by the sentence's shape (question →
  LAST_RUN, statement → FIX). The router only labels text; it never acts, and the text never leaves the machine.
- **Mapping** (`classifyIntent` → `routeCommand`): ACTION → agent, PAGE/CHAT → chat (page attached),
  WEB → web answer, LAST_RUN → chat with the last run's log, FIX → agent; `other` / timeout (5 s) →
  the previous path. The box sends the last task as `Last task` (`lastRunSummary`: the request and how it
  ended, one line each). While the router is ready, the box skips its own "last run" and "points at the
  open screen" word rules (the router's LAST_RUN/FIX/PAGE cover them); if the router answers nothing,
  `classifyIntent` applies the two last-run rules itself. Still
  ahead of the router: short greetings, the agent-drive toggle, repeat/macro intents, vague-request
  hints and the zero-token quick actions.
- **Eval:** `npm run router:eval` runs the same core (`router-core.mjs`) in plain Node over
  `tests/fixtures/routing-cases.json` (82 en/pt/es cases, some with a last task) and scores the word
  rules on the same set. On an Intel i7-9750H (CPU): router 89.0 % (90.2 % with the greeting fast path)
  vs word rules 84.1 %, p50 ≈ 0.6–0.9 s, p95 ≈ 1.0–1.4 s, load ≈ 9 s, ≈ 0.9 GB RSS in Node (≈ 2 GB
  reported for the utility process, model file mmapped). Smoke: `tests/e2e/router-local.spec.ts`
  (skips without the model; `BAH_ROUTER_MODEL` points at the file).
- **Request expansion** (`src/shared/request-expansion.ts`, IPC `router:expand`): before the agent
  starts a task, a "find/download" request about a named work (`shouldExpandRequest`: find/download
  verb + media noun + a work after from/of/do/de…; never URLs or plain commands) is rewritten by the
  same model in a second, small context (1024 tokens, own JSON grammar `{"understood": "…"}`,
  ≤ 96 tokens, temperature 0). The prompt only allows disambiguation (year, performer, original vs
  sequel/remake, full names) and forbids track lists, new steps, composers/directors. The main process
  checks the output (`checkExpansion`): junk/refusals, > 320 chars, missing key terms of the request
  (synonyms movie↔film, plurals and one-letter typos tolerated), a new action (buy/send/play/open/…),
  a new number other than a year, a capitalised name the user never wrote (except after "not …"), or a
  new site → dropped. Timeout 3.5 s (renderer 4 s); no model, slow or dropped → the original text.
  Accepted text shows in the feed as "🔎 Understood as: …" and goes to the agent as an
  `UNDERSTOOD AS (… a GUESS … the GOAL wins …)` line under `GOAL:` (kept when the history is trimmed,
  cleared when the user edits the goal). The 1.5B model's facts are often wrong (it said "Bad by The
  Beatles"), hence the "guess" wording. Eval: `npm run router:expand-eval` prints the raw output and the
  verdict per request. E2E without a model: `E2E_FAKE_ROUTER_EXPAND` (with `E2E_MOCK_AI=1`) fakes the
  model's answer.
- **Media collections** (`src/renderer/download-steps.ts`, skill `media-collection`): the agent stores
  `work` ("Top Gun (1986)") and `tracks` as "Title — Artist"; Bah then downloads each one with
  `ytsearch:` + `collectionQuery` = title + artist + work + year (`subjectYear`: the stored `work`, else
  the request, else the expansion, ignoring what follows "not …"). The main process widens the search
  pool (`ytsearchN`) and takes the first hit that passes the duration filter; ranking the top hits by
  title/artist/year is not done.
- **Packaging:** `@node-llama-cpp/*` (and node-llama-cpp `bins/`) are `asarUnpack`ed; node-llama-cpp's JS
  and the engine stay in the asar, where its ~120 dependencies resolve. CUDA packages, the llama.cpp
  source bundle and CLI templates are excluded.

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
panel feed (`AgentCommandBar` `feedsByTab`) and the session's **thread**. When a tab's key changes, its
conversation moves with it (`bah:move-thread`). Rules: `src/shared/agent-sessions.ts` (tested in
`tests/unit/agent-sessions.test.ts`); state: `store.ts`; UI: `TabBar.tsx`, `AgentCommandBar.tsx`; end to
end: `tests/e2e/agent-sessions.spec.ts`.

**One thread per session.** `src/renderer/threads.ts` holds one thread per key (rules in
`src/shared/thread-store.ts`): **turns** (what you asked, what the chat answered — recent ones verbatim,
clipped), **agent task summaries** (goal, last key steps, outcome, last thing acted on — not every step;
written by `finishRun` in `App.tsx`) and **facts** (signed in/out per site) plus 📌
**pinned** items, which are never compacted. The agent prompt ("PREVIOUS REQUESTS THIS SESSION") and the
chat read the same rendered block (`promptBlock`); chat sends it to `ai:chat`, and `ai-engine.ts` then
skips its own per-tab history (only an attached file is remembered there, `lastDocs`). The thread has a
fixed **token budget per prompt** — ~15% of the model's window, 512–4096 tokens, 3000 when the window is
unknown — so the current page is never crowded out. At 80% the feed warns and offers 📌; over budget,
the oldest items fold into a running summary and the feed says "🗜 Summarized N older turns", which
expands to the exact text that replaced them; `/compact` and 🗑 do the same, visibly. When the
observation must be trimmed to fit the window, the page is trimmed (never the thread) and the feed says
"✂️ page trimmed to fit".
**Context meter** (`components/ContextMeter.tsx`, math in `src/shared/context-meter.ts`): next to the
model name, `context 6.1k / 16k · thread 2.3k`; the bar goes amber/red and names what crowds it; a tap
shows the last call's breakdown (instructions, skills, thread, page). Window from the engine's detection
(`ai:context-window` → `resolveContextBudget`: `/props` on llama.cpp or the configured size; unknown on
cloud); total from the provider's `prompt_tokens` when reported, else an estimate (marked `~`). Test hook:
`window.__bahThreadBudget`; `E2E_CONTEXT_WINDOW` fakes the window under `E2E_MOCK_AI`.

**Restore + chat history.** `src/main/chat-store.ts` keeps two `safeStorage`-encrypted files (rules in
`src/shared/chat-history.ts`): the **live** threads + session names/colours (`threads-live.enc`, saved
≤1.5 s after a change and on window close, before the tab session's "saved" reply) and the **🕘 chat
history** (`chat-history.enc`: one entry per session with name, colour, dates, sites, first request, its
tabs and thread; updated as you go, like browsing history). With ⋮ → When Bah opens = "Continue where you
left off" the tabs come back with the same tab id and `sessionId` (`session.v1` stores `id`/`sid`) and
the thread re-attaches (`store.ts` `bootTabs`, loaded synchronously via `threads:load-live-sync`); any
other choice deletes the live file at startup. ⋮ → 🕘 Chat history (`components/ChatHistoryPanel.tsx`)
opens a past session read-only or **Resumes** it (`store.resumeSession`, optionally reopening its tabs).
"Clear browsing data" has a "chat history" box (same time range). Incognito never reaches either file.
Tests: `tests/unit/thread-store.test.ts`, `chat-history.test.ts`, `context-meter.test.ts`,
`session-restore.test.ts`; end to end `tests/e2e/sessions-thread.spec.ts`.

## Navigation skills (`skills/*/SKILL.md`)

Short, tested recipes the agent gets **only when they apply**, instead of one ever-growing system prompt
(a small local model follows a short, relevant prompt far better). Format is compatible with the
`SKILL.md` used by Browse.sh / agent-browser: YAML-ish front matter + a markdown body (≤ 220 words).

```markdown
---
name: eula-accept            # must equal the folder name
description: Accept a standard software license as part of a requested download.
states: [eula]               # page states Bah detects (see below)
tasks: [download]            # task types (see below)
sites: [booking.com]         # optional: hosts (subdomains match)
priority: 35                 # tie-breaker, higher first
---
1. ...steps written in terms of Bah's actions (click_ref, check, select_option, find, look_at...)
```

A skill is used when **every** list it declares matches; each step injects at most 3, most specific
first (site > task > page state), as a `SKILLS FOR THIS PAGE` section in the page state, with a `TODAY`
line (ISO date and the coming weekend) so small models get dates right.

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

Task types come from the request: `download` (download words, typos included), `collection` (every track of a soundtrack, album or top-N list: `isMediaCollectionRequest`), `search` (find/search/
compare/cheapest/list...), `travel` (hotels, lodging, flights...), `shopping` (prices, buy, cheapest...),
`parts` (charger/adapter/battery/compatible...), `people`. Per-site **account state** (signed in / signed out, read
from the page each step and remembered per site for the session — `agent-login-policy.ts`) goes in the prompt as an
`ACCOUNT:` line. **Bundled skills are general rules, not recipes
for named sites** — site-specific recipes belong in user/contributed skills.
User skills live in `<userData>/skills/` (menu → 🧩 My skills); after a successful task (3+ steps, and a
final message that does not say it failed) Bah offers to draft one ("Save as skill" → review → Save →
optional GitHub proposal). See [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md). Code: parser + selection
`src/shared/skills.ts` (unit-tested in `tests/unit/skills.test.ts`, which also checks every bundled skill
parses, has triggers and stays short), loader + `skills:list` / `skills:save` / `skills:open-folder` IPC
`src/main/skills-loader.ts` (re-reads the files for every task; packaged via `electron-builder.yml`
`files`). Bundled skills: `popup-dismiss`, `autocomplete-pick`, `date-picker`, `site-search`, `page-tabs`,
`download-chain`, `eula-accept`, `os-selector`, `product-specs`, `compatible-part`, `shopping-compare`,
`used-listings`, `travel-search`, `people-search`, `card-list`, `sign-in`.

---

## Memory saver (sleeping tabs)

Chrome's Memory Saver, plus one Bah rule. A sweep in `App.tsx` (every 60 s) unmounts the `<webview>` of a
tab that has been idle long enough (`discarded: true`); clicking the tab remounts it at its URL. Pure rules
in `src/shared/memory-saver.ts` (tested in `tests/unit/memory-saver.test.ts`); UI in
`components/MemorySaverMenu.tsx` (⋮ → 💤 Memory saver ▸: on/off, level, keep-active list).
- **Levels** (Chrome publishes no times; these are Bah's): Moderate 2 h, Balanced 30 min (default, the old
  behaviour), Maximum 10 min idle. Stored in `localStorage` `memSaver` / `memSaverLevel` / `memSaverKeep`.
- **Never discarded**: the active tab, incognito/hidden tabs (`incognito.ts` `canDiscard`), pinned tabs,
  sites on the keep-active list, tabs whose **session** (`store.threadKeyOf`) has an agent task running or
  waiting for the user (confirm/questions card, sign-in pause — the whole `onExecute`), and — gathered only for tabs that pass those cheap checks — tabs playing audio or video
  (even a muted `<video>`), with camera/microphone/screen granted on the current page, with notifications
  allowed for the site, with a download in progress that started there, with a half-filled form, or with an
  open USB/HID/serial/Bluetooth device. The page part is one script (`PAGE_SIGNALS_SCRIPT`; forms compare `value`/`checked`/`selected` with their HTML
  defaults, ignoring hidden and search inputs); the main part is `memsaver:signals`
  (`src/main/memory-saver-signals.ts`, fed by `site-permissions.ts` and `download-manager.ts`).
  Camera/screen counts from the grant until the page navigates (Electron has no "capture stopped" event).
- **Keep-active list**, Chrome's rules: `google.com` covers its subdomains, `.google.com` only that domain,
  `[*.]`/`*.` prefixes mean the same as none, an optional path matches on a segment boundary
  (`site.com/app`), and a written scheme or port must match.
- The tab's hover tooltip says why a candidate tab was kept ("Kept active: form partly filled in").
- **Tests**: `tests/e2e/memory-saver.spec.ts` uses `memSaverIdleMs` / `memSaverSweepMs` (localStorage
  overrides for tests) to shorten the idle time and the sweep.

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
