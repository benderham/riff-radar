# Milestone 2: the evidence

Six runs on 17 September 2026. Four from the development sandbox and two from Ben's own machine, where MusicBrainz blocks his IP. All six traces are committed beside this file as JSON, exported from `riff-radar.db` with nothing removed but the stored page HTML, which is recorded by size, status and candidate count instead.

Three stories. **Evidence run 1** is an interruption and its resume: a run killed at step six and continued by run id. **Evidence run 2** is a run killed during its Notion write, and the re-run of the same window that followed it. **The degraded pair** is the one failure that cannot be staged in the sandbox, run where it happens for free.

| | `c4d95544` | `51f702ca` | `d2b59538` | `d5d6e816` |
|---|---|---|---|---|
| Story | run 1, killed | run 1, resume | run 2, killed mid-write | run 2, re-run |
| Command | `run --dry-run` | `run --dry-run --resume c4d95544` | `run --last-days 14` | `run --last-days 14` |
| Window | 2026-09-11 to 2026-09-17 | inherited | 2026-09-04 to 2026-09-17 | 2026-09-04 to 2026-09-17 |
| Termination reason | `aborted` | `completed_short` | none — killed | `max_steps_exceeded` |
| Steps | 6 | 14 (20 in the chain) | 27 of 30 | 30 of 30 |
| Wall clock | 2m 34s to the kill | 2m 03s | over 10m to the kill | 9m 50s |
| Cost | $0.0062 | $0.0062 of its own, $0.0125 in the chain | $0.0437 of steps, $0 on its row | $0.0294 |
| Cached input, this run's own steps | 65,530 of 68,386 tokens (96%) | 116,546 of 124,207 (94%) | 257,920 of 314,719 (82%) | 317,626 of 333,157 (95%) |
| Shortlist | — | 1 | 5 written, never recorded | 0 |
| Notion write | no (dry run) | no (dry run) | 5 rows; `notion_write_performed = 0` | no |

MusicBrainz was answering intermittently from the sandbox all afternoon, which is why every run carries retries and one category. That was luck rather than design, and it is the reason criteria 3 and 4 rest on real calls rather than on staged ones.

## What each criterion rests on

**1. Agent actions use defined schemas.** Already true since ADR-0016 and cited rather than rebuilt: the six actions are declared in `src/tools.ts`, the model's tool schema is derived from those declarations, and `validateAction` (`src/tools.ts:346`) is the only route to dispatch. Its tests are in `src/tools.test.ts`.

**2. Every model response is validated.** Three places, all in `src/tools.ts` and `src/clients/sources.ts`: the loop's tool calls through `validateAction`; the nested extraction call inside `fetch_source` through `extractionSchema.safeParse` (`src/clients/sources.ts:155`); and the shortlist at `finish` through `validateShortlist`. The third is the one that had never been shown to refuse *and recover* — ticket 06's repair does that, and `src/agents/riff-radar.test.ts` pins the refusal, the errors handed back and the corrected shortlist.

**3. External failures have explicit categories.** A count over the column, not over prose:

```sql
SELECT failure_category, COUNT(*) FROM steps WHERE failure_category IS NOT NULL GROUP BY failure_category;
-- transient  5
```

Five real failures across the four runs, every one a MusicBrainz 503 that survived three attempts — for example `51f702ca` step 8, `lookup of Hate Meditation — Degenerator returned HTTP 503 after 3 attempts`, recorded with `failure_category = 'transient'` beside the sentence rather than instead of it.

**4. External calls retry with bounded backoff.** Twenty-nine steps across the four runs report an attempt count, and the run that cost the most seconds says where they went:

| Run, step | Note | Duration |
|---|---|---|
| `c4d95544` 1 | Loudwire `answered after 3 attempts` | 44.6s |
| `51f702ca` 4 | `Der Weg Einer Freiheit — Innern (Instrumental) returned HTTP 503 after 3 attempts` | 7.6s |
| `51f702ca` 8 | `Hate Meditation — Degenerator returned HTTP 503 after 3 attempts` | 5.4s |
| `d2b59538` 9 | `Mother of Millions — T answered after 2 attempts` — the step *after* the one that gave up | 14.6s |
| `d5d6e816` 1 | Loudwire `answered after 3 attempts` — the slowest step in the set | 126.1s |

