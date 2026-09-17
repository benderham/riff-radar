# Decisions

ADR-style log of architectural decisions for Riff Radar. Newest at the bottom. Each entry is ACCEPTED, PENDING, AMENDED (still in force except where the named later ADR changes it) or SUPERSEDED (kept for history — the named later ADR replaces it). Original text is never rewritten; corrections are new entries.

## ADR-0001: Discover from fixed configured sources, not open web search

**Status:** ACCEPTED — amended by ADR-0031, which drops one of the three sources

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

## ADR-0022: The taste profile is JSON, not YAML

**Status:** ACCEPTED

Earlier drafts of the Milestone 1 specification showed the taste profile as `taste-profile.yaml`. Node has no built-in YAML parser, and ADR-0013 caps the runtime dependency budget at `zod` alone, so YAML would mean either taking a parsing dependency or hand-writing a parser for a narrow subset. The profile is a small, flat, hand-edited structure of lists; JSON expresses it adequately and `JSON.parse` reads it for free. The file becomes `taste-profile.json`.

**Consequences:** The profile loses comments, which YAML would have allowed beside each entry — if annotation turns out to matter, an explicit `note` field is cheaper than reopening the format. `docs/specs/milestone-1-working-agent.md` is updated to match. Validation is still Zod's, so a malformed profile fails with a useful error rather than silently loading empty lists.
## ADR-0023: The date window resolves in local time

**Status:** ACCEPTED

`--last-days N` resolves to a pair of `YYYY-MM-DD` local calendar dates, inclusive at both ends, with `N` counting days including today: a seven-day run on Monday the 14th covers the 8th to the 14th. Resolution happens once at the start of a run and the resolved pair is what the trace records; the flag means something different every day and a stored `7` would tell a later reader nothing.

Local time rather than UTC, because the window means "the week Ben just lived through". For most of an Australian working day the UTC date is a day behind, so a Friday-morning run resolved in UTC would quietly end on Thursday. Dates rather than instants, because releases carry dates and not times, which also makes range comparison ordinary string comparison.

**Consequences:** A run started either side of midnight covers different windows, which is correct but means a run is not reproducible from its flag alone — only from its recorded range, which is why the range is recorded. Milestone 3's golden dataset will need absolute `--from`/`--to` dates that bypass resolution entirely; nothing here blocks that.

## ADR-0024: `@types/node` is a fourth development dependency

**Status:** PENDING — needs Ben's approval

ADR-0013 budgets three dependencies: `typescript`, `tsx`, `zod`. Type checking the code requires a fourth, `@types/node`, because TypeScript ships no declarations for Node's built-ins and the project deliberately leans on `node:sqlite`, `node:test`, `node:fs` and `fetch` in place of libraries. Without it `tsc --noEmit` cannot resolve a single import and the static check the completion protocol requires does not run at all.

It is development-only, types-only, and emits no runtime code. The alternative is hand-written declaration stubs for the Node surface we use, which is more code to maintain and less correct than the published types.

**Consequences:** The dependency budget reads as three runtime-and-build packages plus their type declarations, rather than three packages absolutely. If Ben would rather hold the line at three, the fallback is dropping `npm run typecheck` from the checks, which costs more than the dependency does.

## ADR-0025: An empty shortlist is `no_candidates`, not a failed validation

**Status:** ACCEPTED

`finish` with zero items ends the run with `no_candidates`. The shortlist validator requires between one and five items, so an empty shortlist would otherwise be `validation_failed` — the reason reserved for a model that proposed something broken. A quiet release week is not a broken proposal, and the termination reason is the field a later reader uses to tell "the agent misbehaved" from "there was nothing to find".

**Consequences:** Zero items is the one shortlist size checked in the loop rather than by the validator, which stays pure and keeps its 1–5 rule. Neither reason permits a Notion write, so the distinction costs nothing operationally and everything diagnostically. The system prompt tells the model to call `finish` with an empty shortlist when nothing is eligible, rather than leaving it to stall until `max_steps_exceeded`.

## ADR-0026: A per-run cost ceiling of USD 0.25, and cost labelled when it is a ceiling

**Status:** ACCEPTED

`budget_exceeded` needs a number and the specification gives none. The ceiling is USD 0.25 per run, checked before each model call rather than after, so it is a ceiling rather than a line the run notices it has already crossed. At the confirmed prices that is roughly a million uncached input tokens: far beyond an honest thirty-step run, and reached only by something runaway, which is what the guardrail is for.

Runs also carry `cost_is_upper_bound`. ADR-0020 left open whether the provider reports a cached-token breakdown; when a response does not, every input token in it is priced as uncached and the run is flagged. The flag is a column rather than a note, because Milestone 4's economics evidence has to distinguish a measured cost from a ceiling without reading prose.

The specification names "token or cost ceiling"; only the cost ceiling is implemented, because cost is what the tokens are counted for and a token ceiling would be a second number expressing the same limit less directly.

**Consequences:** A run that legitimately needs more than a quarter of a dollar is terminated, which at thirty steps cannot happen without something being wrong. The ceiling is in `config.ts` and moves without touching the loop. A single run whose first response omits the breakdown flags the whole run, deliberately: a cost that is partly measured and partly bounded is a bound.

## ADR-0027: One tool call per response is asked of the provider, not only of the prompt

**Status:** ACCEPTED

Requests set `parallel_tool_calls: false`. The loop's shape is one action per step, and the system prompt says so, but the first live call against DeepSeek V4.1 Flash returned three `fetch_source` calls in a single response — one per configured source, which is a sensible thing for a model to do and exactly what the loop cannot accept. Refusing them is correct and already implemented, but a run that refuses the model's first reasonable move three times in a row terminates with `invalid_action_limit` before it fetches anything.

So the constraint is asked for twice: of the provider, which honours it, and of the model in the prompt, which did not. The client-side refusal stays as the guardrail behind both, because a provider flag is a request and not a guarantee.

**Consequences:** A run takes one step per source rather than fetching all three at once, which is slower and is the price of a loop whose every step is separately validated, recorded and interruptible. The multi-call rejection is now a guardrail that should never fire in normal operation; the test that drives it is what keeps it honest. If a later ticket wants genuine parallelism it needs its own decision, because the step model — one proposed action, one validation, one dispatch, one row — assumes it away.

## ADR-0028: Fireworks reports cached token counts, so cost is a measurement

**Status:** ACCEPTED

Settles the question ADR-0020 left open. A live call confirms that Fireworks returns `usage.prompt_tokens_details.cached_tokens`, and that the cache behaves as the stable-prefix design assumed: a first request billed 1411 uncached input tokens, and the next identical prefix billed 129 uncached and 1282 cached. Cost accounting is therefore a measurement rather than an upper bound, and `cost_is_upper_bound` should read 0 on every run against this provider.

**Consequences:** The `cost_is_upper_bound` flag and the code that sets it stay, because they cost nothing and a provider can change what it reports without telling anyone — a run that stops seeing the breakdown labels itself rather than silently misreporting by up to thirty times. The prefix ordering is now evidence rather than theory: roughly 90% of a step's input tokens are served from cache, so the ordering rule in ADR-0020 is load-bearing and not a precaution.

