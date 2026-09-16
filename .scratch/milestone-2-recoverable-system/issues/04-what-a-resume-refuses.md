# 04: A resume refuses four things and inherits two

**What to build:** The guardrails around `--resume`: the four cases it must refuse, and the parent's step and cost ceilings carrying over.

**Blocked by:** 03

**Status:** ready-for-agent

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

- [ ] All four refusals, each with its own message and its own test
- [ ] Step and cost ceilings are inherited from the parent; a test proves a resume cannot launder the budget
- [ ] A parent that used 28 of 30 steps leaves the child two, and the child terminates at `max_steps_exceeded` accordingly
- [ ] A parent that reached the cost ceiling leaves a child that terminates `budget_exceeded` before spending a token
- [ ] The CLI states what the resume inherited when it starts — steps used, cost spent, what remains
- [ ] Inheritance is derived from the parent's step columns, not stored separately
- [ ] A chain of resumes accumulates correctly: a grandchild inherits the whole chain's spend, not just its parent's
- [ ] `npm run trace` shows the chain's totals as well as each run's own

## Notes

Resuming a run that died at step 28 is very nearly pointless — it gets two steps and will probably end at the ceiling. That is correct, and the right response is a Re-run, but it will look like a broken feature the first time it happens. The CLI stating what it inherited at startup is what makes the difference between understanding it and filing a bug.

The version refusal has a cost worth accepting: editing the prompt or the taste profile invalidates every unfinished run. See ADR-0047.
