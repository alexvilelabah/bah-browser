# PROGRESS — verified state of the local-AI hardening work

Status codes are **claims about code that was run**, not intentions. Every "done" below
was checked with the command named in the last section.

## Done (committed, gates green)

| # | Item | Evidence |
|---|------|----------|
| C1 | `cancellableFetch` on every provider call | `src/main/cancellable-fetch.ts`; `tests/unit/cancellable-fetch.test.ts` (abort mid-stream, no unhandled rejection) |
| C2 | Ollama `stream:true` | `src/main/local-providers.ts`; `tests/unit/local-streaming.test.ts` |
| C3 | LM Studio `stream:true` | same file/test |
| C4 | Stop button reaches the network layer | `actionCancel` IPC in `src/main/main.ts`, wired per-step in `App.tsx` |
| C5 | Per-clock budgets (connect 10s / first-token 45s / body-idle 30s / absolute 180s) | `src/main/thinking-budget.ts`; `tests/unit/thinking-budget.test.ts` |
| C6 | LM Studio auto-context discovery (`n_ctx`) | `tests/unit/context-discovery.test.ts` |
| C7 | First-token watchdog on OpenAI-compatible endpoints | `tests/unit/streamed-metrics.test.ts` |
| C8 | Cloud bodies **pinned byte-exact** | `scripts/golden-cloud-bodies.mjs` (8 forbidden tokens, incl. `think:false`, `format:json`, top-level `temperature`) |
| C9 | Local body builder + fallback chain, same pinned contract | `tests/unit/local-body-pin.test.ts` (7 golden fixtures vs 13 fabricated keys) |
| C10 | OCR/AX observation stays out of the wire body | `tests/unit/local-body-pin.test.ts` (`[observed_page]` never emitted) |
| C11 | Metrics on every local call | `src/main/stream-readers.ts` (`StreamMetrics`), `ai-engine.ts` logs |
| C12 | `tokens/sec`, `firstTokenMs`, `thinkingMs`, `totalMs` reported to the user | progress payload + `AgentCommandBar` status line |
| C13 | Structured error codes end-to-end | `src/shared/error-codes.ts` (`classifyError`/`withCode`); renderer decides on codes, never prose |
| C14 | HTTP status surfaced honestly | `HTTP_{status}` codes cover 404 model-not-found and 400 context-length |
| C15 | Retry → degrade → pause ladder | `App.tsx` step call site: 3 attempts, 2 s/5 s backoff, drops the screenshot on the first retry |
| C16 | Pause for help when the engine is down | `ManualHelpKind: 'local_unavailable'`; capped at 2 pauses/run, then an honest failure |
| C17 | Deadline aborts in flight | `src/renderer/task-deadline.ts`; 4 unit tests incl. machine-time accounting (human help is not charged) |
| C25 | First-run guide + beginner tour | `src/renderer/components/AppGuide.tsx`; 18 keys × en/pt/es; closes on ✕ / button / Esc / click-outside |

## Open

| # | Item | Note |
|---|------|------|
| C18 | Plan preview before acting | plan text exists in the prompt; needs a preview panel with Approve / Run / Edit |
| C19 | Vision frame cache | reuse the post-action OCR frame instead of re-capturing |
| C20 | Self-reflection prompt | ask the model to critique its own previous action; `evaluation` field is already parsed |
| C21 | Monitor notification types | per-monitor notify kinds in Settings + tray + task report |
| C22 | Torrent engine | bundled via `scripts/build-torrent-engine.mjs`; real-Docker verification still owed |
| C23 | `eng`+`por` tessdata shipped in the packaged app | `eng.traineddata`/`por.traineddata` in the repo root — confirm `electron-builder.yml` ships both |
| C24 | Vision default OFF on machines without a GPU | add a GPU capability probe; today `visionEnabled` defaults to `true` for everyone |
| C27 | Full manual test plan (§10) | needs a real machine: Ollama `qwen3:14b` + full-size screenshots, 5 scenarios |

## Gates — run these before claiming anything

```
npm run typecheck:renderer      # tsc -p tsconfig.json --noEmit
npm run build:main              # tsc -p tsconfig.main.json + torrent bundle
npm run build:renderer          # vite build
npm run test:unit               # node --test tests/unit/*.test.ts
npm run test:goldens          # cloud + local body pin
npm run i18n:check              # en/pt/es parity
npm run test:e2e              # playwright (needs the built app)
npm run test:e2e:live         # live agent run, needs the built app + a configured model
```

There is **no `doctor` script** in this repo — §9.4 of the plan names one; the real gate
is `typecheck:renderer` + `build:main`.

## Facts that cost time to learn (do not re-derive)

- **`think:false` breaks llama.cpp/LM Studio.** It makes llama.cpp *silently* disable
  grammar-constrained decoding, and a thinking model can then "answer itself" into
  `done:true` while on a login page. Reasoning stays in the prose; nothing in the body
  toggles it.
- **`format:"json"` (LM Studio) is the same trap** — forced JSON pushes the model to
  emit a premature `done`.
- **Top-level `temperature` on cloud endpoints** trips Google's "at most one of
  temperature / topP / topK" validation → the request fails, or empty output →
  `done:true`.
- **A cloud thinking model emits ` reasoning_content:` (leading space) in its delta
  key.** `/think/i` inside the SSE parser would match the cloud's *content* key and set
  `inThinking = true`, so real action JSON was swallowed. The SSE parser is local-only;
  cloud thinking content is skipped with literal `' reasoning_content'`.
- **`max_tokens` = 12000** is the accepted floor for small local models ("a resposta
  completa pode ser bem longa"). Short caps truncate the JSON → the parser finds no
  `done` → the agent loops.
- **A local vision model on a desktop GPU produces a blurry, coordinate-losing picture at
  1280 px.** Long edge goes up to 2560; it is gated to vision turns only, so text
  turns are unaffected.
- **The step prompt must demand an action.** A text-only "what do you see?" answer sent
  the agent into a loop that clicked nothing on a Netflix login page.
- **Renderer files are CRLF.** Exact multi-line replacements must preserve `\r\n`;
  prefer line-index splicing.
- **Shell heredocs eat `\n` inside JS string literals.** Build such strings from
  `String.fromCharCode(92)` or write them with the `write` tool.
