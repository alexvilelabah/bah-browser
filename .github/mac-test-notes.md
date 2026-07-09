## ⚠️ EXPERIMENTAL macOS build — testers only

**Do NOT download this if you just want to use Bah.** This is an automated build for testing. It has **never been run on a real Mac** by the author (I build/develop on Windows), so it may not open, may crash, or may behave oddly. It is **unsigned** and **not notarized** by Apple.

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
- ✅ **AI chat / talking about a page** — please test with a **DeepSeek** API key, and also with the built-in **🆓 Free** tab (no key, no signup). Tell me if each one answers.
- ✅ Browsing, tabs, the assistant panel — should work.
- ❌ **Downloading videos/music** will most likely **fail** on macOS in this build (the download helpers are Windows-only for now). Images may still work.

### Please report back
Does it open? Does DeepSeek answer? Does the Free tab answer? Any crashes or weird behavior? Every bit helps — thank you for testing. 🙏
