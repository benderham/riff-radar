# 01: External failures get six names, and the schema gets its columns

**What to build:** A pure function from an HTTP response to one of six failure categories, wired into every client, plus the four new columns this milestone needs — in one schema change.

**Blocked by:** —

**Status:** done

## Why

The only explicit distinction between external failures today is answered versus never-answered (`src/domain/http-outcome.ts`, ADR-0043). Everything else is prose: `"Loudwire: HTTP 503"`, `"no answer: fetch failed (ENOTFOUND)"`. A human reads those fine. Milestone 3 has to *count* them, and counting prose means regexes over a column written for people.

Three other tickets need this before they can start. Retry (02) needs to know which failures are worth retrying, resume (03) needs the columns, and degraded mode (05) needs to know which lookups count towards giving up.

This is the prefactor, and it is deliberately not a vertical slice. It also carries three columns that nothing populates until ticket 03, which is the point: `assertSchemaIsCurrent` refuses an out-of-date database and tells Ben to delete it, so one schema change means he does that once rather than twice.

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

## The columns

Four, all nullable or defaulted, in one change to the schema:

- `steps.failure_category TEXT` — constrained by a `CHECK` listing the six values, in the same style as `runs.termination_reason`. Populated by this ticket.
- `steps.candidates_after TEXT` — the run's candidate list as JSON. Populated by ticket 03 (ADR-0046).
- `runs.resumed_from TEXT` — the parent run id, referencing `runs(run_id)`. Populated by ticket 03.
- `runs.musicbrainz_degraded INTEGER DEFAULT 0` — constrained to 0 or 1. Populated by ticket 05.

No migration. `assertSchemaIsCurrent` will refuse the existing database and name all four; export anything worth keeping with `npm run trace` before deleting it. The rule holds because `*.db` is gitignored and evidence is already committed as exported JSON.

## Acceptance criteria

- [x] `src/domain/failure.ts` exports a `FailureCategory` union of exactly those six values and a function mapping `(status, body)` to a category or `undefined` for success
- [x] Unit tested across every category, including status 0, 429, 503, 401, 403, 404, and a 2xx
- [x] All four columns are added in one schema change, with their constraints
- [x] `assertSchemaIsCurrent` refuses the old database and names all four new columns — the existing behaviour, confirmed by test, not changed
- [x] Every client that records a warning or an error also records the category: sources, MusicBrainz, search, cover art, Notion
- [x] A 2xx whose body fails its schema records `malformed` — the extraction path at `src/clients/sources.ts:133` and the Notion parse paths are the cases that exist today
- [x] A model call that fails records `tool_failure` as the run's reason and a category on its step, replacing the shoehorn apologised for in the comment at `src/agents/riff-radar.ts:175`
- [x] Where one step makes several external calls, the recorded category is the one that produced the step's warning; a test covers a `fetch_source` whose page fetch succeeded and whose extraction was malformed
- [x] `npm run trace` prints the category beside the error

## Notes

Six, not five and not ten. `rate_limited` is split from `transient` only because `Retry-After` changes the backoff, and the set is small deliberately: it is a `CHECK` constraint, so splitting a category later costs a schema change. See ADR-0048.

Reasons and categories answer different questions and `CONTEXT.md` now says so — a Termination Reason is why the *run* stopped, a Failure Category is what broke *outside* it.

## What it turned out to be

Two things the ticket did not anticipate, both small.

Cover art has no warning to categorise. It swallows every outcome and returns
either an address or nothing, which is the whole of its rule, so there was
nothing to wire and nothing was invented to give it something.

MusicBrainz's own `isTransient` is gone, replaced by `isRetryable` over the
shared category. That widens its retry from 503 alone to every 5xx, which is
the category's definition and was the reason to share the judgement rather than
keep a second list of statuses next to the first.

Two widenings of the table above, both deliberate and neither in ADR-0048:
every other 4xx — a 400, a 410 — is `refused` rather than a seventh name, since
the alternative is a `CHECK` constraint per status a provider might invent. And
a 3xx that nobody followed is not a failure at all, so a source that warns about
one records prose and no category; the only client that sees an unfollowed
redirect is cover art, which records nothing either way.

`assertSchemaIsCurrent` was changed rather than merely tested: it threw on the
first table that disagreed, so a database written before this milestone named
only two of the four columns. It now collects every table and names all four in
one message, which is what the acceptance criterion above asks for and what one
schema change is supposed to buy.
