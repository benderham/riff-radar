# Milestone 1: Working agent

Status: ready-for-agent

Scope: `docs/project-brief.md` · Definition: `docs/specs/milestone-1-working-agent.md` · Rationale: `docs/decisions.md` (ADR-0001 to ADR-0021) · Vocabulary: `CONTEXT.md`

## Problem Statement

Every Friday morning Ben opens four websites, scans them for metal releases from the past week, recognises a handful of artists worth trying, copies up to five into a Notion database, and pastes an Apple Music link beside each one. He then listens in his own time and rates each album Nope, OK, Rotate or AOTY.

The discovery half of that routine is repetitive and bounded: the same four sources, the same judgement applied over and over, roughly five slots a week. It is also where things get missed — a good release on a source he didn't get to, or an artist he'd have recognised if he'd seen the name.

Separately, Ben wants to understand how a custom agent loop actually works: the loop, tool dispatch, state, and the evidence a run leaves behind. Adopting a framework would deliver albums while teaching none of it.

## Solution

A command-line program that performs the discovery half of the Friday routine and stops where human judgement begins.

One Run covers a backward-looking window, defaulting to the past seven days. The agent fetches the configured Sources, extracts Candidates, discards those that are not Eligible Releases, enriches survivors from MusicBrainz, ranks them against Ben's Taste Profile, and proposes a Shortlist of at most five to Notion with `Status = Proposed`. Ben still does the listening and the Rating.

The loop is hand-written and visible in application code: the model chooses one action per step from a small set, every proposed action is validated before dispatch, and every step is recorded. A Run can be reconstructed afterwards from its trace alone — what was proposed, what was dispatched, what each tool returned, why it stopped, and what it cost.

## Acceptance Criteria

The milestone passes when a single Run demonstrates all seven outcomes, evidenced by its trace:

1. **Completes the workflow from CLI input to proposed Notion records** — one command produces Shortlist Items in Notion with `Status = Proposed`.
2. **A terminating agent loop** — the Run ends with exactly one recorded Termination Reason, not by exhausting patience or crashing.
3. **A source fetch** — at least one configured Source is fetched and Candidates extracted from it.
4. **A MusicBrainz request** — at least one Candidate is looked up, with the request and its result recorded.
5. **Enforced guardrails** — at least one guardrail is observably enforced in the trace rather than merely present in code.
6. **Deliberate memory** — the Taste Profile is read and demonstrably affects ranking; releases already in Notion are suppressed on Release Identity.
7. **A complete audit trace** — the Run is fully reconstructable from persisted records.

### Required deliverables

- A successful end-to-end Run trace, committed or linked.
- At least one proposed Notion record produced by that Run.
- The current manual workflow and the future agent workflow documented in `docs/`. (Both are already written in `docs/specs/milestone-1-working-agent.md`; this deliverable is satisfied by keeping them accurate, not by writing them again elsewhere.)

## User Stories

**Starting a run**

1. As the sole user, I want to start a Run with a single command and no arguments, so that my Friday routine costs me one line of typing.
2. As the sole user, I want the window to default to the past seven days, so that the common case needs no thought.
3. As the sole user, I want to widen the window when I've missed a week, so that I can catch up without editing configuration.
4. As the sole user, I want the resolved absolute dates recorded rather than the relative flag, so that a Run means the same thing when I read it back months later.
5. As the sole user, I want a dry-run mode that does everything except write to Notion, so that I can watch the loop work without polluting my database.
6. As the sole user, I want the Run to refuse to start when credentials are missing, so that I find out immediately rather than after the model has been billed.

**Discovery**

7. As the sole user, I want the agent to read the same Sources I read, so that I trust its coverage without auditing it.
8. As the sole user, I want a Candidate to originate only from a Source, never from a web search, so that discovery stays reproducible.
9. As the sole user, I want web search available for disambiguation and enrichment, so that an ambiguous artist can be resolved without widening discovery.
10. As the sole user, I want the raw fetched text of each Source retained, so that extraction can be re-examined when a result looks wrong.
11. As the sole user, I want a warning recorded when a Source that usually yields Candidates yields none, so that a silent site redesign doesn't look like a quiet week.

**Eligibility**

12. As the sole user, I want live albums, singles, splits, compilations, reissues and remasters excluded, so that my five slots go to new work.
13. As the sole user, I want a total re-record treated as eligible, so that a band re-recording its own album still reaches me.
14. As the sole user, I want an EP included only when it is substantial, so that a two-track release doesn't displace an album.
15. As the sole user, I want a release excluded when the data needed to confirm eligibility is missing, so that an unconfirmable release never costs me a slot.
16. As the sole user, I want a release kept when any credible Source places it inside the window, with the disagreement recorded, so that conflicting dates don't silently drop good records.
17. As the sole user, I want only already-issued releases considered, so that my list is things I can actually listen to.

