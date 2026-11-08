---
name: compatible-part
description: Find the exact compatible part (charger, adapter, battery) for a device model, then compare it across shops.
tasks: [parts]
priority: 65
---
Chargers/adapters/batteries are specific to the model and SKU — never guess from the product name.
0. FIRST emit a plan: 1) look up the part on the manufacturer site, 2–6) the five sites to check. Do not finish before all are covered (or shown to have nothing).
1. IDENTIFY the part on the MANUFACTURER's site (see product-specs). store: part numbers (P/N, FRU), wattage, voltage/amps, connector (USB-C or tip size like 4.0x1.7mm).
2. SEARCH shops with SHORT queries: the part number first (e.g. the adapter's P/N), then "<brand> 65W 4.0mm charger". Never paste words like "compatible", "part number" or "wattage" into a search box.
3. Keep only listings with the same part number, or the same watts + connector with this model listed as compatible.
4. Five sites, open choice: the manufacturer's own store, big online stores, any seller a web_search for the part number finds, plus USED marketplaces / local classifieds (used-listings).
5. Report a table (render_view): site, listing, condition (OEM/compatible/used), price incl. shipping, link — and the specs you matched. Search only: never buy or contact sellers.
