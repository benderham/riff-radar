# Milestone 3: Measurable system

Status: ready-for-agent

Scope: `docs/project-brief.md` · Carried forward: `carried-forward.md` · Rationale: `docs/decisions.md` (ADR-0058 to ADR-0065) · Vocabulary: `CONTEXT.md`

## Problem Statement

Ben has a system that survives failure and cannot tell him whether it is any good.

Everything it does is recorded. Six real Runs sit in `docs/evidence/` with their steps, their tokens, their costs, their Failure Categories and their Termination Reasons. What none of it answers is the only question left: when this Run proposed five albums, how many should it have proposed, and were these the five?

The gap is visible in the evidence already collected. Run `3e657aa3` completed, wrote nothing to any error column, and scored all five of its proposals **zero** — the order Ben read was the model's own preference surviving through a tie-break, and the Taste Profile had no arithmetic effect whatsoever. Nothing in the trace says so. A Run that ranks by accident and a Run that ranks correctly produce identical-looking records, because the system has no vocabulary for being *wrong* as distinct from *broken*.

The same absence hides everything else. Two rules — the EP thresholds and the always-list guarantee — have never fired outside a unit test in any Run ever made. A Source silently loses 36% of its content to truncation and the loss falls on the months a real Run actually queries. Nine records sit at `Proposed` in Notion, unjudged, so the project's entire claim to usefulness rests on nobody having looked closely.

And because there is no measurement, there is no way to improve anything on purpose. A change to ranking, a change to the prompt, a change to the profile — each is a guess whose effect is unknowable, because there is nothing to compare against.

## Solution

The system gets a fixed set of questions it can be asked repeatedly, a vocabulary for the ways it can answer them wrongly, and one demonstration that a deliberate change moved a number.

Failures the agent causes get a name. A **Defect** is a third vocabulary beside Failure Category and Termination Reason — seven words for a Run that was wrong rather than broken, asserted by a grader against a labelled case and never recorded by a Run about itself. One of the seven, `unlisted`, exists because a release no Source carried is not a release the agent failed to find, and without the distinction a truncation bug reads as a bad model.

Twenty **Golden Cases** make the questions fixed. Each is a recorded set of HTTP responses and the arguments that ask for them, replayed through the real loop against a fake `http` port and a real store, with the model live — which is the only arrangement where steps, latency and cost are real numbers rather than simulated ones. Twelve are harvested from historical weeks of 2026; eight are deliberate mutations covering the duplicate, ambiguous, conflicting and failed-tool scenarios the brief demands and that no real week supplied.

The historical twelve are possible because of a fact that was measured rather than assumed: both Sources are year pages, and `fixtures/loudwire.html` carries all twelve months of 2026 uncut. A January window is replayable against bytes already committed.

Those same weeks give the project something the Golden Dataset cannot: a **Back-test** against Ben's own Notion database, which holds albums back to January. It measures coverage — whether the agent's five picks come from the pool Ben's taste actually drew from — normalised as `hits / min(k, 5)` so that a busy week is read rather than excluded. Because those rows were logged before the five-item cap existed and under a looser bar, the **Known Set** is curated first, by Rating rather than by deletion, and frozen before the baseline runs.

Taste stays outside all of it. The Golden Cases label eligibility, which is a fact about fixed bytes; they never label rank order or desirability, because that would put a second copy of the Taste Profile into twenty fixtures to go stale. Whether the recommendations are any *good* is read from Notion as **Acceptance Rate** and **Taste Yield**, per profile version, beside Shortlist Fill Rate so that the metric does not reward proposing fewer and safer. Neither gates anything.

Then the milestone does the one thing that proves the machinery works: it takes a baseline, fixes the ranking bug that scored `3e657aa3` zero, and runs the same twenty cases again.

## Acceptance Criteria

The brief's seven outcomes, each closed by evidence rather than assertion:

1. **Failure taxonomy is documented** — seven Defects defined, distinguished from the six Failure Categories and nine Termination Reasons, in `CONTEXT.md` and ADR-0059.
2. **Twenty golden cases are labelled** — twelve harvested from 2026 weeks, eight mutated, each carrying its eligibility labels and its step and cost budget. The mutated eight include an EP on both sides of both thresholds and a release by an always-list artist (carried-forward item 4).
3. **Deterministic eval checks run automatically** — the graders are pure functions, unit-tested inside `npm test`; `npm run eval` grades a pass with no human judgement in the loop.
4. **Subjective taste evaluation is defined** — Acceptance Rate, Taste Yield and Shortlist Fill Rate defined, computed by `npm run taste`, reported per `profile_version` with n, and gating nothing (ADR-0060).
5. **Tokens, latency, and estimated cost are recorded** — aggregated per case and per pass from columns the trace already has. *Largely already true; this milestone aggregates rather than instruments.*
6. **Baseline and improved versions are compared** — the label-matching fix (ticket 01) evaluated against a baseline taken before it shipped, with the delta read against a published noise floor.
7. **Remaining failures and readiness threshold are documented** — two Defects at zero, four budgeted with numbers set from the baseline, the rest reported (ADR-0065).

### Required deliverables

- **Eval Report** — `docs/evidence/milestone-3.md`, in the shape of milestone 2's, holding the Cost Summary and the Before-and-After Comparison as sections rather than as separate files.
- **Golden Dataset** — `fixtures/eval/`, twenty labelled cases, committed.
- **Cost Summary** — tokens, latency and estimated cost per case and per pass, as a section of the Eval Report.
- **Before and After Comparison** — `docs/evidence/milestone-3-baseline.json` and `milestone-3-improved.json`, with the narrative in the Eval Report.
- **Noise floor** — three samples over five cases, published once, in the Eval Report.
- **Curation record** — the date the Known Set was frozen, the rows touched and the rule applied, in the Eval Report (ADR-0063).
- ADR-0058 to ADR-0065 in `docs/decisions.md`. *Done.*
- Golden Case, Defect, Back-test, Known Set, Acceptance Rate and Taste Yield in `CONTEXT.md`. *Done.*
- `docs/specs/milestone-3-measurable-system.md` as a pointer to this file, so that directory stays a complete index.

## User Stories

**Naming what the agent got wrong**

1. As the sole user, I want a word for a Run that was wrong as distinct from a Run that broke, so that a completed Run with a useless Shortlist stops looking like a success.
2. As the sole user, I want Defect kept apart from Failure Category and Termination Reason, so that "what broke outside", "why did it stop" and "was it right" stay three answerable questions.
3. As the sole user, I want a release no Source ever carried counted separately from one the agent failed to find, so that a truncation bug is not fixed by changing the prompt.
4. As the sole user, I want a fact with no source behind it treated as a fault rather than a score, so that the project's grounding claim is enforced rather than asserted.
5. As the sole user, I want Defects asserted by the grader rather than recorded by the Run, so that nothing in the trace schema has to change and a Run cannot mark its own homework.

**Asking the same questions repeatedly**

6. As the sole user, I want twenty fixed cases, so that a change to the prompt or the ranking has something to be measured against.
7. As the sole user, I want each case to be a whole Run rather than a single decision, so that steps, latency and cost are real numbers.
8. As the sole user, I want the model live during a pass, so that the evaluation measures the half of the system that is a model.
9. As the sole user, I want everything except the model frozen, so that a difference between two passes is the change I made and not a website that moved.
10. As the sole user, I want the noise floor measured once and published, so that I can tell a result from a coin flip without paying for three samples forever.
11. As the sole user, I want cases covering duplicates, ambiguity, conflicting dates and a failed tool, so that the dataset exercises the paths a quiet week never reaches.
12. As the sole user, I want the EP thresholds and the always-list guarantee exercised by construction, so that two rules that have never fired outside a unit test finally do.

**Checking it against what I actually found**

13. As the sole user, I want historical weeks replayed against the calendar bytes already committed, so that a back-test costs no network access and no new capture.
14. As the sole user, I want weekly windows rather than monthly, so that the measurement is about the agent rather than about the five-item cap.
15. As the sole user, I want busy weeks included rather than excluded, so that the sample is not quietly biased toward the easy ones.
16. As the sole user, I want a proposal that matches nothing in my database treated as unlabelled rather than as an error, so that an album I simply never heard of is not counted against the agent.
17. As the sole user, I want to label those non-matches once, so that the reference set becomes what I would have wanted rather than only what I found.
18. As the sole user, I want rows this agent wrote excluded from the reference set, so that it is not graded on its own output.
19. As the sole user, I want to curate by rating rather than by deleting, so that suppression keeps working and nothing is lost.
20. As the sole user, I want the curation frozen and declared before the baseline runs, so that the number cannot be improved by moving the target.

