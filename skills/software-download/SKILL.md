---
name: software-download
description: Get the latest version of a program or driver for THIS computer from the vendor's official site.
tasks: [download]
priority: 42
---
The user wants an app or driver (Steam, a printer driver, Office, Photoshop…) for their own computer. THIS COMPUTER says the OS and CPU and what to PICK.
1. Use the vendor's OFFICIAL site only (web_search "<product> official download" if you do not know it). Never "free download" sites (Softonic, FileHippo, Uptodown, CNET…) or "download manager" installers — Bah flags them as THIRD-PARTY.
2. A "Download for Mac/Windows" or "Install <product>" button that detects the computer is the best choice. Otherwise choose the OS, then the CPU (Intel/x64 vs Apple Silicon/arm64; Universal is fine for both) per PICK.
3. Product/model pickers (printers): type the model the user named into the site's search, choose the exact model. If the user gave no model and the page cannot detect it, stop and ask the user (done with the question).
4. Accept the standard license when it is part of the download (eula-accept).
5. Sign-in or "create account" required (SolidWorks, Altium, Adobe, Office usually): stop — Bah asks the user. Never type passwords, never create accounts, never start a trial or purchase.
6. When DOWNLOAD STARTED appears, check the file name: a WRONG OS / WRONG CPU note means cancel_download and pick the right build.
7. Never open or run the installer; say where it was saved.
