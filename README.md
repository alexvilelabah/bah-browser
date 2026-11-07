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

https://github.com/user-attachments/assets/0b67eac7-7800-403a-b9e1-6bc9e7619c24

<p align="center">
  <i>Running on a local model: Bah finds Michael Jackson's most famous music videos and downloads them, compares AirPods Pro prices across stores in one table, and downloads Steam from the vendor's own site.</i><br/>
  ▶️ <a href="assets/demo.mp4">Download the video (MP4)</a>
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

## 💡 What people use Bah for

An open-source **AI browser agent** for the boring parts of the web: it reads the page, clicks, types,
uploads and waits like a person would, and **asks you before anything risky** (paying, deleting,
submitting, reading your files or clipboard). Runs with a cloud model or **100% local** (Ollama or
llama.cpp — tested with `Qwen3-VL-8B` on a 16 GB GPU).

| Ask it… | What Bah does | Status |
|---|---|---|
| *"Download the latest Ubuntu ISO"* · *"get the printer driver for my Mac"* | Finds the right file for **your** OS and CPU, clicks through EULAs and OS selectors, downloads in the background (any size, resumable), tells you the saved path; can verify checksums | ✅ tested end-to-end |
| *"Download the latest Steam / HP printer software / Office / SolidWorks / Altium / Photoshop for this computer"* | Goes to the **vendor's official** page (flags "free download" aggregators), takes the build for your OS **and CPU** (Intel vs Apple Silicon, x64 vs ARM64), warns on a wrong-OS/CPU file, and **stops at sign-in walls** for you to decide (never types passwords or creates accounts). Never opens the installer | 🧪 test pages (auto-detect, OS/CPU list, printer model, modal, sign-in). Live, local Qwen3-VL-8B, Intel Mac: ✅ Steam (`steam.dmg`) · ✅ Altium (stopped at sign-in) · ❌ HP 9015e, Office, SolidWorks, Photoshop (official page reached, no build picked) |
| *"Find a hotel in New York under $450 a night for next weekend"* | Searches booking sites, picks dates in the date picker, dismisses pop-ups (keeps coupon codes), compares prices | ✅ tested (Booking.com) |
| *"Compare prices for AirPods Pro on Amazon and other stores"* · *"find a compatible charger for my laptop"* | **Visits each store's own site** (the ones you name, topped up with your region's big retailers), searches there, reads the price on that page and builds the table only from those reads — a deals article or price aggregator is never a source. A store showing a bot check is handed to you (Watch/Takeover) or marked "couldn't read"; every row links to the page it was read from | ✅ live, local 8B model: Amazon, Best Buy, Walmart read · Target showed a press-and-hold check (handed off) · 🧪 4 practice stores |
| *"Open my 2 recommended jobs"* · *"Apply to this job with my résumé"* | Reads your recommended jobs (saved ★ ones too), opens them one at a time, picks the best résumé from a folder **you** allow, fills the form **by code** — text fields and searchable drop-downs (Greenhouse, Workday) alike — from your 📝 application profile and saved answers, asks you once for anything left, and stops for your OK before submitting | 🧪 rehearsed on copies of real Indeed + Ashby pages (3/3) · live sites next |
| *"Add milk, eggs, bananas and a dozen bagels to my Walmart cart"* | Searches each item, picks by your words (brand, size, organic) or a sensible store-brand default and says why, sets quantities (a dozen bagels = 2 six-packs), asks before substituting anything out of stock and before choosing pickup/delivery or a store, checks the cart, reports a table — and **never checks out** (the brake asks before Checkout / Place order / Reserve time slot) | 🧪 rehearsed on local store copies with the local 8B model: Walmart copy 3/3 carts right and never checked out (2/3 also checked the cart and reported) · Whole Foods and Target copies 0/1 · live stores not tried |
| *"Open a support ticket with Apple for my MacBook's battery"* · *"Ask the Dell Community why my XPS fan is loud"* | **Starts by finding the vendor's support site with a web search** (any brand — Dell, Canon, Logitech…), opens only a result on the vendor's own domain (look-alike "support" ads such as `canon-support-help.com` are refused), then stays there, picks product → topic → contact options, searches the community before drafting a post, and **fills the ticket by code with what is known so far** — your request and follow-up replies, the product and serial you gave, a similar thread it saw — written by your model under an "only these facts" rule (anything it adds, like a model year, is rejected and Bah falls back to your own words in a fixed template), plus subject and the 📝 profile's contact fields; a card then asks you to look it over in the tab, change anything, and press Continue. Never a password, never an account. A vendor page that does not load (Access Denied / 403, not found, blank) → it web-searches for that page and opens only a result on the vendor's own domain; still blocked → it stops and says so. A run that ends off the vendor's site is reported as not done; at the sign-in form Bah pauses for you, and the final **Submit / Send / Post** shows you the exact text first | 🧪 local 8B model (Qwen3-VL-8B) on practice copies, with the form filled by code: tickets sent through the card: Dell 3/3, Apple 2/5 (the misses never reached the form and ended as failed); forum posts 6/6 (one as a reply in the matching thread); every form reached got the description filled and the review card; no made-up sentence in anything sent; every sign-in reached paused, every send asked, no password typed · 🧪 a scam look-alike ad above the real result is refused (Canon) · live: Dell's "Contact Support" tab answers Access Denied to Bah — the agent searches for the page instead of leaving Dell (verified with synthetic pages, not live) |
| *"Who are the procurement managers at Acme?"* | People research on LinkedIn in **careful mode** — one page load per request, no automated clicking on sites whose terms forbid it | ✅ tested |
| *"Plan my Tokyo trip in Tokyo time"* | Shows sites in your destination's time zone and tells the agent when your VPN makes prices foreign | ✅ tested |
| *"Save this receipt as a PDF"* · *"screenshot the whole page"* · *"copy the total"* | Saves to Downloads / copies for you; reading your clipboard needs your permission | ✅ tested |
| Behind a **corporate proxy** (Blue Coat, PAC, SOCKS) with company TLS certificates | Uses the OS proxy and certificates for pages **and** Bah's own requests; proxy sign-in prompt | ✅ tested with an authenticating proxy |
| *"Build a grocery cart for a family of four"* · scheduled daily searches | Multi-item carts across grocers; tasks on a schedule with missed-run prompts | 🛠️ planned |

