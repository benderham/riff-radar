# The harvested twelve: what they cost, and what they replay as

Twelve Golden Cases harvested from historical weeks on 18 September 2026 (ticket 05, ADR-0062). Each is one run of the real loop against the committed Source pages and **live MusicBrainz**, with every MusicBrainz answer recorded into the case. They are hermetic from then on: a pass replays them with no network but the model.

## The weeks, and why these twelve

The earliest twelve weeks of the frozen Known Set whose seven-day window lies wholly inside 2026 (`weeksToHarvest`). Not chosen by hand: the earliest weeks are where `fixtures/wikipedia.html` is least damaged by its 36% truncation, and the whole-window rule excludes the week ending 2026-01-02, which opens on 2025-12-27 against Source pages that only carry 2026 (carried-forward item 6). Two weeks are above the five-item cap, which is what the `hits / min(k, 5)` precision regime is read against.

## Harvest cost

| Week | `k` | Termination | Steps | Wall clock | Cost | MusicBrainz answers |
|---|---|---|---|---|---|---|
| 2026-01-09 | 2 | `completed` | 20 | 340s | $0.0198 | 59 |
| 2026-01-16 | 4 | `completed` | 20 | 416s | $0.0094 | 86 |
| 2026-01-23 | 1 | `completed` | 22 | 397s | $0.0218 | 80 |
| 2026-01-30 | 3 | `completed` | 14 | 243s | $0.0173 | 117 |
| 2026-02-06 | 6 | `completed` | 19 | 254s | $0.0202 | 84 |
| 2026-02-13 | 4 | `completed` | 19 | 330s | $0.0185 | 67 |
| 2026-02-20 | 4 | `completed` | 27 | 444s | $0.0267 | 104 |
| 2026-02-27 | 3 | `completed` | 21 | 451s | $0.0170 | 82 |
| 2026-03-13 | 3 | `completed` | 25 | 428s | $0.0228 | 84 |
| 2026-03-20 | 4 | `completed` | 18 | 300s | $0.0187 | 102 |
| 2026-03-27 | 3 | `completed` | 20 | 391s | $0.0203 | 124 |
| 2026-04-03 | 8 | `completed` | 19 | 214s | $0.0171 | 54 |
| **Total** | | | **244** | **70m** | **$0.2296** | **1,043** |

A further $0.0305 was spent and discarded: the week ending 2026-01-02, harvested before the whole-window rule existed, and a first harvest of 2026-01-16 thrown away when the recording deduplication was fixed. Total spend for the ticket, **$0.2601**, against an estimate of $0.30–0.40.

All twelve **completed**. None hit the thirty-step ceiling, which is worth recording against milestone 2, where a fourteen-day window ended `max_steps_exceeded` at twenty-six steps: a weekly window is inside the budget with room to spare (ADR-0062, carried-forward item 2).

The whole set is 5.3MB, of which the two shared Source pages are counted once.

## Replayed offline

Four cases were replayed through `npm run eval` after harvest, with no network but the model. Nothing else was needed: every MusicBrainz URL the replays asked for was already recorded, including URLs the harvest run itself never requested — the seeding pass is what buys that.

The other eight are checked offline instead, by a test that parses every manifest and resolves every file it names. That proves the recordings are present, not that a replay asks for nothing else; the model is the one thing a pass does not freeze. Ticket 08's baseline pass is where all twelve replay, and a case asking for an unrecorded URL is reported and skipped rather than ending the pass.

| Case | Replay | Defects | Back-test |
|---|---|---|---|
| 2026-01-16 | `completed`, 17 steps, $0.0086 | 1 `unlisted`, 1 `missed` | 2/4 = **0.50** (k 4) |
| 2026-01-23 | `completed`, 25 steps, $0.0162 | none | 1/1 = **1.00** (k 1) |
| 2026-02-06 | `completed`, 28 steps, $0.0234 | 3 `unlisted`, 2 `missed`, 1 `wasteful` | 1/5 = **0.20** (k 6, 1 rated `Rotate`/`AOTY`) |
| 2026-04-03 | `completed`, 19 steps, $0.0084 | 4 `unlisted`, 1 `missed` | 3/5 = **0.60** (k 8, 0 rated `Rotate`/`AOTY`) |

These are not a baseline. Four cases, one sample each, on a model whose own variance moved a single case's cost by a factor of two in ticket 03 — the baseline is ticket 08, over all twenty.

## The one number worth reading now

**Eight of the nineteen releases labelled eligible across those four weeks were carried by no Source page at all.** That is `unlisted` doing exactly the job ADR-0059 created it for: without the word, each of those would have been counted as the agent failing to find a release that was never in front of it, and the fix would have been attempted in the wrong half of the system.

Some of it is the Wikipedia truncation of carried-forward item 1. Some of it is format: three of the eight are EPs, and a calendar that lists albums may never have carried them. Either way it is Source coverage, and it is now measured rather than suspected.

Two smaller things the replays surfaced, both recorded rather than acted on:

- `wasteful` fired once, on 28 steps against the provisional budget of 25. The per-case budget is uniform and provisional by design; ticket 09 sets it from the baseline rather than from a guess (ADR-0065).
- `missed` fired on releases the eligibility rules may themselves refuse — the ten EPs in the Known Set are labelled eligible because membership is not eligibility. The recorded lookups are what a later pass can correct that from, with no re-harvest.
