# Milestone 2: Recoverable system

Status: ready-for-agent

Scope: `docs/project-brief.md` · Carried forward: `carried-forward.md` · Rationale: `docs/decisions.md` (ADR-0046 to ADR-0053) · Vocabulary: `CONTEXT.md`

## Problem Statement

Ben has a system that works and cannot survive anything going wrong.

Four real runs on 16 September 2026 showed the shape of it. A Run whose MusicBrainz lookups all failed ended `validation_failed` holding a Shortlist built in good faith, because an unlooked-up release is excluded. Two consecutive Runs died on one ineligible item and wrote nothing, about three cents each. And a process killed part way through the Notion write leaves rows behind that its own Run row does not know about.

Underneath all three is the same absence. The system records everything it did and can restart none of it. A failure at step twenty costs the nineteen steps before it, and the only recovery is to run the week again from the beginning, paying again for the same Source fetches and the same MusicBrainz lookups. When something does break, the trace describes it in prose written for a human, which means nobody can count how often each kind of thing breaks.

There is also a promise the project has been making and has never demonstrated: that repeating work cannot create duplicate Notion records. It is believed to be true. Nothing has proved it, least of all against a Run that died half way through writing.

## Solution

A Run becomes survivable. Failures get names, the ones worth retrying are retried, every step is a point the Run can be picked up from, and the promise about Notion is evidenced rather than argued.

External failures get a six-word vocabulary — a Failure Category — produced by deterministic code from a response's status and body, recorded on the step beside the prose that already describes it. Counting how often MusicBrainz refused becomes a query rather than a regex.

The HTTP adapter, which already promises never to throw, now also tries again: three attempts with bounded backoff for the two categories worth retrying, reporting how many attempts each call took so the trace can explain where the seconds went.

The trace becomes the Checkpoint. Almost everything the loop holds is already recorded per step; only the candidate list is not derivable, so only the candidate list is stored. `--resume <run-id>` continues an interrupted Run, explicitly and never by inference, replaying the parent's trace into working memory and carrying on. It is recorded as a new Run pointing at its parent and inheriting its ceilings, so an interruption cannot buy a bigger budget.

MusicBrainz stops being a single point of failure by admitting when it is one. Two consecutive silent lookups put the Run into Degraded mode, where it stops knocking and judges format on the Source's stated word — the rule that already governs an untyped release group — and states plainly what it could not check.

A refused Shortlist is handed back to the model once before the Run ends, so one ineligible item among five no longer costs the whole Run.

And the Notion promise turns out to need no new machinery. A second Run over the same window is not a repair attempt: it is Ben, having reviewed the first five, asking for the next five, which works because the suppression read drops what Notion already holds. A kill mid-write leaves rows that are correct, just incomplete, and the next Run suppresses them and proposes the rest. What this milestone owes is the evidence.

## Acceptance Criteria

The milestone's seven outcomes, each closed by evidence rather than assertion:

1. **Agent actions use defined schemas** — every action is declared with a schema from which the model's tool schema is derived, and nothing is dispatched without passing it. *Already true (ADR-0016); this milestone cites it.*
2. **Every model response is validated** — the loop's tool calls, the nested extraction call inside a Source fetch, and the Shortlist at `finish` are each validated before anything acts on them. *Already true; the repair at `finish` additionally proves the last of the three refuses and recovers.*
3. **External failures have explicit categories** — every failed external call records one of six Failure Categories in a constrained column, countable without parsing prose.
4. **External calls retry with bounded backoff** — `transient` and `rate_limited` failures are retried up to three attempts with exponential backoff and jitter, honouring `Retry-After`; the attempt count reaches the trace.
5. **State is checkpointed after each step** — every recorded step carries enough for a Resume to continue from it.
6. **An interrupted run resumes from its checkpoint** — a killed Run is resumed by run id, does not repeat completed work, and its trace chains to its parent.
7. **Repeated runs cannot create duplicate Notion records** — including after a kill part way through a write.

### Required deliverables

