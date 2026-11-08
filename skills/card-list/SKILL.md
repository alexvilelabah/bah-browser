---
name: card-list
description: Work through a list of result cards (jobs, hotels, products, listings, messages), including list + detail-pane layouts.
states: [cards]
priority: 45
---
The page shows a list of similar cards. Each card is one item; the cards ARE the results, whatever the section is called ("Matches your preferences", "Top picks", "Recommended").
1. Read the cards first: extract_text, or the LISTINGS block if Bah shows one. Number them in page order and pick the ones the user asked for (the first N, cheapest, best match).
2. Open ONE card at a time, in order. Prefer its link (navigate) — the URL changes and you can come back.
3. List + detail layout: clicking a card fills a panel beside the list on the SAME page. The first card is often already shown there: read it, do not click it again. If a click changes nothing, the card was already open — go to the next one.
4. After opening a card: extract_text, note its details (store), then move to the next card. Never reopen a card you already read.
5. Bookmark/heart/star badge filled on a card = the user saved it; leave it as is.
6. Stop when you have the number asked for, then report them together.