**Enrichment**

18. As the sole user, I want Candidates identified in MusicBrainz where possible, so that Release Identity is reliable rather than string matching.
19. As the sole user, I want a Candidate absent from MusicBrainz marked Unverified and kept, so that underground releases aren't penalised for thin metadata.
20. As the sole user, I want MusicBrainz's rate limit respected, so that the project stays a good citizen of a free service.
21. As the sole user, I want album cover art fetched where available, so that my Notion rows look like my manual ones.
22. As the sole user, I want missing cover art to never fail a Run, so that a cosmetic gap doesn't cost me a shortlist.

**Ranking and taste**

23. As the sole user, I want artists I always want to hear guaranteed a slot, so that I never miss a favourite.
24. As the sole user, I want artists I never want to hear excluded outright, so that no combination of other signals surfaces them.
25. As the sole user, I want artists I'm curious about guaranteed entry into ranking but not a slot, so that they compete on merit.
26. As the sole user, I want Adjacency — label, personnel, genre — to surface artists I'd merely have heard of, so that the middle ground I can't enumerate still reaches me.
27. As the sole user, I want label and genre exclusions treated as strong negative weight rather than hard filters, so that a mistagged record can still reach me on other signals.
28. As the sole user, I want most of the ranking computed deterministically, so that I can reason about why something scored well.
29. As the sole user, I want the model's resemblance judgement to cite the text it relied on, so that I can check it rather than trust it.
30. As the sole user, I want the Taste Profile changed only by my own edit, so that the system never quietly learns something I didn't sanction.

**The shortlist**

31. As the sole user, I want at most five Shortlist Items, so that the output matches the listening capacity I actually have.
32. As the sole user, I want a Run that finds only three good releases to propose three, so that a quiet week is reported honestly rather than padded.
33. As the sole user, I want every Shortlist Item to carry at least one Source URL, so that I can always check where a fact came from.
34. As the sole user, I want every Shortlist Item to carry a one-line Rationale, so that I can judge the agent's reasoning, not just its output.
35. As the sole user, I want no two Shortlist Items to be the same release, so that a release listed on three Sources doesn't take three slots.

**Notion**

36. As the sole user, I want proposed records written with `Status = Proposed`, so that nothing appears decided that I haven't decided.
37. As the sole user, I want `Rating` never written by the agent, so that my listening verdict stays mine.
38. As the sole user, I want the agent to refuse to write when my database is missing a required property, so that I never get a half-written set of rows.
39. As the sole user, I want an Apple Music search link on every record, so that I can get to the album in one click when I'm ready to listen.
40. As the sole user, I want releases already in Notion suppressed regardless of their Status, so that re-running a week doesn't duplicate rows.
41. As the sole user, I want the write to be all-or-nothing, so that a failure never leaves the database partly updated.
42. As the sole user, I want each record to carry the identifier of the Run that proposed it, so that I can trace a row back to its evidence.

**The loop and its guardrails**

43. As the sole user, I want the model to choose one action per step from a small fixed set, so that the loop's behaviour is bounded and legible.
44. As the sole user, I want every proposed action validated before dispatch, so that a malformed action can never reach a tool.
45. As the sole user, I want an invalid action returned to the model so it can correct itself, so that a typo doesn't waste a whole Run.
46. As the sole user, I want repeated invalid actions to end the Run, so that a confused model can't burn the entire step budget.
47. As the sole user, I want the Notion write to happen outside the loop after validation, so that the model cannot write early by mistake.
48. As the sole user, I want a step ceiling and a cost ceiling, so that no Run can run away.
49. As a future maintainer, I want the loop readable top to bottom in one file, so that the mechanism can be understood without tracing through a framework.

**Evidence**

50. As someone reviewing a Run, I want exactly one Termination Reason recorded, so that "why did it stop" always has a single answer.
51. As someone reviewing a Run, I want the proposed action and the dispatched action recorded separately, so that rejected actions are visible rather than absent.
52. As someone reviewing a Run, I want each step's duration recorded, so that I can see where the time went.
53. As someone reviewing a Run, I want cached and uncached input tokens counted separately, so that the cost figure is not wrong by an order of magnitude.
54. As someone reviewing a Run, I want the prompt, profile and schema versions recorded, so that I know which configuration produced which result.
55. As someone reviewing a Run, I want every tool call and its result or error recorded, so that the Run can be reconstructed without rerunning it.
56. As someone reviewing a Run, I want to read the trace without special tooling, so that inspecting a Run is never blocked on building a viewer.

