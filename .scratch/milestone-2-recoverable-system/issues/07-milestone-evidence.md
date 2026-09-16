# 07: The milestone, evidenced by a kill and a resume

**What to build:** `docs/evidence/milestone-2.md` and three exported traces that close all seven acceptance criteria.

**Blocked by:** 01, 02, 03, 04, 05, 06

**Status:** ready-for-agent

## Why

The brief asks for a deliberately interrupted and resumed trace among its delivery evidence. Two of this milestone's seven boxes are already true and need citing rather than building; the other five need a run that actually broke.

## What

Two evidence runs — two stories, four exported traces, in the shape of `docs/evidence/milestone-1-run-*.json`.

**Evidence run 1 — the interruption and its resume.** Start a run, let it fetch sources and spend a few lookups, kill the process mid-loop. Then `--resume` that run id: it must not repeat the completed steps, must inherit the parent's spend, and must chain to its parent in `npm run trace`. Both traces exported.

**Evidence run 2 — the mid-write kill and its re-run.** Kill a run between two `createPage` calls, leaving some pages in Notion and `notion_write_performed = 0`. Then re-run the same window: it must propose only what is left, with no duplicates. Both traces exported, with the Notion database state before and after.

## Acceptance criteria

Each criterion cites its evidence:

- [ ] **Actions use defined schemas** — cite `src/tools.ts` and the `validateAction` tests. Already true (ADR-0016)
- [ ] **Every model response is validated** — cite the same, the extraction schema at `src/clients/sources.ts:133`, and ticket 06's repair proving the `finish` path refuses and recovers
- [ ] **Explicit categories** — a real run's trace shows a non-null `failure_category`, and a `GROUP BY` over it is included to show the count is a query and not a parse
- [ ] **Bounded retry** — a trace shows `attempts > 1` on a real call, with the latency it cost
- [ ] **Checkpointed** — every step of evidence run 1's parent has a non-null `candidates_after`
- [ ] **Resume** — evidence run 1's pair, with the step counts proving no completed work was repeated and the inherited budget shown
- [ ] **No duplicate Notion records** — evidence run 2's pair, with the Notion database state before and after, showing the remaining releases proposed and nothing proposed twice
- [ ] Degraded mode is evidenced — from Ben's own machine, where MusicBrainz is blocked, which is the one place the real failure reproduces for free
- [ ] Latency, token use and estimated cost for all four traces, as milestone 1's evidence file reports them
- [ ] Anything still carried forward is appended to `carried-forward.md` with its evidence, for milestone 3

## Notes

The mid-write kill is the fiddly one: it needs an interruption between two `createPage` calls against Ben's real database, and it leaves rows behind by design — those rows are the evidence, so do not tidy them until the re-run has used them. If staging it live proves unreasonable, a fake that throws on the third create proves the same mechanism; the evidence file must say which was done and why.

Degraded mode is the opposite: it is *hardest* to reproduce in the sandbox and free to reproduce on Ben's machine. Run it there.

Do not begin milestone 3. See the completion protocol in `AGENTS.md`.
