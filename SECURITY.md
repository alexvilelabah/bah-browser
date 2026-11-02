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
- **Site permissions (location, camera, microphone, clipboard, notifications, MIDI, files):** denied
  until you answer Bah's bar — *Allow this time* (until the page reloads), *Always allow* / *Never allow*
  (saved per site in `site-permissions.json`; review or reset in menu ⋮ → 🔒 Site permissions). The bar is
  Bah's own UI, outside the page, so the agent cannot answer it; requests from background or hidden tabs
  are denied without asking. Screen capture, USB/HID/serial and unknown permissions are always denied.
  Before this, Electron's default granted all of these to every site silently. See
  [`src/main/site-permissions.ts`](src/main/site-permissions.ts).
- **Network country check:** in *Auto* shopping region only, one request to `https://www.cloudflare.com/cdn-cgi/trace`
  (through the browser engine, same route as your tabs) when a task starts or the 🌍 panel opens, cached 10 minutes.
  Only the country code is used. Choose *My computer's region* or a fixed country to turn it off. See
  [`src/main/region.ts`](src/main/region.ts).
- **Time zone:** like every browser, page scripts can read your time zone. Bah also puts your region and time zone
  in the agent's prompt, which goes to your AI provider (stays local with a local model). Choose **UTC** in 🌍
  Region & time to hide it from pages.
- **Files from your computer (uploads):** the agent never chooses a path. For `upload`, Bah shows a card and
  *you* pick the file in the OS dialog (the agent sees only its name). Or you can **allow one folder for this
  session**: the agent may then list it, read PDF/Word/text files in it (e.g. to pick the résumé that fits a
  job) and attach files from it — resolved and checked in the main process (no `../` or symlink escape), until
  you quit Bah or revoke it (menu ⋮ → 📂 Agent folder access). Nothing is sent until the site's form is
  submitted. See [`src/main/upload.ts`](src/main/upload.ts).
- **Proxy:** when a proxy is configured (OS settings, the 🌐 Network & proxy panel or `HTTPS_PROXY`),
  all of Bah's traffic goes through it — that is the point. Proxy passwords are typed into Bah's own
  box, stored only if you tick *Remember*, encrypted with the OS keychain (`safeStorage`, file
  `proxy-auth.json`), and never shown to the agent or the model. See [`src/main/proxy.ts`](src/main/proxy.ts).
- **Company root certificates:** Bah adds the OS-trusted root certificates to Node so it trusts what the
  browser engine already trusts. It does not add or trust anything the OS does not. See
  [`src/main/system-ca.ts`](src/main/system-ca.ts).
- **No analytics, no telemetry, no phone-home.** There is no analytics SDK or endpoint in
  the source — grep for it.

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
| Safety brake (pay / buy / delete / card / send a job application) | [`src/renderer/risk.ts`](src/renderer/risk.ts) + the agent loop in `App.tsx` | `riskForAction` classifies the action; click, **fill** (card data) and **press** (Enter on checkout) all ask for confirmation before running. In a job-application task, a bare "Submit"/"Send" button and Enter on a review page also ask (`📨 Send it` / `Don't send`) |
| Job application profile + saved answers | [`src/main/applicant-profile.ts`](src/main/applicant-profile.ts), [`src/shared/form-fill.ts`](src/shared/form-fill.ts) | Stored only on this computer, encrypted with `safeStorage` (no keychain → not stored). Filled into forms **by code** in job tasks; answers the user types in the questions card are saved only when "Save these answers" is ticked. Voluntary self-identification defaults to "decline". Editable/erasable in ⋮ → 📝 |
| Assistant conversations (live thread + 🕘 Chat history) | [`src/main/chat-store.ts`](src/main/chat-store.ts), [`src/shared/chat-history.ts`](src/shared/chat-history.ts), [`src/shared/thread-store.ts`](src/shared/thread-store.ts) | Stored only on this computer, encrypted with `safeStorage` (`threads-live.enc`, `chat-history.enc`; no keychain → not stored). Capped (100 conversations / ~2 MB of history, 60 live threads / ~1.5 MB). Incognito tabs never reach either file (filtered in the renderer and again in main). The live thread comes back only with ⋮ → When Bah opens = "Continue where you left off"; otherwise it is deleted at startup. Chat history is cleared by "Clear browsing data". The `threads:*` / `chat-history:*` channels accept only the main window as sender (`threads:save-live` / `threads:load-live-sync` use `send` / `sendSync` so the last save lands before the window closes) |
| Sign-in: the agent never types a password | [`src/renderer/agent-login-policy.ts`](src/renderer/agent-login-policy.ts) + [`skills/sign-in/SKILL.md`](skills/sign-in/SKILL.md) + the sign-in guard in `App.tsx` | the agent may click a site's Sign in only when the task needs the user's account (`commandLikelyNeedsAccount`); a visible password field / login page on such a task pauses Bah (`detectManualHelpNeed`) for the user to sign in; saved passwords stay in the password manager (no tool reaches it). Per-site signed-in/out state (`accountStateOf`) goes in the prompt as an `ACCOUNT:` line. Careful-mode sites (`careful-sites.ts`) stop the task at the second refused action |
| Reading pages that forbid scripts | [`src/renderer/page-eval.ts`](src/renderer/page-eval.ts) + `page:eval-isolated` in `main.ts` | only when the page world refuses a trivial probe, Bah's own reader scripts run in a separate isolated world (1047) of that tab; the IPC accepts only the main window as sender and only `<webview>` tabs of that window; the page's own JavaScript cannot see or call into that world |
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
2. **Download TLS-lenient fallback** (`main.ts`): on a certificate-chain error, a download is
   retried with verification relaxed. The file still only lands in the downloads folder and is
   never opened automatically. Added for sites (e.g. some government portals) that ship a
   broken certificate chain.
3. **Binary supply chain:** `yt-dlp` and `ffmpeg` are fetched from their upstream "latest"
   URLs without a pinned checksum ([`src/main/media-downloader.ts`](src/main/media-downloader.ts)).
   Acceptable at this scale; checksum-pinning is planned before wider distribution.
4. **Any file type can be downloaded** — including installers and scripts (`.exe`, `.dmg`,
   `.pkg`, `.sh`, ...), by you or by the agent. There is no extension blocklist or content
   sniffing; the protection is that downloads go only to the downloads folder and are never
   executed by Bah. Review what the agent downloads before opening it.
5. **Optional captcha checkbox click** (menu ☑️, OFF by default; `tryCaptchaCheckbox` in `App.tsx`):
   when ON, on a real human-verification gate the agent clicks a reCAPTCHA / hCaptcha / Turnstile
   checkbox **once** with real input and checks whether it passed (response token / widget gone);
   otherwise it asks the user as before. It never attempts image challenges. Some sites forbid
   automated access in their terms — this is the user's choice to make.

---

## Reporting

Found something that looks wrong? Please reach out via the **Contact** section in the
[README](README.md) (or open an issue on the repository). Honest reports are welcome —
this document exists precisely so problems can be found by reading.