**Knowing whether the recommendations are any good**

21. As the sole user, I want "did it belong on the list" and "was the album good" measured separately, so that a quiet week of bad metal is not confused with a bad agent.
22. As the sole user, I want taste measured from Notion rather than labelled into fixtures, so that improving my Taste Profile does not fail the evaluation.
23. As the sole user, I want both numbers reported per profile version with n stated, so that a comparison across a profile edit is visibly not a comparison.
24. As the sole user, I want Shortlist Fill Rate printed beside them, so that a metric I could improve by proposing fewer and safer albums cannot be improved that way quietly.
25. As the sole user, I want neither number to gate the milestone, so that the milestone does not fail for reasons that have nothing to do with the code.
26. As the sole user, I want the agent never to be able to write my Rating column, so that the verdicts stay mine.

**Proving a change did something**

27. As the sole user, I want a baseline taken before the ranking fix ships, so that there is something to compare the fix against.
28. As the sole user, I want the controlled change to be a deterministic one, so that its effect is not drowned in model variance.
29. As the sole user, I want the before and after reports committed as files, so that the comparison can be checked by someone who cannot run the system.
30. As the sole user, I want the readiness threshold set after the baseline rather than before it, so that it is not a bar invented in order to be cleared.
31. As the sole user, I want to know what a pass costs, so that running the evaluation is a decision I can make with a number in front of me.

## Implementation Decisions

**A Defect module, pure and first.** `src/domain/eval.ts` holds the seven-value union and the assertions over a completed Run plus its case labels. It depends on nothing that does not already exist — a Shortlist, a trace, a stored Source Text — and everything else in the milestone depends on it, so it is built first. `ungrounded` checks a factual field against its source URLs and a vibe note against the stored Source Text, reusing `citedVibes` rather than restating the rule. `unlisted` checks a labelled release against `source_texts.raw_body`. (ADR-0059.)

**A case is a directory of recorded bodies plus a manifest.** `fixtures/eval/<NN>-<slug>/` holds the manifest — CLI arguments, the eligibility labels, the step and cost budget — and the recorded responses keyed by request. The two Source bodies are **not** copied per case: they are the existing `fixtures/loudwire.html` and `fixtures/wikipedia.html`, referenced by name, because twelve copies of 1.9MB to vary a date range is storage bought for nothing. Only the recorded MusicBrainz and Notion answers differ per case. (ADR-0058, ADR-0062.)

**The runner replays, it does not re-derive.** `scripts/eval.ts` builds a fake `http` port over a case's recorded responses, a fake clock, a real in-memory store and the live model port, and calls `runRiffRadar` unchanged. No evaluation-only branch exists anywhere in `src/`: if the loop needs to know it is being evaluated, the design is wrong. Output is one JSON report per pass, holding per-case Defects, tokens, latency, cost and Termination Reason.

**Harvest is a separate act from replay.** Harvesting a historical week runs the loop against the committed Source fixtures and **live** MusicBrainz, recording the answers into the case directory. It happens once per case, by hand, and is never part of a pass. This is the only step in the milestone that touches a live provider other than the model.

**The taste command stands alone.** `scripts/taste.ts` queries Notion with its own read-only schema naming `Status` and `Rating`, pages to the end the way `suppressedReleases` already does, and reports Acceptance Rate, Taste Yield and Shortlist Fill Rate per `profile_version`. `NOTION_PROPERTIES` is untouched; no write path names `Rating`. (ADR-0061.)

**The back-test metric is one line.** `hits / min(k, 5)`, with `k` the size of the Known Set for that week and `hits` the intersection on Release Identity — MusicBrainz id where both sides have one, otherwise `artistTitleIdentity`, which is the existing function and the one that already handles Ben's hand-entered rows carrying no MusicBrainz ids. (ADR-0062.)

**The noise floor is measured once.** Five cases, three samples each, published in the Eval Report as a range per metric. Every later pass is n=1 and every delta is read against it. (ADR-0058.)

**Nothing is added to the trace schema.** No migration, no new column, no new table. A Defect is a property of a grading, not of a Run, and the existing `runs` and `steps` columns already carry every number the Cost Summary needs.

