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

# Carried forward from milestone 2

Same rule as above: each item was found by a real run, and each has evidence behind it. Evidence: `docs/evidence/milestone-2.md`.

## 7. The step ceiling now breaks the *recovery*, not just the first run

Item 1 above was about a busy week costing a run. Milestone 2 produced the case that matters more: `d5d6e816`, a re-run over a fourteen-day window with five fewer candidates than the run before it, used all thirty steps — twenty-six of them lookups — and wrote nothing, for $0.0294. A re-run is what recovery looks like, and on a wide window recovery cannot finish.

The two directions ADR-0044 named are unchanged: one action that looks several releases up, or the code rather than the model choosing which candidates deserve one. Nothing about this is a recovery problem, which is why milestone 2 deliberately left it alone.

Evidence: `d5d6e816`, and `d2b59538` at 27 of 30 on the same window.

## 8. A live kill between two page creations was attempted and not achieved

Criterion 7's live pair proves that a killed run's rows are suppressed by the next run. It does not show a shortlist *split* across two runs, because both attempts to kill a run between two page creations missed: five creates are fast, and the second attempt's run never reached `finish`. The mechanism is covered deterministically by a test, and the gap is that ADR-0051's accepted consequence — a shortlist split across two runs, so Rank is per run — has still never happened for real.

Cheap if it is ever wanted: a run that writes a shortlist of five while a poller kills it on the first new row will eventually land mid-write; it is a matter of buying attempts.

## 9. A cost report that sums `runs.estimated_cost` will omit every killed run

`d2b59538`'s row reads `$0.0000` and its steps read `$0.0437`, because a run row is written at the end. `npm run trace` already totals from steps (ADR-0050). Milestone 3's failure and cost reporting has to do the same, or it will be blind to exactly the runs it exists to describe.

## 10. ~~Degraded mode is evidenced by tests and a diary entry~~ — closed 17 September

Ben exported `e480b9c1` and `3e657aa3` from his own machine and committed them. What the pair leaves open is smaller and is recorded here rather than dropped: both are dry runs, so the caveat ADR-0052 puts in a degraded record's `Rationale` has still never reached Notion. It is covered by a test and by the flag on the shortlist items in those traces.
