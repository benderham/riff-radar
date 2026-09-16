# 04: `--resume` picks a killed run back up

**What to build:** `riff-radar --resume <run-id>`: replay the parent's trace into working memory, continue the loop, record it as a new run pointing at its parent.

**Blocked by:** 03

**Status:** ready-for-agent

## Why

Today a run killed at step twenty costs the nineteen steps before it. The only recovery is to run the week again from the beginning, which pays for the same source fetches and the same MusicBrainz lookups a second time.

A Resume and a Re-run are both legitimate and they are not the same operation, which is why this is a flag and never an inference. Ben reviewing the first five and wanting the next five is a Re-run and already works. Ben losing a run to a kill is a Resume. If the CLI ever guesses, a deliberate second run silently becomes a continuation and Ben gets nothing new — the failure mode hardest to notice.

## What

`--resume <run-id>` takes no window argument; the window comes from the parent's row.

Startup is the *same path as a fresh run*: schema preflight, then a fresh suppression read. That is what makes a half-written parent self-correct — the pages it already wrote are in Notion, so the resumed run suppresses them and proposes what is left. The only difference from a fresh run is that working memory is replayed instead of empty.

The resume creates a **new** run row with `resumed_from` set. Step indices restart at zero. The parent is closed with `aborted`, so exactly one termination reason per run still holds.

## Acceptance criteria

- [ ] `--resume <run-id>` continues the parent's loop; `--resume` with a window argument is refused
- [ ] Without the flag, a run is always new — even when an unfinished run exists for the same window. The CLI may *mention* one; it must not act on it
- [ ] Working memory is rebuilt from the parent's trace: `messages` from `model_response` and `tool_result`, candidates from the latest `candidates_after`, usage summed from the step columns, consecutive-invalid from the trailing `invalid_action` steps
- [ ] The resumed run does not repeat a completed step — a parent with two `fetch_source` steps does not fetch those sources again
- [ ] A step interrupted before it was recorded is simply re-run; a test covers a parent killed between a tool call and its `recordStep`
- [ ] **No abort mechanism is built for the tests.** A killed run is simulated by writing a partial run into the real in-memory store and calling with `--resume`. Resume's input is the trace, so a hand-written trace is a legitimate input and the test exercises the real path rather than a test-only hook
- [ ] Four refusals, each with its own message and test: no such run id; the run already has a termination reason; the run has no recorded steps; the run's `prompt_version`, `profile_version` or `action_schema_version` differs from current configuration
- [ ] The resumed run is a new row with `resumed_from` set and `step_index` from 0; the parent's row is closed `aborted`
- [ ] Step and cost ceilings are **inherited** — a parent that used 28 steps leaves the child two, and a test proves a resume cannot launder the budget
- [ ] The schema preflight and the suppression read both run again on resume
- [ ] `npm run trace` follows `resumed_from` and prints the chain as one story, with the totals for the chain

## Notes

Resuming a run that died at step 28 is very nearly pointless: it gets two steps and will probably end `max_steps_exceeded`. That is correct — the right response is a Re-run — and it will look like a broken feature the first time it happens, so the CLI should say what it inherited when it starts.

At-least-once on the interrupted step is safe because every tool in the loop is side-effect-free. The only side effect in the system is the Notion write, which is post-loop and covered by suppression (ADR-0051).

See ADR-0047 and ADR-0050.
