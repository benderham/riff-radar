# 07: The milestone, evidenced by a kill and a resume

**What to build:** `docs/evidence/milestone-2.md` and three exported traces that close all seven acceptance criteria.

**Blocked by:** 01, 02, 03, 04, 05, 06

**Status:** done

## Why

The brief asks for a deliberately interrupted and resumed trace among its delivery evidence. Two of this milestone's seven boxes are already true and need citing rather than building; the other five need a run that actually broke.

## What

Two evidence runs — two stories, four exported traces, in the shape of `docs/evidence/milestone-1-run-*.json`.

**Evidence run 1 — the interruption and its resume.** Start a run, let it fetch sources and spend a few lookups, kill the process mid-loop. Then `--resume` that run id: it must not repeat the completed steps, must inherit the parent's spend, and must chain to its parent in `npm run trace`. Both traces exported.

**Evidence run 2 — the mid-write kill and its re-run.** Kill a run between two `createPage` calls, leaving some pages in Notion and `notion_write_performed = 0`. Then re-run the same window: it must propose only what is left, with no duplicates. Both traces exported, with the Notion database state before and after.

## Acceptance criteria

Each criterion cites its evidence:

- [x] **Actions use defined schemas** — cite `src/tools.ts` and the `validateAction` tests. Already true (ADR-0016)
- [x] **Every model response is validated** — cite the same, the extraction schema at `src/clients/sources.ts:133`, and ticket 06's repair proving the `finish` path refuses and recovers
- [x] **Explicit categories** — a real run's trace shows a non-null `failure_category`, and a `GROUP BY` over it is included to show the count is a query and not a parse
- [x] **Bounded retry** — a trace shows `attempts > 1` on a real call, with the latency it cost
- [x] **Checkpointed** — every step of evidence run 1's parent has a non-null `candidates_after`
- [x] **Resume** — evidence run 1's pair, with the step counts proving no completed work was repeated and the inherited budget shown
- [x] **No duplicate Notion records** — evidence run 2's pair, with the Notion database state before and after, showing the remaining releases proposed and nothing proposed twice
- [ ] Degraded mode is evidenced — from Ben's own machine, where MusicBrainz is blocked, which is the one place the real failure reproduces for free
- [x] Latency, token use and estimated cost for all four traces, as milestone 1's evidence file reports them
- [x] Anything still carried forward is appended to `carried-forward.md` with its evidence, for milestone 3

## Notes

The mid-write kill is the fiddly one: it needs an interruption between two `createPage` calls against Ben's real database, and it leaves rows behind by design — those rows are the evidence, so do not tidy them until the re-run has used them. If staging it live proves unreasonable, a fake that throws on the third create proves the same mechanism; the evidence file must say which was done and why.

Degraded mode is the opposite: it is *hardest* to reproduce in the sandbox and free to reproduce on Ben's machine. Run it there.

Do not begin milestone 3. See the completion protocol in `AGENTS.md`.

## What was done

Four traces under `docs/evidence/`, and `docs/evidence/milestone-2.md` closing each criterion against them. Evidence run 1 went as the ticket described: `c4d95544` killed at step six mid-loop, `51f702ca` resumed by run id, inheriting six steps and $0.0062, repeating nothing and chaining in `npm run trace`.

Evidence run 2 went differently and the file says so. `d2b59538` was killed during its write, but after the fifth create rather than between two, so it leaves five correct rows behind and a run row that denies writing — which is the state the criterion is about, and the re-run `d5d6e816` suppresses all five and proposes none of them twice. What that pair cannot show is a shortlist split across two runs. A second live attempt at a between-creates kill ended `max_steps_exceeded` before it reached `finish`, and a third was not bought at three cents a try; the remainder case is closed instead by the fake the milestone's testing decisions asked for — *a run killed part way through its write leaves rows the next run suppresses*, which stands the killed state up in a real store and asserts the next run proposes the third release and only the third. The kill itself cannot be staged in process: every failure a fake can produce triggers the compensating rollback, and a killed process rolls nothing back.

**Still open:** degraded mode, which needs an export from Ben's machine; the command is in the evidence file. Four items are appended to `carried-forward.md`, the first of which is the step ceiling breaking a *re-run* rather than a first run.
