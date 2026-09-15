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

`https://tavily.com/agent-setup/SKILL.md`, the setup document Ben pointed at, was never read: the sandbox's network policy allows `tavily.com` and `api.tavily.com` but the document redirects to `www.tavily.com`, which is denied. The implementation is built against the live API's actual behaviour instead, which is the stronger source, but any setup step that document prescribes beyond the search call has not been followed.
