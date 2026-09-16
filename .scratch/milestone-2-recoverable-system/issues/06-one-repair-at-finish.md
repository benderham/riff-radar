# 06: A refused shortlist gets one chance to fix itself

**What to build:** When `validateShortlist` refuses, hand the errors back to the model and let it call `finish` once more. A second refusal ends the run.

**Blocked by:** —

**Status:** ready-for-agent

## Why

Validation at `finish` is all-or-nothing and `finish` ends the run, so one ineligible item among five means `validation_failed`, nothing written, and the whole run's cost spent. This happened twice in a row on 16 September 2026 on the same release, for about three cents each.

The immediate cause was fixed — the model is now told at lookup time that a release is ineligible — but the structural fault stands: the last step of a run has no way to fail softly, and a shortlist the model could trivially repair is thrown away instead.

## What

On a failed validation, push the errors back as a tool message — the same mechanism `rejectAction` already uses for an invalid action — and let the loop continue. The model may call `finish` a second time. A second refusal is `validation_failed` and the run ends.

One repair, not three. The model has already been told the item is ineligible at lookup time; a second failure means it is not listening, and further attempts buy tokens rather than a shortlist.

## Acceptance criteria

- [ ] A shortlist that fails validation returns its errors to the model rather than ending the run
- [ ] The model may call `finish` once more; a second failure ends the run at `validation_failed`
- [ ] The repair attempt is a recorded step like any other, so the trace shows the refusal, the errors handed back, and the corrected shortlist
- [ ] The repair counter is per run and is **not** the consecutive-invalid counter — a repair does not count towards `invalid_action_limit`, and an invalid action between the two `finish` calls does not consume the repair
- [ ] The guardrail is unchanged: `validateShortlist` still decides, still runs before any write, and still refuses. A test proves an unrepaired shortlist still writes nothing
- [ ] An empty shortlist is still `no_candidates` and never reaches the validator (ADR-0025) — a quiet week is not something to repair
- [ ] The step and cost ceilings still apply to the repair; a run at its budget does not get an extra call
- [ ] The repair counter is derivable on resume from the recorded `finish` steps, not stored

## Notes

This is the independent ticket. If the milestone runs long, this is the one to drop, at the cost of leaving carried-forward item 2 open.

`validation_failed` becomes rarer and therefore more meaningful: it now means the model was told twice. See ADR-0053, which amends ADR-0035.
