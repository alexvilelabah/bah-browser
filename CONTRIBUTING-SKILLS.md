# Contributing agent skills

Bah's agent gets short, tested **skills** — `SKILL.md` files — only on the pages where they apply
(see [ARCHITECTURE.md → Navigation skills](ARCHITECTURE.md#navigation-skills-skillsskillmd)).

## Where skills live

| Kind | Folder | Who writes it |
|---|---|---|
| Bundled | `skills/<name>/SKILL.md` in this repo | the project — **general rules only** |
| Yours | `~/Library/Application Support/bah-browser/skills/<name>/SKILL.md` (Windows: `%APPDATA%\bah-browser\skills`) | you — menu → 🧩 **My skills** opens it |

A user skill with the same `name` as a bundled one replaces it; otherwise user skills win ties.

## Getting a skill

After a task that **worked** (3+ steps), Bah offers **💾 Save as skill?** — your own model drafts the file
from what worked, you **review** it, and only **Save** writes it. Nothing is saved or shared on its own:
a skill is an instruction to the model. **🌍 Open on GitHub** then opens a pre-filled proposal for this
repo — nothing is sent until you submit it there.

## Format

```markdown
---
name: kebab-case-name           # = folder name
description: one line
sites: [example.com]            # optional; subdomains match
states: [dialog, suggestions, datepicker, eula, os-selector, searchbox, tabs, cards, signin]   # optional
tasks: [download, search, travel, shopping, parts, people, jobs, support]       # optional
priority: 40
---
1. Numbered steps using the agent's actions: navigate, click_ref, fill_ref, select_option,
   check, find, look_at, web_search, extract_text, render_view, download, wait...
```

Rules (enforced by `validateSkill` in `src/shared/skills.ts` and `tests/unit/skills.test.ts`): at least
one trigger, known states/tasks only, body ≤ 220 words.

## What we accept into `skills/`

- **General rules** about a kind of page or task (date pickers, download chains, spec pages with tabs…).
  Recipes for one named site stay in your own folder.
- Steps that were **tested** with a real run, no dead ends, no personal data.
- Nothing that helps the agent evade a site's bot detection, solve image captchas, or act without the
  user's confirmation where Bah asks for it.
