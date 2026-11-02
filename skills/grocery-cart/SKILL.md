---
name: grocery-cart
description: Fill a store's cart from the user's grocery list — pick products, set quantities, ask before substitutes, stop at the cart (never check out).
tasks: [grocery]
priority: 60
---
1. One list item at a time: fill_ref the store's search box with a short query ("whole milk", "bagels"), never the whole list; Bah presses Enter.
2. Choose by the user's words (brand, size, organic, 2%…). Nothing said → a common size of the store's own brand (milk: 1 gallon; eggs: 12) at a fair unit price; skip "Sponsored" unless it fits best. Say why.
3. Quantity: click ADD once, then + until "IN CART ×n" matches. Packs add up: "a dozen bagels" in 6-packs = 2. Bananas sold each, no number given = 6.
4. OUT OF STOCK / unavailable → never substitute on your own: finish the rest, then ask the user, naming 1–2 alternatives.
5. A popup asks pickup or delivery, a store or a ZIP code → use what the user said; otherwise stop and ask. Never guess an address. Never sign in or create an account.
6. When the list is done, open the cart. Check each line (product, qty); fix it with + / −.
7. NEVER click Checkout, Check out, Continue to payment, Place order or Reserve time slot — the user does that.
8. Report with render_view: item asked, product chosen, qty, price, note (why, out of stock, substitute to confirm), plus the cart subtotal.