- `docs/evidence/milestone-2.md`, in the shape of milestone 1's.
- **Evidence run 1 — the interruption and its Resume.** A Run started, allowed to fetch Sources and spend several lookups, then killed mid-loop; then resumed by run id. Both traces exported.
- **Evidence run 2 — the mid-write kill and its Re-run.** A Run killed between two Notion page creations, leaving some rows behind and `notion_write_performed = 0`; then the same window re-run, proposing only what is left. Both traces exported, with the Notion database state before and after.
- ADR-0046 to ADR-0053 in `docs/decisions.md`. *Done.*
- Failure Category, Checkpoint, Resume, Re-run and Degraded in `CONTEXT.md`. *Done.*

## User Stories

**Surviving a failure**

1. As the sole user, I want a Source that is briefly down to be tried again rather than lost, so that a Run does not fail on five seconds of somebody else's bad luck.
2. As the sole user, I want retries bounded at three attempts, so that a provider that is genuinely down costs me seconds rather than a whole Run's patience.
3. As the sole user, I want a provider that asks me to wait to be waited for, so that I am not rate-limited harder for ignoring what it told me.
4. As the sole user, I want a Run to give up immediately on a refused credential or a missing page, so that no time is spent retrying an answer.
5. As the sole user, I want to know how many attempts a call took, so that a step that took twenty seconds can be explained rather than wondered about.
6. As the sole user, I want retrying to happen in one place, so that a client added later is retried without anyone remembering to ask for it.

**Naming what broke**

7. As the sole user, I want every external failure recorded as one of a small fixed set of Failure Categories, so that I can count how often each kind of thing goes wrong.
8. As the sole user, I want the category stored beside the prose rather than instead of it, so that I keep the sentence that tells me which host went away.
9. As the sole user, I want a response that arrived but made no sense to be a different category from one that never arrived, so that a provider changing its shape is not confused with a provider being down.
10. As the sole user, I want a model failure to carry a category like any other external failure, so that the one place the trace currently apologises for itself becomes data.
11. As the sole user, I want Failure Category and Termination Reason kept apart, so that "why did the Run stop" and "what broke outside it" remain two answerable questions.
12. As the sole user, I want the category set small and constrained by the database, so that it stays countable and a new value is a deliberate decision.

**Being able to pick a Run back up**

13. As the sole user, I want every step to record enough to continue from, so that a Run killed at step twenty has not lost the nineteen before it.
14. As the sole user, I want to resume a Run by naming its id, so that recovery is something I ask for rather than something that happens to me.
15. As the sole user, I want a Run without the flag to always be a new Run, so that asking for the next five after reviewing the first five never silently becomes a continuation.
16. As the sole user, I want a Resume to skip work the parent completed, so that resuming is cheaper than starting again — which is the only reason to do it.
17. As the sole user, I want a step that was interrupted before it was recorded to simply run again, so that recovery does not depend on catching a process at exactly the right moment.
18. As the sole user, I want a Resume to inherit the parent's spent budget and step count, so that an interruption cannot be used to buy a bigger ceiling.
19. As the sole user, I want to be told what a Resume inherited when it starts, so that a Run resuming with two steps left is understood rather than reported as a bug.
20. As the sole user, I want a Resume refused when the prompt, profile or action schema has changed since the parent ran, so that I never hold a trace half-built under one version and half under another.
21. As the sole user, I want a Resume refused for a Run that already finished, or that never recorded a step, so that the flag means one thing.
22. As the sole user, I want a resumed Run recorded as its own row pointing at its parent, so that a Run row never changes its mind about how it ended.
23. As the sole user, I want the trace command to follow the chain and print it as one story, so that two rows describing one piece of work read as one piece of work.

**Not duplicating what Notion already holds**

24. As the sole user, I want a second Run over the same window to propose releases I have not seen, so that reviewing the first five and asking for more is a thing I can do.
25. As the sole user, I want a Run killed part way through writing to leave rows that are correct, so that I never have to reconcile a half-finished write by hand.
26. As the sole user, I want the next Run to suppress the rows the killed Run managed to write, so that recovery happens by itself and proposes only what is missing.
27. As the sole user, I want a Resume to re-read the suppression set and the schema, so that it sees what its own parent wrote before it died.
28. As the sole user, I want this proved by a Run I actually killed, so that the claim rests on evidence rather than on an argument about how suppression works.

**Working without MusicBrainz**

