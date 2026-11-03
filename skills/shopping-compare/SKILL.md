---
name: shopping-compare
description: Compare a product's price on each store's own site (or options inside one store) and report a table with links (no buying).
tasks: [shopping]
priority: 50
---
1. Search with a SHORT query: only the product (type + key spec, or model number). Never paste instruction words or store names into a search box.
2. Several stores ("on Amazon and other stores", "where to buy", "cheapest place"): visit EACH store's own site — the stores named, plus well-known retailers for the user's region, 3–4 in total. Use the store's search box or search URL, find the matching product, read its price there; open the product page only if the price is missing.
3. A price counts only if you read it on that store's own domain. Articles, deal blogs, comparison sites and search snippets are never a price source. A step marked ❌ Failed is not a source.
4. Error page, captcha, robot check or sign-in wall: write "couldn't read — <reason>" for that store and go to the next one. Never try to get past a bot check.
5. One store: sort by price or rating as asked; extract_text; read exact title, price, rating (count), shipping; skip ads and accessories.
6. Report with render_view: store, exact product title, price, availability/shipping, link to the page read — every store tried, including blocked ones. Say how many stores were read vs blocked. Never add to cart, buy, or sign in.
