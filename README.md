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

**🤖 An AI agent is installing Bah for you?** Point it at [INSTALL-FOR-AGENTS.md](INSTALL-FOR-AGENTS.md) — step-by-step, with a check after each step.

---

## What it does

- **Full browser** with tabs, navigation, URL bar, dark theme
- **AGENT panel** on the side: type a command → the AI decides step by step until it's done
- **Reads the page** (DOM, numbered interactive elements, and OCR) and acts through structured tools — it doesn't rely on "seeing" the screen. Works on pages that forbid scripts too (raw files on Hugging Face / GitHub): Bah reads them from its own isolated script world
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
- **Network & privacy** — system/manual/PAC/SOCKS proxies with sign-in, OS root certificates, **Secure DNS** (DNS-over-HTTPS: AdGuard, Mullvad, Quad9, Cloudflare, your NextDNS, or your own Pi-hole), **WebRTC IP-leak protection on by default**, IP-version and leak warnings ("your proxy is IPv4-only but this computer also has IPv6"), VPN-aware region and a "time zone for sites" setting
- **Google sign-in is optional** — a round profile icon at the top right (like Chrome's) signs in to Google for Gmail / Drive / YouTube tasks; everything else works without it
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

### Linux: build and install

Tested on Ubuntu 24.04 x64; package names and the AppArmor step below are for that release. Other distros need the equivalent packages.

**1. System packages.** Also install **Node.js 22.18 or newer** (older 22.x builds, but `npm run test:unit` needs 22.18).

```bash
sudo apt-get install -y git libfuse2t64 libnss3 libgtk-3-0t64 libasound2t64 libgbm1 libnotify4 \
  libxss1 libxtst6 libatspi2.0-0t64 libuuid1 libsecret-1-0 xdg-utils
```

`xvfb` is optional: only headless smoke tests use it.

**2. Build the AppImage**, from the cloned folder:

```bash
npm ci
node node_modules/electron/install.js   # npm does not fetch the Electron binary on its own
npm run build
npx electron-builder --linux AppImage --publish never
```

The result is `release/Bah-<version>.AppImage`. If `npm ci` fails with `Permission denied (publickey)`, you have no GitHub SSH key; run `git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"` and retry.

**3. Allow the browser sandbox.** Ubuntu 24.04 restricts the user namespaces Chromium's sandbox uses, so Bah aborts at launch with a `chrome-sandbox` error. Run this **from the cloned folder** to add an AppArmor profile like the one Chrome ships with:

```bash
sudo tee /etc/apparmor.d/bah-browser > /dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile bah-browser "/{tmp/.mount_Bah-*/bah-browser,${PWD#/}/release/linux-unpacked/bah-browser,${PWD#/}/node_modules/electron/dist/electron}" flags=(unconfined) {
  userns,
  include if exists <local/bah-browser>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bah-browser
```

It covers the AppImage (mounted under `/tmp`; if you set `TMPDIR`, adjust that path), `release/linux-unpacked` and the dev Electron in this folder. Don't use `--no-sandbox` instead: it turns off Chromium's sandbox for every site you visit.

**4. Run it:** `release/Bah-*.AppImage`, or `npx electron .` from the source folder.

**Good to know**

- **`MESA-LOADER: failed to open nvidia-drm` on a machine without NVIDIA:** leftover NVIDIA settings are forcing the wrong graphics driver. If `/etc/environment` sets them, remove them and log out and back in:
  ```bash
  sudo sed -i.bak -E '/^(GBM_BACKEND|__GLX_VENDOR_LIBRARY_NAME|LIBVA_DRIVER_NAME)=/d' /etc/environment
  ```
- **Netflix and other DRM video** need a package signed through castLabs (see `build/afterSign.js`); a plain local build doesn't play them.

### Setting up the AI

1. Open the browser, click the **AI** button in the address bar.
2. Gear icon → pick a provider.
3. Pick **DeepSeek**, **Mistral** or **NVIDIA NIM** and paste that provider's key (DeepSeek's is very cheap) → Save. Image generation works with no key either way; chat and the agent need this (or local Ollama, next step).
4. **Local (optional, free/offline):** install [Ollama](https://ollama.com) and **keep it running** (it lives in the tray and serves models at `127.0.0.1:11434`). Then download a model from inside Bah (☁️/🏠 → 🏠 Local AI → type a name → **Download**) or in a terminal (e.g. `ollama pull qwen3:14b`). Local works offline, but the cloud (DeepSeek) is more reliable.

### Corporate networks (proxy, company certificates)

Bah follows the **operating system's proxy settings** by default, like Chrome — including automatic
detection (WPAD) and PAC scripts set by IT. To set one by hand: menu ⋮ → **🌐 Network & proxy**:
**System** (default) · **Manual** (`proxy.corp:8080` for HTTP+HTTPS, or `socks5://127.0.0.1:1080` for a
SOCKS proxy / `ssh -D` tunnel) · **PAC** (script URL) · **Direct**, plus a bypass list and a
**Test connection** button. `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` pre-configure it when nothing is saved.

- **Proxy sign-in (HTTP 407, e.g. Blue Coat):** Bah asks for the username and password in its own box;
  *Remember* stores them encrypted with the OS keychain (`safeStorage`). They never reach the agent or the model.
- **Everything uses the same route:** pages, sign-in windows and Bah's own requests (AI calls, updates,
  search, the agent's downloads) go through the browser engine's network stack, so one proxy setting
  (and one sign-in) covers them.
- **Company root certificates (TLS inspection):** Chromium already trusts the OS certificate store.
  Electron's Node does not, so Bah reads the OS store at startup (macOS keychains, Windows `Root`/`CA`
  stores, Linux CA bundle) and adds those roots to Node's defaults — downloads in the worker thread work
  behind a TLS-inspecting proxy too.
