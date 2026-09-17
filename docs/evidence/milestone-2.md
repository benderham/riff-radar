# Milestone 2: the evidence

Four runs on 17 September 2026, from the development sandbox. All four traces are committed beside this file as JSON, exported from `riff-radar.db` with nothing removed but the stored page HTML, which is recorded by size, status and candidate count instead.

Two stories. **Evidence run 1** is an interruption and its resume: a run killed at step six and continued by run id. **Evidence run 2** is a run killed during its Notion write, and the re-run of the same window that followed it.

| | `c4d95544` | `51f702ca` | `d2b59538` | `d5d6e816` |
|---|---|---|---|---|
| Story | run 1, killed | run 1, resume | run 2, killed mid-write | run 2, re-run |
| Command | `run --dry-run` | `run --dry-run --resume c4d95544` | `run --last-days 14` | `run --last-days 14` |
| Window | 2026-09-11 to 2026-09-17 | inherited | 2026-09-04 to 2026-09-17 | 2026-09-04 to 2026-09-17 |
| Termination reason | `aborted` | `completed_short` | none — killed | `max_steps_exceeded` |
| Steps | 6 | 14 (20 in the chain) | 27 of 30 | 30 of 30 |
| Wall clock | 2m 34s to the kill | 2m 03s | 9m 35s to the kill | 9m 50s |
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
| `d2b59538` 9 | `Mother of Millions — T answered after 2 attempts` — the step *after* the one that gave up | 8.5s |

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

**7. Repeated runs cannot create duplicate Notion records, including after a kill part way through a write.** `d2b59538` reached `finish` with five releases and was killed with `SIGKILL` during the write. All five pages had been created; the process died before the run row could record anything, so the row still says `termination_reason = NULL`, `shortlist_size = 0`, `notion_write_performed = 0`, `estimated_cost = 0` — while its steps add up to $0.0437 and Notion holds five correct `Proposed` rows carrying its run id.

Notion before the kill: 281 rows, the newest nine from milestone 1. After: 286 rows — *Just Live Loud!* (Shakra), *Thistle* (Spirit Mother), *The Darkest Side of Humanity* (A Night in Texas), *Airbourne* (Airbourne), *Stories of Destiny* (Mad Max).

`d5d6e816` then re-ran the same window. Its first two fetches report `alreadyProposed: 13` and `alreadyProposed: 23`, against the killed run's `10` and `18`: the five rows a run that denies writing had written are suppressed by the next run, because suppression reads Notion and not the run row (ADR-0051). None of the five appears anywhere in its 27 candidates, and the database still holds no duplicate artist-and-album pair across all 286 rows.

What this pair does **not** show is a shortlist split across two runs, and the reason is worth stating plainly rather than dressing up. Two attempts were made to kill a run *between* two page creations, by polling Notion and killing on the first new row; the write of five pages is fast enough that the first attempt's kill landed after the fifth create, and the second attempt's run never reached `finish` at all — it ended `max_steps_exceeded` on a fourteen-day window, which is carried-forward item 1 doing exactly what milestone 1 said it would. A third attempt was not bought: at roughly three cents a run it is paying for timing luck.

So the remainder case is closed deterministically instead, by the test the milestone's testing decisions asked for: *a run killed part way through its write leaves rows the next run suppresses* in `src/agents/riff-radar.test.ts`. It stands a killed run up in a real store with two of its three pages in Notion and its row denying the write, and asserts that the next run suppresses those two and proposes the third and only the third. The kill itself cannot be staged in process — every failure a fake can produce triggers the compensating rollback (ADR-0042), and a killed process rolls nothing back — so what the test constructs is the *state* a kill leaves, which is the input the claim is about.

## Degraded mode

Not evidenced here, and deliberately: MusicBrainz answers the sandbox and blocks Ben's IP, so the failure reproduces for free on his machine and has to be staged in this one. Two runs on his machine on 17 September already exercised it — `e480b9c1`, which degraded after two silent lookups and ended `no_candidates`, and `3e657aa3`, which completed with five proposals and both reissues correctly left off. Both are in his local `riff-radar.db` and neither has been exported.

To close this criterion, run this in the repository on that machine and commit what it writes:

```bash
node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite"); const { writeFileSync } = require("node:fs");
for (const prefix of ["e480b9c1", "3e657aa3"]) {
  const db = new DatabaseSync("riff-radar.db", { readOnly: true });
  const run = db.prepare("select * from runs where run_id like ?").get(prefix + "%");
  const steps = db.prepare("select * from steps where run_id = ? order by step_index").all(run.run_id);
  const sources = db.prepare("select * from source_texts where run_id = ? order by fetched_at").all(run.run_id)
    .map(({ raw_body, ...rest }) => ({ ...rest, raw_body_bytes: Buffer.byteLength(raw_body ?? "") }));
  writeFileSync(`docs/evidence/milestone-2-run-${prefix}-degraded.json`, JSON.stringify({ run, steps, sources }, null, 1) + "\n");
}'
```

That is the same export the four traces here were made with. Until it is run, criterion 8 of the ticket rests on the diary entry for 17 September and on `src/agents/riff-radar.test.ts`, which pins the two-silences threshold, the answer the degraded lookup gives the model and the caveat that reaches Notion.

## What the runs say about two numbers

**The step ceiling is still a lookup budget, and a fourteen-day window makes it obvious.** `d2b59538` used 27 of 30 and reached `finish` with three to spare. `d5d6e816`, over the same window with five fewer candidates, used all 30 and wrote nothing, having spent $0.0294. Twenty-one of its thirty steps were lookups. ADR-0044 kept the ceiling at 30 on the argument that a bigger number hides the problem; that argument now has a run behind it where the ceiling was reached by a *re-run*, which is the case that matters, because a re-run is what recovery looks like.

**A killed run's row reads $0.0000 and its steps read $0.0437.** This is not a defect — a run row is written at the end and a step is written when it happens — but it is why `npm run trace` totals a chain from its steps (ADR-0050) and why any later cost report has to do the same. A report that sums `runs.estimated_cost` will silently omit every run that was killed, which is exactly the population a failure report is about.

## What is not proven

- Degraded mode, from Ben's machine. See above.
- A shortlist split across two runs by a kill between two page creations. The mechanism is tested; the live version was attempted twice and not achieved, and is described above rather than claimed.
- The EP thresholds and the `artists.always` guarantee still have not fired outside their unit tests. Unchanged from milestone 1.
- No human verdict on the five rows `d2b59538` wrote. They are `Proposed`, they are correct, and they are deliberately not tidied: they are the evidence.
