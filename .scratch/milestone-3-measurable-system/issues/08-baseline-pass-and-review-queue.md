# 08: The baseline, the noise floor, and one pass of human labelling

**What to build:** the baseline report, the published noise floor, and the review queue Ben works through once.

**Blocked by:** 05, 06

**Status:** ready-for-agent

## Why

Nothing in this milestone means anything without a number taken before anything was improved. This ticket takes it.

It is also the gate on ticket 01. **The label-matching fix must not ship before this ticket completes** — it is the milestone's only controlled change, and fixing it early destroys the comparison. It is a four-line change and it will be tempting to make in passing.

## What

**The baseline pass.** Twenty cases, n=1, roughly $0.26. Emitted as `docs/evidence/milestone-3-baseline.json`, committed. Pins the dataset, prompt version, profile version and model identifier.

**The noise floor.** Five fixed cases, three samples each, roughly $0.15, run **once**. Published as a range per metric. Every later pass is n=1 and every delta is read against this; a difference smaller than the floor is not a result. Three samples on every case forever would triple the cost of every pass to re-measure something that moves rarely (ADR-0058).

**The review queue.** The back-test's non-matches — proposals matching nothing in the Known Set — are printed once for Ben. Absence from Notion is missing evidence, never proof an album is bad, so an unlabelled non-match counts for nothing. A non-match Ben marks "correct, I had not heard of it" is what turns the reference set from what he found into what he would have wanted. Labels persist as case data.

This is the only human labelling step in the milestone and it happens **once**, not per pass.

## Acceptance criteria

- [ ] Baseline report committed, with versions pinned
- [ ] Noise floor published as a range per metric, from 5 cases x 3 samples
- [ ] Per-case Defect counts, Termination Reasons, tokens, latency and cost in the report
- [ ] Back-test recall reported over the Known Set (everything but `Nope`), with n, plus the count of rows left unrated
- [ ] The `Rotate`/`AOTY` secondary number reported for the weeks where `k > 5`
- [ ] Review queue worked through once; labels committed
- [ ] Ticket 01 still unshipped when this closes — check `git log src/domain/ranking.ts`
- [ ] Actual pass cost recorded for the Cost Summary

## Notes

ADR-0058, ADR-0062, ADR-0063. Unblocks ticket 01.