- **WebRTC IP leak protection (on by default):** with a proxy, WebRTC may only use the proxy
  (`disable_non_proxied_udp`); without one, only the main network connection
  (`default_public_interface_only`) — either way a page cannot list your IP addresses through it. **Best call
  quality** turns it off (any page can then read your real IPs). **WebRTC: IPv4 only** removes IPv6 candidates
  (applies after a restart). Chromium cannot sign in to SOCKS5 proxies (username/password); SOCKS5 without a
  password works.
- **Secure DNS (DNS-over-HTTPS):** **System** (default — nothing changes until you pick) · presets **AdGuard**
  and **Mullvad** (ad blocking, no sign-up), **Quad9** (malware blocking), **Cloudflare** (no filtering) ·
  **NextDNS** (paste your configuration ID — free account, you manage the lists; free plan 300k queries/month,
  after that it still resolves but stops filtering) · **Custom** `https://` address (Pi-hole, AdGuard Home).
  **Strict** makes lookups fail instead of falling back to your network's plain DNS when the server can't be
  reached. One setting for every tab, private ones included. It's a browser setting, not an extension: Chrome
  extensions have no way to change the resolver.
- **IP version:** Bah's engine cannot force IPv4-only or IPv6-only for page traffic (tested: `--disable-ipv6`
  does nothing in Electron 44), so those options are shown disabled with the reason — use your system's
  network settings. Only WebRTC can be limited to IPv4 (above).
