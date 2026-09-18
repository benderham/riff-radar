# 06: The eight cases no real week supplied

**What to build:** eight Golden Cases covering the scenarios the brief demands and history did not provide.

**Blocked by:** 03

**Status:** ready-for-agent

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

- [ ] Eight cases, each naming which brief scenario it covers
- [ ] Both EP thresholds crossed in both directions
- [ ] An always-list release reaches the Shortlist, or the case records why not
- [ ] Every label traceable to an `Eligible Release` rule in `CONTEXT.md`
- [ ] No case labels rank order or desirability
- [ ] Twenty cases total with ticket 05

## Notes

Carried-forward item 4. If either rule is wrong, this is where it is found — which is a success for the ticket and a new ticket for the rule.
