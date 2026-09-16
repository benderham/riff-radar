# Milestone 1: the evidence

Two real runs, on 16 September 2026, over the window 2026-09-10 to 2026-09-16. Both traces are committed beside this file as JSON, exported from `riff-radar.db` with nothing removed but the two megabytes of stored page HTML, which is recorded by size, status and candidate count instead.

| | `bae956af` | `10a5e3a1` |
|---|---|---|
| Termination reason | `completed` | `completed_short` |
| Steps | 27 of 30 | 22 of 30 |
| Wall clock | 4m 06s | 5m 03s |
| Cost | $0.0147 | $0.0203 |
| Cached input | 211,496 of 223,761 tokens (94%) | 163,954 of 173,595 (94%) |
| Actions | 2 fetches, 23 lookups, 1 finish | 2 fetches, 16 lookups, 2 searches, 1 finish |
| Shortlist | 5 | 4 |
| Notion write | 5 rows | 4 rows |

Both runs were made from the development sandbox rather than Ben's own machine, which MusicBrainz blocks by IP.

## What each criterion rests on

**One command, start to finish.** `npm run riff-radar run`. No arguments: the window defaults to seven days and resolves to absolute dates before anything else happens.

**Exactly one termination reason.** `runs.termination_reason` is `completed` and `completed_short` respectively, written once by an `UPDATE` whose `WHERE` clause refuses a second ending.

**A source fetched, and candidates extracted.** Step 0 and step 1 of each run: Wikipedia and Loudwire, stored whole in `source_texts` (1.9 MB across the two pages), 18 releases listed by Loudwire and 5 by Wikipedia in the second run.

**A MusicBrainz request and its result.** 23 lookups in the first run, 16 in the second, each with its arguments in `steps.tool_args` and what MusicBrainz returned in `steps.tool_result` — release-group id, type, date, track count, label, genres, band members.

**Guardrails observably enforced.** Three kinds, in the trace rather than in the code:

- *Suppression.* The second run's two fetches report `alreadyProposed: 2` and `alreadyProposed: 5`. Seven releases Notion already held were dropped before the model saw them, and none of the five written by the first run appears anywhere in the second run's candidates.
- *Eligibility.* Run `24eb9f8a`, earlier the same day, ended `validation_failed` with `item 5: Mother of Millions — T is not eligible: MusicBrainz states no release type`. Nothing was written. That refusal is why ticket 08 exists.
- *A degraded service.* Three lookups in the first run came back `HTTP 503` and are recorded as warnings, not errors; the run continued and the releases were simply left unverified.

**The taste profile changed the order.** The `finish` step's `tool_result` carries the arithmetic beside the order it produced:

```
Green Lung — Necropolitan          rank 1  total 5   artist "Green Lung" +3, label "Nuclear Blast Records" +2
Cartilage — Operating Altar        rank 2  total 2   genre "death metal" +2
Dreadnought — Wars Of Spirit…      rank 3  total 0
Archgoat — Nightbringer…           rank 4  total 0
Harlott — Exsequiis                rank 5  total 0
```

The model proposed these five; the code ordered them. Where the profile had nothing to say — the last three — the model's own order survived as the tie-break.

**Reconstructable from the trace alone.** Every step carries what the model said (`model_response`), what it asked for (`proposed_action`), whether that was allowed (`validation_result`), what was dispatched (`dispatched_action`), what came back (`tool_result`), how long it took, and what it cost in three kinds of token. `npm run trace <run-id-prefix>` prints it, and issues nothing a person could not type into `sqlite3`.

**Notion records exist.** Nine rows across the two runs, every one `Status = Proposed`, carrying the run id, a source URL, the rationale, an Apple Music search link, the MusicBrainz id and the album cover. `Rating` is empty on all nine, and no code in the project can name that property.

## What the runs say about two numbers

**The step ceiling of 30 is tighter than it looks.** The first run used 27. Twenty-three of those steps were lookups — one per candidate, and a candidate costs four MusicBrainz requests (ADR-0038). A week with more releases than this one would hit the ceiling before reaching `finish`, and the run would end `max_steps_exceeded` with nothing written, having spent every cent of the work. The ceiling is not raised here, because the honest fix is not a bigger number: it is that the model spends a step per candidate to learn things a batch could answer, and that belongs in the milestone that looks at failure. Recorded rather than changed.

**The EP thresholds were never exercised.** Neither run met a release MusicBrainz types as an EP, so the 4-track and 20-minute rules ran zero times outside their unit tests. They stand as specified, unconfirmed by live data.

## What is not proven

- No run has yet been made from Ben's own machine, because MusicBrainz blocks his IP. The write path, the suppression read and the cover fetch have all met the real services; the network between them and his laptop has not.
- Cover art was fetched at creation time only in the second run; the first run's five rows were covered by a one-off repair, because the archive was unreachable when they were written.
- No shortlist has yet been rejected by a human. `Status` stays `Proposed` until Ben judges the nine.