## Implementation Decisions

**Runtime and dependencies.** TypeScript on Node 22. Three packages only: `typescript` and `tsx` for development, `zod` at runtime. The built-in test runner, SQLite module and `fetch` replace a test framework, a database driver and an HTTP client. The SQLite module is experimental and warns; the warning is suppressed narrowly, never globally. HTML cleaning begins as a hand-written tag stripper — the model performs extraction, so text only needs to be roughly clean. (ADR-0013)

**Process model.** A single short-lived CLI process. No HTTP server, no listener, no callback endpoint. Notion authenticates with an integration token from the environment.

**Model and provider.** DeepSeek V4.1 Flash on Fireworks, reached over its OpenAI-compatible endpoint using built-in `fetch` rather than a provider SDK, so the request and response shape stays visible. (ADR-0014)

**The loop is hand-written.** No SDK tool runner. A tool runner is the correct production choice and the wrong teaching choice. (ADR-0015)

**Action transport.** Actions travel as native tool calls. The model does not enforce a JSON schema on tool-call arguments, so arguments are untrusted input: parse, then validate against the action schema, before every dispatch. Both malformed JSON and well-formed JSON of the wrong shape are expected failure modes. (ADR-0016)

**Action set.** Four actions: fetch one configured Source; look up a release in MusicBrainz; run a web search for disambiguation or enrichment; finish with a Shortlist. Writing to Notion is deliberately not an action. (ADR-0005)

**Invalid actions.** A validation failure is returned to the model as that step's result and it may retry. Three consecutive invalid actions terminate the Run with `invalid_action_limit` and no write. (ADR-0017)

**Discovery.** Three configured Sources: Album of the Year's recent metal page, the Wikipedia year-in-heavy-metal page, and the Loudwire release calendar. *Amended by ADR-0031: Album of the Year serves a bot challenge and is not configured, so version 1 discovers from two.* Metal Archives' upcoming page is excluded because a backward-looking window cannot use it. A Candidate may never originate from a web search. (ADR-0001, ADR-0002)

**Extraction.** The model extracts Candidates from cleaned page text rather than a per-Source parser. Raw fetched text is stored so extraction is replayable. A Source that normally yields Candidates and yields none is recorded as a warning. (ADR-0003)

**Ranking.** Deterministic scoring over matchable release attributes — artist tier, label, genre, personnel — produces a base score. The model contributes only the resemblance judgement and the Rationale, and must cite Source text for both. (ADR-0006)

**Taste Profile.** Versioned, hand-edited, never written by the agent. Artists are tiered by effect: `always` guarantees a slot, `watch` guarantees entry into ranking, `exclude` never surfaces. Artist exclusion is a hard filter; label and genre exclusions are negative weights. (ADR-0007)

**Missing data.** Missing data needed to confirm eligibility excludes the release; missing data for a ranking signal simply removes that signal. Different questions, different answers. (ADR-0010)

**Cross-run memory.** Only two things cross a Run boundary: the Taste Profile, and the set of releases already in Notion, suppressed on Release Identity regardless of Status. Past traces are never fed to the model. (ADR-0009)

**Notion as external contract.** The agent never creates or alters the database schema. Before any write it verifies the expected properties exist with the expected types and blocks the write if they do not. Five properties must be added by hand before a Run can write: Status, MusicBrainz ID, Source URL, Rationale, Run ID. (ADR-0011)

**Status and Rating are separate.** Status records whether a proposal belonged on the list and is the agent's field; Rating records the post-listening verdict and is Ben's alone. (ADR-0008)

**Trace persistence.** One SQLite database. A run-level record and a step-level record per Run, plus stored raw Source text. Proposed and dispatched actions are separate columns so rejected actions are visible. (ADR-0012)

**Cost accounting.** Three rates, not two: uncached input, cached input and output are counted separately, because cached input is roughly thirty times cheaper and a single input count would misreport cost by that factor. The stable prefix — system prompt, tool definitions, Taste Profile — goes at the front of every request, ahead of anything varying per step. Whether the provider reports cached token counts is unverified; if it does not, cost is reported as an upper bound and labelled as one. (ADR-0020)

