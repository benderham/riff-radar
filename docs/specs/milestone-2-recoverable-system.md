# Milestone 2: Recoverable system

The definition agreed on 16 September 2026. Scope comes from `docs/project-brief.md`; the reasoning behind each choice is in `docs/decisions.md` (ADR-0046 to ADR-0054); the vocabulary is in `CONTEXT.md`.

**The specification itself is `.scratch/milestone-2-recoverable-system/spec.md`, with seven tickets beside it.** This file is a pointer, deliberately. Milestone 1 has a full specification here *and* one in the tracker, and two decisions have since had to correct both — ADR-0022 and ADR-0041 each note the copy in this directory needed updating too. One document, corrected once.

Milestone 1's entry earns its place for a reason this milestone has no equivalent of: it carries the manual-versus-agent workflow description that the brief asks for as a deliverable, which is not a ticket specification at all.

## What the milestone is

Milestone 1 produced a run that works and a run that cannot survive anything going wrong. A failure at step twenty costs the nineteen steps before it, failures are described in prose nobody can count, and the promise that repeated work cannot duplicate a Notion record has never been tested against a run that died half way through writing.

This milestone makes a run survivable: failures get names, the ones worth retrying are retried, every step is a Checkpoint the run can be picked up from, and the Notion promise is evidenced rather than argued.

## Outcomes

It passes when all seven hold, each closed by evidence:

1. Agent actions use defined schemas. *Already true (ADR-0016); cited, not built.*
2. Every model response is validated. *Already true; the repair at `finish` additionally proves the last of the three paths refuses and recovers.*
3. External failures have explicit categories.
4. External calls retry with bounded backoff.
5. State is checkpointed after each step.
6. An interrupted run resumes from its checkpoint.
7. Repeated runs cannot create duplicate Notion records, including after a kill part way through a write.

## Evidence

Two runs, two stories, four exported traces:

1. **The interruption and its Resume.** A run killed mid-loop, then resumed by run id: it must not repeat completed work, must inherit the parent's spend, and must chain to its parent.
2. **The mid-write kill and its Re-run.** A run killed between two Notion page creations, then the same window re-run: it must propose only what is left, with the database state shown before and after.

## Tickets

`.scratch/milestone-2-recoverable-system/issues/`

| # | Ticket | Blocked by |
| - | ------ | ---------- |
| 01 | Failure categories | — |
| 02 | Bounded retry in the HTTP adapter | 01 |
| 03 | Checkpointed state | 01 |
| 04 | Resume an interrupted run | 03 |
| 05 | MusicBrainz degraded mode | 01, 02 |
| 06 | One repair at `finish` | — |
| 07 | Milestone evidence | 01–06 |

01 first, because three others need the category function. 06 is blocked by nothing and is the one to drop if the milestone runs long, at the cost of leaving carried-forward item 2 open.

## Out of scope

The step ceiling as a lookup budget, the two rules that have never run against live data, the human verdict on the nine proposed records, and a migration system. Each is named with its reasoning in the tracker specification, so it is deferred rather than forgotten.
