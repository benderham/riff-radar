# 07: Three numbers about whether it is any good

**What to build:** `scripts/taste.ts` — Acceptance Rate, Taste Yield and Shortlist Fill Rate, read from Notion.

**Blocked by:** 04

**Status:** done

## Why

Nine records sit at `Proposed`, unjudged. Nothing in the project measures whether the recommendations are worth having, as distinct from whether the machinery works. Ben's goal is that the share of proposals he ends up rating `Rotate`/`AOTY` rises over time — this ticket builds the instrument and takes the first reading. It cannot show the trend; at five proposals a Run, that needs months.

## What

**Acceptance Rate** — proposals whose `Status` is not rejected, over proposals. Moves without Ben listening to anything.

**Taste Yield** — proposals rated `Rotate` or `AOTY`, over proposals **rated at all**. Unrated proposals are a third bucket, reported, never folded in: a backlog is not a rejection.

**Shortlist Fill Rate** — Runs that proposed a full five, over Runs. Printed beside the other two always. Yield alone is maximised by proposing fewer, safer, better-known albums, which is the opposite of what Adjacency exists for; this is the denominator that stops the metric rewarding cowardice.

All three per `profile_version`, with **n** stated. A profile edit invalidates comparison across the boundary.

**Reading `Rating` is permitted here and only here.** `NOTION_PROPERTIES` is untouched and stays the sole source for writes and preflight. This command carries its own read-only schema naming `Status` and `Rating` and has no path that creates or patches a page (ADR-0061, amending ADR-0042).

## Acceptance criteria

- [x] `npm run taste` prints all three per `profile_version` with n
- [x] Unrated proposals reported as their own bucket
- [x] Fill Rate printed unconditionally, never behind a flag
- [x] Its read-only schema names `Rating`; `NOTION_PROPERTIES` does not
- [x] No write path in the command; provable by inspection
- [x] Pages to the end the way `suppressedReleases` does
- [x] The arithmetic is pure and unit-tested; the Notion call is not in `npm test`

## Notes

ADR-0060, ADR-0061. Gates nothing. A quiet week of mediocre metal would otherwise fail a milestone for reasons unrelated to the agent.

## What the build found

**`profile_version` is not in Notion.** It is joined on `Run ID` against the
store — and against the trace exports in `docs/evidence/`, because the
milestone-1 database was deleted at milestone 2's schema change and of the four
runs that have ever written to Notion, `riff-radar.db` remembers one. Run
`530ebea6` survives nowhere and its five proposals are bucketed `unknown`
(ADR-0068).

**The ticket's premise is stale.** "Nine records sit at `Proposed`, unjudged" —
all fifteen are now judged and rated. Nothing is `Rejected`, so Acceptance is
100% and says only that Ben has rejected nothing outright; Yield is the number
with something to say.

**The Fill Rate denominator was wrong in the first build** and the spec review
caught it. It counted runs that wrote to Notion, which silently excludes the
run that proposed nothing — precisely the behaviour the denominator exists to
expose. It now counts every run that reached a shortlist decision, and the
reading moved from 33% of 3 to 17% of 6.

## Evidence

One live reading on 21 September 2026, 288 rows paged from Notion:

```
profile   n   Acceptance          Taste Yield                  Fill Rate
v2       10   100% (0 unjudged)    10% of 10 rated (0 unrated)   17% of 6 run(s)
unknown   5   100% (0 unjudged)    20% of 5 rated (0 unrated)   100% of 1 run(s)
```

One of fifteen proposals is a `Rotate` or an `AOTY`. `n` is too small to read
as a trend and the ticket says so in advance; this is the instrument and its
first reading. 584 tests, `npm run check` green and offline.
