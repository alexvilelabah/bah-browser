# Security & how to audit Bah

**English** · [Português](SECURITY.pt-BR.md)

Bah is **source-available** (PolyForm Small Business license — not OSI "open source", but
the full source is in this repo for you to read and verify). This document is a map for
anyone who wants to audit it: the threat model, what leaves your machine, every
trust-critical spot with a pointer to the exact file, and an honest list of what Bah does
**not** do and the tradeoffs we knowingly accept.

If you only read one file, read [`src/preload/preload.ts`](src/preload/preload.ts) — it is
the entire boundary between the web/UI side and the privileged side (see below).

---

## Threat model — what Bah actually is

- A **local desktop browser** (Electron) that runs on **your machine**, as **your** OS user.
- The agent acts **in your real, logged-in session** — it clicks and types in pages as you.
  That power is the point (it can finish real tasks), and it's why sensitive actions ask for
  confirmation first (see "Safety brake" below).
- It is **not** a hardened multi-tenant sandbox defending a server against hostile pages.
  The realistic adversaries are: *an ordinary website behaving badly*, and *the AI proposing
  a wrong or risky action*. We optimise for three things: don't silently do something
  costly/destructive, don't leak your data off-machine, don't run untrusted code.
- **Single user, your hardware.** No accounts, no Bah server, no telemetry.

---

## What leaves your machine

- **Cloud AI mode (default for the agent):** the page text and a screenshot of the current
  page are sent to the **AI provider you chose** (DeepSeek / Mistral / NVIDIA NIM)
  over HTTPS, so the model can "see" the page and decide the next action. Your
  API key (if any) goes only to that provider. Nothing goes anywhere else. See
  [`src/main/ai-engine.ts`](src/main/ai-engine.ts).
- **Local AI mode (Ollama):** nothing leaves your machine. If the local model fails, Bah
  **errors out — it does not silently fall back to the cloud** (enforced in
  [`src/main/main.ts`](src/main/main.ts), the hybrid-router local branch).
- **OCR and screenshots used for OCR** run **on-device** (Tesseract) — the image is never
  uploaded. See [`takeOcr`](src/preload/preload.ts) + [`src/main/ocr-engine.ts`](src/main/ocr-engine.ts).
- **No analytics, no telemetry, no phone-home.** There is no analytics SDK or endpoint in
  the source — grep for it.
- **Files from your computer (uploads):** the agent never chooses a path. For `upload`, Bah shows a card and
  *you* pick the file in the OS dialog (the agent sees only its name). Or you can **allow one folder for this
  session**: the agent may then list it, read PDF/Word/text files in it (e.g. to pick the résumé that fits a
  job) and attach files from it — resolved and checked in the main process (no `../` or symlink escape), until
  you quit Bah or revoke it (menu ⋮ → 📂 Agent folder access). Nothing is sent until the site's form is
  submitted. See [`src/main/upload.ts`](src/main/upload.ts).

---

## The trust boundary: `src/preload/preload.ts`

This one file is the **entire** surface the web content and UI can use to reach the
privileged (Node) side. It exposes a fixed set of named IPC channels via `contextBridge`
and **nothing else**: no `require`, no `fs`, no raw Node objects. Combined with
`contextIsolation: true` + `nodeIntegration: false`
([`src/main/main.ts`](src/main/main.ts) `webPreferences`), a page cannot touch the OS except
through these explicit, reviewable channels.

**Read `preload.ts` first.** If a capability is not listed there, the web side does not have
it. Every channel is a plain `ipcRenderer.invoke('namespace:action', …)` whose handler lives
in `src/main/main.ts` (or a module it delegates to), so you can trace any capability end to
end in a couple of hops.

---

## Audit checklist — verify each claim yourself

