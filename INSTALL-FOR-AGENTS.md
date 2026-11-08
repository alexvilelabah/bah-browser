# Installing Bah — instructions for an AI agent

You are an agent asked to install the **Bah** browser on the user's computer. Follow these steps in
order. Every step has a **check**; do not continue past a failed check — report it to the user.

**Ask the user before** running anything with `sudo`/admin rights, changing security settings, or
installing extra software (Homebrew, Node.js, Ollama). Never disable OS security features yourself;
when a step below needs that, tell the user what to click.

---

## 0. Decide the route

| User wants | Route |
|---|---|
| Just use Bah (Windows or macOS) | **A. Release installer** |
| Linux, or the newest unreleased changes from a branch/fork | **B. From source** |

Find the OS and CPU:

```bash
uname -s; uname -m            # macOS/Linux: Darwin|Linux, arm64|x86_64
```
```powershell
[System.Environment]::OSVersion.Platform; $env:PROCESSOR_ARCHITECTURE   # Windows
```

---

## A. Release installer

Releases: <https://github.com/alexvilelabah/bah-browser/releases/latest>. Asset names follow
`Bah-<version>-<arch>.dmg` (macOS) and `Bah-Setup-<version>.exe` (Windows).

### A1. macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/x64/')               # arm64 or x64
gh release download --repo alexvilelabah/bah-browser --pattern "Bah-*-${ARCH}.dmg" --dir ~/Downloads
MNT=$(hdiutil attach ~/Downloads/Bah-*-"${ARCH}".dmg -nobrowse | tail -1 | awk -F'\t' '{print $NF}')
cp -R "$MNT/Bah.app" /Applications/
hdiutil detach "$MNT" -quiet
xattr -cr /Applications/Bah.app                       # not signed/notarized yet: clears the "damaged" block
```

No `gh`? Download the `.dmg` for the right architecture from the releases page instead.
**Check:** `test -d /Applications/Bah.app && echo ok`, then `open -a Bah` starts it.

Video downloads and MP3s on macOS need ffmpeg from Homebrew (optional, ask first; Bah fetches
yt-dlp and Deno itself):
```bash
brew install ffmpeg
```
**Check:** `ffmpeg -version | head -1`.

### A2. Windows

```powershell
gh release download --repo alexvilelabah/bah-browser --pattern "Bah-Setup-*.exe" --dir $env:USERPROFILE\Downloads
Start-Process "$env:USERPROFILE\Downloads\Bah-Setup-*.exe"
```

The installer is not code-signed yet:
- "Windows protected your PC" → the **user** clicks **More info → Run anyway**.
- If it is blocked with no "Run anyway", Smart App Control is on. Only the user can turn it off
  (Windows Security → App & browser control → Smart App Control settings). Explain; do not do it.

**Check:** Bah appears in the Start menu and opens. Windows builds auto-update themselves.

---

## B. From source (any OS; required on Linux and for unreleased branches)

Needs **git** and **Node.js 22 or newer** (`node --version`).

```bash
git clone https://github.com/alexvilelabah/bah-browser.git      # or the fork/branch the user named
cd bah-browser
# git checkout <branch>                                          # if the user asked for a branch
npm install
node node_modules/electron/install.js   # fetches the castLabs Electron binary (npm does not fetch it on its own)
npm run build
npm start                                                        # or: npx electron .
```

**Check:** `node_modules/electron/dist/` exists (macOS: `Electron.app`), `npm run build` ends with `✓ built in …` and no `error`; `npm start` opens the window.
Optional: `npm run test:unit` should report `fail 0`.

macOS: for video downloads and MP3s, `brew install ffmpeg` (see A1).

### Linux (tested on Ubuntu 24.04 x64)

Ask the user before each `sudo` block, and do these **before** `npm start`. `npm run test:unit` needs Node 22.18 or newer.

```bash
sudo apt-get install -y git libfuse2t64 libnss3 libgtk-3-0t64 libasound2t64 libgbm1 libnotify4 \
  libxss1 libxtst6 libatspi2.0-0t64 libuuid1 libsecret-1-0 xdg-utils
```

Ubuntu 24.04 restricts the user namespaces Chromium's sandbox needs, so Bah aborts with a `chrome-sandbox` error until it has an AppArmor profile. From the cloned folder:

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

Never launch with `--no-sandbox` as a workaround; report the failure instead. To build an installable AppImage after `npm run build`:

```bash
npx electron-builder --linux AppImage --publish never     # writes release/Bah-<version>.AppImage
```

**Check:** the app stays open and its output has no `chrome-sandbox` line. If it logs `MESA-LOADER: failed to open nvidia-drm` on a machine without NVIDIA, see README → *Linux: build and install*; don't change `/etc/environment` without asking.

**Behind a corporate proxy:** `npm install` needs the proxy and, with TLS inspection, the company root
certificate: `export HTTPS_PROXY=http://proxy.corp:8080` and `export NODE_EXTRA_CA_CERTS=/path/to/company-root.pem`
(ask the user or their IT for both; never disable TLS checks with `strict-ssl=false`). Bah itself
picks up the OS proxy and OS root certificates on its own; see README → *Corporate networks*.

---

## C. Set up the AI (after installing)

Bah needs one AI provider. Ask the user which:

1. **Cloud (no GPU):** in Bah → **AI** button → ⚙️ → pick DeepSeek / Mistral / NVIDIA NIM → the
   **user** pastes their API key. Never type a key you were not given by the user.
2. **Local, Ollama:** install [Ollama](https://ollama.com) (ask first), keep it running, then in Bah
   → 🏠 Local AI → type a model name → **Download**.
3. **Local, llama.cpp (tested setup):** on a machine with a ~16 GB GPU:
   ```bash
   llama-server -hf unsloth/Qwen3-VL-8B-Instruct-GGUF:Q4_K_M -c 32768 -ngl 99 --host 0.0.0.0 --port 8080
   ```
   In Bah → 🏠 Local AI → OpenAI-compatible endpoint `http://<server>:8080/v1`.
   **Check:** `curl -s http://<server>:8080/v1/models` lists the model, and its `input_modalities`
   include `image` (use a vision model, the `-VL-` variants).

**Check:** in Bah, ask the agent *"open example.com and tell me the page title"* — it should answer
"Example Domain".

---

## D. Report back

Tell the user: the route used, the version (macOS:
`defaults read /Applications/Bah.app/Contents/Info.plist CFBundleShortVersionString`; Windows: Settings →
Apps → Bah; from source: `git log -1 --oneline`), the AI provider configured, and anything they still have to do themselves (security
prompts, API key, Homebrew tools).

## Uninstall

- macOS: quit Bah, delete `/Applications/Bah.app`; settings live in `~/Library/Application Support/bah-browser`.
- Windows: Settings → Apps → Bah → Uninstall; settings in `%APPDATA%\bah-browser`.
- From source: delete the cloned folder (and the settings folder above). Linux, if you added the AppArmor profile: `sudo apparmor_parser -R /etc/apparmor.d/bah-browser && sudo rm /etc/apparmor.d/bah-browser`.