## ADR-0029: Extraction is a nested model call inside `fetch_source`, not the loop's own reading

**Status:** ACCEPTED

ADR-0003 says the model extracts candidates from fetched page text. That leaves open *which* call does it. Two readings were available: the loop's own model reads the page text returned by `fetch_source` and holds candidates in its head, or `fetch_source` makes a separate, toolless model call whose only job is to turn one page into a JSON array of candidates and hand structured data back.

The second was chosen. Ticket 02 requires candidates to be normalised and deduplicated on release identity, tested directly as pure functions, and requires a source that yields none to record a warning. None of that is possible unless candidates exist as data in our own code; under the first reading there is nothing to deduplicate and nothing to count. It is not a sub-agent: no loop, no tool choice, no termination reason — one page in, one JSON object out.

**Consequences:** A run makes more model calls than it takes steps, so the usage returned by an action is added to the step that dispatched it; an extraction billed to nobody would make the cost ceiling unenforceable exactly where the tokens are. Page text is large, so cleaned text is capped at `MAX_SOURCE_TEXT_CHARS` and the cut is marked rather than hidden — raising the cap never requires refetching, because the raw body is stored whole. The loop's model never sees page text at all: it receives candidates, which is both cheaper and the reason the loop's own context stays small over a run.

ADR-0026 checks the cost ceiling before each of the loop's calls, and an action's nested call happens after that check, so a run can exceed the ceiling by one extraction. The overshoot is bounded by the text cap rather than by the page: at `MAX_SOURCE_TEXT_CHARS` and the confirmed prices it is roughly USD 0.003 against a ceiling of 0.25. Guarding it properly would mean handing the run's spend to every action, which buys a hundredth of a cent.

## ADR-0030: A disappointing source is a warning, not a failed run

**Status:** ACCEPTED

A source that returns a non-2xx status, lists nothing, or produces an extraction that will not parse does not end the run. It records a warning on the step that fetched it, the warning is handed back to the model, and the run continues on its other sources. Only a fetch that throws — no network, a timeout — is a tool failure that ends the run.

Three sources exist so that no one of them is critical. Ending a run because Loudwire was briefly behind a bot wall would throw away two sources that worked, and a redesign at Album of the Year would take the whole project offline until someone noticed.

**Consequences:** `no candidates from this source` is a phrase the trace has to be read for, since nothing stops. That is the detector ADR-0003 promised, so it is recorded in two places, in a `warning` column both times: on the step that fetched, beside but never in its `error` column, and on the `source_texts` row alongside the body that produced it. A step that warns is still a step that succeeded, and the trace has to say so without being read carefully.

The rule the specification states is narrower — a source that *normally* yields candidates and yields none — and nothing here knows what a source normally does, because no run's results are ever fed to another (ADR-0009). So every empty source warns, including a genuinely quiet page, and the warning says the page may have changed shape rather than asserting that it has. The risk accepted is a quietly degraded run — two sources reporting and one silently empty week after week — which `npm run smoke:sources` exists to catch.

## ADR-0031: Album of the Year is behind a bot challenge; version 1 runs on two sources

**Status:** ACCEPTED — amends ADR-0001

ADR-0001 names three sources. Two of them read fine. The third, Album of the Year, answers every request with HTTP 403 and a Cloudflare interstitial, and no ordinary request gets past it. What it served on 14 September 2026 was captured and read: an interstitial whose only words are in its `<title>`, so it reduces to no text at all. The capture is in commit 3ccb982 and was removed once the decision was taken, rather than kept as a fixture for a source nothing reads. Reading it would mean impersonating a browser and solving a challenge designed to stop exactly that, which is not something this project should be doing to a site that has said no.

So version 1 runs on two sources. Album of the Year is not configured at all, rather than configured and failing: a run has thirty steps, and spending one of them knocking on a door that is shut buys nothing but a warning we already know the text of. Its URL lives in this decision, which is one line away from putting it back. Nothing is faked and nothing pretends the coverage is complete.

**Consequences:** Discovery runs on two sources, and a run's coverage is narrower than the specification assumed. Ben has three ways out and this decision commits to none of them: accept two sources and amend ADR-0001; replace Album of the Year with another source that permits reading; or ask them for access. The warning is in every run's trace until one of those happens, which is the point — a source quietly producing nothing is the failure mode ADR-0003 was most worried about, and this one is loud.

## ADR-0032: Web search is Brave's API, and the search-to-shortlist path is closed in code

**Status:** ACCEPTED — amended by ADR-0033, which replaces Brave with Tavily. Everything below about the search-to-shortlist path stands; only the provider changed. Implements the enrichment half of ADR-0001.

`web_search` searches Brave's API: JSON over a plain GET, authenticated by a key in a header. The `http` port gains an optional `headers` argument to carry that key, which is additive — the project's own user agent is always sent — so nothing here impersonates a browser (ADR-0031). `BRAVE_API_KEY` joins the credentials a run refuses to start without, because a run that discovers its search is unusable halfway through has already been billed for the model calls before it.

Two alternatives were weighed and rejected. Scraping DuckDuckGo's HTML endpoint needs no key and no port change, but it blocks non-browser user agents, and a tool that permanently degrades to a warning is a fake by another name. Wikipedia's search API is free and well-behaved but too thin for underground metal, and MusicBrainz (ticket 04) already answers most identity questions.

The more consequential half of this decision is not the provider. ADR-0001 says a candidate may never originate from a search, and until now that rule lived only in the system prompt. `validateShortlist` now takes the run's candidates and rejects any item naming a release no source listed. Since only `fetch_source` adds to that list and `web_search` cannot reach it, the path from a search result to a Notion row does not exist in code rather than being discouraged in prose.

**Consequences:** A model that invents or imports a release ends its run with `validation_failed` and no write, which is a blunt end to an otherwise good run — the alternative, dropping the offending item and writing the rest, would let a run write a shortlist the model did not propose. Identity is matched on artist and title, so a model that "corrects" a title it read on a source loses the item; when ticket 04 gives candidates MusicBrainz ids, that match should strengthen rather than stay as it is.

`BRAVE_API_KEY` is required by every run, including a dry run and a run that never searches, which is stricter than the tool's use. The alternative — discovering the key is missing on the step that needs it — spends a search step and some of the model's patience to learn something knowable before the run starts.

One existing test changed meaning: a run whose only source 403s can no longer propose a shortlist, because it has no candidates to ground one in. That run now ends `no_candidates` rather than `completed_short`, which is the honest reading — the shortlist it used to propose was never anchored to anything. The test keeps its original claim by fetching a second source that works.

The search client's automated tests run against an invented body of Brave's documented shape rather than a capture, because capturing one needs a key this repository does not have. `npm run smoke:search` is what checks the shape against reality, and the first real response should replace the invented body with a fixture.

## ADR-0033: The search provider is Tavily, and the `http` port gains a POST

