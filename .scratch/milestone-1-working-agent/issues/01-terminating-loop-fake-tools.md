# 01: A terminating agent loop over fake tools

**What to build:** `riff-radar run [--last-days N] [--dry-run]` starts, resolves its window to absolute dates, drives a hand-written agent loop in which the model chooses one action per step, and stops with exactly one recorded Termination Reason. Every action is faked — `fetch_source`, `lookup_release` and `web_search` return canned data, and `finish` is real — so the loop, its guardrails and its trace can be exercised end to end before any live integration exists. Afterwards a Run can be read back out of SQLite with no tooling beyond a SQL client.

This is the largest ticket in the milestone and the one the project exists to teach. It is deliberately not split: a loop without its guardrails is not a terminating loop, and retrofitting validation into working code costs more than building it in.

**Blocked by:** None (can start immediately)

**Status:** needs-review (part A complete, commit 037c41a; part B complete)

## Session break

Two sittings. Part A stands alone and is demoable without a model; part B is the loop itself.

**Part A — the run exists.** Project scaffolding, CLI, configuration, store, trace schema. A Run with no loop at all starts, resolves its window, writes a `runs` record with `termination_reason = no_candidates`, and exits.

**Part B — the loop runs.** Model adapter, action declarations, validation, dispatch, step records, limits, cost accounting.

## Acceptance criteria

### Part A

- [x] TypeScript on Node 22.22 with `typescript`, `tsx` and `zod` as the only dependencies; `node:test` is the test runner and `node:sqlite` the database
- [x] The `node:sqlite` experimental warning is suppressed with `--disable-warning=ExperimentalWarning`, never globally
- [x] Directory layout follows the one in the specification, with the CLI entry point in place of an HTTP app
- [x] A check that can be run from the command line fails when anything in `domain/` imports from `clients/` or `adapters/`
- [x] `--last-days` defaults to 7; the resolved absolute range is what the trace records, not the flag
- [x] The Run refuses to start and writes nothing when required credentials are absent from the environment
- [x] `runs` and `steps` tables carry every column named in the specification
- [x] A Run that reaches no candidates ends with `no_candidates` and performs no write

### Part B

- [x] The model is reached over the provider's OpenAI-compatible endpoint using built-in `fetch`, with no provider SDK
- [x] The loop is readable top to bottom in a single file
- [x] All four actions are declared once each — name, description, input schema, implementation together — and the JSON tool schema sent to the model is derived from those declarations rather than maintained separately
- [x] Tool-call arguments are treated as untrusted: parsed, then validated against the action schema, before every dispatch
- [x] Malformed JSON and well-formed JSON of the wrong shape are both handled as ordinary failures
- [x] A failed validation is returned to the model as that step's result and the model may correct itself
- [x] Three consecutive invalid actions end the Run with `invalid_action_limit` and no write
- [x] Thirty steps end the Run with `max_steps_exceeded` and no write
- [x] A token or cost ceiling ends the Run with `budget_exceeded` and no write
- [x] `finish` with 5 valid items ends the Run `completed`; with 1–4 valid items, `completed_short`; with an invalid shortlist, `validation_failed`
- [x] Shortlist validation is a pure function: 1–5 items, no two sharing a Release Identity, and each item carrying artist, album title, a release date inside the resolved range, at least one Source URL, a rank, a Rationale, and either a MusicBrainz ID or an explicit `unverified: true`
- [x] A missing Source URL invalidates an item; a missing MusicBrainz ID does not
- [x] Every step records its proposed action, its validation result and its dispatched action in separate columns, so a rejected action is visible rather than absent
- [x] Every step records its duration
- [x] Uncached input, cached input and output tokens are counted separately per step and per Run, and estimated cost is computed from all three rates
- [x] The stable prefix — system prompt, tool definitions, taste profile — is sent ahead of anything that varies per step
- [x] Whether the provider reports cached token counts is settled against a real response; if it does not, cost is recorded as an upper bound and labelled as one — settled live: Fireworks reports them (ADR-0028), so cost is a measurement
- [x] Prompt version, profile version, action schema version and model identifier are recorded on the Run
- [x] Exactly one Termination Reason is recorded per Run
- [x] A live smoke test against the model provider exists, invoked separately and excluded from the automated suite
- [x] Every Termination Reason reachable in this ticket is covered by a test driven through the injected ports
