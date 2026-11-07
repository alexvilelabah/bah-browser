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
| `proxy.ts`, `proxy-config.ts` | Proxy for **every** session (system / manual http·https·socks5 / PAC / direct), 407 sign-in prompt with keychain-encrypted saved credentials, `proxy:*` IPC. Main-process `fetch` is routed through the `persist:browser` session's `session.fetch`, so one setting covers Bah's own requests too |
| `proxy-base.ts` | Bridge between Bah's proxy settings and Chrome extensions' `chrome.proxy` (VPN extensions): an extension in control wins (as in Chrome); when it lets go, the tabs return to the proxy configured in Bah, not a fixed "system"; Bah's WebRTC leak policy is the extensions' baseline |
| `secure-dns.ts` (+ `src/shared/secure-dns.ts`) | Secure DNS (DNS-over-HTTPS) chosen by the user: `app.configureHostResolver` for the whole app, `dns:*` IPC. See [Secure DNS](#secure-dns-dns-over-https) |
| `system-ca.ts` | Reads the OS root certificate store and adds it to Node's default CAs (`tls.setDefaultCACertificates`) for TLS-inspecting corporate proxies |
| `video-cuts.ts`, `transcript.ts` | Local video features (locate where a phrase is spoken, transcripts) — native ffmpeg |
| `image-harvester.ts` | Bulk image download + AI image generation (Pollinations), with limits |
| `ocr-engine.ts`, `page-capture.ts` | On-device OCR (Tesseract) + screenshots |
| `data-view.ts` | Renders data tables/charts to a local page (no CDN) |
| `validate.ts` | Path-safety helpers (`isInsideAllowedRoot`, etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Popup/overlay handling and dismissal |
| `job-queue.ts` | Serialises long-running jobs |

### Secure DNS (DNS over HTTPS)

⋮ → Network & proxy → **Secure DNS**. Saved in `userData/secure-dns.json`; `src/shared/secure-dns.ts`
turns the setting into `app.configureHostResolver({ secureDnsMode, secureDnsServers })` (validated,
unit-tested; bad input falls back to System). The host resolver belongs to Chromium's single network
service, so one setting covers **every** session: tabs, incognito, Google sign-in windows and Bah's own
requests. It is applied after `ready` and re-applied live when the user saves (open connections are closed).

| Mode | Resolver |
|---|---|
| **System** (default) | Bah does not call `configureHostResolver` at all: Chromium's default (`automatic`, no servers: plain network DNS, upgraded to DoH only if the system's DNS provider supports it). Nothing changes until the user picks something; switching back re-applies exactly that default |
| Provider (no account) | AdGuard DNS `https://dns.adguard-dns.com/dns-query` (ads + malware), Mullvad adblock `https://adblock.dns.mullvad.net/dns-query` (ads), Quad9 `https://dns.quad9.net/dns-query` (malware), Cloudflare `https://cloudflare-dns.com/dns-query` (no filtering). Lists are the provider's |
| NextDNS | `https://dns.nextdns.io/<id>` — the user's own configuration (free account; they manage the lists). Never a default because it needs an account |
| Custom | Any `https://` DoH template (`{?dns}` allowed), e.g. a Pi-hole / AdGuard Home on the LAN; `http://` rejected |

**Strict** (off by default) maps to `secure` (lookups fail if the DoH server is unreachable) instead of
`automatic` (falls back to the network's plain DNS). With a proxy set, the proxy may resolve names for
proxied traffic (HTTP CONNECT, SOCKS5) — the panel says so; proxy behaviour is unchanged.

It is a core setting, not an extension: Chrome extensions have no API to set the resolver, and
Chrome / Edge / Brave / Firefox all keep Secure DNS in their own settings.

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