29. As the sole user, I want a Run to stop calling MusicBrainz once it is clearly unreachable, so that a blocked provider costs two lookups rather than the whole ceiling.
30. As the sole user, I want the model told that MusicBrainz is unavailable, so that it stops spending steps asking and gets on with the Shortlist.
31. As the sole user, I want a Degraded Run to judge format on the Source's stated word, so that an outage produces a weaker Shortlist rather than no Shortlist.
32. As the sole user, I want the rule used when Degraded to be the one that already exists for an untyped release group, so that nothing new is invented at the moment things are going wrong.
33. As the sole user, I want a Degraded Run to say exactly what it could not check, so that I know which proposals rest on weaker evidence before I listen to them.
34. As the sole user, I want the Notion record to say it too, so that the caveat survives past the terminal.
35. As the sole user, I want Degraded recorded as a property of the Run rather than as a Termination Reason, so that a Degraded Run that completed is still a completed Run.
36. As the sole user, I want to run this from my own machine, where MusicBrainz blocks me, so that the failure is reproduced for free rather than staged.

**Recovering a refused Shortlist**

37. As the sole user, I want a Shortlist refused for one ineligible item handed back to the model, so that a Run is not lost to a mistake the model could fix in one step.
38. As the sole user, I want exactly one repair allowed, so that a model that is not listening cannot spend the rest of the budget proving it.
39. As the sole user, I want the repair visible in the trace — the refusal, the errors handed back, the corrected Shortlist — so that a guardrail working is something I can watch.
40. As the sole user, I want the validator unchanged, so that the repair makes the Run more forgiving without making the Shortlist less checked.
41. As the sole user, I want a quiet week to remain a quiet week, so that an empty Shortlist is still reported rather than treated as something to repair.
42. As the sole user, I want `validation_failed` to now mean the model was told twice, so that the reason is worth reading when it appears.

**Reading it back**

43. As the sole user, I want the trace to show the Failure Category, the attempt count and the candidate count per step, so that a Run's story is readable without a query.
44. As the sole user, I want failure counts obtainable by grouping a column, so that a later milestone's failure report does not begin with a parser.
45. As the sole user, I want the database to refuse to open when it predates a schema change and tell me what to do, so that I find out at startup rather than three steps in.
46. As the sole user, I want both evidence scenarios exported as files in the repository, so that the milestone's claims can be checked by someone who cannot run the system.

## Implementation Decisions

**A Failure Category module.** A new domain module holds a six-value union — `transient`, `rate_limited`, `refused`, `not_found`, `malformed`, `unavailable` — and a pure function from a response's status and body to one of them, or to nothing when the call succeeded. `transient` covers a request that got no answer and any 5xx; `rate_limited` covers 429; `refused` covers 401 and 403; `not_found` covers 404, which is an answer rather than a failure of the call. `malformed` and `unavailable` are not derivable from a status: the first is raised by a client whose schema rejected a 2xx body, the second is set by degraded mode. The function covers what a status can say; the other two are supplied by the caller that knows. This module blocks retry and degraded mode, so it is built first. (ADR-0048.)

**Retry lives in the HTTP adapter.** The adapter already owns the contract that nothing below the clients throws, so it also owns trying again: three attempts total, roughly 1s/2s/4s with jitter, only for `transient` and `rate_limited`, honouring `Retry-After` in seconds or as an HTTP date and clamping a hostile value. Every other category returns on the first attempt. `HttpResponse` gains an `attempts` count, always at least one, which clients surface in their warnings so it reaches the trace. There is deliberately no per-run retry budget. MusicBrainz's one-request-per-second gate stays in its own client: it is politeness, not a response to failure. (ADR-0049.)

**`ClockPort` gains `sleep`.** Backoff needs time to pass in a way tests control. Rather than a second injection point in the adapter, the existing clock port gains a `sleep(ms)` method, the adapter takes the clock at construction, and the MusicBrainz gate stops calling a raw timer. One place in the project where time passes, which is what the single-seam rule was for. (ADR-0018.)

**The trace is the Checkpoint.** No checkpoint table. Steps already record the model's raw response, the dispatched action, the tool result, usage and timing, from which a Resume rebuilds the message history, the accumulated usage, the consecutive-invalid counter, the repair counter and the degraded counter. Only the candidate list is not derivable — a Source fetch returns the whole merged list in its result, but a lookup enriches the list in place, collapses it by release group and returns only reshaped facts about one release — so steps gain one nullable JSON column holding the candidate list after each step, and nothing else is stored. (ADR-0046.)

