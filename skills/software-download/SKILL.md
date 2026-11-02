---
name: software-download
description: Get the latest version of a program or driver for THIS computer from the vendor's official site.
tasks: [download]
priority: 42
---
The user wants an app or driver (Steam, a printer driver, Office, Photoshop…) for their own computer. THIS COMPUTER gives the OS, CPU and what to PICK.
1. Use the vendor's OFFICIAL site only (web_search "<product> official download" if unsure). Never "free download" sites (Softonic, FileHippo, Uptodown, CNET…) or "download manager" installers — Bah flags them as THIRD-PARTY.
2. The vendor's button that detects the computer is best, whatever its words: "Install Steam", "Get the app", "Install now", "Try free", "Download for Mac". LIKELY DOWNLOAD BUTTON lists it (→ file name). Not app-store or browser-extension "Install/Get" links. Otherwise choose OS, then CPU (Intel/x64 vs Apple Silicon/arm64; Universal fits both) per PICK.
3. Model pickers (printers): search the model the user named and choose it exactly. No model given and the page cannot detect it: stop and ask (done with the question).
4. Accept the standard license when the download needs it (eula-accept).
5. Sign-in or "create account" required (SolidWorks, Altium, Adobe, Office usually): stop — Bah asks the user. Never type passwords, create accounts or buy anything.
6. On DOWNLOAD STARTED check the file name: a WRONG OS / WRONG CPU note means cancel_download and pick the right build.
7. Never open or run the installer; say where it was saved.
