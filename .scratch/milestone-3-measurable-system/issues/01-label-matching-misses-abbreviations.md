# 01: A label the source abbreviated scores nothing

**What to build:** Decide and implement how a profile label term matches a label a source printed, when one is an abbreviation of the other.

**Blocked by:** 08 — the baseline must be taken before this ships

**Status:** ready-for-agent

## Why

Run `3e657aa3` — the first degraded run to propose anything — shortlisted five releases and scored **every one of them zero**. The order Ben read was the model's own preference surviving through the tie-break, not the profile's arithmetic.

One of those five is on a label Ben included:

```
profile labels.include:  "Reigning Phoenix Music"
candidate.label:         "Reigning Phoenix"        (Loudwire's calendar)
```

`matching()` in `src/domain/ranking.ts` asks whether the *value* contains the *term*. `Century Media` finds `Century Media Records`; `Reigning Phoenix Music` finds nothing in `Reigning Phoenix`. The containment runs one way, and a source that shortens a label is on the wrong side of it.

The model noticed what the ranking missed. Its rationale for that release reads "credited to Reigning Phoenix Music, which is on the profile's label include list" — a true statement, while the signal that should have scored it recorded nothing.

Undegraded runs are insulated: MusicBrainz supplies the label in full, and `scoreRelease` prefers it. That is why this has never been visible in a run before — and it is also why it matters now, because a degraded run has no full name to fall back to and the label is the last ranking signal it has left. It is not a degraded-mode bug: any release MusicBrainz has never heard of has always been scored on the source's abbreviation.

## What

The decision, not yet taken: what "the same label" means.

Symmetric containment — either string containing the other — matches `Reigning Phoenix` to `Reigning Phoenix Music` and costs one line. It also matches a term to a value that merely starts the same way, and `Rise Records` against a bare `Rise` is the shape of the false positive. Labels are not as dangerous as artist names here (`matchingNames` is already whole-name for exactly that reason, ADR-0007's Ulcerate case), because a label is negative or positive weight rather than a guaranteed slot — nothing is filtered by it.

Worth weighing against two cheaper answers:

- **Normalise the suffix.** Strip a trailing `Records`, `Music`, `Productions`, `Recordings` from both sides before comparing. Narrow, predictable, and it fixes the observed case without opening containment up.
- **Fix the data.** The profile is hand-edited and Ben owns it; the terms could simply be written as the sources print them. This costs nothing in code and moves the problem to whichever source abbreviates differently next.

Whichever is chosen, a label that scored should be **visible as a signal in the trace**, which it already is — this ticket only changes which ones fire.

## Acceptance criteria

- [ ] A decision recorded in `docs/decisions.md`, with the false-positive it accepts stated
- [ ] `Reigning Phoenix` and `Reigning Phoenix Music` score as the same label
- [ ] The rule is proved by unit tests over the real pairs, including at least one that must **not** match
- [ ] Nothing about artist matching moves: `matchingNames` stays whole-name (ADR-0007)
- [ ] Re-scoring run `3e657aa3`'s candidates under the new rule produces a non-zero score for the CoreLeoni release

## Notes

This is milestone 3's **controlled change** (ADR-0058, ADR-0065), and the
ordering was reversed when the milestone was defined on 18 September 2026: the
baseline is taken **before** this ships, not after. Fixing it early destroys the
only before-and-after the milestone has. See ticket 08.

Evidence: run `3e657aa3`, finish step, `ranking` array — five items, `signals: []`
on all five. ADR-0052's second amendment describes the same finding.
