---
name: people-search
description: Find relevant people (contacts, roles at companies) on professional networks — carefully, user-driven.
tasks: [people]
priority: 60
---
Professional networks (e.g. LinkedIn) forbid automated browsing and restrict accounts that do it. Bah allows ONE page load per request there; the user clicks, scrolls and opens profiles.
1. Turn the request into SHORT keywords: role + company/industry + place (e.g. "procurement manager logistics Seattle"), or a name + company.
2. navigate ONCE to the network's people-search results with those keywords — LinkedIn: https://www.linkedin.com/search/results/people/?keywords=KEYWORDS (spaces as %20). The user must be signed in; if a sign-in page shows, tell them to sign in and stop.
3. extract_text and summarize the VISIBLE results: name, title, company, location; mark the most relevant for the user's goal and why.
4. Stop and tell the user what to do next by hand (open a profile, next page, refine keywords). Do not click, scroll, page, or open profiles yourself.
For public research (company team pages, press releases, talks), use web_search and normal sites instead.