✅ tested end-to-end on the real site · 🧪 tested on purpose-built test pages · 🛠️ planned.
Want another workflow? Bah can **save what worked as a skill** — see [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md).

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
- **Scheduled tasks** — "every weekday at 8am check my Indeed recommendations" or ⋮ → ⏰ Scheduled tasks: runs while Bah is open, each in its own tab; a time missed while Bah was closed is offered when it opens; anything that needs your OK (send, buy, submit, sign in) waits for you with a notification
- **One memory per session, sized for small local models** — the agent and the chat share the session's conversation (requests, answers, task summaries, facts, 📌 pinned items) within a fixed token budget, so the page is never crowded out. When it fills up, older turns are summarized **visibly** in the panel (expand to read the summary; `/compact` on demand). A **context meter** next to the model name shows `context 6.1k / 16k · thread 2.3k` and, tapped, what took the room
- **Conversations survive a restart** with ⋮ → When Bah opens → "Continue where you left off", and **🕘 Chat history** (⋮) lists past sessions — open one read-only or **Resume** it, reopening its tabs. Stored encrypted on this computer, never for incognito tabs, cleared with "Clear browsing data"
- **Memory saver** — like Chrome's: tabs you haven't used for a while (⋮ → 💤: Moderate 2 h, Balanced 30 min, Maximum 10 min) free their memory and reload when clicked. Never tabs playing audio/video, using the camera, mic or screen, downloading, with a half-filled form, pinned, with notifications or a connected device, on your "always keep these sites active" list, or with an AI task running or waiting for you
- **Understands follow-ups** — "did you click it?" is answered from a log of what the agent just did (not a web search); "one window was opened, but not the second" sends the agent back to finish; "it" / "that one" in a new request means the last thing the agent acted on
- **Goes straight to sites you name** — "browse to linkedin, find a job…" opens linkedin.com right away instead of searching for it first. Only a short, checked list of well-known sites is used; an unknown name is searched, never guessed
- **"Summarize my open tabs"** — one line per tab plus an overall summary, each with a link to switch to it. Asks before reading your tabs (or follows your always/never choice), skips incognito tabs and internal pages, and leaves sleeping tabs asleep unless you ask
- **Natural-language routing** — commands that start with an action ("search for…", "find…", "browse to…", "apply…") go to the agent; questions get an answer. Typos like "open 2 windos … a different video in each" still open 2 videos
- **Optional local router** — download a small model once (Qwen2.5-1.5B, 1.1 GB, Apache-2.0; asked first) and every message is labelled on your own computer before it reaches the AI: task, page question, web question, chat, a question about the last run, or "that went wrong, fix it". Copes with typos ("search for a set of new golf blubs"); your text never leaves the machine; without it the word rules route as before. For "find/download" requests about a named work it also makes the request precise before the big AI starts ("music videos from top gun with tom cruise" → "…the 1986 film Top Gun…"), shown as **🔎 Understood as: …**; the big AI gets both texts and yours wins. Media collections ("all the music videos from the movie X") are then searched track by track as title + artist + year
- **One-shot skills**: open N videos at once, jump to the exact moment a phrase is spoken across several videos, **chat about a YouTube video using its transcript**, compare prices, fetch news — deterministic shortcuts that cost zero tokens
- **UI in English by default**, with **Português** and **Español** available in Settings — the AI replies in your chosen language
- **Full adblock** (EasyList + EasyPrivacy) with automatic bypass for sites that break (YouTube, Twitch)
- **Safe Browsing** (URLhaus malicious-hosts list, updated daily)
- **Real mouse clicks** via Chromium `sendInputEvent` (not synthetic events — goes through React, Vue, Angular without being ignored)
- **Honest, consistent browser identity** — current Chrome user agent, client hints and languages set inside the engine (one source, no JavaScript patching), so sites see a normal Chrome and don't wrongly block it. GPU, CPU cores and memory are the **real** values (the same ones Chrome reports on your computer) — nothing faked, so the page and its workers agree. It does not try to evade bot detection; sites that forbid automation get **careful mode**. Why test runs see more bot checks than you will: [ARCHITECTURE.md](ARCHITECTURE.md#browser-identity--bot-checks-what-sites-see)
- **Navigation skills** — short `SKILL.md` recipes (pop-ups, date pickers, autocomplete, EULAs, OS selectors, downloads, shopping, travel, people search, job applications, card lists, sign-in) chosen per step; save your own after a task that worked
- **Safety first** — confirms payments/deletions/submits; **location is denied to every site** without even asking (only a site you set to Allow in its padlock menu gets it); camera, microphone and clipboard are **blocked until you allow them**; uploads only use files *you* pick or a folder *you* allow for the session; page dialogs go through Bah's own box
- **Network & privacy** — system/manual/PAC/SOCKS proxies with sign-in, OS root certificates, **Secure DNS** (DNS-over-HTTPS: AdGuard, Mullvad, Quad9, Cloudflare, your NextDNS, or your own Pi-hole), **WebRTC IP-leak protection on by default**, IP-version and leak warnings ("your proxy is IPv4-only but this computer also has IPv6"), VPN-aware region and a "time zone for sites" setting
- **Hands the page to you when a site wants a person** — bot checks of any style and sign-in walls: the tab comes to the front, you do it, Bah carries on by itself (**Watch/Takeover**)
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

