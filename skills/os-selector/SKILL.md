---
name: os-selector
description: Pick the user's operating system/version on driver and software download pages.
states: [os-selector]
priority: 45
---
This page offers downloads for several operating systems. Use the OS, version and CPU type the user asked for.
1. If the page shows another OS (e.g. Windows downloads when the user asked for Mac), change it FIRST: drop-downs → select_option with the user's OS, e.g. option "macOS 26.x" (partial text is fine); tabs/links/buttons → click the matching OS ("macOS", "Mac", "Linux (deb)").
2. Pick the closest version listed for the user's OS (same major version, or the newest one if the exact one is missing).
3. Match the CPU type too when offered: Apple Silicon/ARM64 vs Intel/x86-64.
4. Only then choose the package.
