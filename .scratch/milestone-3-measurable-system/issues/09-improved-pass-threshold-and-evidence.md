# 09: The second reading, the threshold, and the milestone

**What to build:** the improved pass, the readiness threshold's numbers, and `docs/evidence/milestone-3.md`.

**Blocked by:** 01

**Status:** ready-for-agent

## Why

The milestone's last three criteria close here: baseline and improved compared, remaining failures and readiness threshold documented, and the four evidence artefacts delivered.

## What

**The improved pass.** The same twenty cases after ticket 01's label-matching fix, n=1. Emitted as `docs/evidence/milestone-3-improved.json`, committed. The delta is read against ticket 08's noise floor — and being a deterministic change, it should sit well outside it, which is why it was chosen over a prompt change.

The specific thing to look for: run `3e657aa3` scored all five proposals zero because `matching()` runs one way. Re-scored under the new rule, the CoreLeoni release scores non-zero. If the `misranked` count does not move, either the fix or the grader is wrong and the milestone has found something.

**The threshold's numbers.** The shape is already decided (ADR-0065): `ungrounded` and `escaped` at zero; `missed`, `spurious`, `misranked` and `wasteful` budgeted; `unlisted`, Acceptance Rate, Taste Yield and back-test recall reported only. The numbers are set **now**, from what the baseline actually did — a threshold chosen beforehand is a bar invented in order to be cleared, by the party about to be measured against it.

**The Eval Report.** `docs/evidence/milestone-3.md`, in the shape of milestone 2's, holding as sections: the Cost Summary (tokens, latency, cost per case and per pass, including harvest and noise-floor spend), the Before-and-After Comparison, the noise floor, the curation record from ticket 04 (date, rows touched, rule), and the remaining failures.

## Acceptance criteria

- [ ] Improved report committed
- [ ] Delta stated against the noise floor, with the verdict on whether it clears it
- [ ] `misranked` movement explained, whichever way it goes
- [ ] All four budget numbers set, each justified by a baseline figure
- [ ] Cost Summary covers harvest, noise floor, baseline and improved
- [ ] Curation record present: date, rows, rule
- [ ] Remaining failures listed, with what each would take to close
- [ ] Every brief criterion for milestone 3 cited with its evidence
- [ ] Diary entry appended; `npm run check` green

## Notes

ADR-0058, ADR-0065. Four artefacts, one narrative: splitting them into four files buys nothing and guarantees three go stale.

Stop here. Milestone 4 is a case study and is not this.
