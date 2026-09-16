# Carried forward from milestone 1

Failure points milestone 1 exposed and deliberately did not fix. Each was found by a real run, not by reasoning, and each has evidence behind it. Read this before writing milestone 2's tickets: some of these are that milestone's actual subject, and one of them is a trap.

Nothing here is a decision. Where a decision was taken, it is named.

## 1. The step ceiling is a lookup budget in disguise

Run `bae956af` used **27 of its 30 steps, and 23 of those were `lookup_release`** — one step per candidate, four MusicBrainz requests and about ten seconds each. A busier release week ends at `max_steps_exceeded` having paid for the whole run and written nothing.

The ceiling was deliberately **not** raised (ADR-0044): a bigger number buys a fortnight and hides the shape of the problem, which is that the model spends a step to learn a fact the code could ask for directly. Two directions, neither adopted: one action that looks up several releases, or the code rather than the model choosing which candidates deserve a lookup.

Evidence: `docs/evidence/milestone-1.md`, ADR-0044.

## 2. One refused item destroys the whole shortlist

Validation is all-or-nothing at `finish` (ADR-0035), and `finish` terminates the run. A shortlist of five with one ineligible item is not repaired, not returned to the model, and not partially written: the run ends `validation_failed` and writes nothing.

This cost two consecutive runs and about three cents on 16 September 2026, both on the same release. The immediate cause was fixed — the model is now told a release is ineligible at lookup time rather than discovering it at `finish` — but the *structural* fault is untouched: the last step of a run has no way to fail softly, and the model gets no chance to correct a shortlist it could easily fix.

Worth deciding in milestone 2: is a refused item a run-ending fault, or a repair the model should be handed back? The guardrail must survive either answer.

Evidence: `docs/diary.md`, 16 September 2026; run `24eb9f8a` in the trace database.

## 3. MusicBrainz is a single point of failure, and it blocks Ben's IP

Ben's own machine cannot reach `musicbrainz.org` at all — his IP is blocked. Every run so far has been made from the development sandbox. A run whose lookups all fail now survives (ADR-0043) but proposes nothing, because an unlooked-up release is excluded: it ends `validation_failed` with a shortlist the model built in good faith.

A sketched, unbuilt design: after two consecutive lookups that get no answer, record `musicbrainz_unavailable`, stop spending steps knocking, and judge format on the source's stated word — which ticket 08 already made the rule for an untyped release group (ADR-0045), so the machinery exists. What is lost while degraded should be stated rather than discovered: reissue and remaster detection, EP thresholds, and the label, genre and personnel half of the ranking.

Evidence: runs `5edc2927` and `51b4dda6`; `docs/diary.md`, 16 September 2026.

## 4. The Notion write is compensating, not atomic

A failure part way through the write archives the pages already created, but a rollback that itself fails — or a process killed mid-loop — can still leave rows behind (ADR-0042). Milestone 2 is where checkpointing and resume arrive, and resume has to answer what a half-written Friday means: the run row says `notion_write_performed = 0` while the database holds three of five rows, and suppression will then hide those three from the next run.

## 5. Two rules have never run against live data

The EP thresholds — 4 tracks, 20 minutes — have never fired outside their unit tests, because no release either evidenced run met was typed as an EP by MusicBrainz (ADR-0044). The same is true of the shortlist's `artists.always` guarantee: no release by an always-list artist has appeared in a run yet. Both are correct as far as anything knows; neither has been confirmed by a Friday.

## 6. No human verdict exists

Nine records sit at `Status = Proposed`. Until Ben sets a Status and a Rating on them, nothing in this project has been measured against whether the recommendations are any good — only against whether the machinery works. Milestone 3's evaluation has no baseline until that happens.
