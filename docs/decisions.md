# Decisions

ADR-style log of architectural decisions for Riff Radar. Newest at the bottom. Each entry is ACCEPTED, PENDING, AMENDED (still in force except where the named later ADR changes it) or SUPERSEDED (kept for history — the named later ADR replaces it). Original text is never rewritten; corrections are new entries.

## ADR-0001: Discover from fixed configured sources, not open web search

**Status:** ACCEPTED

The brief says the agent searches the web, but Ben's actual workflow reads four known sites. We discover from a fixed, configured source list and keep open web search as a secondary enrichment action only; a candidate may never originate from a search. Fixed sources are reproducible, which the Milestone 3 golden dataset requires and open search cannot provide, and they match the sources Ben already trusts.

**Consequences:** `docs/project-brief.md` needs amending, as it currently describes search as the discovery mechanism. A source redesign or outage now removes a whole discovery channel rather than degrading gracefully.

## ADR-0002: Released only, backward-looking window

**Status:** ACCEPTED

A run covers releases that already exist, over a window ending today. Upcoming releases cannot be verified in MusicBrainz, cannot be listened to, and have dates that move; proposing them would turn the shortlist into a watchlist, which is a different product.

**Consequences:** `metal-archives.com/release/upcoming` contributes nothing to a backward window and drops out of the Milestone 1 source list by consequence. Ben keeps checking it manually.

## ADR-0003: The model extracts candidates from fetched pages

**Status:** ACCEPTED

Fetching returns cleaned page text and the model extracts candidates from it, rather than a hand-written parser per source. Four bespoke scrapers are four things to maintain on a project whose subject is agent loops, not scraping, and they break when a site redesigns.

**Consequences:** Extraction is not byte-reproducible, so the raw fetched text is stored in the trace and replay works from that instead. A site redesign degrades extraction quietly rather than raising an error, so a source that normally yields candidates and suddenly yields none is recorded as a warning.

## ADR-0004: Keep a free-choice agent loop over a fixed-order pipeline

**Status:** ACCEPTED

The workflow is fixed-order and a pipeline would be simpler, cheaper and more testable. We keep a loop in which the model chooses the next action anyway, because the brief's stated purpose is learning how a custom agent loop works by building one, and a pipeline would deliver the albums while teaching none of it.

**Consequences:** This is deliberate over-engineering relative to the task. The loop is justified by three cases that genuinely branch on run-time state: recovering from a shortfall of eligible candidates, spending a search on one ambiguous artist, and seeking a third source when release dates conflict. It buys nothing on pick quality, which is deterministic per ADR-0006.

## ADR-0005: The Notion write is post-loop code, not a model action

**Status:** ACCEPTED

Writing to Notion is not in the action set. The loop terminates, the shortlist is validated, and deterministic code performs the write. Making the write an action would mean relying on the prompt to stop the model writing before validation, which is a guardrail that belongs in code.

## ADR-0006: Hybrid ranking, with the model confined to judgement

**Status:** ACCEPTED

Deterministic code scores the matchable attributes of a release — artist tier, label, genre, personnel — to produce a base score. The model contributes only the resemblance judgement and the one-line rationale, and must cite source text for both. This keeps most of the ranking inspectable and testable without a model, and confines non-determinism to the one place interpretation is genuinely required.

## ADR-0007: Taste profile tiers are named by effect, with asymmetric filtering

**Status:** ACCEPTED

Artists are listed as `always` (guaranteed a shortlist slot), `watch` (guaranteed entry into ranking, competing on merit) or `exclude` (never surfaced). Tiers name what happens rather than how Ben feels, so no boundary judgement is needed to file an artist. Artist `exclude` is a hard filter; genre and label `exclude` are strong negative weights instead, because genre tags on new releases are frequently wrong and a hard genre filter would silently drop a mistagged record.

## ADR-0008: Status and Rating are separate Notion properties

**Status:** ACCEPTED

`Status` records whether a proposed release belonged on the list and is written by the agent as `Proposed`; `Rating` records what Ben thought after listening and is never written by the agent. The brief requires shortlist acceptance and post-listening usefulness to be measured separately, and one field cannot carry both: an album can be correctly proposed and still bad.

## ADR-0009: Memory crossing a run boundary is limited to the taste profile and Notion suppression