**Four columns, and no migration.** Steps gain the candidate list and the Failure Category, the latter constrained by a CHECK the way the Termination Reason already is. Runs gain the parent run id for a Resume and a boolean for Degraded. The existing rule that an out-of-date database is refused at open with instructions to delete it stands: the evidence that matters is exported as JSON and committed, and database files are not versioned. Export before deleting.

**Resume is a flag and a new row.** `--resume <run-id>` takes no window; the window comes from the parent. Startup is the same path as a fresh Run — schema preflight, then a fresh suppression read — which is what makes a half-written parent self-correct, because the rows it wrote are in Notion and are therefore suppressed. The only difference from a fresh Run is that working memory is replayed instead of empty. The Resume is a new Run row carrying the parent's id, with step indices restarting at zero; the parent is closed `aborted`. Four refusals: unknown run id, a Run that already has a Termination Reason, a Run with no recorded steps, and a Run whose prompt, profile or action-schema version differs from current configuration. The interrupted step needs no special handling — a step that died before it was recorded is simply absent, so it runs again, which is safe because every tool in the loop is side-effect-free and the only side effect in the system is the post-loop Notion write. (ADR-0047.)

**A Resume inherits both ceilings.** Step count and cost are loaded from the parent and continue against the same limits, because the ceilings bound what one question costs rather than what one process costs. A Run killed at step twenty-eight therefore resumes with two steps and will probably end at the step ceiling; that is correct, the right response is a Re-run, and the CLI says what it inherited at startup so this is understood rather than reported as a bug. (ADR-0050.)

**Notion idempotency is unchanged.** No write-intent journal and no per-page idempotency key. The suppression read already makes repeated work safe, and a kill mid-write leaves rows that are correct but incomplete, which the next Run resolves by suppressing them and proposing the rest. The existing rollback keeps a *survivable* failure all-or-nothing; a kill needs no protection. What changes is that this is evidenced. One consequence accepted: a Shortlist can be split across two Runs, so Rank is per Run and the Notion database is not a single ordered list. (ADR-0051.)

**Degraded mode after two silent lookups.** Two consecutive lookup steps whose category is `transient` or `unavailable` flip the Run to Degraded. Thereafter the lookup action returns immediately without a request, telling the model that MusicBrainz is unavailable and that releases are judged on their Source's stated format — reusing the existing untyped-release-group path rather than adding a second one. The Run records the flag, and the Shortlist Items and Notion records say the release was judged without MusicBrainz. The losses are named explicitly rather than left to be inferred: no reissue or remaster detection, no EP track-count or duration thresholds, and ranking without its label, genre and personnel terms. No new Termination Reason — a Degraded Run ends `completed`, `completed_short` or `no_candidates` like any other. The counter is recomputed from the trailing lookup steps on Resume, not stored. (ADR-0052.)

**One repair at `finish`.** When Shortlist validation refuses, the errors are returned to the model as a tool message, reusing the mechanism that already exists for an invalid action, and the model may call `finish` once more. A second refusal ends the Run at `validation_failed`. The repair counter is per Run and separate from the consecutive-invalid counter: a repair does not count towards the invalid-action limit, and an invalid action between the two `finish` calls does not consume the repair. The validator is untouched — it still decides, still runs before any write, and still refuses. An empty Shortlist remains `no_candidates` and never reaches the validator. The step and cost ceilings still apply, so a Run at its budget gets no extra call. The repair counter is derivable on Resume from the recorded `finish` steps. (ADR-0053.)

## Testing Decisions

**What a good test is here.** It asserts what a Run did, not how the code did it: the Termination Reason, the recorded steps, the Failure Categories, whether Notion was written, what the model was told. A test that names an internal function's arguments is testing the implementation and will break on the refactor it should have survived. Tests must not touch a live service; the smoke scripts are the separately-invoked exception and stay that way.

**Prefer the highest existing seam, which is the whole Run.** The loop's own test file already runs `runRiffRadar` end to end against a scripted model port, a fake HTTP port answering from recorded fixtures, and a real in-memory SQLite store. Everything this milestone adds is observable there: that a completed step was not repeated, that a category was recorded, that the model was told MusicBrainz is unavailable, that a refused Shortlist got one more chance, that a killed write leaves suppressible rows. New tests go there by default.

