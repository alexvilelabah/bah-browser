## ⚠️ EXPERIMENTAL macOS build — testers only

**Do NOT download this if you just want to use Bah.** This is an automated build for testing. The author develops on Windows and has no Mac, so it may crash or behave oddly. It is **unsigned** and **not notarized** by Apple.

**Nobody has tested THIS version on a Mac.** An earlier build (1.6.2) was confirmed to launch and chat on an M1, and that build also fixed the missing app menu (**Quit / Cmd+Q**, Hide, Window). Everything since then — including all of the changes below — is unverified on macOS.

**What's new since the last Mac build (1.6.2):** a new warm look (rounded panel cards, restyled address bar), stronger ad/tracker blocking (cookie banners + tracking params like `fbclid` stripped from URLs), a selectable AI step limit (25/50/100), and a bundled emoji font.

There is **no auto-update** for this build — it's a one-off test.

### Which Mac?
This build is for **Apple Silicon (M1 / M2 / M3 / M4)**. It will **not** run on older Intel Macs. If you're on an Intel Mac, tell me and I'll make an Intel build.

### How to open it (macOS blocks unsigned apps)
1. Open the `.dmg` and drag **Bah** into Applications.
2. On first launch macOS will say it "is damaged / can't be opened" (that's just the missing Apple signature). Open **Terminal** and run:
   ```
   xattr -cr /Applications/Bah.app
   ```
   Then open Bah normally (or right-click the app → **Open**).

### What to test (and what probably won't work)
- ✅ **AI chat / talking about a page** — needs an API key now (DeepSeek is cheap and recommended) or a local Ollama model; there's no free no-key mode anymore. Tell me if it answers once configured.
- ✅ Browsing, tabs, the assistant panel — should work.
- ❌ **Downloading videos/music** will most likely **fail** on macOS in this build (the download helpers are Windows-only for now). Images may still work.

### Please report back
Does it open? Does the AI answer once you add a key? Any crashes or weird behavior? Every bit helps — thank you for testing. 🙏
