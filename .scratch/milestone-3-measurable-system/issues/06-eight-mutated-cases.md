# 06: The eight cases no real week supplied

**What to build:** eight Golden Cases covering the scenarios the brief demands and history did not provide.

**Blocked by:** 03

**Status:** done

## Why

The brief requires the dataset to cover normal, missing, duplicate, ambiguous, conflicting and failed-tool scenarios. Twelve harvested weeks give normal and missing for free and are unlikely to give the rest.

Two rules have also never fired outside a unit test in any Run ever made: the EP thresholds (four tracks, twenty minutes) and the Shortlist's `artists.always` guarantee. This ticket makes them fire by construction rather than by luck.

## What

Eight cases, hand-built by mutating harvested ones:

- **duplicate** — the same release from both Sources under different spellings.
- **ambiguous** — an artist name matching several MusicBrainz artists.
- **conflicting** — two Sources stating different release dates (Date Disagreement: every stated date kept, none chosen).
- **failed-tool** — MusicBrainz `transient` throughout, driving degraded mode; and a second where it recovers after one failure.
- **EP boundary** — a release typed EP on each side of both thresholds.
- **always-list** — a release by an artist on `artists.always`.
- **unverified** — a release MusicBrainz has never heard of.

Labels are **eligibility only**. Any case whose label needs an opinion belongs in the harvested twelve or nowhere — these are written by the same party being measured, which is a real conflict and is contained by labelling against a rule in `CONTEXT.md` rather than a judgement.

## Acceptance criteria

- [x] Eight cases, each naming which brief scenario it covers — the table in `fixtures/eval/README.md`
- [x] Both EP thresholds crossed in both directions — `06-ep-boundary`, 3 tracks and 4-at-18-minutes below, 4-at-21 and 6-at-45 above, asserted in `scripts/eval.test.ts` from the case's own recordings
- [x] An always-list release reaches the Shortlist, or the case records why not — `07-always-list` puts seven eligible releases against the cap of five, six of them scoring and the always-list one not; it replayed `completed` with a full five and no `missed`
- [x] Every label traceable to an `Eligible Release` rule in `CONTEXT.md` — eleven of the sixteen labels are re-derived by `isEligible` in `npm test` from the case's own recordings; the five MusicBrainz cannot settle are proved by replay
- [x] No case labels rank order or desirability — `labels` carries eligibility only, as it does in the twelve
- [x] Twenty cases total with ticket 05 — twenty plus `00-smoke`, asserted

## Notes

Carried-forward item 4. If either rule is wrong, this is where it is found — which is a success for the ticket and a new ticket for the rule.

## What it found

Two things, both written up rather than fixed here.

**Identification is first-match-wins.** `02-ambiguous` as first written put a
2011 namesake ahead of the 2026 release at the same score, and the run took it,
judged it a reissue and dropped a release the case labelled eligible. The case
was reordered; the weakness is carried-forward item 7, and it wants its own
case, which is the one that was reordered.

**A recording could not express a recovery.** The response format was stateless,
so "MusicBrainz recovers after one failure" could not be written at all. A
recording may now be a sequence (ADR-0067). `05-recovers` shows the run asking
again and the release surviving.

Neither EP threshold nor the always-list guarantee turned out to be wrong. They
had simply never run.

Two cases were rebuilt after review, because both were passing without testing
anything. `07-always-list` carried three eligible releases against a cap of
five, so no choice was ever forced and a build that ignored `artists.always`
would have replayed identically; it now carries seven, six of which score.
`03-conflicting` had MusicBrainz dating both releases, and a release group's
own date settles eligibility by itself — so the Sources' disagreement never
reached the rule. Both releases are unverified now, which is the only
arrangement where a stated date decides anything.

## Evidence

Eight replays on 21 September 2026, one per case, $0.0211 for the eight, all
`completed`, no defects in any of them, and a further $0.0137 on the replays
that the rebuilt cases and an over-engineering review superseded. What the silence is worth per case is
written up in `fixtures/eval/README.md`, including the two cases where it is
worth less than the others. The reports were not committed: ticket 08's
baseline runs all twenty, and that is the pass the milestone reports.
