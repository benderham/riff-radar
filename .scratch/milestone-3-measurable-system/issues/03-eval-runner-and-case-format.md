# 03: A pass over twenty cases

**What to build:** the case format under `fixtures/eval/`, and `scripts/eval.ts` to run a pass and emit one JSON report.

**Blocked by:** 02

**Status:** done

## Why

A Golden Case has to be a whole Run or the report cannot carry steps, latency or cost — those exist at no smaller scale (ADR-0058). The loop's own test file already runs `runRiffRadar` against a fake `http` port, a fake clock and a real in-memory store, so the seam this needs is proven; what is missing is the model being real and the result being graded.

## What

**The case format.** `fixtures/eval/<NN>-<slug>/` holds `case.json` — CLI arguments, eligibility labels, step budget, cost budget — and the recorded MusicBrainz and Notion responses keyed by request.

The two Source bodies are **referenced by name**, not copied: `fixtures/loudwire.html` and `fixtures/wikipedia.html` are shared across every case, because twelve copies of 1.9MB to vary a date range is storage bought for nothing (ADR-0062).

`case.json` is validated by a schema and refused loudly. A case that does not parse is not a case that runs with defaults.

**The runner.** Builds the fake ports over a case's recorded responses, uses the **live** model port, calls `runRiffRadar` unchanged, grades the result with ticket 02's module, and writes one JSON report per pass holding per-case Defects, Termination Reason, tokens, latency and cost, plus pass totals.

**No evaluation-only branch anywhere in `src/`.** If the loop needs to know it is being evaluated, the design is wrong and this ticket stops.

## Acceptance criteria

- [x] `npm run eval` runs every case in `fixtures/eval/` and writes a report
- [x] `--case <slug>` runs one, for iterating without paying for twenty
- [x] Source bodies are referenced, not duplicated per case
- [x] A malformed `case.json` is refused with a message naming the case and the field
- [x] `git diff src/agents/ src/tools.ts` is empty at the end of this ticket
- [x] Aggregation and cost arithmetic are pure and unit-tested against a committed sample report
- [x] `npm run check` stays offline and green

## Notes

ADR-0058, ADR-0064. The report is the input to tickets 08 and 09.
