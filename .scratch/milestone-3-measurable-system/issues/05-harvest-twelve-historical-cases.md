# 05: Twelve weeks of 2026, recorded once

**What to build:** twelve Golden Cases harvested from historical weeks, plus the back-test metric.

**Blocked by:** 03, 04

**Status:** ready-for-agent

## Why

Measured on 18 September 2026: both Sources are **year** pages and the URL never varies with the window. `fixtures/loudwire.html` cleans to 47,083 characters against the 80,000 cap — **not truncated** — and carries all twelve months of 2026. So a January window is replayable against bytes already committed: no network, no new capture, no archive URL that does not exist.

## What

**Pick the weeks** from ticket 04's buckets: weekly windows where the Known Set holds at least one album. Weekly, not monthly — the Shortlist caps at five, so a month measures the cap, and a fourteen-day window already ended `max_steps_exceeded` at twenty-six of thirty steps.

**Harvest each once.** Run the loop against the committed Source fixtures and **live** MusicBrainz, recording the answers into the case directory. This is the only step in the milestone touching a live provider other than the model, and it is never part of a pass.

**Label eligibility only** — format, novelty, window. Never rank order or desirability (ADR-0060).

**The metric:** `hits / min(k, 5)`. Plain recall when the week holds five or fewer known albums, precision against the known pool when it holds more. No week excluded for being busy.

**Where `k > 5`, one secondary number:** how many of the matches were rated `Rotate` or `AOTY`. The cap forced a choice that week, and this is whether it chose well. Not reported where `k <= 5`, because no choice was forced and the number would be noise. Intersection on Release Identity: MusicBrainz id where both sides have one, otherwise `artistTitleIdentity` — the existing function, and the one that handles Ben's hand-entered rows carrying no MusicBrainz ids.

## Acceptance criteria

- [ ] Twelve cases under `fixtures/eval/`, each replayable offline after harvest
- [ ] Weeks chosen from the frozen Known Set, not picked by hand
- [ ] `hits / min(k, 5)` unit-tested in both regimes and at `k = 5`
- [ ] Busy weeks included, with their `k` recorded
- [ ] The `Rotate`/`AOTY` secondary number computed only where `k > 5`
- [ ] Prefer Jan–Mar where possible: `fixtures/wikipedia.html` truncates 36%, biased toward later months (carried-forward item 1)
- [ ] Harvest cost recorded for the Cost Summary

## Notes

ADR-0062. Proposals matching nothing in the Known Set are **not** defects — that is ticket 08's review queue.
