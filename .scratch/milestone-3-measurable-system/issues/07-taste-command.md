# 07: Three numbers about whether it is any good

**What to build:** `scripts/taste.ts` — Acceptance Rate, Taste Yield and Shortlist Fill Rate, read from Notion.

**Blocked by:** 04

**Status:** ready-for-agent

## Why

Nine records sit at `Proposed`, unjudged. Nothing in the project measures whether the recommendations are worth having, as distinct from whether the machinery works. Ben's goal is that the share of proposals he ends up rating `Rotate`/`AOTY` rises over time — this ticket builds the instrument and takes the first reading. It cannot show the trend; at five proposals a Run, that needs months.

## What

**Acceptance Rate** — proposals whose `Status` is not rejected, over proposals. Moves without Ben listening to anything.

**Taste Yield** — proposals rated `Rotate` or `AOTY`, over proposals **rated at all**. Unrated proposals are a third bucket, reported, never folded in: a backlog is not a rejection.

**Shortlist Fill Rate** — Runs that proposed a full five, over Runs. Printed beside the other two always. Yield alone is maximised by proposing fewer, safer, better-known albums, which is the opposite of what Adjacency exists for; this is the denominator that stops the metric rewarding cowardice.

All three per `profile_version`, with **n** stated. A profile edit invalidates comparison across the boundary.

**Reading `Rating` is permitted here and only here.** `NOTION_PROPERTIES` is untouched and stays the sole source for writes and preflight. This command carries its own read-only schema naming `Status` and `Rating` and has no path that creates or patches a page (ADR-0061, amending ADR-0042).

## Acceptance criteria

- [ ] `npm run taste` prints all three per `profile_version` with n
- [ ] Unrated proposals reported as their own bucket
- [ ] Fill Rate printed unconditionally, never behind a flag
- [ ] Its read-only schema names `Rating`; `NOTION_PROPERTIES` does not
- [ ] No write path in the command; provable by inspection
- [ ] Pages to the end the way `suppressedReleases` does
- [ ] The arithmetic is pure and unit-tested; the Notion call is not in `npm test`

## Notes

ADR-0060, ADR-0061. Gates nothing. A quiet week of mediocre metal would otherwise fail a milestone for reasons unrelated to the agent.
