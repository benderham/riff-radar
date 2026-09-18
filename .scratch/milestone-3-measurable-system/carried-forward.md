# Carried forward from milestone 2

Things milestone 2 left open, plus one defect found while defining milestone 3. Read this before writing this milestone's tickets: one of these is the reason a Defect category exists, and two of them are what the Golden Dataset is about to exercise for the first time.

Nothing here is a decision. Where a decision was taken, it is named.

## 1. Wikipedia loses 36% of itself to truncation, and the loss lands on recent months

Measured on 18 September 2026 while establishing whether historical windows were replayable:

```
loudwire.html   424KB raw -> 47,083 chars text   -> not truncated (cap 80,000)
wikipedia.html  1.5MB raw -> 124,831 chars text  -> truncated, 44,831 chars lost
```

The loss is not evenly spread. Counting month names in the full text against the kept 80,000: January 117 -> 104, February 111 -> 93, March 148 -> 96, but June 105 -> 29, July 176 -> 55, August 140 -> 37, September 70 -> 30. The page is chronological, so truncating the tail removes the **later** months — which is exactly what a real Run queries, since the window is always backward-looking from today.

A real run asking for last week is therefore reading a Wikipedia page with roughly half of that week's entries cut out of it. The system is not silent about this: `sources.ts` sets `truncated` and raises a warning (ADR-0030). What was not known is the magnitude, or that it is biased toward the months that matter.

Deliberately not fixed here. The obvious answers — raise `MAX_SOURCE_TEXT_CHARS`, or slice the cleaned text around the window's dates before truncating rather than after — are both source-coverage work and neither is what "measurable" means. What milestone 3 does instead is refuse to let it be miscounted: ADR-0059's `unlisted` Defect exists so that a release no Source carried is separated from a release the agent failed to find.

Note that this makes the Back-test *safer* than a live run, not less safe: Loudwire is complete for every month, and Wikipedia's January-to-March coverage is its best.

Evidence: measurement above, reproducible over `fixtures/`; ADR-0062.

## 2. The step ceiling is still a lookup budget

Carried forward from milestone 1 and not closed. Milestone 2 added a second data point rather than a fix: a fourteen-day window ended `max_steps_exceeded` at twenty-six of thirty steps, twenty-three of them lookups, for $0.0294 and nothing written. Run `3e657aa3` spent ten of seventeen steps on lookups that could only repeat the same degraded answer.

ADR-0044 held the ceiling at thirty deliberately. The consequence for this milestone is a constraint rather than a task: it is why the Back-test uses weekly windows (ADR-0062), and it is what the `wasteful` Defect is for.

Evidence: `docs/evidence/milestone-2.md`; ADR-0044; `docs/diary.md`, 17 September 2026.

## 3. The degraded record's Notion caveat has never been seen in Notion

ADR-0052 has a Degraded Run state its caveat in the Notion `Rationale`, because a new property would have to exist in Ben's database before the preflight would let the Run start. Both degraded evidence runs were dry: `e480b9c1` proposed nothing and `3e657aa3` was not written. So the one part of degraded mode that survives past the terminal is the one part never observed.

Not milestone 3's subject, and cheap to close whenever a degraded Run is allowed to write.

Evidence: `docs/evidence/milestone-2.md`; `docs/diary.md`, 17 September 2026.

## 4. Two rules have never run against live data

Carried forward from milestone 1, unchanged. The EP thresholds — four tracks, twenty minutes — have never fired outside their unit tests, because no release in any evidenced Run was typed as an EP by MusicBrainz. The same is true of the Shortlist's `artists.always` guarantee.

This milestone is where that changes, and it changes by construction rather than by luck: the mutated Golden Cases are written to include a release MusicBrainz types as an EP, on both sides of both thresholds, and a release by an always-list artist. If either rule is wrong, this is the milestone that finds out.

Evidence: `.scratch/milestone-2-recoverable-system/carried-forward.md` item 5; ADR-0044.

## 5. Ranking has been observed producing nothing at all

Run `3e657aa3` shortlisted five releases and scored every one of them zero, because `matching()` in `src/domain/ranking.ts` asks whether the value contains the term, so `Reigning Phoenix Music` finds nothing in a Source's `Reigning Phoenix`.

This is a trap for the milestone rather than an item in it. It must be fixed **after** the baseline pass, not before, because it is this milestone's controlled change (ticket 01, blocked by ticket 08). Fixing it early destroys the only before-and-after comparison the milestone has.

Evidence: run `3e657aa3`; ADR-0052's second amendment; `.scratch/milestone-3-measurable-system/issues/01-label-matching-misses-abbreviations.md`.
