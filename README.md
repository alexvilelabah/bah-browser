<p align="center">
  <img src="build/icon.png" width="116" alt="Bah" />
</p>

<h1 align="center">Bah</h1>

<p align="center">
  <b>AI browser</b> — type in plain language, and the AI <b>autonomously</b> operates the web for you.<br/>
  <b>Perplexity Comet</b> style · open source · by <b>VilelaLab</b>.
</p>

<p align="center">
  🌐 <b>English</b> · <a href="README.pt-BR.md">Português</a>
</p>

<p align="center">
  <a href="https://github.com/alexvilelabah/bah-browser/releases"><img src="https://img.shields.io/github/downloads/alexvilelabah/bah-browser/total?label=downloads&color=success" alt="Downloads" /></a>
  <a href="https://github.com/alexvilelabah/bah-browser/releases/latest"><img src="https://img.shields.io/github/v/release/alexvilelabah/bah-browser?label=version&color=blue" alt="Version" /></a>
</p>

> You give natural-language commands ("open gmail and delete the spam") and the AI operates the browser in your place — reading the screen, clicking with a real mouse, typing, and going until it's done.

> 🖼️ **Image generation works out of the box — no key.** For chat and the full autonomous agent, add a cheap key — **DeepSeek** (recommended), **Mistral** or **NVIDIA NIM** — or go 100% local + offline with **Ollama** (also free, no key).

<p align="center">
  <a href="https://www.electronjs.org"><img src="https://img.shields.io/badge/Electron-2B2E3A?style=flat-square&logo=electron&logoColor=white" alt="Electron" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" /></a>
</p>

<p align="center">
  <sub><b>Works with</b></sub><br/>
  <a href="https://deepseek.com"><img src="https://img.shields.io/badge/DeepSeek-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="DeepSeek" /></a>
  <a href="https://mistral.ai"><img src="https://img.shields.io/badge/Mistral-FA520F?style=flat-square&logo=mistralai&logoColor=white" alt="Mistral" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-76B900?style=flat-square&logo=nvidia&logoColor=white" alt="NVIDIA NIM" /></a>
  <a href="https://ollama.com"><img src="https://img.shields.io/badge/Ollama-101010?style=flat-square&logo=ollama&logoColor=white" alt="Ollama" /></a>
</p>

## 🎬 Demo

![Bah in action](assets/demo.gif)