**Status:** ACCEPTED — amends ADR-0032. Tavily was Ben's instruction on 15 September 2026, which is the approval AGENTS.md requires before an external provider changes.

Brave was never used: ADR-0032 was written and implemented against its documented shape, but the repository had no key, so no Brave response was ever captured or parsed. Tavily replaces it before that gap closed, so nothing is being unwound — the endpoint, the credential name and the response schema move, and the client either side of them does not.

Tavily takes its query in a JSON body rather than a query string, so the `http` port gains `post(url, body, headers?)` beside `get`. It is a second method rather than a general `request(method, ...)`: only one caller posts, every source is and will remain a GET, and generalising would have rewritten every existing caller to buy nothing. `post` sends the project's own user agent exactly as `get` does, so nothing here impersonates a browser (ADR-0031). `TAVILY_API_KEY` replaces `BRAVE_API_KEY` in the credentials a run refuses to start without, for the reason ADR-0032 gives.

The URL recorded on a search step is now the bare endpoint, because the query has moved into the body. The query was never lost — `SearchFetch` has always carried it separately, and that is what the step records and what the model reads.

**Consequences:** The search client's tests no longer run against an invented body. `fixtures/tavily-search.json` is a real Tavily response, captured 15 September 2026, which is what ADR-0032 said should happen the first time a key existed. The gap that decision was uncomfortable about is closed: `npm run smoke:search` passed against the live API on 15 September 2026, and the shape it returned is the shape the client parses.

Tavily's snippet field is called `content`; it is mapped to `description` at the port boundary, because that is the project's own word and no provider's name should reach the rest of the code. The fakes in the test suite now have to declare which verb they expect, and each refuses the other — a source fake that is asked to POST throws, and a search fake that is asked to GET throws. That is noise in the tests, and it is the useful kind: it says out loud that a source is a page and a search is not.

`https://tavily.com/agent-setup/SKILL.md`, the setup document Ben pointed at, was read once `www.tavily.com` was allowed, after the implementation was already built against the live API. It offers several paths; this project is its **Path B**, integrating Tavily into an application that keeps running after the agent session ends, and not its CLI-and-Agent-Skills onboarding, which equips a coding agent rather than a product. Path B permits "the official SDK **or** REST API", so calling the REST endpoint through the `http` port stands: `@tavily/core` would be a dependency AGENTS.md requires approval for, and it would sit below the port where this project deliberately keeps raw HTTP (ADR-0018). Its other Path B instructions — put the key in the project's existing gitignored `.env`, never use the CLI as the product's runtime integration, run one real request as a smoke test before claiming the integration works — were already satisfied.

Reading it corrected one thing. Tavily documents a 400-character ceiling on a query, and the `web_search` action schema had no upper bound, so a model that wrote a paragraph where a search query belongs would have spent a step discovering that from the provider. `MAX_SEARCH_QUERY_CHARS` now bounds it, which is where AGENTS.md wanted it anyway: a model-produced action validated before dispatch.

Not done, and deliberately: the document's Autonomous Setup installs the `tvly` CLI and adds Tavily's Agent Skills globally to the coding agent. That equips Ben's machine rather than this repository, and AGENTS.md's scope boundaries do not cover it. It is his call, not a step to take silently.

## ADR-0034: MusicBrainz is the identity, and its data model settles two of the brief's rules

**Status:** ACCEPTED — implements ticket 04. No approval was needed for the provider: MusicBrainz is named in the brief.

`lookup_release` searches MusicBrainz's release-group index over the `http` port. Release Identity is the release-group id where there is one, and artist and title where there is not (CONTEXT.md). `releaseIdentityOf` is that rule; `candidateIdentity` stays the weaker artist-and-title one, because merging happens as a source is read, long before anything is looked up, and an identity that changed halfway through a run would stop a later fetch merging into an enriched candidate. The proof that two candidates are one release is spent where it is produced: `collapseByReleaseGroup` runs after each lookup.

Two of the brief's eligibility rules turned out to need almost no code, because MusicBrainz already draws the line. A reissue and a remaster are *releases inside* the original's release group — Exodus's "Bonded by Blood" is one group dated 1985 holding fifteen of them — so a reissue in this week's calendar resolves to a release group from decades ago and excludes itself on its date. A total re-record gets its *own* release group with its own date, so the carve-out the brief asks for is what the data already says. Both were verified against the live service rather than assumed.

Four things the live service taught that no fixture would have:

- It answers HTTP 200 with `{"error": "…busy…"}` under load, so a 2xx is not by itself a result and the body must be read.
- It sheds load often enough that giving up on the first refusal would leave candidates unverified for no better reason than the hour of the day. Transient refusals are retried three times, backing off further each time. A 404 is not retried; it will say the same thing three times. *(Superseded in part by ADR-0049: the retry itself now lives in the HTTP adapter and applies to every provider. What stayed here is the one-request-per-second gate, which is politeness rather than recovery.)*
- Its search is fuzzy and scored. Asked about Ulcerate it offers an EP by *Ulcerate Fester*, a different band. A hit is a match only when it scores at least 90 **and** its artist and title agree, because binding a candidate to the wrong release group would make Release Identity — and every fact resting on it — confidently wrong about a different record.
- It serves partial dates. `1985` is one, and a first draft that treated any non-ten-character date as undecidable would have excluded a forty-year-old reissue as a mystery rather than as a reissue. A partial date is compared against the same prefix of the window, which settles every case except one that genuinely overlaps it.

The one-request-per-second limit lives in the client so no caller can forget it, and its arithmetic is a pure function so the limit can be proved without spending a second per assertion. A clock that has gone backwards owes nothing — otherwise an NTP correction stalls the client for however far back it jumped.

An EP costs a second request: a release group states its type but not its tracks, and the ≥4-track, ≥20-minute threshold needs both. Only an EP pays it. A duration summed from an incomplete tracklist is an undercount, and an undercount excludes an EP that should qualify, so an untimed track means no duration at all rather than a wrong one.

**Consequences:** A lookup that *failed* is deliberately not recorded as a lookup. Recording `found: false` for a service that was briefly down would mark the release Unverified, and an Unverified release is judged on the source's own word about its format — so a stumble at MusicBrainz could let a live album through. The candidate stays un-looked-up, which excludes it, which is the honest reading of what the run knows.

The user agent gained a contact URL, because MusicBrainz's terms ask for one. It is the repository, not Ben's address, which would otherwise be personal data in every request and every trace.

**What this does not do.** Four things, written down rather than faked:

