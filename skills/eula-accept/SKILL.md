---
name: eula-accept
description: Accept a standard software license/EULA as part of a download the user asked for.
states: [eula]
tasks: [download]
priority: 35
---
The page asks to accept a license, EULA or terms before downloading.
1. The user asked for the download, so accepting the vendor's standard license IS part of the task. Do not stop to ask.
2. If there is an "I accept / I agree to the license" checkbox, use check on its [id] (not click_ref — clicking an already ticked box unticks it). Then click the Download button.
3. If the agreement is the button itself ("Agree to the EULA and Download", "Accept and Download"), just click it.
4. Do not accept marketing/newsletter checkboxes — only the license needed for the download.