## Testing Decisions

**What a good test is here.** It asserts what a grader concluded from a given Run and case, not how it concluded it. The graders are pure functions over data the store already produces, so they are tested directly and exhaustively — that is the whole reason ADR-0064 split them out of the runner.

**The graders are the test subject; the runner is barely tested.** Each of the seven Defects gets cases that fire it and cases that must not, built from small hand-written Run records rather than from real traces, because a fixture large enough to be realistic is one nobody can read. The `hits / min(k, 5)` normalisation is tested across both regimes and at the boundary. The aggregation and cost arithmetic are tested against a recorded pass output committed under `fixtures/eval/`.

**No live service in `npm test`.** The runner's live model call and the taste command's live Notion call are the separately-invoked exceptions, and they join the six existing smoke scripts rather than inventing a category. `npm run check` stays offline.

**The fake `http` port already exists.** The loop's own test file runs `runRiffRadar` end to end against a scripted model, a fake HTTP port answering from recorded fixtures and a real in-memory store. The evaluation runner is that arrangement with the model swapped for the real one, so the seam is proven before this milestone starts.

**Seams to cover, following `AGENTS.md`:** the Defect assertions; the back-test normalisation; the aggregation of tokens, latency and cost across a pass; case-manifest validation, which is schema validation like any other and is refused loudly rather than defaulted.

## Out of Scope

**Fixing the Wikipedia truncation.** Measured at 36% lost, biased toward the months a real Run queries, and recorded as carried-forward item 1. It is source-coverage work, it would change every harvested case, and the milestone's answer to it is `unlisted` — a word that stops it being miscounted. Fixing it is a later ticket.

**Fixing the step ceiling.** Still a lookup budget, still thirty, still the most tempting thing in `carried-forward.md`. The `wasteful` Defect exists to measure it, which is this milestone's entire business with it.

**A second controlled change.** The brief asks for at least one. One is what this milestone does, and it is the deterministic one, deliberately: a prompt change is the more interesting comparison and the much noisier one, and there is no noise floor to read it against until this milestone publishes one.

**Acting on the taste numbers.** The report says which profile terms correlate with `Rotate`. Editing the Taste Profile in response is Ben's to do and is not a ticket, because the agent adjusting its own semantic memory is excluded by `AGENTS.md` and ADR-0009.

**Any automation of the review queue.** Ben labels the non-matches once, by hand, and the labels persist as case data. A second pass over them is not built until there is a second pass to build it for.

**Anything from milestone 4.** No case study, no demo script, no engineering or executive explanation.

## Further Notes

**One criterion is mostly already met.** Tokens, latency and estimated cost have been recorded per step and per Run since milestone 1, with cached input accounted separately (ADR-0020, ADR-0028). This milestone aggregates them; it instruments nothing, and the criterion is closed by citation plus a Cost Summary.

**The order has one hard constraint and it is easy to get wrong.** The baseline pass must run **before** the label-matching fix ships. Ticket 01 was written first and is numbered first, and it is blocked by ticket 08. Fixing it early destroys the only before-and-after the milestone has, and the fix is a four-line change that will be tempting to make in passing.

**The curation is the long pole and it is Ben's.** Rating eight months of Notion rows is the one task no agent can do, it blocks case harvesting, and it must be finished and frozen before the baseline. It is ticket 04 and it is `ready-for-human` for that reason.

**A pass costs about twenty-six cents.** Twenty cases at roughly $0.013 each. The noise-floor probe is a further fifteen. Harvesting is twelve live Runs, about the same again. The whole milestone is under two dollars of model spend, which is worth stating because the instinct to economise on samples here is an instinct to economise on nothing.

**Two risks worth stating before they are discovered.** The Known Set may still turn out to be thin once curated. Excluding only `Nope` keeps it as large as the data allows — an earlier draft of ADR-0063 restricted it to `Rotate`/`AOTY` and was corrected, because most weeks hold only a handful of rated albums and the restriction would have discarded most of the reference set. What remains thin is anything unrated after curation, which is excluded and counted. If the n is small, report it with its n rather than loosening the rule that produced it. And the mutated eight are written by the same party being measured, which is a real conflict: they are labelled on eligibility, which is a rule in `CONTEXT.md` rather than a judgement, and any case whose label requires an opinion belongs in the harvested twelve or nowhere.