**Module shape.** An agent module holding the loop; a tools module where each action is declared once with its schema and implementation together, from which the JSON tool schema is derived; a ports module; adapters for model, HTTP and clock; clients for the Sources, MusicBrainz, cover art and Notion sitting above the HTTP port; a domain layer of pure functions; a store layer; and prompt assets. The domain layer imports nothing from clients or adapters, and that rule is mechanically checkable. Layout mirrors the Flue framework where it carries over, so the cost of a later migration stays legible; it diverges deliberately on a CLI entry point instead of an HTTP router, and on Zod instead of valibot. (ADR-0018, ADR-0021)

## Testing Decisions

**What makes a good test here.** Tests assert on observable behaviour — what a Run produced, what it wrote, why it stopped — not on how a module reached that result. No test asserts the number of model calls, the internal shape of a prompt, or the order of private function calls. Tests must not touch live external services.

**One seam.** Everything non-deterministic or external is reached through a single injected object with three members: the model, HTTP, and the clock. HTTP is deliberately low-level, returning status, headers and body, so the Source fetchers, MusicBrainz client, cover art client and Notion client are exercised for real against recorded fixture bodies rather than stubbed out. The cost is more verbose fixtures; the benefit is that the failure modes worth testing — partial MusicBrainz data, a Source page changing shape — only exist at the raw-response level.

**SQLite is real.** The store is not behind a port. Tests use an in-memory database. Faking a database we own would make persistence tests prove nothing.

**Tested through the seam, end to end:** loop termination for every Termination Reason; the step ceiling; the cost ceiling; action validation rejecting a malformed action and the model recovering; three consecutive invalid actions ending the Run; tool dispatch reaching the right client with the right arguments; shortfall recovery when eligibility leaves too few Candidates; suppression of releases already in Notion; the Notion schema preflight blocking a write; dry-run performing no write; all-or-nothing write behaviour; token and cost accounting across three rates.

**Tested directly as pure functions, with no seam:** action schema validation; Candidate normalisation and deduplication on Release Identity; eligibility rules including the EP thresholds, the total re-record carve-out and the missing-data exclusion; ranking arithmetic including artist tiers and negative weights; Shortlist validation including the Source URL requirement and the Unverified allowance; cost arithmetic.

**Prior art.** None — this is the first code in the repository. These tests set the convention. Tests live beside their source and are found by the built-in runner; recorded HTTP fixtures live in a shared fixtures directory.

**One live smoke test per external integration**, invoked separately and never part of the automated suite: one against the model provider, one against MusicBrainz, one against Notion in dry-run.

## Out of Scope

Explicitly excluded from this milestone, and not to be built "while we're in there":

- **Recovery** — checkpointing after every step, resuming an interrupted Run, retry classification and escalation behaviour. Milestone 2.
- **Evaluation infrastructure** — the golden dataset, the evaluation command, correctness and grounding metrics, baseline comparison. Milestone 3.
- **The case study** and audience-specific explanations. Milestone 4.
- **Absolute `--from` / `--to` dates.** Milestone 3's golden dataset will need them; the relative window is sufficient now.
- Scheduling, cron, email, notifications, any form of publishing.
- Sub-agents, agent frameworks, RAG, embeddings, vector databases.
- A web interface or HTTP server of any kind.
- Additional music providers. The Apple Music link is a constructed search URL, not an integration.
- Any change to the listening or Rating half of the workflow.
- Automatic updates to the Taste Profile from Rating data — that is self-modifying memory and is excluded from version 1 entirely.
- Creating or altering the Notion database schema.

## Further Notes

**Blocked until done by hand:** the five Notion properties. The schema preflight blocks every write until Status, MusicBrainz ID, Source URL, Rationale and Run ID exist with the expected types.

**Verify early, cheaply:** whether Fireworks reports cached token counts in its responses. If it does not, cost can only be an upper bound and must say so. This is trivial to check against one real response and awkward to discover later.

**Known undetectable risks, accepted:**

- Model extraction degrades quietly when a Source redesigns rather than raising an error. The zero-Candidate warning is the only detector, and by its nature it is untested until it fires.
- A hosted open-weights model can be swapped or re-quantised without notice. The recorded model identifier names what was asked for, not what answered. (ADR-0019)
- MusicBrainz personnel and producer credits are sparse for new underground releases, so those ranking signals will fire less often than the Taste Profile's structure implies.

**Reasoned guesses with no data behind them**, to be revisited once real Runs exist: the step ceiling of 30, and the EP thresholds of four tracks and twenty minutes.

**The loop is deliberately more machinery than the task requires.** A fixed-order pipeline would be simpler, cheaper and more testable. The loop is justified by three cases that genuinely branch on run-time state — shortfall recovery, targeted disambiguation, and seeking a third opinion when release dates conflict — and, more honestly, by the fact that the loop is the thing this project exists to learn. (ADR-0004)
