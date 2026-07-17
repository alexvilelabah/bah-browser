## EXPERIMENTAL — testers only

This is an **untested** Linux build. It compiles and passes CI (the app opens and does not crash headless), but **nobody has run it on real hardware yet** — I don't have a Linux machine.

**Do not treat this as a stable release.** The stable, tested build is Windows — see the Latest release.

### How to run

```bash
chmod +x Bah-*.AppImage
./Bah-*.AppImage
```

If it refuses to start, try `--no-sandbox`. On some distros you may need `libsecret` and `fuse2`.

### What should work

The whole core is cross-platform: the AI agent, ad/tracker blocking, the keyless free AI (Pollinations), local AI via Ollama, cloud API keys, document Q&A, background monitors, voice input.

### What does NOT work on Linux

**Media downloading.** It fetches a Windows build of ffmpeg/yt-dlp, so that feature is skipped on Linux. It degrades — it does not crash.

Also: auto-update is Windows-only. To update, download a newer AppImage.

### What I'd love to know

If you install it, the most useful thing you can tell me:

1. **Does it open at all?** (that alone is useful)
2. **Does the AI agent actually click things?** Open the assistant, ask it to do something on a page — e.g. "open youtube and search for X" — and tell me whether it really operated the page, or just talked about it. That's the part I most need confirmed on Linux.
3. Anything that looks visually broken.

Open an issue with whatever you find, even if it's just "it doesn't launch". That's the point of this build.