The agent answers with one JSON action per step (or a short batch). Command parity with
[agent-browser](https://agent-browser.dev/commands), adapted to a human-in-the-loop desktop browser.

| Group | Actions |
|---|---|
| **Click & type** | `click_ref` · `fill_ref` · `click_text` · `click_role` (role + name + nth) · `click_at` · `fill` (by label/placeholder) · `type` · `insert_text` · `press` (combos like `Control+Enter`) · `keydown` / `keyup` · `hover` · `dblclick` · `focus` · `drag` · `check` / `uncheck` · `select_option` |
| **Read the page** | element list (with `frame="…"` for iframe content and `disabled` marks) · `extract_text` (main content as Markdown; long pages in pages via `offset`, size scaled to the model's free context) · `find` · `look_at` (zoomed crop) · `get` (value, checked, enabled, visible…) · `get_html` (cleaned HTML of a selector or the page — `[#N]` refs, `[hidden]` marks, secrets and scripts stripped; for duplicate buttons, unlabeled fields, custom dropdowns; paged with `offset` like `extract_text`) |
| **Navigate & wait** | `navigate` · `back` / `forward` / `reload` · `scroll` · `new_tab` / `switch_tab` / `close_tab` · `wait` (`ms`, or until `text` / `gone` / `url` / `load: "networkidle"`) |
| **Search** | `web_search` (Google → Bing → DuckDuckGo → Yahoo → Perplexity, skipping engines that block) · `history_search` (asks permission) |
| **Files** | `upload` (you pick in the OS dialog) · `list_files` / `read_file` / `upload { file }` (a folder you allow for the session) · `download` + `list/cancel/pause/resume/retry_download` · `save_pdf` · `screenshot { full }` |
| **Dialogs & clipboard** | `dialog { accept }` (answer the next alert/confirm) · `clipboard { write }` · `clipboard { read }` (asks permission) |
| **Plan & finish** | `plan` · `store` · `suggest_time_zone` (you confirm) · `render_view` (comparison table) · `done(reason, success)` |

Clicks happen through `webContents.sendInputEvent` in the main process — a **real** Chromium mouse event, not a synthetic one, so React/Vue/anti-bot sites respond normally. The AI prefers the **DOM-first** path (`click_ref`), falling back to text and then coordinates.

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

- **Local AI on integrated graphics:** the built-in router uses the CPU on integrated GPUs (for example Intel Iris Xe). Voice input always runs on the CPU. Ollama and `llama-server` choose their own hardware.
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
5. **Local via llama.cpp (tested setup):** Bah also talks to any OpenAI-compatible server. We test the agent against [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` running **`Qwen3-VL-8B-Instruct-Q4_K_M.gguf`** (from [`unsloth/Qwen3-VL-8B-Instruct-GGUF`](https://huggingface.co/unsloth/Qwen3-VL-8B-Instruct-GGUF), with its vision projector) on a 16 GB NVIDIA GPU — it fits fully in VRAM and is fast enough for step-by-step browsing:
   ```bash
   llama-server -hf unsloth/Qwen3-VL-8B-Instruct-GGUF:Q4_K_M -c 32768 -ngl 99 --host 0.0.0.0 --port 8080
   ```
   In Bah: gear icon → 🏠 Local AI → OpenAI-compatible endpoint `http://<server>:8080/v1`. With this model the agent reliably handles multi-page download tasks — e.g. *"download the latest ubuntu iso"* (finds the release index, starts the download, waits for it and reports the saved path; ISO verified against the published SHA256). Use a vision-capable model (the `-VL-` variants): the agent reads the screenshot as well as the page's element list.

### Corporate networks (proxy, company certificates)

Bah follows the **operating system's proxy settings** by default, like Chrome — including automatic
detection (WPAD) and PAC scripts set by IT. To set one by hand: menu ⋮ → **🌐 Network & proxy**:
**System** (default) · **Manual** (`proxy.corp:8080` for HTTP+HTTPS, or `socks5://127.0.0.1:1080` for a
SOCKS proxy / `ssh -D` tunnel) · **PAC** (script URL) · **Direct**, plus a bypass list and a
**Test connection** button. `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` pre-configure it when nothing is saved.

- **Proxy sign-in (HTTP 407, e.g. Blue Coat):** Bah asks for the username and password in its own box;
  *Remember* stores them encrypted with the OS keychain (`safeStorage`). They never reach the agent or the model.
- **Everything uses the same route:** pages, sign-in windows, Bah's own requests (AI calls, updates,
  search) and the agent's downloads all go through the browser engine's network stack, so one proxy
  setting (and one sign-in) covers them.
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

- 🛑 **Stop means stop.** The ■ Stop button cancels immediately, even mid model-call or mid-loop; a late response won't "resurrect" a cancelled task.

- 🎯 **No fake success.** After a fill/type the agent checks the field actually holds the value; if an action had no real effect it switches strategy instead of reporting success.

- 🙋 **Hands you the page when it wants a person.** On a bot check / CAPTCHA of any kind or a sign-in wall it **brings the tab to the front and lets you do it** — [Hand back] / [Skip this site] — then resumes by itself as soon as the page is normal again. It never touches the check. The only exception is the opt-in menu switch (☑️ *Agent may click captcha checkboxes*, OFF by default), which still clicks a simple checkbox once before handing off. Scheduled runs don't wait: that site is marked "couldn't read — human check".

- 🔐 **Signs in only with you.** When a task needs your account ("my list", "my saved jobs", orders, inbox) the agent may click the site's **Sign in** button once; at the login form Bah **pauses** — you sign in (click the username field to pick a login saved in Bah's password manager, or type it) and press Continue. The agent never types or sees a password and never guesses a username. Bah tracks whether you're **signed in or out per site** and tells the agent each step, so it doesn't re-click Sign in or assume pages it can't see.
- 🔑 **Works with your password-manager extension.** With LastPass, Bitwarden or 1Password installed, Bah steps aside so the two managers don't compete: its own logins list and "Save password?" stay off in normal tabs (there's a switch in Passwords). At a login form the agent waits a few seconds for the **extension's own** auto-login and carries on once you're in. If nothing happens, a card tells you to sign in with the extension and which setting to turn on so it's automatic next time: "Auto-login" in LastPass, "Autofill on page load" in Bitwarden. The agent never clicks the extension's menu and never reads a password.
- 🧩 **Add to Bah.** The Chrome Web Store only shows its install button in Google Chrome. On an extension's store page, Bah shows its own **Add to Bah** button, which downloads the extension's public package and asks before adding it.

