# 05: Twelve weeks of 2026, recorded once

**What to build:** twelve Golden Cases harvested from historical weeks, plus the back-test metric.

**Blocked by:** 03, 04

**Status:** done

## Why

Measured on 18 September 2026: both Sources are **year** pages and the URL never varies with the window. `fixtures/loudwire.html` cleans to 47,083 characters against the 80,000 cap — **not truncated** — and carries all twelve months of 2026. So a January window is replayable against bytes already committed: no network, no new capture, no archive URL that does not exist.

## What

**Pick the weeks** from ticket 04's buckets: weekly windows where the Known Set holds at least one album. Weekly, not monthly — the Shortlist caps at five, so a month measures the cap, and a fourteen-day window already ended `max_steps_exceeded` at twenty-six of thirty steps.

**Harvest each once.** Run the loop against the committed Source fixtures and **live** MusicBrainz, recording the answers into the case directory. This is the only step in the milestone touching a live provider other than the model, and it is never part of a pass.

**Label eligibility only** — format, novelty, window. Never rank order or desirability (ADR-0060).

**The metric:** `hits / min(k, 5)`. Plain recall when the week holds five or fewer known albums, precision against the known pool when it holds more. No week excluded for being busy.

**Where `k > 5`, one secondary number:** how many of the matches were rated `Rotate` or `AOTY`. The cap forced a choice that week, and this is whether it chose well. Not reported where `k <= 5`, because no choice was forced and the number would be noise. Intersection on Release Identity: MusicBrainz id where both sides have one, otherwise `artistTitleIdentity` — the existing function, and the one that handles Ben's hand-entered rows carrying no MusicBrainz ids.

## Acceptance criteria

- [x] Twelve cases under `fixtures/eval/`, each replayable offline after harvest — four were replayed end to end; the other eight are checked by a test that parses every manifest and resolves every file it names, which proves the recordings are *present* rather than that a replay asks for nothing else. The full proof is ticket 08's baseline pass, and a case that asks for an unrecorded URL is reported and skipped rather than ending the pass
- [x] Weeks chosen from the frozen Known Set, not picked by hand — `weeksToHarvest`, unit-tested
- [x] `hits / min(k, 5)` unit-tested in both regimes and at `k = 5`
- [x] Busy weeks included, with their `k` recorded — two of them, `k = 6` and `k = 8`; `k` is recorded by the back-test in the report rather than copied into the manifest, where it could drift from the frozen set
- [x] The `Rotate`/`AOTY` secondary number computed only where `k > 5`
- [x] Prefer Jan–Mar where possible — eleven of the twelve; the twelfth is 2026-04-03, which replaced the year-boundary week
- [x] Harvest cost recorded for the Cost Summary — `docs/evidence/milestone-3-harvest.md`, $0.2296 over the twelve

## What changed from the ticket

**The twelve are not the earliest twelve.** The week ending 2026-01-02 opens on 2025-12-27, and both Sources are 2026 year pages, so six of its seven days were never captured — it was harvested, read, and swapped for 2026-04-03. The rule is now "the earliest weeks whose whole window lies inside the Sources' year", which is a fact about the fixtures rather than a preference. The general case is carried-forward item 6: a real run between the last Friday of December and the first of January is quietly blind to most of its window, and the fix is Sources that vary with the window's years.

**`labels.ineligible` is empty in all twelve.** `eligible` is the week's Known Set, derived from the frozen file. `spurious` still fires on a shortlist item dated outside the window, which needs no label, and the eight mutated cases of ticket 06 are built for the rest of that side. The recorded lookups mean an ineligible list can be derived later with no re-harvest.

**Case slugs are the week, with no numeric prefix.** A swapped week would otherwise renumber every case after it.

## Notes

ADR-0062. Proposals matching nothing in the Known Set are **not** defects — that is ticket 08's review queue.
