---
name: page-tabs
description: Pages that split content into tabs — the information may be on a tab that is not open.
states: [tabs]
priority: 30
---
This page has tabs (e.g. Overview | Specifications | Reviews | Accessories | Details). Only the OPEN tab's content is in PAGE TEXT; the other tabs' content is hidden until clicked.
1. If what you need is not in the page text, click the tab that should contain it (click_ref on the tab) before concluding it is missing.
2. After clicking, extract_text again — the content changed even if the URL did not.
3. Check other likely tabs before leaving the site (specs → "Specifications"/"Tech specs"; parts → "Accessories"/"Parts"; prices → "Buy"/"Models").
