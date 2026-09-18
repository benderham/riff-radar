# 04: Curate the Known Set, then freeze it

**What to build:** nothing. This is Ben rating eight months of Notion rows, and then a declaration.

**Blocked by:** nothing

**Status:** done

## Why

Notion holds 272-odd hand-entered rows back to January 2026, collected before the five-item cap existed and under a looser bar — some weeks held over thirty releases and only a fraction met Ben's taste, which is why the cap was introduced. As it stands the database is a *superset* of what a capped Run should propose, so a `missed` against a January row may be the agent correctly applying the stricter rule.

This blocks case harvesting (ticket 05), so it is the milestone's long pole and the one task no agent can do.

## What

Set `Rating` on rows with a `Release Date` in January–August 2026. `Nope` carries "should not have made the cut". The Known Set becomes: `Run ID` empty (hand-entered, so uncontaminated by the agent's own writes since 16 September) **and** `Rating` anything other than `Nope`.

`OK` counts. It means the album was listened to and was fine, which is a release the agent was right to surface. `Rotate`/`AOTY` are not the bar for membership — they are a secondary number used only where a week holds more than five known albums (ADR-0063). Rows left unrated are excluded and counted, because an unrated row cannot be told apart from a `Nope`.

**Do not delete rows.** `suppressedReleases` reads the whole database unfiltered, deliberately — every deleted row becomes proposable again, which trades a live guarantee for a reporting convenience (ADR-0063).

Then freeze. Record in a note for the Eval Report: the date, the number of rows touched, and the rule applied.

## Acceptance criteria

- [x] Jan–Aug 2026 rows carry a Rating — as far as Ben rated them, and to 18 September rather than August; 139 of 288 left unrated and excluded
- [x] No rows deleted
- [x] `Run ID` non-empty rows identified and excluded from the Known Set — 15
- [x] The freeze declared: date, row count, rule — `docs/evidence/known-set-freeze.md`
- [x] Weeks bucketed by `Release Date`, with `k` per week, so ticket 05 can pick its twelve — 33 weeks, 12 of them in January–March
- [x] Count of rows left unrated recorded, for the Eval Report — 139
- [x] Not revised after any result is seen — no pass has been run

## What was built after all

`npm run known-set` and `src/domain/known-set.ts`. The rating was Ben's and could not be automated; bucketing 288 rows by week, applying the membership rule and counting the exclusions is arithmetic, and doing it by hand would have been both slower and unrepeatable. The script is read-only and names `Rating` in its own schema, which ADR-0061 permits and `NOTION_PROPERTIES` still does not. The set itself is written to a gitignored `known-set.json`, because it is taste data; the committed record is counts.

## Notes

ADR-0063. The leakage rule is the point of the freeze: curating while designing the thing it measures is how a benchmark gets gamed without anyone intending it. Declared, it is legitimate; iterative, it is meaningless with no way to tell from outside.

A risk worth watching: if a lot of rows stay unrated, the back-test has an n too small to read. Report it with its n rather than loosening the rule.