**Three lower seams, each for something the top seam cannot see.** The Failure Category function is pure and is tested directly across every status that maps to each category. The HTTP adapter is tested through its existing injected-fetch seam for the retry sequence, the attempt count, the `Retry-After` handling and the clamp. The store is tested against a real in-memory database for the round trip of the candidate list, the CHECK constraint on the category, and the refusal of an out-of-date schema.

**No abort mechanism is built to test Resume.** A killed Run is simulated by writing a partial Run directly into the real store and calling the Run with the resume flag. Resume's input is the trace, so a hand-written trace is a legitimate input and the test exercises the real path rather than a test-only hook. The mid-write kill uses the existing fake HTTP port, failing the third page creation.

**Backoff is asserted, not waited for.** The clock port's `sleep` is faked, so tests record the delay sequence and assert its shape — bounded, increasing, jittered within range — without the suite spending seven seconds per case. The same fake proves that retry and the MusicBrainz gate compose without sleeping twice for one request.

**Seams to cover, following the list in `AGENTS.md`:** loop termination and the ceilings; action-schema validation; tool dispatch; candidate normalisation and deduplication; Checkpoint and Resume; retry and failure classification; idempotent Notion writes; token and cost accounting, now including a resumed Run's inherited totals.

**Prior art.** The loop's existing tests are the model for the Run-level cases. The MusicBrainz client's tests are the model for fixture-backed client behaviour and for the pure delay function beside the one line that waits. The store's tests are the model for schema assertions against a real database.

## Out of Scope

**The step ceiling as a lookup budget.** The first complete Run used twenty-seven of its thirty steps, twenty-three of them lookups, so a busy week will still end at the ceiling having spent every cent. It is a cost and throughput problem, not a recovery one, and it is the most tempting thing in `carried-forward.md` to fix here and the least connected to the word recoverable. The ceiling stays at thirty (ADR-0044).

**The two rules that have never run live.** The EP thresholds and the always-list guarantee are confirmed by unit tests and nothing else. A golden dataset is what will exercise them, and that is not this milestone.

**A human verdict on the proposals.** Nine records sit at `Proposed`. Nothing here measures whether the recommendations are any good; this milestone measures whether the machinery survives. Rating them is Ben's to do, not a ticket.

**A migration system.** Four columns are added and the existing database will be refused and deleted. Building migrations would be machinery bought to protect a file that is deliberately not versioned.

**A second specification document.** Milestone 1 has a spec in the issue tracker and another under `docs/specs` saying overlapping things. This milestone has one, here.

**Anything about later milestones.** No evaluation dataset, no evaluation runner, no case study, no comparison against a baseline.

## Further Notes

**Two of the seven outcomes are already met.** Actions have travelled as derived schemas and been validated before dispatch since ADR-0016, and the nested extraction call is validated too. Those outcomes are closed by citation and by the repair work proving the `finish` path also refuses and recovers — not by building anything.

**The order is forced by one module.** The Failure Category function blocks retry, the checkpoint columns and degraded mode. The repair at `finish` is blocked by nothing and is the piece to drop if the milestone runs long, at the cost of leaving carried-forward item 2 open.

**Retry makes the outage worse before degraded mode makes it better.** Three attempts with backoff turns a futile lookup into roughly seven seconds, so twenty-three lookups against a blocked MusicBrainz would be three minutes of knocking to learn what the second lookup already knew. That arithmetic is why degraded mode is in this milestone rather than the next one.

**Two risks worth stating before they are discovered.** Two consecutive failures is a low bar for degrading, so a single flaky minute will trip it and a Degraded Run judges format on weaker evidence — the alternative is a Run that spends its ceiling learning the same fact more slowly. And a later milestone's evaluation will have to exclude or label Degraded Runs, or they will read as a ranking regression.

**The mid-write evidence run is deliberately untidy.** It leaves rows in Ben's real Notion database, and those rows *are* the evidence: they must survive until the Re-run has used them. If staging the interruption between two page creations live proves unreasonable, the same mechanism is provable with a fake that fails the third creation, and the evidence file must say which was done and why.

**Degraded mode is the opposite.** It is hardest to reproduce in the development sandbox and free to reproduce on Ben's own machine, where MusicBrainz blocks his IP. Run that one at home.
