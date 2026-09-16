# 03: Every step is a point the run can be picked up from

**What to build:** The columns a resume needs — `candidates_after` on `steps`, `resumed_from` and `musicbrainz_degraded` on `runs` — written as each step is recorded.

**Blocked by:** 01

**Status:** ready-for-agent

## Why

"State is checkpointed after every step" sounds like a new table. It is not. `steps` already records the model's raw response, the dispatched action, the tool result, the usage and the timing for every step, which is almost the whole of what the loop holds. A second table holding the same run is a second thing that can disagree with the first.

One thing genuinely is not derivable. `fetch_source` returns the whole merged candidate list in its result (`src/tools.ts:138`), so a fetch replays. `lookup_release` does not: it enriches `context.candidates` in place, collapses them by release group, and returns only reshaped facts about the one release — `releaseGroupId` renamed to `musicbrainzId`, `found` dropped. Rebuilding candidates after a lookup would need an inverse of that reshaping plus a re-run of the collapse, which is the kind of function that breaks silently and gets believed.

So: one column for the thing that is not derivable, and nothing for the things that are.

## What

Three columns, all nullable or defaulted, added to `src/store/schema.sql`:

- `steps.candidates_after TEXT` — the run's candidate list as JSON, written with every step
- `runs.resumed_from TEXT` — the parent run id, null for a run that is not a resume
- `runs.musicbrainz_degraded INTEGER DEFAULT 0` — set by ticket 05

Plus `steps.failure_category` from ticket 01.

## Acceptance criteria

- [ ] Every recorded step in a run carries a non-null `candidates_after`, including `invalid_action`, `tool_error` and `finish` steps
- [ ] `candidates_after` round-trips: a candidate list written and read back is deeply equal, including the `lookup` enrichment
- [ ] `runs.resumed_from` references `runs(run_id)` and is null on a normal run
- [ ] `runs.musicbrainz_degraded` defaults to 0 and is constrained to 0 or 1
- [ ] `assertSchemaIsCurrent` refuses the old database and names all four new columns — the existing behaviour, confirmed by test, not changed
- [ ] `npm run trace` shows the candidate count per step, not the whole list
- [ ] A test proves what is *not* stored is derivable from what is: `messages` from `model_response` and `tool_result`, total usage from the step columns, and the consecutive-invalid count from the trailing run of `invalid_action` steps

That last criterion is the one that matters. Ticket 04 depends on it, and finding out there that something is unrecoverable is finding out too late.

## Notes

No migration. `assertSchemaIsCurrent` will tell Ben to delete `riff-radar.db`; export anything worth keeping with `npm run trace` first. The rule holds because `*.db` is gitignored and evidence is already committed as exported JSON.

The candidate list is re-serialised on every step, so a busy run writes it twenty-odd times. That is kilobytes, and it buys a resume that cannot be subtly wrong. See ADR-0046.