- 🔢 **25-step cap per command.** If a task doesn't finish in 25 actions, the agent stops on its own.

- 🧩 **Compatibility, not evasion.** We present as a standard, current Chrome (user agent, client hints and languages set consistently inside the engine — no page-script patching) only to avoid being wrongly blocked. Sites whose terms forbid automation (e.g. LinkedIn) get **careful mode**: one page load per request, no automated clicking — if the agent tries anyway, Bah stops the task and tells you what to do by hand (sign in yourself; open the job and click Apply, then let Bah continue on the company's own application site). We do **not** solve image CAPTCHAs or dodge rate-limits. By default the agent stops and asks you on any human-verification page; an **opt-in** menu switch (☑️ *Agent may click captcha checkboxes*, off by default) lets it click a simple "I'm not a robot" / "Verify you are human" checkbox once — the captcha service still decides, and anything more (image puzzles) goes back to you. Respect each site's terms.

- **🔑 Google login (optional) — the profile icon at the top right.** Signing in is only needed for tasks inside Google (Gmail, Drive, your YouTube). Google blocks login *inside* embedded browsers (Electron/webview). Bah handles it the right way: click the **profile icon** → **Sign in to Google** → it opens the login in your **real Chrome/Edge** (where Google trusts it), you sign in, and Bah **detects it automatically**, imports the session (cookies via CDP) and closes the login window. Do it **once** and you stay logged in.

- 📥 **Downloads have no type or size limit.** Any file type can be downloaded (installers included), streamed straight to disk. **Torrents:** by default `.torrent` files just download like any other file and `magnet:` links open in your system's torrent app; turn on **🧲 Built-in torrent client** in the menu to open them in Bah's own torrent card instead. Details in [ARCHITECTURE.md](ARCHITECTURE.md#downloads--torrents).

- 🚫 **Adblock pauses on known sites.** YouTube and Twitch get automatic bypass so their player isn't blocked by anti-adblock. Everywhere else adblock stays on.

**Not implemented yet** (but would be nice): a "preview the plan, then approve" mode before running, a per-tab sandbox, and click rate-limiting to avoid aggressive bot-like behavior.

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
