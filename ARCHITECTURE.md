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
  WEB → web answer; `other` / timeout (5 s) → the previous path. The box does not send the last task
  yet (`Last task: none`), so LAST_RUN maps to chat and FIX to the agent. While the router is ready, the
  "question that points at the open screen" word rule is skipped (the router's PAGE covers it). Still
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
