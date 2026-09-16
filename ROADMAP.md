# Fabric UI Advanced — Roadmap & TODO

Merged from `fabric-gui/roadmap.md` and `fabric-gui/TODO.md` on 2026-09-14, with the TUI build removed
(decided 2026-09-14: web app only — see [Decisions](#decisions) below). This is now the single planning
doc for this project.

## Context

`fabric-gui` (a vanilla HTML/JS + Python-proxy tool) was the first prototype — built to run fabric-ai
patterns from a browser instead of the CLI. It proved out the core feature set and caught real problems
(unsearchable 260+-pattern list, silent YouTube/input conflicts, sessions not doing what the name implied)
before this rewrite started. `fabric-ui` is a clean SvelteKit rebuild — not a fork of `fabric-gui`
and not a fork of fabric's own official `web/` app — that carries the *proven features* forward properly
architected, and adds the larger ones `fabric-gui` never attempted.

## Decisions

- **Web app only, no TUI.** The original plan was Go+Bubble Tea TUI first, Svelte web UI second (reusing
  the TUI's "core logic"). Reconsidered 2026-09-14: the two aren't code-shareable anyway (different
  language runtimes — Go binary vs. browser/Node JS), and personal usefulness matters more here than
  matching fabric's own Go-binary distribution model. If a TUI happens later, it will be a separate,
  from-scratch Go project that only shares *API/protocol knowledge* with this one, not code. If real
  logic-sharing across a future TUI and this web app ever matters, the right place for that shared logic
  is inside `fabric-ai` itself (already Go) as new endpoints/flags — both frontends would then be thin
  clients over one implementation.
- **Not a fork.** Built as a fresh `sv create` scaffold (SvelteKit + TypeScript + Tailwind 4 + mdsvex —
  matching fabric's own official web app's core stack so components/patterns are easier to borrow later).
  `fabric-source` (a clone of `danielmiessler/fabric`) exists locally only as a read-only reference for
  comparison, not something this project imports from.
- **Separate repo**, local git only for now (`git init` done 2026-09-14) — no GitHub remote yet.
- **Tech stack confirmed and executed**: SvelteKit 5 (runes mode), TypeScript, Tailwind 4, mdsvex. Skeleton
  UI (fabric's own component library) not yet added — revisit if/when a component need justifies the
  dependency.
- **CORS/proxy solved via SvelteKit server routes** instead of a separate Python process: fabric-ai's REST
  API only sets `Access-Control-Allow-Origin` on `/chat` (hardcoded to `localhost:5173` — coincidentally
  fabric's own official app's default Vite port), and zero CORS headers on every other endpoint
  (`/patterns`, `/models`, `/youtube/transcript`, ...). `src/routes/api/fabric/[...path]/+server.ts` proxies
  everything server-side, sidestepping the problem entirely regardless of which port Vite picks.

## Feature backlog

Merged from both source documents; overlapping ideas combined into one item.

### High priority

- [x] **Pattern chaining / pipelines (minimal version)** — 2026-09-14. "Use as input →" button loads the
  current output into the input box, clears the YouTube field, and focuses pattern search so the user
  picks a new pattern and Runs — no manual copy/paste. Verified live: `tighten_prompt`'s output correctly
  fed `improve_prompt` as input. Originally surfaced in `fabric-gui` when "Session" was mistaken for this
  exact feature. Not something fabric-ai's API does natively (the CLI equivalent is piping,
  `fabric-ai -p pattern1 | fabric-ai -p pattern2`) — this is GUI-side orchestration, two sequential
  `/chat` calls with a UI step in between.
  - [ ] **Ambitious version, not built**: a full visual pipeline/wiring builder (drag boxes, connect
    outputs to inputs, run a whole chain in one click). Revisit if the minimal version proves limiting.
- [x] **Pattern variables** — 2026-09-15. Picking a pattern now scans its raw `system.md` for `{{name}}`
  placeholders (skipping the built-in `{{input}}`) and shows one labeled field per variable, with a snippet
  of the surrounding prose as a hint. Run is blocked with a specific error until every declared variable is
  filled in; values flow through to `/chat`'s existing `variables` map and are mirrored in the CLI-command
  preview as `-v=name:value`. Verified live against `translate` (`{{lang_code}}`) — correctly translated to
  French. Note: fabric-ai attaches no type/description/allowed-values metadata to variables (confirmed by
  reading `internal/plugins/template/template.go` — it's a bare `variables[name]` string lookup), so there's
  no dropdown, just a free-text field per variable — that's the ceiling of what the data supports.
- [x] **Prompt preview (client-side dry-run)** — 2026-09-15. fabric-ai's real `--dry-run` fully resolves a
  pattern (variables + `{{input}}`) and returns the exact request it would have sent, without calling a real
  model or spending tokens — but it's CLI-only: `internal/server/chat.go`'s `/chat` handler hardcodes
  `dryRun: false`, so the REST API fabric-ui talks to has no way to request it. Built a client-side
  equivalent instead: "Preview prompt" (next to Run) fetches the pattern's raw `system.md` and reproduces
  fsdb's `applyVariables`/`ensureInput` logic locally — substituting filled-in variables and `{{input}}`
  (auto-appended if the pattern doesn't reference it, matching server behavior), leaving anything unfilled
  as a visible `{{name}}` placeholder. Shown in a dismissible violet panel labeled "not sent, no tokens
  used," separate from the real Output panel so it can't be mistaken for a real run. Verified live against
  `translate`: correctly showed `{{lang_code}}` unresolved before filling it in, then `fr` after.
  - **Follow-up found 2026-09-15**: `POST /patterns/:name/apply` (`internal/server/patterns.go:106`) is a
    real server-side equivalent of this same resolution. Switching Preview to call it instead of the
    hand-rolled client-side substitution would make it 100% accurate — including surfacing the exact
    "missing variable" error `/chat` would give — for near-zero extra effort. Not done yet.
- [ ] **Contexts** — `/contexts/*` supports reusable text blocks prepended to any pattern (e.g. a saved
  Genie Agent's vocabulary, so `improve_genie_question` doesn't have to guess table/column names every
  time). Not exposed in either the old or new UI yet.
- [ ] **Session/history browser** — fabric-ai stores session history in a filesystem DB (`fsdb`); nothing
  surfaces it well anywhere, including the official app's raw "Session Name" text field. Build a
  searchable history view: past runs, inputs/outputs, diff two outputs, re-run a past session with tweaks.
  Note: this is about *reading* past sessions, which sidesteps the live multi-turn bug below — a browser
  doesn't need to *create* new multi-turn exchanges to be useful.
  - Known limitation if multi-turn *writing* is ever revisited: the 2nd+ message in any session that uses
    a pattern currently fails against Anthropic (`400 This model does not support assistant message
    prefill`), reproduced via plain CLI — this is an upstream fabric-ai bug, not something either UI can
    fix. Tracked as [danielmiessler/fabric#2208](https://github.com/danielmiessler/fabric/issues/2208).
- [ ] **Reasoning/"thinking" level control** — attempted and reverted 2026-09-15; **blocked on an upstream
  fabric-ai server bug, do not re-attempt without a fabric-ai fix or a real root cause.**
  - Why it looked promising: `internal/server/chat.go` passes `request.Thinking` straight into
    `ChatOptions` — genuinely wired into `/chat`, unlike most other CLI-only flags checked in the same
    audit (image gen, TTS, transcription, notifications, max-tokens, suppress-think — all confirmed
    dropped by the handler, no REST path exists).
  - Built: a dropdown (Off/Low/Medium/High) next to Model, plus a client-side fix forcing
    `temperature: 1` whenever thinking is non-off — required because Anthropic 400s any thinking-enabled
    request unless temperature is exactly 1 (verified via plain CLI repro), and fabric-ai never
    coordinates the two itself despite `--raw`'s flag text claiming "smart parameter selection" for
    Anthropic (no such logic actually exists in the plugin, confirmed by reading it).
  - **Found while testing, not initially expected**: even with temperature correctly forced to 1, every
    non-default thinking level (`low`/`medium`/`high` — not just `high`) fails when the request goes
    through fabric-ai's REST `/chat` endpoint, returning a generic `empty response` error
    (`chatter_error_empty_response` in `internal/core/chatter.go:185`, meaning the accumulated stream
    content was empty but no stream error was recorded). The **identical** request (same model, same
    `--thinking` level, same `--temperature 1`) succeeds via plain CLI, including with `--stream`
    explicitly enabled — so it isn't a non-streaming-vs-streaming difference, and both code paths call the
    same `chatter.Send`/`SendStream` functions. Restarting `fabric-ai --serve` (to rule out stale
    in-process state) made no difference. Root cause not identified — most likely a bug specific to the
    REST server's SSE handling in `internal/server/chat.go` (e.g. around the `clientGone`/`streamChan`
    plumbing) when Anthropic's extended-thinking response has a longer pre-content delay than usual, but
    this is a hypothesis, not confirmed.
  - Net effect: the dropdown as built only had one working option ("(default)" — i.e., not sending
    `thinking` at all), so it was removed from the UI rather than shipped half-functional. The underlying
    client library support (`ChatRunOptions.thinking`, `THINKING_LEVELS`, the temperature-1 coupling fix)
    was left in place in `src/lib/fabric.ts`, unused by the UI, so re-adding the control later is cheap
    once fabric-ai's server-side bug is understood or fixed — don't rediscover the temperature coupling,
    just re-verify the empty-response bug is actually resolved before re-wiring the dropdown.
  - Not filed upstream yet — should be, with the exact repro above (`-p translate -v=lang_code:fr
    --thinking low --temperature 1`, CLI succeeds / REST `/chat` with identical params returns empty
    response).
- [ ] **`fabric-ai --serve` behind an API key** — 2026-09-15, found via the same audit. Confirmed in
  `internal/server/auth.go`: `requireAPIKeyForBind` forces `--api-key` whenever `--serve` binds to
  anything non-loopback (a real documented setup, e.g. running fabric-ai on a home server), and
  `APIKeyMiddleware` then 401s every request without a matching `X-API-Key` header. fabric-ui's proxy
  (`src/routes/api/fabric/[...path]/+server.ts`) has no concept of this — no env var, nothing — so
  pointing fabric-ui at any non-localhost fabric-ai instance currently fails silently and totally. This is
  a reliability gap more than a feature request; fix is one env var forwarded as a header in the proxy.

### Medium priority

- [ ] **Vendor/API-key setup panel** — 2026-09-15, found via the same audit. `GET /config` (returns each
  vendor's key masked to last 4 chars) and `POST /config/update` (writes `.env`, skips resubmitted masked
  values) already exist server-side and are already built defensively. Today, adding a new model vendor
  means hand-editing `~/.config/fabric/.env` or running the CLI's interactive `--setup` — a panel showing
  configured vendors and accepting a new key would remove the last reason to touch a terminal for setup.

- [ ] **Multi-model comparison view** — run the same pattern across 2-3 models (e.g. different Claude
  tiers, or Ollama if configured) side by side to compare outputs directly.
- [ ] **Live pattern editor with test runs** — edit a pattern's `system.md` in the UI and immediately test
  it against sample input, side by side, without leaving the editor. `/patterns/:name` already supports
  GET (raw content) and POST (save) server-side.
- [ ] **Smart input handling, remaining pieces** — YouTube URL handling (auto-detect + mutual exclusivity
  with typed input) is already done. Still open: generic URL scraping (fabric's `-u`/`scrape_url` flag) and
  drag-and-drop file input, so users don't need to remember which flag maps to which input type.
- [ ] **Strategies dropdown** — `/strategies` lists reasoning strategies (e.g. chain-of-thought) from
  `~/.config/fabric/strategies/*.json`. Not exposed anywhere yet.
- [x] **Advanced params panel** — 2026-09-16. Collapsible panel under Model with sliders for temperature,
  top-p, presence penalty, and frequency penalty. Values are only put on the wire when changed from
  fabric-ai's own CLI defaults (0.7 / 0.9 / 0.0 / 0.0 per `internal/cli/flags.go`), so an untouched panel
  leaves request bodies byte-identical to before the feature existed; a "modified" badge and a
  reset-to-defaults button make the non-default state obvious. Non-default values also show up in the
  CLI-command preview (`-t` / `-T` / `-P` / `-F`). Verified live: temperature 1.4 reached the model,
  preview correctly rendered `-t 1.4` while omitting the untouched three, and reset restored everything.
  - Vendor support is uneven, and the panel says so inline rather than pretending otherwise — confirmed by
    reading each plugin: **Anthropic** treats Temperature and TopP as mutually exclusive (a non-default
    TopP makes `anthropic.go` send TopP and drop Temperature entirely) and never references either
    penalty; **Gemini** applies Temperature/TopP but ignores the penalties too; **OpenAI** is the only
    vendor where all four do something. Crucially, none of them *reject* these values — unlike the
    thinking control's hard 400 — so this was safe to ship where that wasn't.
  - Corrected 2026-09-15: this bullet previously also listed `seed`, but the full-surface audit confirmed
    `chat.go`'s handler only copies 9 specific fields from the request into `ChatOptions`
    (Model/Temperature/TopP/FrequencyPenalty/PresencePenalty/Thinking/Search/SearchLocation/Quiet) and
    silently drops everything else — `seed` has no REST path, CLI-only, so it was left out of the panel.
  - Possible follow-up: fabric-ui's "Preview prompt" still shows only the resolved system message, while
    the CLI's real `--dry-run` also prints the options block (Model/Temperature/TopP/penalties). Now that
    these values are user-controllable, appending a similar options summary to the preview would close
    most of the remaining gap between the two.

### Lower priority / exploratory

- [ ] **Custom pattern builder** — a form-based UI for authoring brand-new patterns (not just running or
  editing existing ones), including variable/placeholder definition, without hand-editing markdown files.
  Broader than the live pattern editor above — that one edits; this one creates from scratch.

## Shipped

Everything below was built and verified working in `fabric-gui` (the vanilla-JS prototype). The features
carry forward into `fabric-ui` as native SvelteKit implementations rather than ported files —
tracked here as design/functionality wins, not code to copy.

- Token usage display (parses the `/chat` SSE `usage` event) — 2026-09-11
- CLI-command preview (shows the equivalent `fabric-ai` command, real input redacted as `<your input>`) — 2026-09-11
- Searchable pattern picker with live descriptions (pulled from each pattern's own `# IDENTITY and PURPOSE`
  section) — 2026-09-11. Confirmed 2026-09-14 by inspecting fabric's own official app: it ships a plain
  260+-item `<select>` with zero search or descriptions — this remains a real differentiator, not a solved
  problem elsewhere.
- Web search toggle (`ChatOptions.Search`, verified live — token count jumped 7x confirming the tool
  actually fired) — 2026-09-11
- YouTube URL / typed-input mutual exclusivity (one field disables the other, so a transcript can never
  silently overwrite typed input) — 2026-09-14
- Sessions — built then removed the same day, 2026-09-11. Blocked by the upstream bug noted above, and
  separately the UI was confusing (users expected "Session" to mean pattern chaining — see that backlog
  item). Removed entirely rather than shipped half-broken.
- 5 custom Databricks fabric patterns, distilled from `databricks/databricks-agent-skills` (the real source
  behind `databricks-solutions/ai-dev-kit`'s installer notebook — most of that ~30-skill set doesn't
  convert to fabric patterns since it assumes live CLI/workspace execution, but the pure code-writing-
  convention subset does): `write_databricks_pipeline_code`, `write_databricks_streaming_code`,
  `write_databricks_sql_code`, `write_databricks_sdk_code`, `review_databricks_serverless_compatibility` —
  all 2026-09-11, all tested live with planted-issue inputs to confirm correctness, not just that they run.
  These live in `~/.config/fabric/patterns/` and work regardless of which UI is used.

**`fabric-ui` milestones:**

- SvelteKit + TypeScript + Tailwind 4 + mdsvex scaffold, git-initialized — 2026-09-14
- Server-side proxy (`/api/fabric/[...path]`) replacing the standalone Python proxy — 2026-09-14
- Full pattern-runner page ported and verified end-to-end against live `fabric-ai --serve`: pattern search
  + descriptions, model selection, web search toggle, YouTube/input mutual exclusivity, streaming output,
  token usage, CLI-command preview — 2026-09-14