A failed call explains its attempts inside the error; a call that succeeded on the second or third ask says so in a warning it would not otherwise have written, which is the case the count exists for. Nothing was added to the schema for this: the count rides the note.

**5. State is checkpointed after each step.** Every step of every run carries a candidate list:

```sql
SELECT run_id, COUNT(*), SUM(candidates_after IS NULL) FROM steps GROUP BY run_id;
-- c4d95544  6   0
-- 51f702ca  14  0
-- d2b59538  27  0
-- d5d6e816  30  0
```

**6. An interrupted run resumes from its checkpoint.** `c4d95544` was killed with `SIGKILL` at step 6, mid-loop, having fetched both sources and spent four lookups. `npm run riff-radar run --dry-run --resume c4d95544` said what it inherited before it started:

```
resumed from c4d95544-86d1-4192-aa61-d7f8e6488c2d: 6 of 30 steps and $0.0062 of $0.2500 already used — 24 steps and $0.2438 left
```

The resume repeated none of it. Its step 0 is a lookup of Tygers of Pan Tang, a release the parent never reached; the parent's two source fetches are not repeated, and none of the parent's four looked-up releases is looked up again. The parent's row is closed `aborted` with its own spend, and `npm run trace 51f702ca` prints both rows as one story — `chain   2 runs, 20 steps, $0.0125 in total` — totalled from the steps, because the killed row of a chain never wrote a total.

**7. Repeated runs cannot create duplicate Notion records, including after a kill part way through a write.** `d2b59538` reached `finish` with five releases and was killed with `SIGKILL` during the write, a little over ten minutes in — its last recorded step began at 9m 35s and ran for 35s, and the write followed that. All five pages had been created; the process died before the run row could record anything, so the row still says `termination_reason = NULL`, `shortlist_size = 0`, `notion_write_performed = 0`, `estimated_cost = 0` — while its steps add up to $0.0437 and Notion holds five correct `Proposed` rows carrying its run id.

Notion before the kill: 281 rows, the newest nine from milestone 1. After: 286 rows — *Just Live Loud!* (Shakra), *Thistle* (Spirit Mother), *The Darkest Side of Humanity* (A Night in Texas), *Airbourne* (Airbourne), *Stories of Destiny* (Mad Max).

`d5d6e816` then re-ran the same window. Its first two fetches report `alreadyProposed: 13` and `alreadyProposed: 23`, against the killed run's `10` and `18`: the five rows a run that denies writing had written are suppressed by the next run, because suppression reads Notion and not the run row (ADR-0051). None of the five appears anywhere in its 27 candidates, and the database still holds no duplicate artist-and-album pair across all 286 rows.

What this pair does **not** show is a shortlist split across two runs, and the reason is worth stating plainly rather than dressing up. Two attempts were made to kill a run *between* two page creations, by polling Notion and killing on the first new row; the write of five pages is fast enough that the first attempt's kill landed after the fifth create, and the second attempt's run never reached `finish` at all — it ended `max_steps_exceeded` on a fourteen-day window, which is carried-forward item 1 doing exactly what milestone 1 said it would. A third attempt was not bought: at roughly three cents a run it is paying for timing luck.

So the remainder case is closed deterministically instead, by the test the milestone's testing decisions asked for: *a run killed part way through its write leaves rows the next run suppresses* in `src/agents/riff-radar.test.ts`. It stands a killed run up in a real store with two of its three pages in Notion and its row denying the write, and asserts that the next run suppresses those two and proposes the third and only the third. The kill itself cannot be staged in process — every failure a fake can produce triggers the compensating rollback (ADR-0042), and a killed process rolls nothing back — so what the test constructs is the *state* a kill leaves, which is the input the claim is about.

## Degraded mode

Not reproducible in the sandbox, where MusicBrainz answers, and free on Ben's machine, where it blocks his IP. Two runs from that machine, both `run --dry-run` over 2026-09-11 to 2026-09-17, exported and committed by Ben:

