# 02: Seven words for a run that was wrong

**What to build:** `src/domain/eval.ts` — the Defect union and the pure assertions that produce it from a completed Run plus its case labels.

**Blocked by:** nothing

**Status:** ready-for-agent

## Why

The project can say what broke outside a Run (Failure Category) and why a Run stopped (Termination Reason). It cannot say the Run was *wrong*. Run `3e657aa3` completed cleanly, wrote nothing to any error column, and scored all five proposals zero — indistinguishable in the trace from a Run that ranked correctly.

Everything else in this milestone depends on this module, so it is built first and alone.

## What

A seven-value union and one function per member, all pure, all over data the store already produces:

- `missed` — a release the case labels eligible, absent from the Shortlist.
- `spurious` — a Shortlist item that is ineligible or outside the window.
- `ungrounded` — a factual field with no source URL behind it, or a vibe note whose quote is absent from the stored Source Text. Reuse `citedVibes` (ADR-0040); do not restate the rule.
- `misranked` — Shortlist order contradicts the profile's own arithmetic, i.e. an item ranked above one with a strictly higher score.
- `wasteful` — the Run completed over the case's step or cost budget.
- `escaped` — a tool failure milestone 2 built recovery for, that the Run did not survive.
- `unlisted` — a labelled release absent from `source_texts.raw_body`, so no agent behaviour could have found it.

`unlisted` is checked **before** `missed` and suppresses it: a release no Source carried is a coverage gap, not an agent failure (carried-forward item 1).

Nothing is added to `runs` or `steps`. A Defect is a property of a grading, not of a Run.

## Acceptance criteria

- [ ] The seven are a closed union; an eighth value does not typecheck
- [ ] Each Defect has tests that fire it and tests that must **not** fire it
- [ ] `ungrounded` calls the existing vibe-citation rule rather than a second copy
- [ ] `unlisted` suppresses `missed` for the same release, proved by a test
- [ ] No migration, no new column, no change to `src/store/`
- [ ] Run records in tests are small and hand-written, not real traces
- [ ] `npm run check` green

## Notes

ADR-0059. `CONTEXT.md` already carries the term.
