# Proposal: `/evaluate-this-deal`

Status: **options only, nothing built yet.** Pick one (or a staged mix) before any code is written.

## The ask

The user is looking at something on screen and types `/evaluate-this-deal` (or "is this a good deal?").
Bah answers: is it a good price or offer, what is it compared with, and what to watch out for.

## What Bah already has

| Piece | Where | Reusable for deals |
|---|---|---|
| Page chat with the open page's text | `runChat` in `AgentCommandBar.tsx` (page Q&A, local or cloud) | Read the deal on screen |
| "Points at the screen" routing ("is THIS worth it?") | `pointsAtOpenScreen` in `site-knowledge.ts` | Already sends "worth it?" questions to page chat |
| Google Shopping price scan | `compare_prices` action, `PRICE_EXTRACTOR_JS`, median plausibility filter (`App.tsx`) | Market price for a product |
| Store-search comparison | `skills/shopping-compare`, `skills/used-listings`, `skills/product-specs` | Agent-driven comparison on named stores, used market, specs |
| Results table | `render_view` (sortable table plus chart in a local tab) | Show the comparison |
| Background page watcher | `src/main/monitor-manager.ts` ("price below X", "back in stock") | "Tell me when it drops" follow-up |
| Risk gate and "careful sites" | `risk.ts`, `careful-sites.ts` | Never buy or sign anything during evaluation |
| Multi-search engine with fallbacks | `searchWebResults` / `web_search` | Reviews, recalls, scam reports |

## What "a deal" can be

1. **Product page**: store listing with a price (Amazon, Walmart, Mercado Livre, a brand shop).
2. **Listing**: used or classified item (eBay, Craigslist, Facebook Marketplace, a car or apartment listing).
3. **Offer**: subscription or promotion ("3 months for $1", a bundle, a coupon page, a flight or hotel fare).
4. **Contract terms**: a page or document with terms (phone plan, lease, loan or BNPL, SaaS pricing, job offer).

Each needs different inputs. Products need comparable prices. Listings need the market for the same model and condition. Offers need the effective total cost (after the intro period, fees, auto-renew). Terms need clause reading (cancellation, fees, APR, lock-in).

---

## Option A: Local read-only verdict (page only, no web)

**What it does.** Reads the open page (and an attached document, if any) and the model writes a structured verdict: what the deal is, the effective total cost (intro price → regular price, fees, shipping, renewals), red flags (auto-renew, cancellation fees, "was" prices with no history, urgency timers, seller age or rating), and questions to ask. No comparison with other sellers.

**Deal types covered.** Strong for offers and contract terms (all the information is on the page). Weak for product prices (it cannot say whether $X is cheap).

**Sources.** Only the page text: the same extractor as page chat, plus a small deterministic parser for prices, percentages, durations ("for 12 months", "then $29.99/mo") and APR so the arithmetic is not left to the model.

**How results are shown.** One card in the panel: verdict chip (Looks fair / Check these / Red flags), the effective-cost line, three to six bullets, and "what it doesn't know" (no market comparison).

**Privacy and cost.** Nothing leaves the machine beyond the one model call; with local AI on, fully offline. About one model call (~3–6k tokens in the cloud).

**Effort.** Small: about 2–3 days. A `/evaluate-this-deal` entry (plus the natural-language form) routed like page chat, a prompt template, the cost parser with unit tests, the card, and an e2e test with a mock page.

**Risk.** The model can sound sure about "is $X a good price" without data. The prompt and card must say that no market data was used.

---

## Option B: Market comparison (page plus web price check)

**What it does.** Option A, plus: identify the item (title, brand, model, GTIN or part number from structured data or the page), then run Bah's existing `compare_prices` scan (Google Shopping) and, for used listings, the `used-listings` skill. Result: where this price sits against the market (lowest / median / this one), with links.

**Deal types covered.** Products and listings well; offers partly (it can find competing plans by search); contracts no better than A.

**Sources.** Page, Google Shopping scrape (already built, with the median filter), optionally one `web_search` for "<model> review" and "<seller> scam" to surface warnings. Product identity from `ld+json` / `og:` tags first, page text second.

