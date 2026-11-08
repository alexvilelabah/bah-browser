---
name: shopping-compare
description: Search a store for a product and compare price, rating and value across real options (no buying).
tasks: [shopping]
priority: 50
---
1. Use the store's own search box with a SHORT query (product type + key spec, or a part number) — never paste instruction words. After the first search, look at the results URL: many stores keep the query and sort in it (?q=, /s?k=, &sort=price) and you can edit it directly next time.
2. Sort by price (low to high) when the user wants cheap; by rating when they want best.
3. extract_text the results. For each candidate read: exact title, price (and unit price for packs), star rating + number of ratings, shipping/delivery. Skip ads ("Sponsored", "Ad") unless nothing else fits, and say when one is an ad.
4. Keep only items that really match (right model/spec/size); drop accessories and look-alikes.
5. Compare 3–5 options: cheapest, best rated (many ratings), best value. Open a product page only when details are missing.
6. Report a table (render_view): product, price, rating (count), why it fits, link. Never add to cart, buy, or sign in.