- **Leak warnings:** if your proxy or secure-DNS server is reachable over only one IP version and this computer
  also has a real address of the other, the panel warns that traffic may bypass it (with a button to the
  system's network settings). It also warns when a proxy is set but WebRTC is on Best call quality, and notes
  that a proxy may do its own DNS lookups. Bah only looks at which IP versions exist — never shows or sends
  your addresses.
- **VPN extensions:** a Chrome extension that controls the proxy (`chrome.proxy`) wins while it is on, as in
  Chrome; when it lets go, the tabs return to the proxy set here.

### Region & time (VPN, travel)

Menu ⋮ → **🌍 Region & time**:
- **Network location:** with a VPN or proxy, sites show the prices, currency and stock of the country your
  connection exits in. In **Auto** (default) Bah checks that country with one request to Cloudflare's
  `cdn-cgi/trace` when a task starts (cached 10 min, rechecked when the proxy changes) and tells the agent,
  so it does not call foreign prices "local". Searches use that country (`gl=` / `cc=`). On a shopping or
  travel task, if the network country differs from your computer's, Bah asks once which to prefer.
  **My computer's region** or **a specific country** never checks the network.
- **Time zone for sites:** your computer's (default), a chosen zone for planning a trip or a flight, or
  **UTC** (hides your real zone from page scripts). Set in the engine like DevTools' override; a 🕐 chip in
  the address bar shows it; it goes back to your computer's zone on restart unless you tick *Keep*. The
  agent can only *suggest* a zone (`suggest_time_zone`) — you confirm. Signed-in calendars usually follow
  the time zone in your account settings, not the browser's.

---

## Safety & limits

The agent runs with full browser privileges, so it's worth being clear about what it does and doesn't do:

> ⚖️ **You're in control — and responsible.** Bah acts in your real session, on your account. Use it within each site's terms and the law. Sensitive actions (paying, buying, deleting, entering card data) always ask for your confirmation first.

> 🔍 **Audit it yourself.** The full threat model, a verify-it-yourself checklist (each protection → the exact file), what leaves your machine, and an honest list of accepted tradeoffs all live in **[SECURITY.md](SECURITY.md)**. A map of the codebase — every file, the live agent loop, the build — is in **[ARCHITECTURE.md](ARCHITECTURE.md)**. The whole of `src/` is ~30 files.

- 🔓 **It's your real session.** The browser uses a persistent partition (`persist:browser`), so cookies and logins are saved. If you're logged into Gmail in Bah, so is the agent. **The AI can access anything you could access manually.** Don't log into accounts you wouldn't trust an assistant with.

- 🛡️ **Safety brake on sensitive actions.** Before **paying, buying, checking out or reserving a delivery slot, deleting, entering card data, sending a job application, or sending a support ticket or forum post** (the card shows the text that goes out), the agent **pauses and asks for your confirmation** — and this works on *every* path (model clicks, coordinate clicks, Enter on a checkout page, learned shortcuts, and repeated automations). It never does those silently.

- 💬 **Page pop-ups don't freeze anything.** A site's `alert`/`confirm` opens in Bah's own box instead of the native one that locked the page (and the agent). During a task, alerts are closed and ordinary confirms accepted (the agent can arm the answer first with its `dialog` action); a confirm that looks like a **payment or a deletion goes to you**.

- 🛑 **Stop means stop.** The ■ Stop button cancels immediately, even mid model-call or mid-loop; a late response won't "resurrect" a cancelled task.

- 🎯 **No fake success.** After a fill/type the agent checks the field actually holds the value; if an action had no real effect it switches strategy instead of reporting success.

- 🙋 **Hands you the page when it wants a person.** On a bot check / CAPTCHA of any kind or a sign-in wall it **brings the tab to the front and lets you do it** — [Hand back] / [Skip this site] — then resumes by itself as soon as the page is normal again. It never touches the check. Scheduled runs don't wait: that site is marked "couldn't read — human check". On a paywall it still stops and asks you to step in, then resumes when you press Continue.

- 🔐 **Signs in only with you.** When a task needs your account ("my list", "my saved jobs", orders, inbox) the agent may click the site's **Sign in** button once; at the login form Bah **pauses** — you sign in (click the username field to pick a login saved in Bah's password manager, or type it) and press Continue. The agent never types or sees a password and never guesses a username. Bah tracks whether you're **signed in or out per site** and tells the agent each step, so it doesn't re-click Sign in or assume pages it can't see.
- 🔑 **Works with your password-manager extension.** With LastPass, Bitwarden or 1Password installed, Bah steps aside so the two managers don't compete: its own logins list and "Save password?" stay off in normal tabs (there's a switch in Passwords). At a login form the agent waits a few seconds for the **extension's own** auto-login and carries on once you're in. If nothing happens, a card tells you to sign in with the extension and which setting to turn on so it's automatic next time: "Auto-login" in LastPass, "Autofill on page load" in Bitwarden. The agent never clicks the extension's menu and never reads a password.
- 🧩 **Add to Bah.** The Chrome Web Store only shows its install button in Google Chrome. On an extension's store page, Bah shows its own **Add to Bah** button, which downloads the extension's public package and asks before adding it.

- 🐢 **Per-site pacing.** Actions that touch a page wait a random 1–5 s between them on the same site; after a site shows a bot check, 15–30 s for the next 30 minutes. It only slows the agent down — it does not get around the check.

- 🔢 **25-step cap per command.** If a task doesn't finish in 25 actions, the agent stops on its own.

- 🧩 **Compatibility, not evasion.** We present as a standard, current Chrome (user agent, client hints and languages set consistently inside the engine — no page-script patching) only to avoid being wrongly blocked. We do **not** break CAPTCHAs, dodge rate-limits, or automate things sites forbid in their terms. Sites whose terms forbid automation (LinkedIn by default) get **careful mode**: one page load per request plus reading — no automated clicking, typing or scrolling; a second refused action ends the task and tells you what to do by hand.

- **🔑 Google login (optional) — the profile icon at the top right.** Signing in is only needed for tasks inside Google (Gmail, Drive, your YouTube). Google blocks login *inside* embedded browsers (Electron/webview). Bah handles it the right way: click the **profile icon** → **Sign in to Google** → it opens the login in your **real Chrome/Edge** (where Google trusts it), you sign in, and Bah **detects it automatically**, imports the session (cookies via CDP) and closes the login window. Do it **once** and you stay logged in.

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
