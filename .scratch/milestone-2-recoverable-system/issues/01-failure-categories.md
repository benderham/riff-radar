# 01: External failures get six names

**What to build:** A pure function from an HTTP response to one of six failure categories, and a `failure_category` column on `steps` that records it.

**Blocked by:** —

**Status:** ready-for-agent

## Why

The only explicit distinction between external failures today is answered versus never-answered (`src/domain/http-outcome.ts`, ADR-0043). Everything else is prose: `"Loudwire: HTTP 503"`, `"no answer: fetch failed (ENOTFOUND)"`. A human reads those fine. Milestone 3 has to *count* them, and counting prose means regexes over a column written for people.

Two other tickets need this before they can start. Retry (02) needs to know which failures are worth retrying, and degraded mode (05) needs to know which lookups count towards giving up.

## What

`src/domain/failure.ts`, deterministic, no ports, no network:

| Category | When | Retryable |
| -------- | ---- | --------- |
| `transient` | no answer (status 0), or 5xx | yes |
| `rate_limited` | 429, or a provider's own gate refusing | yes |
| `refused` | 401, 403 — credentials or a bot wall | no |
| `not_found` | 404 — an answer, not a failure of the call | no |
| `malformed` | a 2xx whose body failed its schema | no |
| `unavailable` | a provider already given up on this run | no |

`malformed` and `unavailable` are not derivable from a status alone: `malformed` is raised by a client after a parse fails, and `unavailable` is set by ticket 05. The function covers what a status and body can say; the other two are passed in by the caller that knows.

## Acceptance criteria

- [ ] `src/domain/failure.ts` exports a `FailureCategory` union of exactly those six values and a function mapping `(status, body)` to a category or `undefined` for success
- [ ] Unit tested across every category, including status 0, 429, 503, 401, 403, 404, and a 2xx
- [ ] `steps` gains `failure_category TEXT` with a `CHECK` constraint listing the six values, nullable, in the same style as `runs.termination_reason`
- [ ] Every client that records a warning or an error also records the category: sources, MusicBrainz, search, cover art, Notion
- [ ] A 2xx whose body fails its schema records `malformed` — the extraction path at `src/clients/sources.ts:133` and the Notion parse paths are the cases that exist today
- [ ] A model call that fails records `tool_failure` as the run's reason and a category on its step, replacing the shoehorn apologised for in the comment at `src/agents/riff-radar.ts:175`
- [ ] Where one step makes several external calls, the recorded category is the one that produced the step's warning; a test covers a `fetch_source` whose page fetch succeeded and whose extraction was malformed
- [ ] `npm run trace` prints the category beside the error

## Notes

Six, not five and not ten. `rate_limited` is split from `transient` only because `Retry-After` changes the backoff, and the set is small deliberately: it is a `CHECK` constraint, so splitting a category later costs a schema change. See ADR-0048.

Reasons and categories answer different questions and `CONTEXT.md` now says so — a Termination Reason is why the *run* stopped, a Failure Category is what broke *outside* it.
