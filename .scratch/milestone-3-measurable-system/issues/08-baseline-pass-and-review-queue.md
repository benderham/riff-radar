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
- [ ] The shortlist each case proposed, recorded per case in the report (amendment, 21 September 2026)
- [ ] Back-test recall reported over the Known Set (everything but `Nope`), with n, plus the count of rows left unrated
- [ ] The `Rotate`/`AOTY` secondary number reported for the weeks where `k > 5`
- [ ] Review queue worked through once; labels committed
- [ ] Ticket 01 still unshipped when this closes — check `git log src/domain/ranking.ts`
- [ ] Actual pass cost recorded for the Cost Summary

## Amendment — 21 September 2026: the report records what was proposed

`CaseResult` carries `defects`, `backtest`, and the cost and latency numbers. None of them carry the albums. `BacktestResult` is `weekEnding`, `k`, `hits`, `score` and `preferred` — counts. A `Finding` names a `release`, so an album that tripped a grader appears and an album that behaved does not. A committed report therefore cannot be read to find out what a pass actually proposed.

Found while reviewing ticket 05, where the same absence is total: the twelve harvest runs wrote their traces to `openStore(':memory:')` (`scripts/harvest.ts:204`) and discarded them at exit, and a case records `labels.eligible` — the answer key — rather than the answers. The recorded MusicBrainz URLs are no substitute: the seeding pass looks up every Known Set member whether the run found it or not, so the URL set is candidates union Known Set with no way to separate them, and the apparent 12/12 overlap is a fact about the seeding rather than a result. Nothing in the repository holds the albums those runs found.

The change is one field. `outcome.shortlist` is already in scope where the case result is assembled, passed to `gradeRun` and `backtest` on adjacent lines; it is added to `CaseResult` and carried through `aggregate`, which passes `cases` intact. No extra run cost, because the passes are being run regardless.

**It lands before this ticket's baseline pass, not after.** This is the pass that is committed and that ticket 09 reads its improved pass against. Added later, the baseline is counts while the improved pass has albums, and the milestone's one before-and-after comparison is asymmetric in the dimension a human actually reviews by eye.

It also covers ticket 06's eight mutated cases, which have no Known Set week and so no back-test and no review queue. Those are the cases where the EP thresholds and the `artists.always` guarantee fire for the first time (carried-forward item 4); without the shortlist, all a reader gets is a defect count.

The review queue is unaffected. It prints the back-test's non-matches for labelling, which is a different artefact for a different purpose, and it exists only where a case has a week.

## Notes

ADR-0058, ADR-0062, ADR-0063. Unblocks ticket 01.
