# 04: Curate the Known Set, then freeze it

**What to build:** nothing. This is Ben rating eight months of Notion rows, and then a declaration.

**Blocked by:** nothing

**Status:** ready-for-human

## Why

Notion holds 272-odd hand-entered rows back to January 2026, collected before the five-item cap existed and under a looser bar — some weeks held over thirty releases and only a fraction met Ben's taste, which is why the cap was introduced. As it stands the database is a *superset* of what a capped Run should propose, so a `missed` against a January row may be the agent correctly applying the stricter rule.

This blocks case harvesting (ticket 05), so it is the milestone's long pole and the one task no agent can do.

## What

Set `Rating` on rows with a `Release Date` in January–August 2026. `Nope` carries "should not have made the cut". The Known Set becomes: `Run ID` empty (hand-entered, so uncontaminated by the agent's own writes since 16 September) **and** `Rating` anything other than `Nope`.

`OK` counts. It means the album was listened to and was fine, which is a release the agent was right to surface. `Rotate`/`AOTY` are not the bar for membership — they are a secondary number used only where a week holds more than five known albums (ADR-0063). Rows left unrated are excluded and counted, because an unrated row cannot be told apart from a `Nope`.

**Do not delete rows.** `suppressedReleases` reads the whole database unfiltered, deliberately — every deleted row becomes proposable again, which trades a live guarantee for a reporting convenience (ADR-0063).

Then freeze. Record in a note for the Eval Report: the date, the number of rows touched, and the rule applied.

## Acceptance criteria

- [ ] Jan–Aug 2026 rows carry a Rating
- [ ] No rows deleted
- [ ] `Run ID` non-empty rows identified and excluded from the Known Set
- [ ] The freeze declared: date, row count, rule
- [ ] Weeks bucketed by `Release Date`, with `k` per week, so ticket 05 can pick its twelve
- [ ] Count of rows left unrated recorded, for the Eval Report
- [ ] Not revised after any result is seen

## Notes

ADR-0063. The leakage rule is the point of the freeze: curating while designing the thing it measures is how a benchmark gets gamed without anyone intending it. Declared, it is legitimate; iterative, it is meaningless with no way to tell from outside.

A risk worth watching: if a lot of rows stay unrated, the back-test has an n too small to read. Report it with its n rather than loosening the rule.
