# 04: A resume refuses four things and inherits two

**What to build:** The guardrails around `--resume`: the four cases it must refuse, and the parent's step and cost ceilings carrying over.

**Blocked by:** 03

**Status:** done

## Why

Ticket 03 makes a resume work. This one makes it safe.

Both ceilings are per run in the code — thirty steps and USD 0.25 — and a resume is a new run row. If it starts them at zero, an interruption becomes a way to buy a bigger budget and a crash-loop a way to spend without one. The ceilings exist to bound what one *question* costs, not what one process costs, and a resume is the same question (ADR-0050).

The refusals matter for a different reason. A run half-built under one prompt and finished under another produces a trace nobody can reason about, and a later milestone's evaluation would have to exclude it from every measurement.

## What

Four refusals, each with its own message:

- the run id does not exist
- the run already has a termination reason — it is over; use a re-run
- the run has no recorded steps — that is a re-run, not a resume
- the run's prompt version, profile version or action-schema version differs from current configuration

And two inheritances: the parent's accumulated step count and its accumulated cost, both continuing against the same ceilings.

## Acceptance criteria

- [x] All four refusals, each with its own message and its own test
- [x] Step and cost ceilings are inherited from the parent; a test proves a resume cannot launder the budget
- [x] A parent that used 28 of 30 steps leaves the child two, and the child terminates at `max_steps_exceeded` accordingly
- [x] A parent that reached the cost ceiling leaves a child that terminates `budget_exceeded` before spending a token
- [x] The CLI states what the resume inherited when it starts — steps used, cost spent, what remains
- [x] Inheritance is derived from the parent's step columns, not stored separately
- [x] A chain of resumes accumulates correctly: a grandchild inherits the whole chain's spend, not just its parent's
- [x] `npm run trace` shows the chain's totals as well as each run's own

## Notes

Resuming a run that died at step 28 is very nearly pointless — it gets two steps and will probably end at the ceiling. That is correct, and the right response is a Re-run, but it will look like a broken feature the first time it happens. The CLI stating what it inherited at startup is what makes the difference between understanding it and filing a bug.

The version refusal has a cost worth accepting: editing the prompt or the taste profile invalidates every unfinished run. See ADR-0047.

## Comments

**17 September 2026, during implementation.** One criterion needed a decision
the ticket had not anticipated. "The run has no recorded steps" counts the
*chain's* steps rather than the named run's: a resume killed before its own
first step has none of its own, while its ancestors hold everything worth
continuing — and refusing it would strand the chain, because the parent it
inherited from is already closed `aborted` and is refused too. For a run that
resumed nothing the two counts are the same number, which is the case the
sentence was written about. ADR-0047 is amended to say so, and a test pins it.

Two things the reviews caught. The CLI test asserted `/resumed from <id>/`,
which the end-of-run summary matches just as well as the startup line — so the
criterion about stating the inheritance *when it starts* would have survived
deleting the wiring that meets it; it now asserts the figures and their
position. And the fixture steps used to stand a parent up at 28 of 30 carried a
null candidate list, a shape ticket 03 guarantees the system never writes.

**Found, not fixed:** `scripts/trace.ts` still has no test of its own — the pure
helpers are tested, the script body is not, so the per-run figures added here
have no regression guard. Consistent with the repo's habit and left alone.
