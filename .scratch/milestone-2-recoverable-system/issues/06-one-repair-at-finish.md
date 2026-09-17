# 06: A refused shortlist gets one chance to fix itself

**What to build:** When `validateShortlist` refuses, hand the errors back to the model and let it call `finish` once more. A second refusal ends the run.

**Blocked by:** —

**Status:** done

## Why

Validation at `finish` is all-or-nothing and `finish` ends the run, so one ineligible item among five means `validation_failed`, nothing written, and the whole run's cost spent. This happened twice in a row on 16 September 2026 on the same release, for about three cents each.

The immediate cause was fixed — the model is now told at lookup time that a release is ineligible — but the structural fault stands: the last step of a run has no way to fail softly, and a shortlist the model could trivially repair is thrown away instead.

## What

On a failed validation, push the errors back as a tool message — the same mechanism `rejectAction` already uses for an invalid action — and let the loop continue. The model may call `finish` a second time. A second refusal is `validation_failed` and the run ends.

One repair, not three. The model has already been told the item is ineligible at lookup time; a second failure means it is not listening, and further attempts buy tokens rather than a shortlist.

## Acceptance criteria

- [x] A shortlist that fails validation returns its errors to the model rather than ending the run
- [x] The model may call `finish` once more; a second failure ends the run at `validation_failed`
- [x] The repair attempt is a recorded step like any other, so the trace shows the refusal, the errors handed back, and the corrected shortlist
- [x] The repair counter is per run and is **not** the consecutive-invalid counter — a repair does not count towards `invalid_action_limit`, and an invalid action between the two `finish` calls does not consume the repair
- [x] The guardrail is unchanged: `validateShortlist` still decides, still runs before any write, and still refuses. A test proves an unrepaired shortlist still writes nothing
- [x] An empty shortlist is still `no_candidates` and never reaches the validator (ADR-0025) — a quiet week is not something to repair
- [x] The step and cost ceilings still apply to the repair; a run at its budget does not get an extra call
- [x] The repair counter is derivable on resume from the recorded `finish` steps, not stored

## Notes

This is the independent ticket. If the milestone runs long, this is the one to drop, at the cost of leaving carried-forward item 2 open.

`validation_failed` becomes rarer and therefore more meaningful: it now means the model was told twice. See ADR-0053, which amends ADR-0035.

## Comments

**17 September 2026, during implementation.** Implemented on the branch behind PR #18. Every criterion
is met as written, with two worth spelling out.

The repair counter is a boolean rather than a count. Nothing ever counted with
it — the only reader asked whether it was zero — and a budget that can only be
one or gone reads better as the fact it is. `Replayed.repairSpent` is derived
from the position of the first refused finish in the chain's trace, which the
replay already computes, so the criterion it answers ("derivable on resume from
the recorded `finish` steps, not stored") is met in substance and the word
"counter" is the only casualty. No new step kind and no new column were needed:
a refused finish is a `finish` step with a non-null `error`, and one that ended
its run has nothing to say there.

Two edges neither the ticket nor ADR-0053 anticipated, both settled in the ADR.
A trace can hold *two* refused finishes — the repair and the second refusal that
ended the run — because both record the same errors; only the first ever
answered the model, so the replay identifies it by position. Both reviews caught
this, and without it a resumed chain would have replayed an invitation to try
again for a repair already spent. And where this meets ADR-0025 the quiet week
wins: a model that answers the repair by dropping every item ends
`no_candidates`, not `validation_failed`, because dropping items is exactly what
the repair is for. So `validation_failed` now means the model was told twice and
still named something ineligible — a narrower claim than the ticket's "the model
was told twice", and the more useful one.

Four existing tests changed. Each ended on a `finish` whose shortlist the
validator silently refused and relied on that refusal ending the run in one step
while testing something else — durations, the stable prefix, token accounting,
two runs in one database. They end on an empty shortlist instead, so their
arithmetic is unchanged and their subject is not.

Evidence: 482 tests, `npm run check` green, and four mutants of the repair
condition and its inheritance killed by the new tests.
