---
name: autocomplete-pick
description: Pick a suggestion after typing into a search/destination/address box.
states: [suggestions]
priority: 40
---
A suggestions list is open under a field you typed into (destination, city, address, product, airport).
1. Most sites do NOT accept the typed text alone — you must click one suggestion. Pick the one that matches the user's request best (e.g. "Los Angeles, California, United States", not the airport, unless asked).
2. Use click_ref on the suggestion's [id] from the SUGGESTIONS LIST line.
3. If no suggestion matches, change the text slightly (fill_ref with a more specific name) and wait for the list again.
4. After picking, the field shows the chosen value — then continue (dates, guests, search button).