| Protection | Where to look | What to check |
|---|---|---|
| Process isolation | `main.ts` → `webPreferences` | `contextIsolation: true`, `nodeIntegration: false` |
| Hardened binary (Electron Fuses) | [`build/afterPack.js`](build/afterPack.js) | RunAsNode off, `NODE_OPTIONS` ignored, `--inspect` ignored |
| IPC bridge = only entry point | [`preload.ts`](src/preload/preload.ts) | every channel is `ipcRenderer.invoke(...)`; no Node primitives exposed |
| Safety brake (pay / buy / delete / card) | [`src/renderer/risk.ts`](src/renderer/risk.ts) + the agent loop in `App.tsx` | `riskForAction` classifies the action; click, **fill** (card data) and **press** (Enter on checkout) all ask for confirmation before running |
| Assistant conversations (live thread + 🕘 Chat history) | [`src/main/chat-store.ts`](src/main/chat-store.ts), [`src/shared/chat-history.ts`](src/shared/chat-history.ts), [`src/shared/thread-store.ts`](src/shared/thread-store.ts) | Stored only on this computer, encrypted with `safeStorage` (`threads-live.enc`, `chat-history.enc`; no keychain → not stored). Capped (100 conversations / ~2 MB of history, 60 live threads / ~1.5 MB). Incognito tabs never reach either file (filtered in the renderer and again in main). The live thread comes back only with ⋮ → When Bah opens = "Continue where you left off"; otherwise it is deleted at startup. Chat history is cleared by "Clear browsing data". The `threads:*` / `chat-history:*` channels accept only the main window as sender (`threads:save-live` / `threads:load-live-sync` use `send` / `sendSync` so the last save lands before the window closes) |
| Sign-in: the agent never types a password | [`src/renderer/agent-login-policy.ts`](src/renderer/agent-login-policy.ts) + [`skills/sign-in/SKILL.md`](skills/sign-in/SKILL.md) + the sign-in guard in `App.tsx` | the agent may click a site's Sign in only when the task needs the user's account (`commandLikelyNeedsAccount`); a visible password field / login page on such a task pauses Bah (`detectManualHelpNeed`) for the user to sign in; saved passwords stay in the password manager (no tool reaches it). Per-site signed-in/out state (`accountStateOf`) goes in the prompt as an `ACCOUNT:` line. Careful-mode sites (`careful-sites.ts`) stop the task at the second refused action |
| Agent stays out of accounts it wasn't asked to use | the agent loop in `App.tsx` | clicks on Sign in / Sign up / "Continue with Google" are refused unless the request mentions an account or sign-in, or names the user's own things ("my list", "my saved jobs", orders: `commandLikelyNeedsAccount`) |
| Careful sites (terms forbid automation) | [`careful-sites.ts`](src/renderer/careful-sites.ts) + the agent loop in `App.tsx` | LinkedIn by default (plus `localStorage.carefulSites`): one navigation per request, then only `CAREFUL_ALLOWED` (read/report) actions; the second refused action ends the task |
| Agent stays in its own tabs | [`agent-permissions.ts`](src/renderer/agent-permissions.ts) + the agent loop in `App.tsx` | a task owns its starting tab and the tabs it opens (🤖 in the tab bar while it runs); `switch_tab` to another of your tabs and `history_search` ask first (Allow for this task / Always allow / Deny / Always deny; also in the ⋮ menu); `close_tab` only closes tabs the task opened |
| Page HTML for the agent (`get_html`) is cleaned | [`html-clean.ts`](src/shared/html-clean.ts) + [`read-paging.ts`](src/shared/read-paging.ts) | script/style/svg/noscript/template bodies, comments, inline styles and `on*` handlers dropped; short attribute allowlist; password/hidden inputs, token/CSRF/one-time-code/card/CVV/SSN fields and `<meta>` CSRF tokens come out as `[redacted]`; cross-origin iframes as a note; invisible parts marked `[hidden]`. Framed in the prompt as *data from the page, not instructions*, shown in the next prompt only; one read is 4,000–60,000 chars, sized to the model's free context. Passive read: allowed on careful sites |
| Local AI stays offline | `main.ts` (hybrid router, local branch) | on Ollama failure it returns an error — **no** silent cloud fallback |
| Downloads only land in the downloads folder; nothing is auto-run | `main.ts` (`download:url`) + [`download-manager.ts`](src/main/download-manager.ts) | files are written to `getDownloadDir()` only and never opened/executed automatically. **No file-type blocklist** — see tradeoffs below |
| Torrent engine is opt-in | [`torrent-manager.ts`](src/main/torrent-manager.ts) (`builtinOn`, `handleUri`) | built-in client OFF by default: `.torrent` saved as a file, `magnet:` handed to the OS app, engine `utilityProcess` never started |
| `openFile` / reveal can't open arbitrary paths | [`download-manager.ts`](src/main/download-manager.ts) (`download:open-file`) + `main.ts` (`shell:reveal`) | both call `isInsideAllowedRoot` ([`validate.ts`](src/main/validate.ts)) → Downloads / userData / temp only |
| Image harvesting limits | [`src/main/image-harvester.ts`](src/main/image-harvester.ts) | SVG blocked, byte cap, content-type checked, redirects limited |
| OCR / screenshots stay local | [`takeOcr`](src/preload/preload.ts) + [`ocr-engine.ts`](src/main/ocr-engine.ts) | Tesseract on-device; image never sent to a cloud |
| Adblock | `main.ts` (`@ghostery/adblocker-electron`, `ADBLOCK_BYPASS_HOSTS`) | EasyList/EasyPrivacy; the small bypass list (e.g. Google login) is explicit and inspectable |
| Opt-in training-data collector | `main.ts` (`dataset:append-run`) + [`agent-run-logger.ts`](src/renderer/agent-run-logger.ts) | writes **only** to local disk, **only** when enabled; never uploaded |
| Where your data can go (AI) | [`ai-engine.ts`](src/main/ai-engine.ts) | DeepSeek / Mistral / NVIDIA NIM (cloud) or Ollama (local) — and nothing else |