▶️ **[Download the full video](https://github.com/alexvilelabah/bah-browser/raw/main/assets/demo.mp4)** — the agent searching and operating the web on its own. *(the GIF above is a preview; GitHub doesn't play embedded video in the README.)*

## 🚀 Quick Start (Plug & Play)

**🧑 I just want to use it (Windows):** [**grab the installer here**](https://github.com/alexvilelabah/bah-browser/releases/latest) → the `Bah-Setup-*.exe` file, double-click and install.

> 🏠 **Want it 100% local & free? No terminal needed.** Set up the AI right inside the browser: open the AI panel → 🏠 **Local AI** → type a model name → **Download**, and Bah pulls the Ollama model for you. (Prefer the cloud? A cheap DeepSeek key works too — and needs no GPU.)

> 🔄 **Auto-updates:** after installing, Bah checks for new versions, downloads them in the background and offers *"Restart now"* to apply — no reinstalling.

> ⚠️ Windows shows a blue *"protected your PC"* screen (the app isn't code-signed with a paid certificate yet). Click **More info → Run anyway** — normal for new open-source apps. (Later updates install without that warning.)

> 🛡️ **Windows blocks Bah and there's no "Run anyway" button?** If the installer — or an update — simply refuses to open, your PC has **Smart App Control** turned on. It's a stricter Windows 11 protection that blocks every app without a digital signature, and Microsoft offers [no way to allow a single app](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions). Until Bah is code-signed, the only option is to turn it off: **Windows Security → App & browser control → Smart App Control settings → Off**. Your antivirus (Microsoft Defender) keeps running, new apps still get the usual *"protected your PC"* check, and recent Windows updates let you turn Smart App Control back on later without reinstalling Windows.

**🍎 macOS (new, starting with v1.8.12):** from the [same release page](https://github.com/alexvilelabah/bah-browser/releases/latest), get `Bah-*-arm64.dmg` (Apple Silicon: M1 and newer) or `Bah-*-x64.dmg` (Intel; check Apple menu → About This Mac). Open it and drag **Bah** into Applications. Needs macOS 13 (Ventura) or newer.

> ⚠️ The Mac version is new and isn't signed or notarized by Apple yet, so macOS refuses to open it, usually saying Bah *"is damaged and can't be opened"* (it isn't; that's just the missing Apple signature). Run `xattr -cr /Applications/Bah.app` in Terminal, then open Bah normally. There's no auto-update on macOS yet: to update, download the new `.dmg`, replace the app and run the `xattr` command again. Netflix, Prime Video and Disney+ don't play on the Mac version yet.

> 🍺 **Video/audio downloads on macOS use [Homebrew](https://brew.sh)'s tools:** `brew install yt-dlp deno ffmpeg` (or `brew bundle` in a clone of this repo, using the [`Brewfile`](Brewfile)). The Mac build doesn't download and run programs itself (an unsigned app running a freshly downloaded binary is what macOS distrusts most); Homebrew installs and updates them. Without ffmpeg, only audio downloads work, saved in the original format (usually M4A). Everything else works without them.

**👨‍💻 I want to hack on the code:** clone and run it — see [Running it](#running-it) below.

---

## What it does

- **Full browser** with tabs, navigation, URL bar, dark theme
- **AGENT panel** on the side: type a command → the AI decides step by step until it's done
- **Reads the page** (DOM, numbered interactive elements, and OCR) and acts through structured tools — it doesn't rely on "seeing" the screen
- **AI**: image generation **works free out of the box** (no key). Chat and the full autonomous agent need a key — **DeepSeek** (cheap, recommended) — also **Mistral** / **NVIDIA NIM** — or **Ollama** (local/offline, free)
- **Assistant sessions on your tabs** — the first time you use the assistant on a tab it gets a session: a coloured chip with a short name ("Job hunt", "Groceries") on the tab strip, like a Chrome tab group. Tabs in a session share one conversation — tabs the agent opens, and links you open from a session tab, join it; right-click a tab to add it to a session or take it out; click the chip to rename or recolour
- **One memory per session, sized for small local models** — the agent and the chat share the session's conversation (requests, answers, task summaries, facts, 📌 pinned items) within a fixed token budget, so the page is never crowded out. When it fills up, older turns are summarized **visibly** in the panel (expand to read the summary; `/compact` on demand). A **context meter** next to the model name shows `context 6.1k / 16k · thread 2.3k` and, tapped, what took the room
- **Conversations survive a restart** with ⋮ → When Bah opens → "Continue where you left off", and **🕘 Chat history** (⋮) lists past sessions — open one read-only or **Resume** it, reopening its tabs. Stored encrypted on this computer, never for incognito tabs, cleared with "Clear browsing data"
- **Scheduled tasks** — "every weekday at 8am check my Indeed recommendations" or ⋮ → ⏰ Scheduled tasks: runs while Bah is open, each in its own tab; a time missed while Bah was closed is offered when it opens; anything that needs your OK (send, buy, submit, sign in) waits for you with a notification
- **Understands follow-ups** — "did you click it?" is answered from a log of what the agent just did (not a web search); "one window was opened, but not the second" sends the agent back to finish; "it" / "that one" in a new request means the last thing the agent acted on
- **"Summarize my open tabs"** — one line per tab plus an overall summary, each with a link to switch to it. Asks before reading your tabs (or follows your always/never choice), skips incognito tabs and internal pages, and leaves sleeping tabs asleep unless you ask
- **Memory saver** — like Chrome's: tabs you haven't used for a while (⋮ → 💤: Moderate 2 h, Balanced 30 min, Maximum 10 min) free their memory and reload when clicked. Never tabs playing audio/video, using the camera, mic or screen, downloading, with a half-filled form, pinned, with notifications or a connected device, on your "always keep these sites active" list, or with an AI task running or waiting for you
- **Natural-language routing** — commands that start with an action ("search for…", "find…", "browse to…", "apply…") go to the agent; questions get an answer. Typos like "open 2 windos … a different video in each" still open 2 videos
- **Optional local router** — download a small model once (Qwen2.5-1.5B, 1.1 GB, Apache-2.0; asked first) and every message is labelled on your own computer before it reaches the AI: task, page question, web question or chat. Copes with typos ("search for a set of new golf blubs"); your text never leaves the machine; without it the word rules route as before. On integrated graphics (for example Intel Iris Xe) it runs on the CPU. For "find/download" requests about a named work it also makes the request precise before the big AI starts ("music videos from top gun with tom cruise" → "…the 1986 film Top Gun…"), shown as **🔎 Understood as: …**; the big AI gets both texts and yours wins
- **One-shot skills**: open N videos at once, jump to the exact moment a phrase is spoken across several videos, **chat about a YouTube video using its transcript**, compare prices, fetch news — deterministic shortcuts that cost zero tokens
- **Navigation skills** — short `SKILL.md` recipes (pop-ups, date pickers, autocomplete, EULAs, OS selectors, downloads, shopping, travel, people search, job applications, card lists, sign-in) chosen per step; save your own after a task that worked — see [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md)
- **UI in English by default**, with **Português** and **Español** available in Settings — the AI replies in your chosen language
- **Full adblock** (EasyList + EasyPrivacy) with automatic bypass for sites that break (YouTube, Twitch)
- **Safe Browsing** ([NetAPI](https://netapi.com/compromised-urls/) compromised-domains list, updated daily)
- **Real mouse clicks** via Chromium `sendInputEvent` (not synthetic events — goes through React, Vue, Angular without being ignored)
- **Modern-site compatibility** — presents as a current Chrome on your real OS (user agent, client hints and languages set consistently inside the engine; real GPU/CPU/memory; `navigator.webdriver` left to the engine) so sites don't wrongly block the browser
- **Comet-style visual overlay** — pulsing border, scan line, click ripple, status label

---

## Stack

| Layer | Tech |
|---|---|
| Browser shell | **Electron 44** + Chromium |
| UI | **React 19** + **TypeScript** + Vite |
| AI (cloud) | **DeepSeek** (recommended) · **Mistral** · **NVIDIA NIM** |
| AI (local) | **Ollama** |
| Adblock | `@ghostery/adblocker-electron` |
| Webview | `<webview>` tag with persistent partition |

---

## The agent's ReAct loop (core)

```
USER → "open gmail and delete the spam"
        │
        ▼
┌───────────────────────────────────────────────┐
│  for step in 1..25:                           │
│    1. observePage(webview)                    │
│       → { url, title, interactive_elements }  │
│    2. captureScreenshot()                     │
│    3. AI decides ONE action:                  │
│       { action: { type, ...params } }         │
│    4. execute action via REAL OS input        │
│    5. wait, re-observe, self-evaluate         │
│    6. if action == 'done' → return            │
└───────────────────────────────────────────────┘
```

### Tools the AI can call

| Action | What it does |
|---|---|
| `click_ref(N)` | Clicks the element with id N from the observed list |
| `fill_ref(N, value)` | Fills input id N with `value` (and verifies it took) |
| `click_text(text)` | Finds by visible text and clicks |
| `click_at(x, y)` | Click at exact coordinates (visual fallback) |
| `type(text)` / `press(key)` | Type into the focused field / send a key |
| `navigate(url)` / `scroll(dir)` | Go to a URL / scroll |
| `new_tab` / `switch_tab` / `close_tab` | Tab management |
| `extract_text(offset?, max_chars?)` | The page's main content as Markdown; long pages come in pages via `offset`, sized to the model's free context |
| `get_html(selector?, offset?, max?)` | Cleaned HTML of a selector or the page — `[#N]` refs, `[hidden]` marks, secrets and scripts stripped; for duplicate buttons, unlabeled fields, custom dropdowns; paged like `extract_text` |
| `done(reason, success)` | End the loop |

Clicks happen through `webContents.sendInputEvent` in the main process — a **real** Chromium mouse event, not a synthetic one, so React/Vue/anti-bot sites respond normally. Before the click, the pointer moves to the target along the same arc as the agent cursor Bah draws on screen (no random jitter), so the page's `mousemove` events match what you see. The AI prefers the **DOM-first** path (`click_ref`), falling back to text and then coordinates.

Iframes count too: fields and buttons inside embedded forms (job applications, payment fields, booking widgets) — same-origin or from another site — appear in the element list marked `frame="host"`, and `click_ref` / `fill_ref` work on them the same way.

---

## Running it

```bash
git clone https://github.com/alexvilelabah/bah-browser.git
cd bah-browser
npm install
npm run build
npm start        # or: npx electron .
```

Windows shortcut: double-click `Abrir-Bah.bat`.

### Setting up the AI

1. Open the browser, click the **AI** button in the address bar.
2. Gear icon → pick a provider.
3. Pick **DeepSeek**, **Mistral** or **NVIDIA NIM** and paste that provider's key (DeepSeek's is very cheap) → Save. Image generation works with no key either way; chat and the agent need this (or local Ollama, next step).
4. **Local (optional, free/offline):** install [Ollama](https://ollama.com) and **keep it running** (it lives in the tray and serves models at `127.0.0.1:11434`). Then download a model from inside Bah (☁️/🏠 → 🏠 Local AI → type a name → **Download**) or in a terminal (e.g. `ollama pull qwen3:14b`). Local works offline, but the cloud (DeepSeek) is more reliable.

---

## Safety & limits

The agent runs with full browser privileges, so it's worth being clear about what it does and doesn't do:

> ⚖️ **You're in control — and responsible.** Bah acts in your real session, on your account. Use it within each site's terms and the law. Sensitive actions (paying, buying, deleting, entering card data) always ask for your confirmation first.

> 🔍 **Audit it yourself.** The full threat model, a verify-it-yourself checklist (each protection → the exact file), what leaves your machine, and an honest list of accepted tradeoffs all live in **[SECURITY.md](SECURITY.md)**. A map of the codebase — every file, the live agent loop, the build — is in **[ARCHITECTURE.md](ARCHITECTURE.md)**. The whole of `src/` is ~30 files.

- 🔓 **It's your real session.** The browser uses a persistent partition (`persist:browser`), so cookies and logins are saved. If you're logged into Gmail in Bah, so is the agent. **The AI can access anything you could access manually.** Don't log into accounts you wouldn't trust an assistant with.

- 🛡️ **Safety brake on sensitive actions.** Before **paying, buying, deleting, entering card data, or sending a job application**, the agent **pauses and asks for your confirmation** — and this works on *every* path (model clicks, coordinate clicks, Enter on a checkout page, learned shortcuts, and repeated automations). It never does those silently.

- 💬 **Page pop-ups don't freeze anything.** A site's `alert`/`confirm` opens in Bah's own box instead of the native one that locked the page (and the agent). During a task, alerts are closed and ordinary confirms accepted (the agent can arm the answer first with its `dialog` action); a confirm that looks like a **payment or a deletion goes to you**.

- 🛑 **Stop means stop.** The ■ Stop button cancels immediately, even mid model-call or mid-loop; a late response won't "resurrect" a cancelled task.

- 🎯 **No fake success.** After a fill/type the agent checks the field actually holds the value; if an action had no real effect it switches strategy instead of reporting success.

- 🙋 **Asks for help when blocked.** On a CAPTCHA, login wall, or paywall it **stops and asks you to step in**, then resumes — it doesn't flail.

- 🔐 **Signs in only with you.** When a task needs your account ("my list", "my saved jobs", orders, inbox) the agent may click the site's **Sign in** button once; at the login form Bah **pauses** — you sign in (click the username field to pick a login saved in Bah's password manager, or type it) and press Continue. The agent never types or sees a password and never guesses a username. Bah tracks whether you're **signed in or out per site** and tells the agent each step, so it doesn't re-click Sign in or assume pages it can't see.

- 🐢 **Per-site pacing.** Actions that touch a page wait a random 1–5 s between them on the same site; after a site shows a bot check, 15–30 s for the next 30 minutes. It only slows the agent down — it does not get around the check.

- 🔢 **25-step cap per command.** If a task doesn't finish in 25 actions, the agent stops on its own.

- 🧩 **Compatibility, not evasion.** We present as a standard, current Chrome (user agent, client hints and languages set consistently inside the engine — no page-script patching) only to avoid being wrongly blocked. We do **not** break CAPTCHAs, dodge rate-limits, or automate things sites forbid in their terms. Sites whose terms forbid automation (LinkedIn by default) get **careful mode**: one page load per request plus reading — no automated clicking, typing or scrolling; a second refused action ends the task and tells you what to do by hand.

- **🔑 Google login — use the "Sign in to Google" button.** Google blocks login *inside* embedded browsers (Electron/webview). Bah handles it the right way: click **🔑 Sign in to Google** → it opens the login in your **real Chrome/Edge** (where Google trusts it), you sign in, and Bah **detects it automatically**, imports the session (cookies via CDP) and closes the login window. Do it **once** and you stay logged in.

- 📥 **Downloads have no type or size limit.** Any file type can be downloaded (installers included), streamed straight to disk. **Torrents:** by default `.torrent` files just download like any other file and `magnet:` links open in your system's torrent app; turn on **🧲 Built-in torrent client** in the menu to open them in Bah's own torrent card instead. Details in [ARCHITECTURE.md](ARCHITECTURE.md#downloads--torrents).

- 🚫 **Adblock pauses on known sites.** YouTube and Twitch get automatic bypass so their player isn't blocked by anti-adblock. Everywhere else adblock stays on.

**Not implemented yet** (but would be nice): a "preview the plan, then approve" mode before running and a per-tab sandbox.

---

## Comparison with other agents

|  | **Bah** | Comet | Browser-Use |
|---|---|---|---|
| Open source | ✅ | ❌ | ✅ |
| 100% local option (Ollama) | ✅ | ❌ | ✅ |
| Runs at home | ✅ | ❌ | ❌ (lib only) |
| Cloud **or** local AI | ✅ | ❌ (cloud only) | ✅ |
| Real clicks (not synthetic) | ✅ | ✅ | ✅ |
| Full UI | ✅ | ✅ | ❌ |
| Adblock + Safe Browsing | ✅ | ✅ | ❌ |
| Confirmation before sensitive actions | ✅ | ⚠️ | ❌ |

> ℹ️ The **tested and recommended** AI path is **DeepSeek (cloud)**; local (Ollama) also works but is **less validated**.

---

## License

**MIT** — see [LICENSE](LICENSE).

In short:

- Free and open source.
- You may use, modify, redistribute, and use it commercially.
- Keep the copyright and license notice.
- No warranty. Provided "as is".

---

## Contact

- 📧 **Email**: **alexmachadovilela@gmail.com**
- 🐦 **X / Twitter**: [@alexvilelaba](https://x.com/alexvilelaba)
- 🐛 **Bugs / ideas**: [open an issue](https://github.com/alexvilelabah/bah-browser/issues)

Made with 🧉 by **Alex Vilela** — **VilelaLab**.
