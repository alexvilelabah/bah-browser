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

Task types come from the request: `download` (download words, typos included), `search` (find/search/
compare/cheapest/list...), `travel` (hotels, lodging, flights...), `shopping` (prices, buy, cheapest...),
`parts` (charger/adapter/battery/compatible...), `people`. **Bundled skills are general rules, not recipes
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
