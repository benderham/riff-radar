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
