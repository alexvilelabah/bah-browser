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
  page are sent to the **AI provider you chose** (DeepSeek / Mistral / NVIDIA NIM /
  Pollinations) over HTTPS, so the model can "see" the page and decide the next action. Your
  API key (if any) goes only to that provider. Nothing goes anywhere else. See
  [`src/main/ai-engine.ts`](src/main/ai-engine.ts).
- **Local AI mode (Ollama):** nothing leaves your machine. If the local model fails, Bah
  **errors out — it does not silently fall back to the cloud** (enforced in
  [`src/main/main.ts`](src/main/main.ts), the hybrid-router local branch).
- **OCR and screenshots used for OCR** run **on-device** (Tesseract) — the image is never
  uploaded. See [`takeOcr`](src/preload/preload.ts) + [`src/main/ocr-engine.ts`](src/main/ocr-engine.ts).
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
| Safety brake (pay / buy / delete / card) | [`src/renderer/risk.ts`](src/renderer/risk.ts) + the agent loop in `App.tsx` | `riskForAction` classifies the action; click, **fill** (card data) and **press** (Enter on checkout) all ask for confirmation before running |
| Local AI stays offline | `main.ts` (hybrid router, local branch) | on Ollama failure it returns an error — **no** silent cloud fallback |
| No executable downloads | `main.ts` `BLOCKED_EXTENSIONS` + `attachDownloadManager` | `.exe/.msi/.bat/.cmd/.scr/.js/.vbs/.ps1/.jar/.lnk/.hta/...` blocked at download time |
| `openFile` / reveal can't open arbitrary paths | [`download-manager.ts`](src/main/download-manager.ts) (`download:open-file`) + `main.ts` (`shell:reveal`) | both call `isInsideAllowedRoot` ([`validate.ts`](src/main/validate.ts)) → Downloads / userData / temp only |
| Image harvesting limits | [`src/main/image-harvester.ts`](src/main/image-harvester.ts) | SVG blocked, byte cap, content-type checked, redirects limited |
| OCR / screenshots stay local | [`takeOcr`](src/preload/preload.ts) + [`ocr-engine.ts`](src/main/ocr-engine.ts) | Tesseract on-device; image never sent to a cloud |
| Adblock | `main.ts` (`@ghostery/adblocker-electron`, `ADBLOCK_BYPASS_HOSTS`) | EasyList/EasyPrivacy; the small bypass list (e.g. Google login) is explicit and inspectable |
| Opt-in training-data collector | `main.ts` (`dataset:append-run`) + [`agent-run-logger.ts`](src/renderer/agent-run-logger.ts) | writes **only** to local disk, **only** when enabled; never uploaded |
| Where your data can go (AI) | [`ai-engine.ts`](src/main/ai-engine.ts) | DeepSeek / Mistral / NVIDIA NIM / Pollinations (cloud) or Ollama (local) — and nothing else |

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
   retried with verification relaxed — **but** the file is still rejected if it is an
   executable (see `BLOCKED_EXTENSIONS`), which bounds the risk. Added for sites (e.g. some
   government portals) that ship a broken certificate chain.
3. **Binary supply chain:** `yt-dlp` and `ffmpeg` are fetched from their upstream "latest"
   URLs without a pinned checksum ([`src/main/media-downloader.ts`](src/main/media-downloader.ts)).
   Acceptable at this scale; checksum-pinning is planned before wider distribution.

---

## Reporting

Found something that looks wrong? Please reach out via the **Contact** section in the
[README](README.md) (or open an issue on the repository). Honest reports are welcome —
this document exists precisely so problems can be found by reading.