**Status:** ACCEPTED

A run's only inputs from outside itself are the versioned taste profile and the set of releases already present in Notion, which are suppressed on release identity regardless of their Status. Past run traces are never fed to the model.

**Consequences:** Suppression is deterministic rather than a model judgement, and makes the Notion write idempotent by construction. Reading `Rating` back to update the taste profile automatically would be self-modifying memory and is out of scope; using it to inform a reviewed hand edit, or as evaluation data, is not.

## ADR-0010: Missing data excludes for eligibility and proceeds for ranking

**Status:** ACCEPTED

Where data needed to confirm eligibility is missing, the release is excluded, because eligibility cannot be confirmed and a wrongly included release costs one of five scarce slots. Where data needed for a ranking signal is missing, the release proceeds without that signal. This is consistent with the brief's rule that absence from MusicBrainz is missing evidence rather than invalidity: the two rules answer different questions.

## ADR-0011: The Notion database schema is an external contract, checked before writing

**Status:** ACCEPTED

The agent never creates or alters the Notion database schema; Ben maintains it by hand and the agent reads its location from configuration. Before any write, the agent verifies the expected properties exist with the expected types and blocks the write if they do not.

**Consequences:** The existing database lacks Status, MusicBrainz ID, Source URL, Rationale and Run ID, so Milestone 1 cannot write until Ben adds them. Without the preflight the first run would fail midway with rows partly written, which is the state idempotency exists to prevent.

## ADR-0012: Traces record proposed and dispatched actions separately

**Status:** ACCEPTED

Run and step records store the action the model proposed alongside the action actually dispatched, plus the validation result between them. Storing only what was dispatched makes a rejected action invisible, which would leave the guardrails absent from the record whose purpose is to prove they ran.

## ADR-0013: TypeScript on Node 22, with a deliberately small dependency budget

**Status:** ACCEPTED

Implementation is TypeScript on Node 22.22. Ben's fluency is the deciding factor: friction in an unfamiliar language would be cognitive load spent on something other than the agent loop, which is the thing the project exists to teach. Three dependencies are taken — `typescript` and `tsx` (development only) and `zod` (runtime) — and the built-in `node:test`, `node:sqlite` and `fetch` are used in place of a test runner, a database driver and an HTTP client.

**Consequences:** This Node build has no TypeScript support compiled in, so `--experimental-strip-types` is unavailable and `tsx` is required rather than optional. `node:sqlite` is experimental and warns on every run; the warning is suppressed narrowly with `--disable-warning=ExperimentalWarning`, never globally. HTML cleaning starts as a hand-written tag stripper, since the model performs extraction (ADR-0003) and only needs roughly clean text; taking an HTML parsing dependency later requires its own ADR.

## ADR-0014: Fireworks-hosted DeepSeek V4.1 Flash, called over raw fetch

**Status:** AMENDED by ADR-0020

The model is DeepSeek V4.1 Flash served by Fireworks, reached through its OpenAI-compatible endpoint using the built-in `fetch` rather than the `openai` client. The SDK's retry and streaming machinery would hide the request and response shape, which is part of what the project sets out to make visible, and avoiding it costs no dependency.

**Consequences:** Request and response shaping, retries and error classification are ours to write. Neither the model identifier nor the per-token price has been verified from a source the agent could read; both must be confirmed from the Fireworks dashboard before cost accounting reports real numbers.

## ADR-0015: The agent loop is hand-written, not delegated to an SDK tool runner

**Status:** ACCEPTED

Provider SDKs offer helpers that drive the request, execute, repeat cycle automatically. We write the loop by hand. A tool runner is the correct production choice and precisely the wrong teaching choice: it hides the mechanism the brief exists to study, and AGENTS.md requires the loop to stay visible in application code.

## ADR-0016: Actions travel as native tool calls and are validated client-side

**Status:** ACCEPTED

The model proposes actions through the provider's function-calling interface rather than as JSON embedded in prose, because that yields a structured call rather than text to fish through. DeepSeek V4.1 Flash supports function calling but does not enforce a JSON schema on the arguments, so tool-call arguments are treated as untrusted input and validated against the action schema before dispatch, every time.