- The re-record carve-out is half implemented, **and that is the accepted scope, not a gap left open**. A *total* re-record qualifies and a reissue or remaster excludes itself, both because of where MusicBrainz puts them. A **covers album**, a **partial re-record** and **another band's version** are each their own release group with their own date, and MusicBrainz has no secondary type for any of them, so all three pass as new albums. Ben accepted this on 15 September 2026: the records are rare enough that the slots they would cost are not worth a rule the data cannot support. Ticket 05 does not inherit it, and nothing should be built to close it unless one of them actually reaches a shortlist.

  (An earlier draft of this decision claimed the match rule excluded another band's version. That was wrong: the match rule stops a candidate binding to the *original* band's release group, but a source listing `Cover Band — Master of Puppets` matches Cover Band's own release group, primary type Album, and passes.)
- **Label and personnel are not fetched.** The ticket's brief asks for them; a release group carries neither, so each would cost a further request per candidate, on top of the one an EP already costs. Adjacency is ticket 05's subject and nothing ranks on them yet, so the request was not made. This is a deferral, not an oversight, and ticket 05 has to close it.
- **`artistCount > 1` is a proxy for a split, not the rule.** MusicBrainz has no split type. The proxy excludes every legitimate two-artist collaboration along with the splits, which is a false exclusion of exactly the kind of record that might deserve a slot. It is kept because ADR-0010's asymmetry says so — a wrongly *included* release costs one of five scarce slots, a wrongly excluded one costs a run — but it is a judgement Ben should overturn if collaborations start going missing.

**Two readings worth naming, because both could have gone the other way.** The brief says a release is eligible when *any credible source* places its earliest official release date inside the range. Where MusicBrainz supplies a date, that date decides alone: it *is* the earliest official release date, which is the test the brief sets, and the reissue rule depends on it being authoritative — a 1985 release group listed in this week's calendar has to lose to MusicBrainz, not to the calendar. The consequence is real and worth seeing: a MusicBrainz date one day outside the window excludes a release every source placed inside it. The "any source" tolerance therefore survives only for Unverified releases, which is where the run has nothing better.

The excluded secondary types are also wider than the brief's list, which names live albums, singles, splits, compilations, reissues and remasters. Demo, Soundtrack, Mixtape/Street, Interview, Audiobook, Audio drama and Spokenword are added because none of them is the new album Ben is looking for and each would cost a slot. The retry behaviour is likewise not in the ticket; it is in AGENTS.md's design rules ("bound retries and obey provider rate limits") and the live service made it necessary rather than theoretical.

## ADR-0035: Eligibility is enforced at `finish`, and an unlooked-up release is excluded

**Status:** ACCEPTED — the enforcement point and the missing-data reading were Ben's calls, asked and answered on 15 September 2026.

The brief's eligibility rules lived in the system prompt, which made them a request rather than a rule — the same position the provenance rule was in before ticket 03. They are now pure functions in `domain/eligibility.ts`, and `validateShortlist` runs them over every proposed item. The model still does the choosing; the code refuses the choices the rules do not allow. The verdict carries its reason rather than a boolean, because both readers need it: the trace, to explain an absence, and the model, to be told why an item it liked was refused.

Enforcing at `finish` rather than filtering candidates was chosen over two alternatives. Filtering in code would hide the exclusion from the model, which then cannot explain it and cannot argue with it, and would make the trace quieter exactly where it should be loud. Doing both would put one rule in two places that can disagree.

A candidate nobody looked up is excluded, per ADR-0010: the data needed to confirm its format and its first release date is missing. This is a cliff, and it is deliberate — a run whose model skips `lookup_release` returns nothing at all — so the system prompt now says that a lookup is not optional, and `PROMPT_VERSION` is 3.

An Unverified release is *not* excluded, because absence from MusicBrainz is missing evidence and not invalidity (CONTEXT.md). It falls back to the format its source stated, which is the only statement the run has. A source that called it a live album still excludes it; a source that said nothing usable excludes it too.

**Consequences:** Nine agent tests broke, all of them proposing shortlists no run could now produce because they never looked anything up. That is the useful kind of failure, and the same kind ticket 03 produced: they were asserting on outcomes the rules no longer allow. They look releases up before finishing now.

The ranking half of ADR-0010 is untouched: missing data still excludes for eligibility and still proceeds for ranking. The two rules answer different questions.

## ADR-0036: A release is judged on who made it, not on how many made it

**Status:** ACCEPTED — amends ADR-0034 and the format list in CONTEXT.md. Ben's proposal and decision, 15 September 2026.

ADR-0034 excluded any release MusicBrainz credited to more than one artist, as a proxy for the brief's "split". MusicBrainz has no split type, and the proxy could not tell a split from a collaboration, so it threw out every two-artist record — which in metal is a real and frequently good category, not an edge case.

A split and a collaboration are indistinguishable in the data because the distinction was never really about the count. The question being asked is whether Ben wants to hear it, and that is a taste question: a Killswitch Engage / Disturbed record is refused because Disturbed is excluded, and a Killswitch Engage / Parkway Drive record is not refused at all. So `MusicbrainzLookup` carries the credited artists' names rather than their number, and eligibility refuses a release when **any** credited artist is on the profile's `artists.exclude`.

The asymmetry is ADR-0007's. An exclusion is a filter and one excluded artist is enough; `artists.always` is a *ranking* guarantee and deliberately does not appear here, because a live album should not become eligible on the strength of who plays on it. That half belongs to ticket 05, where ranking lives.

**Consequences:** A split now reaches the shortlist if its artists pass, which the brief's format list did not intend. The prompt's format exclusions drop "split" to match; CONTEXT.md's Eligible Release gains the artist rule. Nothing else in the brief mentioned splits, so this is the whole of the amendment.

This also closes a gap rather than only opening one. The system prompt has claimed "the artist is not in the profile's `artists.exclude`" since the beginning and no code enforced it — the same shape of problem as the provenance rule in ticket 03 and the eligibility rules in ADR-0035. It is enforced in `validateShortlist` now, across every credited artist rather than only the one a source happened to print first. An Unverified release has no MusicBrainz credits to read, so it is judged on the single artist its source named.

`PROMPT_VERSION` is 4.


## ADR-0037: The code orders the shortlist; the model's order is only the tie-break

**Status:** ACCEPTED — Ben's decision, 15 September 2026.

ADR-0006 put the matchable attributes of a release behind deterministic scoring and left the model the resemblance judgement and the rationale. It did not say who decides the *order*, and both readings were live: the model ranks and the code checks, or the code ranks outright.

The code ranks. `rankShortlist` scores every item the model proposed, sorts by the result, and rewrites `rank` from the sorted position. An `artists.always` match sorts first as a guaranteed slot rather than as a large number, so no combination of weights can outbid it and none has to be tuned to prevent that. Where two releases score the same, the order the model gave them survives — that is the one place its judgement of order still counts, and it is the place where the profile has said nothing.

**Consequences:** "A run demonstrably ranks differently under two different profiles" is provable without a model: the same scripted output under two profiles produces two orders, and the test asserts it. The finish step records the full breakdown — every contribution with the profile term that caused it — so an ordering can be recomputed by hand from the trace. The cost is that the model can no longer express "this one first" except through which releases it proposes at all; if that turns out to matter, the tie-break is where it would be widened.

## ADR-0038: Adjacency costs three MusicBrainz requests, and only the first artist's people

**Status:** ACCEPTED — Ben's decision, 15 September 2026.

Ticket 04 stopped at identity, and label, genre and personnel were left unfetched. They are three separate resources at MusicBrainz, so each is its own request and — under the one-per-second limit — its own second: the release for its label, carrying the tracks an EP already needed; the release group for its genres; and an artist for its `member of band` relations.

Members are fetched for the **first credited artist only**. Following every credit would cost a second per name on exactly the collaborations ADR-0036 made eligible, and the first credit is the one the release is filed under. Production credits are not fetched at all: the ticket's live survey found them effectively unpopulated for this project's music — Blood Incantation's *Absolute Elsewhere* and Ulcerate's *Cutting the Throat of God* returned no credits at any level.

**Consequences:** An identified release now costs four requests rather than one or two, and the live smoke test measures ~13 seconds per lookup including MusicBrainz's retries. A run doing five lookups spends about a minute there. That is time, not money, and the alternative was ranking three of its four signals on data it never asked for. A failed enrichment costs the release that signal and never its identity, per ADR-0010.

Two things the live service taught, both in the first smoke run. `[no label]` is a real entry in MusicBrainz meaning a self-released record; read as a name it would be a label like any other, matchable by a profile term, so it is read as the absence it means. And genres are thin in the long tail: Ulcerate returned six tags and the 1991 EP by Ulcerate Fester returned none. The ticket flagged that as unestablished; it is now established, and it is why genre is weighted no more heavily than label.

## ADR-0039: A suppression read that fails refuses the run

**Status:** ACCEPTED — Ben's decision, 15 September 2026.

The set of releases already in Notion is half of the only memory that crosses a run boundary (ADR-0009). If that read fails, the choice is to run unsuppressed and warn, or not to run.

Not to run. An unsuppressed run can propose what Notion already holds, and suppression is what makes the write idempotent by construction rather than by a deduplication rule at the far end. The read happens before the run row is written, so a failure leaves nothing behind and costs no model tokens; the CLI reports it as a refusal, alongside the missing-credential and broken-profile refusals it already makes. A dry run reads Notion too, because a dry run still spends tokens deciding.

**Consequences:** Notion being down stops a Friday run entirely rather than degrading it. That is the intended trade: a run that proposes last week's albums again is worse than no run, because the whole point of the list is that it is new. Suppression is applied as candidates are discovered rather than at `finish`, so a suppressed release is never offered to the model and nothing is spent looking it up — and a shortlist naming one is refused by the provenance rule that already exists, since a suppressed release is not a candidate.

## ADR-0040: A vibe note scores only when its quote is in the stored Source Text

**Status:** ACCEPTED — Ben's decision, 15 September 2026.

`vibe_notes` is the only model judgement in the ranking, and the ticket requires it to cite the Source Text it relied on. Three readings were possible: refuse the shortlist when a citation cannot be verified, warn, or simply not score it.

Not score it. The item carries a `claim` and a `quote`; the quote is checked verbatim — whitespace normalised, nothing else forgiven — against the Source Text this run stored for a page the item itself names. A quote that is not found contributes nothing and the release is ranked on its data alone. An uncited judgement failing the whole run would spend a Friday's shortlist on a transcription slip, and the judgement is worth one point against a watch-list artist's three.

**Consequences:** The store gains its one read — `sourceTextsOf(runId)` — narrow enough that no past run is reachable through it, so ADR-0009's "past traces are never fed to the model" is unaffected. Only pages `fetch_source` read are stored, so a claim sourced from a web search cannot be cited; that is consistent with Source Text as CONTEXT.md defines it, and it means the model's judgement rests on the same evidence its provenance does. The Rationale is not quote-checked: its provenance is the source URLs, which are already required and already enforced.

## ADR-0041: The Notion database is the contract, and it calls the album's title `Album`

**Status:** ACCEPTED — Ben's decision, 15 September 2026. Corrects the property table in `docs/specs/milestone-1-working-agent.md`.

The specification's property table said `Title`. The live database calls the title property `Album`, and the first run of `npm run smoke:notion` found it: suppression read zero identities from 272 records, because the property it was looking for did not exist. Two other things differ too. The URL column is `Apple Music`, not `Apple Music Link`. And the album cover is not a property at all: it is the Notion *page's* own cover image, which every one of the existing records carries as an external URL — so the agent sets `cover.external.url` when it creates the page, rather than writing a `files` property.

The database wins. It predates the specification, holds hundreds of hand-entered records, and is the tool Ben actually uses on a Friday; renaming a live property to satisfy a document is the wrong direction, and any view or filter keyed on the name would have to be checked. The specification is corrected instead.

**Consequences:** Suppression currently rests entirely on artist and title: not one of the 272 existing records carries a MusicBrainz id, because they were entered by hand. That is exactly why the read returns both identity forms. As the agent writes its own rows the stronger identity accumulates, and the weaker one keeps working in the meantime.

This is the argument for the smoke test rather than for more unit tests. Every automated test passed against a body this project wrote itself, and every one of them agreed with the code about a property name that was wrong. Only the real database disagreed. The cover and the `Apple Music` spelling belong to ticket 06, which is what writes them; they are recorded here so that ticket starts from what the database has rather than from what the specification claimed. Both names stay as the database spells them, for the reason above and because `Apple Music` reads more cleanly in the tool Ben looks at.

## ADR-0042: The Notion schema is checked at the start of a run, and a partial write is undone

**Status:** ACCEPTED — Ben's decision, 16 September 2026.

Ticket 06 requires that a run never leaves the database half-updated, and Notion has no batch create: five rows are five requests, and the fourth can fail. Two things follow from that, and they were settled before the code was written.

The schema preflight runs at the start of a run, beside the suppression read, and a mismatch refuses the run rather than blocking the write at the end. The information is the same either way and finding out first costs nothing: no model tokens, no run row, no half-hour of MusicBrainz lookups spent on a shortlist that cannot be written. The property table lives in `config.ts` and is read by both the preflight and the page builder, so the two cannot drift; `Rating` is absent from it, which is what makes "the agent never writes Rating" a fact about the code rather than a promise. The agent never creates or alters a property — a missing one is Ben's to add by hand, and the refusal names it.

A write that fails part way through archives the pages it has already created. Notion has no delete and no transaction, so an archived page is the closest thing to a row that was never written: it leaves the database, and suppression stops counting it. The alternative was to stop and report a partial week, which would have been quieter and worse — the three rows that landed would suppress themselves next Friday, so the two that did not would never be proposed again. The `http` port gains a `patch` for this one caller, the same way it gained a `post` for the one caller that searches (ADR-0033).

**Consequences:** This is compensation, not atomicity, and the difference is worth stating plainly: a rollback that itself fails, or a process killed mid-loop, can still leave rows behind. What the code guarantees is that no *reachable* failure leaves a partial week silently — a rollback that fails names the pages it could not archive, and the run exits 3, which is neither a success nor a refusal because it spent a run. The write is recorded as a step of its own — kind `notion_write` — but only when one was attempted, because a blocked write has nothing to say that the run row does not already carry in its flags, its termination reason and its shortlist size. Cover art is fetched per item immediately before its page is created, since a page's cover can only be set as the page is made; every failure there is silence, so an archive that is down costs a picture and not a run. How it is fetched was corrected the first time it ran for real: reading the archive's JSON index means following a redirect onto `archive.org` and then onto a numbered storage host — `dn721807.ca.archive.org` one minute, `ia800908.us.archive.org` the next — which no firewall can be asked to allow. `/front` answers 307 with the image's address when there is art and 404 when there is none, so one request that is deliberately not followed settles it, on one host, and no image travels through this process at all. Notion is handed the archive's own stable address and fetches the picture itself.

## ADR-0043: A request that gets no answer is a response, not an exception

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Reverses one line of ADR-0018's `http` contract.

A real run stopped at `tool_failure` on its third step. Two sources had been read, forty seconds of work was in the database, and a MusicBrainz lookup died with the message `fetch failed`. That message is all `fetch` says out loud; everything that identifies the problem — `ENOTFOUND`, `ECONNRESET`, the timeout — is in the error's `cause`, which nothing was reading. So the trace recorded the useless half, and finding out what had actually happened meant guessing.

The deeper fault was the classification. Every client treated an *answered* disappointment as a warning: a 503, a 429, a 404, a page that refused us, MusicBrainz's apology wearing a 200. An *unanswered* request threw, escaped the client entirely, and ended the run. A server politely saying "I am busy" was survivable and a dropped packet was fatal, which is exactly backwards — a dead socket is the most transient thing there is.

The adapter no longer throws. A request that gets no answer comes back as status zero with the reason, cause chain included, in the body. Every client already branches on "did this answer?", so all three inherit the fix without a line of their own: a source becomes a warning and the run continues on its other source (ADR-0030), a search becomes a warning, and a MusicBrainz lookup joins the 503 in being retried three times before it settles for Unverified. One shared function turns a status into words, so a warning reads `no answer: fetch failed: getaddrinfo ENOTFOUND musicbrainz.org` rather than `HTTP 0`.

**Consequences:** `HttpPort` now promises never to reject, which is a stronger contract than ADR-0018 wrote and a simpler one to hold: there is exactly one place that decides what an unanswered request means, instead of one per caller and none for the caller written next. The test asserting the old contract was deleted rather than weakened, and this decision is why. Notion is unaffected in spirit — a suppression read or a preflight that gets no answer still refuses the run (ADR-0039), it simply now says which host went away. Status zero is not a real HTTP status, and that is the point: nothing can mistake it for one, and `NO_ANSWER` is the only name the code uses for it.

## ADR-0044: The step ceiling stands at 30, and the first real runs say why it will not for long

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Revisits ADR-0026's ceilings against live evidence, as ticket 07 requires.

The first complete run used 27 of its 30 steps. Twenty-three were `lookup_release`, one per candidate, each costing four MusicBrainz requests and about ten seconds. Two were source fetches and one was `finish`. A quiet week fits; a busy one does not, and the run that does not fit ends `max_steps_exceeded` having spent every cent and written nothing.

The ceiling is not raised. A bigger number buys a week or two and hides the actual shape of the problem, which is that the model spends a step to learn one candidate's type — a question that does not need a model in the loop at all. Raising the ceiling also raises the cost of a runaway, which is what the ceiling is for. The number stays at 30 and the finding is written down instead, for the milestone that looks at failure and throughput.

The EP thresholds — 4 tracks and 20 minutes — are left exactly as specified, and it should be said plainly that neither run exercised them: no release either run met was typed as an EP by MusicBrainz, so those two numbers have never run against live data. They are confirmed by unit tests and by nothing else.

**Consequences:** A busy release week may terminate at the ceiling before proposing anything, and that will look like a failure of the loop rather than of the lookup budget. The trace makes the difference visible — 23 lookups in 27 steps is the number to read — and `npm run trace` prints it without a query. Two candidate directions for later, neither adopted here: let one action look up several releases, or let the code rather than the model decide which candidates are worth a lookup.

## ADR-0045: A release group nobody has typed is judged on the source's word

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Amends ADR-0034.

Three runs died at `validation_failed` on *Mother of Millions — T*, a record Ben likes. MusicBrainz knows it: one official release, dated 2026-09-11, ten tracks, a confirmed identity. The only thing missing is the primary type, which nobody has filled in. The rule refused it — while an identical release MusicBrainz had *never heard of* would have passed on Loudwire's word that it is a full-length.

That ordering was backwards, and the argument for changing it is not that the record is good: it is that an untyped release group carries more evidence than an absent one, not less. So both now fall to the same rule, the one that already existed for the unheard-of case: the source's stated format decides, a stated album passes, a stated live album, single, compilation, reissue or EP does not, and no stated format at all still excludes. Everything MusicBrainz *does* say still wins on its own word — a stated `Single`, `Broadcast` or `Other`, and every excluded secondary type. The date rule runs before this and is untouched, so an untyped group first released in 1985 is still a reissue.

One thing in the ticket was not implemented as written, and deliberately. It asked that an untyped release be reported as Unverified, "exactly as an unheard-of release does". That would be wrong: Unverified means MusicBrainz cannot identify the release (CONTEXT.md), and here it has — the identity, the date and the track count are all confirmed. Only the format is unknown. Marking it Unverified would throw away a release-group id that suppression depends on, to express an uncertainty about something else entirely. The release keeps its identity; the reason recorded against it says what was actually missing.

**Consequences:** A source that mislabels an untyped release is now believed. The exposure is narrow — it needs MusicBrainz to be missing a type *and* the calendar to be wrong about the format — and the alternative was refusing records like this one, which is a worse trade for a shortlist of five a week. The other half of the fix is not code and is Ben's: MusicBrainz is user-editable, and setting the type corrects the record for everyone.

## ADR-0046: The trace is the checkpoint, and only the candidate list is stored

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Defines milestone 2's checkpointing.

Milestone 2 requires state checkpointed after every step and a run that can resume from it. The obvious design is a second table holding the loop's working memory, serialised per step. It is not taken. `steps` already records, for every step, the model's raw response, the dispatched action, the tool's result, the usage and the timing — which is almost the whole of what the loop holds. A second representation of the same run is a second thing that can disagree with the first, and the trace is the artefact this project exists to make load-bearing.

So resume replays the trace. `messages` is rebuilt from `model_response` and `tool_result`; usage is the sum of the step columns; the consecutive-invalid counter is the trailing run of `invalid_action` steps; the MusicBrainz degraded counter is the trailing run of failed `lookup_release` steps.

One thing is not derivable and is therefore stored. `fetch_source` returns the whole merged candidate list in its result, but `lookup_release` does not: it enriches `context.candidates` in place, collapses them by release group, and returns only reshaped facts about the one release it looked up. Rebuilding candidates after a lookup would mean writing an inverse of that reshaping and re-running the collapse — a function that would break silently and be believed. `steps` gains one nullable column, `candidates_after`, holding the run's candidate list as JSON.

**Consequences:** The candidate list is re-serialised on every step, so a busy run writes it twenty-odd times. That is kilobytes and it buys a resume that cannot be subtly wrong. If the loop ever gains working memory beyond candidates, the honest move is another column rather than a clever derivation. The trace is now the thing a resume trusts, which means a corrupted or truncated trace is a run that cannot be resumed — correctly, because it is also a run that cannot be explained.

## ADR-0047: Resume is explicit, and a resumed run is a new row

**Status:** ACCEPTED — Ben's decision, 16 September 2026.

Two runs over the same window are both legitimate and they are not the same operation. A **Resume** continues one interrupted run from its last checkpoint: Ben lost it to a kill and wants the work back. A **Re-run** starts a fresh run over the same dates: Ben reviewed the first five and wants the next five, which works because what the first run wrote is suppressed.

Nothing infers which was meant. `--resume <run-id>` is required, takes no window argument, and its absence always means a new run — even when an unfinished run for the same dates exists. The CLI may mention such a run; it must not act on it. An inferred resume would silently turn a deliberate second run into a continuation and hand Ben nothing new, which is the failure mode that is hardest to notice.

A resume creates a new run row carrying `resumed_from`, rather than appending to the parent's. The parent keeps its trace and is closed with `aborted`, so exactly one termination reason per run still holds and a run row never changes its mind. Step indices restart at zero in the child, because `step_index` is a position within a run and `UNIQUE (run_id, step_index)` already treats it that way; duplicating the parent's indices would make the child's trace lie about its own length. `scripts/trace.ts` follows `resumed_from` and prints the chain as one story.

A resume is refused when the run id does not exist, when the run already has a termination reason, when it has no recorded steps, or when its `prompt_version`, `profile_version` or `action_schema_version` differs from the current configuration. The last is the one worth stating: a run half-built under an old prompt and finished under a new one produces a trace nobody can reason about, and milestone 3 would have to exclude it from every measurement.

**Amended 17 September 2026, implementing ticket 04.** "No recorded steps" counts the chain's steps, not the named run's own. A resume is itself a run row, so one killed before it took its first step has none of its own while its ancestors hold everything worth continuing; refusing it would strand the chain, because the parent it inherited from has already been closed `aborted` and is refused too. For a run that resumed nothing the two counts are the same number, which is the case the sentence was written about.

**Consequences:** Editing the prompt or the taste profile invalidates every unfinished run, which is correct and will still be annoying. Two run rows describe one piece of work, so every query that counts runs has to decide whether a resumed pair is one or two; `resumed_from` makes that answerable rather than guessable.

## ADR-0048: Six failure categories, recorded on the step, with no new termination reasons

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Extends ADR-0043.

Today the only explicit distinction between external failures is answered versus never-answered (ADR-0043); everything else is prose in a warning. Milestone 3 has to count failure categories, and counting prose means regexes over a column written for humans.

Six categories, produced by a pure function of status and body in `src/domain/failure.ts`: `transient` (no answer, 5xx), `rate_limited` (429, or a provider's own gate), `refused` (401, 403 — credentials or a bot wall), `not_found` (404, which is an answer), `malformed` (a 2xx whose body failed its schema), and `unavailable` (a provider that has failed enough times to stop knocking). The first two retry; the rest do not. `rate_limited` is kept separate from `transient` only because `Retry-After` changes the backoff.

The category is recorded in a new nullable `failure_category` column on `steps`, constrained to those six values the way `termination_reason` is constrained on `runs`. The prose stays where it is; the category sits beside it as the countable thing, so milestone 3's failure report is a `GROUP BY` and not a parser. Where one step makes several external calls, the recorded category is that of the failure which produced the step's warning — categories are per step, and per-request detail lives in the retry count and the prose.

No new termination reasons. `tool_failure` plus the step's category already answers both "why did the run stop" and "what kind of thing broke", and splitting the reason would force milestone 3 to map ten reasons onto six categories for no gain. The one thing corrected is the existing shoehorn: a model failure records `tool_failure` with a category on its step, so the apology in the loop's comment becomes data.

**Consequences:** Nine termination reasons and six categories are two vocabularies a reader must hold at once. They answer different questions — one is about the run, one is about the outside world — and `CONTEXT.md` now says so. A category that turns out to be too coarse cannot be split without a schema change, because it is a CHECK constraint; that is the same trade already made for termination reasons, and it is the reason the set is deliberately small.

## ADR-0049: Retry lives in the HTTP adapter, bounded at three attempts

**Status:** ACCEPTED — Ben's decision, 16 September 2026.

The adapter already owns the contract that nothing below the clients throws (ADR-0043); it now also owns trying again. Three attempts, exponential backoff of roughly one, two and four seconds with jitter, `Retry-After` honoured when a provider states it, and only for `transient` and `rate_limited`. Everything else is an answer and is returned immediately.

The alternatives were a helper each client wraps its own call in — four call sites and four chances to forget one, with the forgotten one invisible until a Friday — and retrying the whole action at the loop, which is the wrong altitude: it would re-run a page fetch and a model extraction to recover from a dropped packet.

`HttpResponse` gains `attempts`, so a retried call is visible to the client above it and therefore in the trace. Without it, retry would make the system quietly more reliable and completely unexplainable, which is the opposite of what this project is for. MusicBrainz's one-request-per-second gate stays in its client: it is a politeness rule, not a response to failure.

Implemented on 17 September 2026. Two things the ticket did not spell out and the code had to settle. The MusicBrainz client's own three-attempt loop was deleted rather than left beside the adapter's: keeping both would have made one lookup cost up to nine requests, and "retry belongs here and nowhere else" is the whole point of the decision. And `Retry-After` is clamped at ten seconds, which is already longer than the backoff would have chosen on its own, so the worst a hostile header can cost a run is twenty seconds rather than the two hours `Retry-After: 3600` would ask for.

**Consequences:** A retried request inflates its step's `duration_ms`, so milestone 3's latency figures will be lumpy and `attempts` is what explains the lumps. There is deliberately no per-run retry budget; a run that dies to accumulated backoff has not happened yet, and the step and cost ceilings already bound the run. Three attempts against a provider that is down adds about seven seconds per call before the run learns anything, which is what makes MusicBrainz's degraded mode (ADR-0052) necessary rather than merely nice.

## ADR-0050: A resumed run inherits its parent's ceilings

**Status:** ACCEPTED — Ben's decision, 16 September 2026.

Both ceilings are per run in the code: thirty steps and USD 0.25. A resumed run is a new row (ADR-0047), so the question is whether it starts them at zero. It does not: resume loads the parent's accumulated usage and step count and continues against the same limits.

Fresh ceilings would make an interruption a way to buy a bigger budget, and a crash-loop a way to spend without one. The ceilings exist to bound what one *question* costs, not what one process costs, and a resume is the same question. `resumed_from` makes the inherited totals auditable rather than magic.

**Consequences:** Resuming a run that died at step 28 is very nearly pointless — it gets two steps and will probably end `max_steps_exceeded`. That is correct, and the right response is a re-run, but it will look like a broken feature the first time it happens, so the spec says it out loud. The cost accounting for a resumed pair must be read as a chain; `npm run trace` following `resumed_from` is what makes the total visible without a query.

## ADR-0051: A half-written Notion database is correct but incomplete, and suppression already fixes it

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Closes carried-forward item 4 and settles what ADR-0042's rollback is for.

A run killed part way through the Notion write leaves rows behind that its own run row does not know about, and `carried-forward.md` framed the consequence as a hazard: suppression will hide those rows from the next run. That framing was wrong, and the reason is a fact about how Ben actually uses the system.

A second run over the same window is not a repair attempt. It is Ben having reviewed the first five and wanting the next five, and it works precisely because the suppression read drops what Notion already holds and the model proposes what it has not seen. Which means "repeated runs cannot create duplicate Notion records" is a promise about duplicate *releases*, not about one write per window — and a kill that leaves three of five rows behind leaves three rows that are *correct*. The next run suppresses them and proposes the remaining two. That is the desired outcome, reached with no new machinery.

So no write-intent journal and no per-page idempotency key. Both were considered and both add a second mechanism to solve a problem the memory that already exists solves better. Resume re-reads the suppression set and the schema preflight exactly as a fresh run does, which is what makes resume and re-run one startup path differing only in whether working memory is replayed.

**Consequences:** ADR-0042's rollback is now the thing that keeps a *survivable* failure all-or-nothing, not the thing that protects against a kill; a kill needs no protection. A shortlist can be split across two runs, so a release the first run ranked second may reach Notion below one the second run ranked first — Ben reviews everything anyway and rank is per run, but the Notion database is not a single ordered list and never was. The claim now has to be evidenced rather than argued: a run killed mid-write, followed by a re-run, with both traces exported.

## ADR-0052: MusicBrainz degrades after two silent lookups rather than spending the run knocking

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Implements the sketch in carried-forward item 3.

Ben's own machine cannot reach MusicBrainz — his IP is blocked — and every run so far has come from a development sandbox. A run whose lookups all fail survives (ADR-0043) but proposes nothing, because an unlooked-up release is excluded: it ends `validation_failed` holding a shortlist built in good faith. With retry (ADR-0049) each of those futile lookups now costs seven seconds before it fails.

After two consecutive `lookup_release` steps whose failure category is `transient` or `unavailable`, the run is Degraded. From then on `lookup_release` returns immediately without a request, telling the model that MusicBrainz is unavailable and that releases will be judged on their source's stated format — which is already the rule for an untyped release group (ADR-0045), so the machinery exists and nothing new is invented under failure.

What is lost is stated rather than discovered: no reissue or remaster detection, no EP track and duration thresholds, and the label, genre and personnel terms drop out of ranking. `runs` gains `musicbrainz_degraded`, and the shortlist items say so. The run still completes and still writes, because a degraded shortlist Ben reviews is worth more than a dead run, and Ben reviews everything.

No new termination reason: degradation is a property of a run, not a reason it stopped.

**Consequences:** A degraded run can propose a reissue or a live album that a source mislabelled, with nothing to catch it — the same narrow exposure ADR-0045 accepted, now reachable by an outage rather than by a missing field. Two consecutive failures is a low bar and a single flaky minute will trip it; the alternative is a run that spends its ceiling discovering the same fact more slowly. Degraded runs must be excluded from, or labelled in, milestone 3's evaluation, or they will look like a ranking regression.

## ADR-0053: A refused shortlist is handed back once before the run ends

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Amends ADR-0035.

Validation at `finish` is all-or-nothing and `finish` ends the run, so one ineligible item among five means `validation_failed`, nothing written, and the whole run's cost spent. This happened twice in a row on 16 September on the same release. The immediate cause was fixed — the model is now told at lookup time that a release is ineligible — but the structural fault stood: the last step of a run had no way to fail softly.

When `validateShortlist` refuses, the errors are returned to the model as a tool message, using the mechanism that already exists for an invalid action, and the model may call `finish` once more. A second refusal ends the run at `validation_failed`.

One repair, not three. By that point the model has already been told the item is ineligible at lookup time; a second failure means it is not listening, and further attempts buy tokens rather than a shortlist.

The guardrail is untouched and that is the point: the validator still decides, still runs before any write, and still refuses. What changes is only that the model gets one chance to drop an item it should not have included.

**Consequences:** A run can now spend one extra model call on its last step, which the cost ceiling already bounds. `validation_failed` becomes rarer and therefore more meaningful — it now means the model was told twice. The repair attempt is a recorded step like any other, so the trace shows the refusal, the errors handed back, and the corrected shortlist, which is the observable version of a guardrail working.

## ADR-0054: Time passes through the clock port

**Status:** ACCEPTED — Ben's decision, 16 September 2026. Extends ADR-0018 and completes ADR-0049.

Backoff needs time to pass in a way tests can control, or the suite spends seven seconds per retry case. The adapter already injects `fetchImpl` for its own tests, so the cheap move was a second injected `sleep` beside it. `ClockPort` gains `sleep(ms)` instead, and the adapter takes the clock at construction.

The cheap move would have made the outside world reachable from two places, which is exactly what ADR-0018 exists to prevent — and the project already has evidence of the cost: the MusicBrainz gate calls `setTimeout` directly, and its tests only avoid waiting a real second because they happen to control `clock.now()` so the computed delay is zero. That is a test passing for a reason unrelated to what it asserts. The gate moves to the same `sleep`.

**Consequences:** `ClockPort` is no longer only a reader of the current instant, so its name is now slightly narrower than its job. Every fake clock in the test suite grows a method. In exchange there is one place where the process waits, and a test that fakes it sees every wait in the system — including the two that currently compose by accident, retry and the rate-limit gate.

## ADR-0055: `model_response` stores the parsed response beside the provider's body

**Status:** ACCEPTED — 17 September 2026, during ticket 03. Implements ADR-0046.

ADR-0046 decided that a resume rebuilds the message history from `model_response` and `tool_result`. Implementing it found that `model_response` could not answer: it held `JSON.stringify(response.raw)`, the provider's body as it arrived. Rebuilding an assistant message from that would mean the loop parsing Fireworks' `choices[0].message.tool_calls` — the adapter's job, moved into the agent, and a resume that breaks the day the provider changes. The other columns cannot stand in either: `proposed_action` records a name and its arguments, and the history needs the tool-call id that ties an assistant message to the tool message answering it, plus whatever prose the model wrote alongside its call.

So `model_response` now holds `{content, toolCalls, raw}`: the two parsed halves the loop actually appended to its history, and the provider's body underneath them unchanged. One function, `recordedModelResponse` in `src/domain/replay.ts`, writes it, and the schema that reads it back sits beside it — the two halves of one format in one file.

The alternative was a second stored column holding the message history, which ADR-0046 rules out for the reason it gives: a second representation of the run is a second thing that can disagree with the first. This is not that. `raw` is still the evidence of what arrived; `content` and `toolCalls` are the same response as the loop understood it, and the loop is what a resume continues.

**Consequences:** The column's shape changed, so a trace written before this reads back as a response the replay refuses — correctly, since it also cannot be resumed. The two committed milestone-1 evidence exports keep the old shape and are historical records rather than resumable runs. Anything that wants the provider's body verbatim now reads `model_response -> '$.raw'` rather than the whole column; nothing currently does, including `npm run trace`.
