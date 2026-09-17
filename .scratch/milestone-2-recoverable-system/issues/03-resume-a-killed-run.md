# 03: A killed run can be picked up where it stopped

**What to build:** `riff-radar --resume <run-id>` continues an interrupted run from its last recorded step, without repeating work the parent completed.

**Blocked by:** 01

**Status:** ready-for-agent

## Why

A run killed at step twenty costs the nineteen steps before it. The only recovery is to run the week again from the beginning, paying again for the same source fetches and the same MusicBrainz lookups — and on a busy week the ceiling means the second attempt may not reach `finish` either.

This ticket is the happy path, end to end: a killed run, resumed, carrying on. Ticket 04 adds what it refuses and what it inherits.

## What

**Checkpointing is one column, because everything else already replays.** Steps already record the model's raw response, the dispatched action, the tool result, usage and timing. From those, a resume rebuilds the message history, the accumulated usage, the consecutive-invalid counter, the repair counter and the degraded counter. The candidate list is the exception: a source fetch returns the whole merged list in its result, but a lookup enriches the list in place, collapses it by release group and returns only reshaped facts about one release. Rebuilding it would need an inverse of that reshaping — the kind of function that breaks silently and gets believed. So the candidate list is written to `candidates_after` on every step, and nothing else is stored (ADR-0046).

**Startup is the same path as a fresh run**: schema preflight, then a fresh suppression read. That is what makes a half-written parent self-correct, because the pages it already wrote are in Notion and are therefore suppressed. The only difference from a fresh run is that working memory is replayed instead of empty.

**A resume is a new run row** carrying `resumed_from`, with step indices restarting at zero. The parent is closed `aborted`, so exactly one termination reason per run still holds and a run row never changes its mind.

The columns all exist already — ticket 01 added them.

## Acceptance criteria

- [ ] Every recorded step carries a non-null `candidates_after`, including `invalid_action`, `tool_error` and `finish` steps
- [ ] `candidates_after` round-trips: a candidate list written and read back is deeply equal, including the `lookup` enrichment
- [ ] `--resume <run-id>` continues the parent's loop; `--resume` combined with a window argument is refused, because the window comes from the parent's row
- [ ] Without the flag, a run is always new — even when an unfinished run exists for the same window. The CLI may *mention* one; it must not act on it (ADR-0047)
- [ ] Working memory is rebuilt from the parent's trace: messages from the recorded model responses and tool results, candidates from the latest `candidates_after`, usage summed from the step columns, consecutive-invalid from the trailing `invalid_action` steps
- [ ] The resumed run does not repeat a completed step — a parent with two `fetch_source` steps does not fetch those sources again
- [ ] A step interrupted before it was recorded is simply re-run; a test covers a parent killed between a tool call and its step record
- [ ] The resumed run is a new row with `resumed_from` set and step indices from 0; the parent's row is closed `aborted`
- [ ] The schema preflight and the suppression read both run again on resume
- [ ] `npm run trace` follows `resumed_from` and prints the chain as one story, with the chain's totals
- [ ] A test proves what is *not* stored is derivable from what is — messages, usage, and the consecutive-invalid count

## Notes

**No abort mechanism is built for the tests.** A killed run is simulated by writing a partial run into the real in-memory store and calling with `--resume`. Resume's input is the trace, so a hand-written partial trace is a legitimate input, and the test exercises the real path rather than a test-only hook.

At-least-once on the interrupted step is safe because every tool in the loop is side-effect-free. The only side effect in the system is the Notion write, which is post-loop and covered by suppression (ADR-0051).

The candidate list is re-serialised on every step, so a busy run writes it twenty-odd times. That is kilobytes, and it buys a resume that cannot be subtly wrong.

## Comments

**17 September 2026, during implementation.** Two things the ticket did not
predict.

`model_response` could not answer the question ADR-0046 asked of it: it held
the provider's raw body, and rebuilding an assistant message from that would
have put Fireworks' wire format inside the loop. It now holds
`{content, toolCalls, raw}` — ADR-0055.

A resume replays the whole ancestor chain rather than the run named on the
command line. Ticket 04's criterion about a grandchild inheriting the chain's
spend turned out not to be an accounting nicety: replaying one link would lose
the *conversation* of everything before it, so a resume of a resume was broken
in ticket 03's own happy path. Implemented here, with a test; ticket 04's
criterion is therefore already met.

**Found, not fixed:** `citedVibes` checks a model's vibe note against
`store.sourceTextsOf(runId)`, which is narrow to the current run by design
(ADR-0009). A resumed run stored none of the parent's pages, so a vibe note
quoting a page the *parent* fetched is silently dropped from the ranking. It
degrades quietly rather than failing, and the fix is a decision about whether
`sourceTextsOf` should follow `resumed_from`. Belongs with ticket 04's other
chain semantics, or its own ticket.
