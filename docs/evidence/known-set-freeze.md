# The Known Set, frozen 18 September 2026

The reference set the Back-test measures coverage against (ADR-0062), curated by Ben and frozen before any baseline pass was run (ADR-0063). Produced by `npm run known-set`, which reads the Notion database and writes the set itself to `known-set.json` — gitignored, because a list of the albums Ben likes is taste data and `AGENTS.md` says it is not committed. What is committed is this record: the date, the rows, the rule, and `k` per week.

**The rule.** A row is a member if its `Run ID` is empty — hand-entered, so uncontaminated by the agent's own writes since 16 September — and its `Rating` is anything other than `Nope`. `OK` counts. Rows left unrated are excluded and counted, because an unrated row cannot be told apart from a `Nope`. No rows were deleted: `suppressedReleases` reads the whole database unfiltered, so a deleted row becomes proposable again.

**What it holds.**

| | |
|---|---|
| Rows read | 288 |
| Rows carrying a Rating | 149 |
| Members | 120 |
| Weeks holding at least one | 33 |
| Weeks holding more than five | 5 |
| Excluded: unrated | 139 |
| Excluded: `Nope` | 14 |
| Excluded: agent-written (`Run ID` set) | 15 |
| Excluded: undated or unidentifiable | 0 |

Ratings were set to 18 September, past the January–August the ticket asked for, so the last two weeks of the set are September.

**`k` per week.** The whole database was read, unfiltered — no date filter was applied, and none was needed: the earliest member falls in the week ending 2026-01-02 and the latest in the week ending 2026-09-11.

| Week ending | `k` | | Week ending | `k` | | Week ending | `k` |
|---|---|---|---|---|---|---|---|
| 2026-01-02 | 1 | | 2026-03-27 | 3 | | 2026-07-03 | 4 |
| 2026-01-09 | 2 | | 2026-04-03 | 8 | | 2026-07-10 | 6 |
| 2026-01-16 | 4 | | 2026-04-10 | 6 | | 2026-07-17 | 14 |
| 2026-01-23 | 1 | | 2026-04-17 | 2 | | 2026-07-24 | 4 |
| 2026-01-30 | 3 | | 2026-04-24 | 3 | | 2026-07-31 | 5 |
| 2026-02-06 | 6 | | 2026-05-01 | 1 | | 2026-08-07 | 5 |
| 2026-02-13 | 4 | | 2026-05-08 | 1 | | 2026-08-21 | 3 |
| 2026-02-20 | 4 | | 2026-05-15 | 1 | | 2026-08-28 | 5 |
| 2026-02-27 | 3 | | 2026-05-22 | 1 | | 2026-09-04 | 3 |
| 2026-03-13 | 3 | | 2026-06-05 | 3 | | 2026-09-11 | 1 |
| 2026-03-20 | 4 | | 2026-06-19 | 1 | | | |
| | | | 2026-06-26 | 5 | | | |

**The five weeks the cap forced a choice in.** ADR-0063's secondary number is reported only where `k > 5`, because below the cap no choice was forced and the number would be noise.

| Week ending | `k` | Rated `Rotate` or `AOTY` |
|---|---|---|
| 2026-02-06 | 6 | 2 |
| 2026-04-03 | 8 | 1 |
| 2026-04-10 | 6 | 1 |
| 2026-07-10 | 6 | 2 |
| 2026-07-17 | 14 | 3 |

A week is named by the Friday its seven-day window closes on, because `resolveWindow(now, 7)` is the six days before `now` plus `now`: a Friday-morning run covers Saturday through Friday and holds exactly one release Friday. The bucket's name is therefore the `now` a weekly Golden Case is run at.

**The n, stated rather than improved.** 139 of 288 rows — 48% — were left unrated and are excluded. That is the risk ticket 04 named, and the response ADR-0063 prescribes is to publish the n rather than loosen the rule that produced it. What remains is 120 members over 33 weeks, of which ticket 05 needs twelve. Twelve of those weeks fall in January–March, which is where `fixtures/wikipedia.html` is least affected by its 36% truncation (carried-forward item 1), so the preference ticket 05 states can be satisfied exactly.

**One thing the reader of a Back-test number needs.** Ten of the 120 members are EPs by their own titles, and an EP is eligible only if it carries four tracks and twenty minutes (`eligibility.ts`). So a week where the agent misses an EP may be the agent correctly refusing it, which is the superset problem this ticket names applied to format rather than to taste. Membership is not eligibility: ticket 05 labels eligibility per case, and that is where the distinction is drawn.

**Reproducing it, and what that must not become.** `npm run known-set` re-reads Notion and rewrites `known-set.json`, so the Back-test can be re-derived on Ben's machine rather than from a file nobody can check. The hazard is the other side of the same coin: rating more rows and re-running would silently produce a *different* reference set under the same declaration. Ticket 05 picks its twelve weeks from the set frozen here, and any later re-run is a new freeze with a new date and a new record.

**Not revised after a result.** No pass has been run against these cases. This file is the declaration; a later change to the rule or the ratings would be a new freeze with a new date, not an edit to this one.