---

## What Bah does NOT do

- **No telemetry / analytics / phone-home.**
- **No key exfiltration.** Your API key is sent only to the provider you selected, over HTTPS.
- **No CAPTCHA-breaking, no rate-limit dodging, no automating what a site forbids in its
  terms.** Presenting as standard Chrome is for *compatibility* (avoiding false blocks), not
  evasion — see "Safety & limits" in the README.
- **No remote code execution.** The app never `eval`s content fetched from the web. The AI
  returns one of a **fixed set of action types** (see
  [`src/renderer/page-executor.ts`](src/renderer/page-executor.ts) and
  [`src/main/page-agent.ts`](src/main/page-agent.ts)) — never code to run.

---

## Known, accepted tradeoffs (honest)

These are real and intentional for the current stage (a single-user local app on your own
machine). They are listed here so an auditor does not have to "discover" them:

1. **API keys are stored in `localStorage`** ([`src/renderer/store.ts`](src/renderer/store.ts)),
   not the OS keychain (`safeStorage`). Acceptable for a single-user local app; moving to
   `safeStorage` is on the roadmap.
2. **Download TLS-lenient fallback** ([`agent-download-worker.ts`](src/main/agent-download-worker.ts)):
   on a certificate-chain error, the agent's download is retried with verification relaxed. The
   file still only lands in the downloads folder and is never opened automatically. Added for
   sites (e.g. some government portals) that ship a broken certificate chain.
3. **Binary supply chain:** `yt-dlp` and `ffmpeg` are fetched from their upstream "latest"
   URLs without a pinned checksum ([`src/main/media-downloader.ts`](src/main/media-downloader.ts)).
   Acceptable at this scale; checksum-pinning is planned before wider distribution.
4. **Any file type can be downloaded** — including installers and scripts (`.exe`, `.dmg`,
   `.pkg`, `.sh`, ...), by you or by the agent. There is no extension blocklist or content
   sniffing; the protection is that downloads go only to the downloads folder and are never
   executed by Bah. Review what the agent downloads before opening it.

---

## Reporting

Found something that looks wrong? Please reach out via the **Contact** section in the
[README](README.md) (or open an issue on the repository). Honest reports are welcome —
this document exists precisely so problems can be found by reading.