**Consequences:** Client-side validation is the only guarantee, not a second line of defence. Both malformed JSON and well-formed JSON of the wrong shape are expected failure modes rather than edge cases.

## ADR-0017: An invalid action is returned to the model, bounded at three consecutive failures

**Status:** ACCEPTED

When a proposed action fails validation, the validation error is returned to the model as the result of that step and it may try again. Three consecutive invalid actions terminate the run with reason `invalid_action_limit` and no Notion write. Correcting a malformed action is the cheapest available recovery and mirrors what a person would do; an unbounded retry would let a confused model burn the whole step budget.

**Consequences:** This is the mechanism that gives ADR-0012's separate `proposed_action` and `dispatched_action` columns something to show, and is the most readily demonstrated of Milestone 1's enforced guardrails.

## ADR-0018: One injection point for the outside world; SQLite is real in tests

**Status:** ACCEPTED

Everything non-deterministic or external is reached through a single injected `Ports` object with three members: `model`, `http`, and `clock`. The `http` port is deliberately low-level, returning status, headers and body, so that the MusicBrainz client, the Notion client, the cover art fetch and the source fetchers sit above it as ordinary tested code. SQLite is not behind a port; tests use a real in-memory database. Pure logic — action validation, normalisation, deduplication, eligibility, ranking arithmetic, shortlist validation, cost accounting — is tested directly and needs no seam at all.

**Consequences:** Tests carry raw response fixtures rather than tidy typed fakes, which is more verbose. That is the intended trade: the failure modes worth testing, such as MusicBrainz returning partial data or a source page changing shape, only exist at the raw-response level. Faking a database we own would make checkpoint and resume tests prove nothing.

## ADR-0019: A hosted open-weights model is an accepted repeatability risk

**Status:** ACCEPTED

Milestone 3 requires evaluation that repeats against fixed versions, and a third-party-hosted open-weights model can be swapped, re-quantised or re-pointed without notice; one Fireworks alias has already been observed serving a successor model after its original was retired. We accept this rather than self-hosting, which is far outside the project's scope.

**Consequences:** The recorded `model_id` names what we asked for, not what answered, so it cannot detect a silent substitution. Any unexplained shift in evaluation results should be treated as a possible provider-side change before it is treated as a regression in our own code.

## ADR-0020: Confirmed model identifier and pricing, and cached input is accounted separately

**Status:** ACCEPTED

Amends ADR-0014, whose model identifier and price were unconfirmed. The model is `accounts/fireworks/models/deepseek-v4p1-flash`, priced per million tokens at 0.22 uncached input, 0.007 cached input, and 0.66 output. Cached input is roughly thirty times cheaper than uncached, so run and step records count cached and uncached input tokens as separate fields rather than one `tokens_in`, and estimated cost is computed from all three rates.

**Consequences:** A single input-token count would misreport cost by up to a factor of thirty, which would invalidate the economics evidence Milestone 4 depends on. Because a hand-written loop resends a growing history on every step, cache behaviour dominates the cost of a run: the stable prefix — system prompt, tool definitions, taste profile — belongs at the front of the request, ahead of anything that varies per step. Whether Fireworks reports cached token counts in its responses is unverified; if it does not, cost accounting can only report an upper bound, and that limitation must be stated rather than hidden.

## ADR-0021: Mirror Flue's layout, but keep Zod

**Status:** ACCEPTED

Other people on Ben's team use the Flue framework, and Riff Radar may migrate to it after the hand-rolled version has done its teaching. The project therefore borrows Flue's file layout where it carries over — `agents/<name>.ts`, a `tools.ts` of `defineTool`-shaped definitions, a root `config.ts` — and declines the parts that assume Flue's runtime or its HTTP-first model: `app.ts` and Hono give way to `cli.ts`, and the hooks, Vite plugin and skills directory have no hand-rolled equivalent worth faking. Flue validates with valibot; we use Zod anyway, because Ben already knows it and fluency matters more here than removing one migration difference.

**Consequences:** The layout makes the cost of a future migration legible: `agents/riff-radar.ts` and `ports.ts` are what a framework would absorb, while everything in `domain/` and `clients/` — the rules and the HTTP clients — survives untouched. The file that would be deleted is the one the project exists to learn from. The Zod choice is a deliberate divergence recorded here so nobody later "corrects" it to match the framework.
