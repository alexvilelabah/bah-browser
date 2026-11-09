---
name: site-search
description: Use the site's own search/destination box, which shows live results while you type.
states: [searchbox]
tasks: [search]
priority: 35
---
This page has its own search field (search bar, "Where are you going?", destination, city, product). Use it instead of Google or guessing URLs.
1. Click the field (click_ref), then type the term with fill_ref — short and specific ("Stowe, Vermont", "Los Angeles").
2. Most sites show live results/suggestions UNDER the field as you type. Use { "action": "wait", "ms": 2000 } once so they can appear.
3. A SUGGESTIONS LIST may open (often with "Trending" items): click an entry ONLY if it contains your key words (e.g. the exact model "15ADA05"); otherwise ignore the panel.
4. No matching entry? press "Enter", or click the search/submit button next to the field.
5. Check the results page is about YOUR query; if it shows something else (another product), re-type the query and press Enter.
6. Then fill any remaining fields (dates, guests) and search.