| | `e480b9c1` | `3e657aa3` |
|---|---|---|
| Started | 04:53 UTC | 05:03 UTC |
| Termination reason | `no_candidates` | `completed` |
| `musicbrainz_degraded` | 1 | 1 |
| Steps | 15 | 17 |
| Wall clock | 3m 55s | 3m 17s |
| Cost | $0.0237 | $0.0123 |
| Cached input | 79,400 of 129,624 tokens (61%) | 145,146 of 152,296 (95%) |
| Lookups | 12: two that failed, ten that asked nothing | 14: two that failed, twelve that asked nothing |
| Shortlist | 0 | 5, every item `judgedWithoutMusicbrainz` |

**The threshold, in the trace.** Both runs read the same two calendars, then the categories tell the story in one column: steps 2 and 3 are `lookup_release` with `failure_category = 'transient'` — two silent lookups against a provider that never answered — and every lookup after them is `unavailable`, which is the category set by the run rather than derived from a status (ADR-0048), on a step that made no request at all. Twenty-two lookups across the two runs cost nothing after the second, which is the arithmetic ADR-0052 exists for: three attempts with backoff against a blocked provider would otherwise have been minutes of knocking to learn what the second lookup already knew.

**What the model was told.** The degraded lookup's result carries it, so it is in the trace rather than only in the prompt:

> MusicBrainz is unavailable for the rest of this run; releases are judged on the source's own word: a stated album passes, a stated live album, EP, single, compilation or reissue does not, and a release no source described is taken on the calendar that listed it. No reissue or remaster detection, no EP track-count or duration thresholds, and the label, genre and personnel terms drop out of the ranking. Judge the title yourself — an anniversary edition or a re-release says so in its name, and nothing else is left to catch it.

**The pair is a before and an after, ten minutes apart.** `e480b9c1` degraded exactly as specified and proposed nothing: its ten silent lookups say they were judged on "the source's stated format, as an untyped release group already is", and every one of the ten came back ineligible, because thirteen of fourteen candidates stated no format at all. Every acceptance criterion of ticket 05 was met and the decision's purpose was not — the dead run degraded mode exists to prevent had been reached by another route. `3e657aa3`, after the rule was corrected so that silence is the calendar's word while a source that describes a release is still believed, completed with five items, all five stamped `judgedWithoutMusicbrainz`, and both reissues on the calendar — *The Last Stand 10th Anniversary Edition* and *The Damn Truth Re-Release* — correctly left off, on their titles alone. That is the full record of the fault, the fix and the evidence for both.

**Two things the pair does not show.** Both runs are dry runs, so the caveat ADR-0052 puts in the Notion `Rationale` has still never been written to Notion; it is covered by `src/agents/riff-radar.test.ts` and by the shortlist items in these traces, which carry the flag the write reads. And the ranking totals in `3e657aa3` are all zero, which is not degradation: `matching()` asks whether a value contains a term, so a profile label of `Reigning Phoenix Music` finds nothing in Loudwire's `Reigning Phoenix`. That is milestone 3's first ticket.

## What the runs say about two numbers

**The step ceiling is still a lookup budget, and a fourteen-day window makes it obvious.** `d2b59538` used 27 of 30 and reached `finish` with three to spare. `d5d6e816`, over the same window with five fewer candidates, used all 30 and wrote nothing, having spent $0.0294. Twenty-six of its thirty steps were lookups. ADR-0044 kept the ceiling at 30 on the argument that a bigger number hides the problem; that argument now has a run behind it where the ceiling was reached by a *re-run*, which is the case that matters, because a re-run is what recovery looks like.

**A killed run's row reads $0.0000 and its steps read $0.0437.** This is not a defect — a run row is written at the end and a step is written when it happens — but it is why `npm run trace` totals a chain from its steps (ADR-0050) and why any later cost report has to do the same. A report that sums `runs.estimated_cost` will silently omit every run that was killed, which is exactly the population a failure report is about.

## What is not proven

- The Notion caveat a degraded run writes. Both degraded runs were dry runs; the flag reaches the shortlist and the write is tested, but no degraded row has been written to Notion.
- A shortlist split across two runs by a kill between two page creations. The mechanism is tested; the live version was attempted twice and not achieved, and is described above rather than claimed.
- The EP thresholds and the `artists.always` guarantee still have not fired outside their unit tests. Unchanged from milestone 1.
- No human verdict on the five rows `d2b59538` wrote. They are `Proposed`, they are correct, and they are deliberately not tidied: they are the evidence.