**How results are shown.** The A card plus a "Market" line ("$249: 2nd lowest of 14 offers, median $279") and a `render_view` table of comparable offers in a background tab. Optional button: "Watch this price" creates a monitor with `monitor-manager`.

**Privacy and cost.** The product name (not the page) goes to Google and the chosen search engines, the same as the existing `compare_prices` action. Visible in the panel status line. Cost: one model call plus 1–3 page loads, about 10–25 s. Scraping can hit captchas; the existing engine fallback and `pacing.ts` back-off apply.

**Effort.** Medium: about 1–1.5 weeks. Product-identity extractor (unit-tested), reuse of the `compare_prices` code path as a function instead of an action (it currently ends the run), a combined card, a "same item?" filter so accessories don't skew the median, and e2e tests with local fake Shopping pages.

**Risk.** Mismatched items (an accessory or the wrong storage size) make a deal look great or terrible. Keep the plausibility filter, show the matched items, and say "low confidence" when fewer than ~4 good matches.

---

## Option C: Agent-driven deep evaluation (skill plus agent run)

**What it does.** Ship it as a **skill** (`skills/evaluate-deal`) plus a `/evaluate-this-deal` trigger that starts a normal agent task with the open tab as the starting tab. The agent follows the skill: read the deal, classify it (product / listing / offer / terms), then choose the checks (named stores via `shopping-compare`, used market via `used-listings`, maker specs via `product-specs`, reviews, price history sites, the full terms page) and finish with `render_view` plus a report.

**Deal types covered.** All four, including multi-step ones (open "see full terms", compare two plans on two sites, check a car's typical price on two marketplaces).

**Sources.** Whatever the agent decides, within the skill's rules. Uses all of Bah's agent machinery: plan preview, risk gate (never buys or signs), pacing, permissions.

**How results are shown.** The usual agent run (steps visible), ending in a report card and a table tab. The plan preview lets the user trim checks before it runs.

**Privacy and cost.** The most data out: several sites visited, searches with the product name, and the agent's prompts carry page text to the cloud model (or stay local with local AI). Cost: 5–20 agent steps, typically 30–120 s and the most tokens of the three. Weak local models will wander; best with a cloud model.

**Effort.** Small to start (the skill is a Markdown file plus the trigger: ~1–2 days), but quality depends on the model and is harder to test deterministically. Scripted-agent e2e tests can pin the trigger and prompts, not the judgment.

**Risk.** Inconsistent answers between runs; slow; may hit captchas on stores. Good as the "go deeper" path, poor as the default.

---

## Comparison

| | A: Local verdict | B: Market comparison | C: Agent deep dive |
|---|---|---|---|
| Product price "is it cheap?" | No (says so) | **Yes** | Yes |
| Used listings | Red flags only | Yes (scan plus used skill) | Yes |
| Subscriptions / offers | **Yes** (effective cost) | Yes | Yes |
| Contract terms | **Yes** (on-page) | Same as A | Yes (follows links) |
| Leaves the machine | Model call only | Product name to Google / search | Many sites plus page text to the model |
| Works fully offline (local AI) | **Yes** | No | No (sites) |
| Typical time | 3–6 s | 10–25 s | 30–120 s |
| Cost | 1 call | 1 call plus scraping | 5–20 agent steps |
| Deterministic tests | High | Medium-high | Low (prompts only) |
| Effort | ~2–3 days | ~1–1.5 weeks | ~1–2 days to start, ongoing tuning |

## Recommendation

**Build A first, then B on top, and offer C as the "dig deeper" button.**

- A is the safe default: fast, private, works with local AI, and it is the only option that handles subscriptions and terms well without the web. Its cost parser is reused by B.
- B adds what users most often mean by "deal" (is this price good?) using code Bah already has (`compare_prices`, median filter, `render_view`, monitors). It should ask once before sending the product name out, the way history and tabs access ask today.
- C costs little to add once A and B exist: a skill file plus a "Dig deeper" button on the card that starts an agent task. That keeps the slow, token-heavy path opt-in.

Open questions for the user:
1. Should B's web check run automatically, or only after a "Compare prices online?" button?
2. Which markets matter first (US stores, Brazil's Mercado Livre, used marketplaces)? This decides the identity and price parsers to test against.
3. Is "Watch this price" (monitor) in scope for the first version?
