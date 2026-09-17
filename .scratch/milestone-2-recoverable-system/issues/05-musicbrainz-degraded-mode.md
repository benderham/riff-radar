# 05: A run that cannot reach MusicBrainz says so and finishes anyway

**What to build:** After two consecutive silent lookups, stop calling MusicBrainz, judge format on the source's stated word, and record what could not be checked.

**Blocked by:** 01, 02

**Status:** ready-for-agent

## Why

Ben's own machine cannot reach MusicBrainz at all — his IP is blocked — and every run so far has been made from the development sandbox. Runs `5edc2927` and `51b4dda6` survived the outage (ADR-0043) and proposed nothing: an unlooked-up release is excluded, so both ended `validation_failed` holding a shortlist built in good faith.

Ticket 02 makes that worse before it makes it better. Three attempts with backoff means each futile lookup now costs about seven seconds, so 23 lookups against a blocked provider is three minutes of knocking to learn one fact the second lookup already knew.

## What

Two consecutive `lookup_release` steps whose failure category is `transient` or `unavailable` put the run into Degraded mode. From then on `lookup_release` returns immediately, without a request, telling the model that MusicBrainz is unavailable and that releases are judged on their source's stated format.

That rule is not new: it is exactly what ADR-0045 already does for a release group nobody has typed. Nothing is invented under failure.

What is lost is stated rather than discovered:

- no reissue or remaster detection
- no EP track-count or duration thresholds
- ranking loses its label, genre and personnel terms

The run still completes and still writes. A degraded shortlist Ben reviews is worth more than a dead run, and Ben reviews everything.

## Acceptance criteria

- [x] Two consecutive failed lookups — categories `transient` or `unavailable` — flip the run to Degraded; one failure followed by a success does not
- [x] In Degraded mode `lookup_release` makes no request and returns immediately, saying MusicBrainz is unavailable and what that means for the verdict
- [x] A release with no lookup is judged by `isEligible` on its source's stated format, reusing the ADR-0045 path rather than a second one
- [x] `runs.musicbrainz_degraded` is set, and the shortlist items say the release was judged without MusicBrainz
- [x] The Notion record states it too, so Ben knows which proposals rest on weaker evidence
- [x] The trace names all three losses explicitly — reissue and remaster detection, the EP thresholds, and the three ranking terms — rather than leaving them to be inferred
- [x] **No new termination reason.** A degraded run ends `completed`, `completed_short` or `no_candidates` like any other
- [x] The counter is **recomputed** on resume from the trailing `lookup_release` steps, not stored — it is derivable, and ADR-0046 stores only what is not
- [x] Tested against recorded fixtures for a blocked provider and for a 503, without a network

## Notes

A degraded run can propose a reissue or a live album that a source mislabelled, with nothing to catch it. That is the same narrow exposure ADR-0045 already accepted, now reachable by an outage instead of by a missing field.

Two consecutive failures is a low bar and a single flaky minute will trip it. The alternative is a run that spends its ceiling discovering the same fact more slowly.

Milestone 3 must exclude or label degraded runs in its evaluation, or they will read as a ranking regression. Worth a line in the evidence file.

See ADR-0052.

## Comments

**17 September 2026, during implementation.** The criterion that shaped the code
was the one about recomputing the counter. A degraded lookup has to record a
failure category of its own, or the trailing run of silent lookups ends the
moment degradation begins and a resumed run asks MusicBrainz again — so a
degraded lookup records `unavailable`, which is exactly what ADR-0048 defined
that category for. Degradation then needs storing nowhere: `runs.musicbrainz_degraded`
is written for Ben and for milestone 3 to count, and no code reads it back.

Two decisions the ticket left open. The Notion record states it in `Rationale`
rather than in a property of its own, because a new property has to exist in
Ben's database before the schema preflight will let a run start, and a run that
refuses to start is the opposite of what degradation is for. And the per-item
stamp lives outside the action schema, set by the run, so saying it costs no
`ACTION_SCHEMA_VERSION` bump — which would have invalidated every unfinished
run, including the ones this feature exists to rescue. It is stamped only on
items with no release-group id: a release looked up before the outage was
judged on MusicBrainz's word like any other.

Ranking needed no change at all. `scoreRelease` already drops the genre and
personnel terms when a candidate has no lookup and falls back to the source's
label, so the three losses ADR-0052 names were already true of the code; what
was missing was saying them, and the degraded lookup's answer now does.

**What the reviews caught.** Two real defects. The replay counted any step whose
`tool_name` was `lookup_release`, including an `invalid_action` the loop refused
before dispatch — nothing was asked of MusicBrainz, but a null failure category
read as an answer, so "silence, silence, a malformed lookup proposal" resumed
*non-degraded and started knocking again*: the exact failure the `unavailable`
category was chosen to prevent. And the loop's own reset — one silence followed
by an answer is not two — was pinned by no test: replacing `: 0` with
`: lookupFailures` left all 464 passing, because the scenario only ever produced
one failure. Both are fixed, and the mutation now kills the new test.

**Not done, deliberately.** "Recorded fixtures for a blocked provider and for a
503" is served by a scripted HTTP fake rather than a file under `fixtures/`.
There is nothing to record: a blocked provider returns no answer and no body,
and a 503 returns no body this code reads. `fixtures/` holds captures, and
inventing an empty one to satisfy the wording would be evidence of nothing. The
criterion's substance — both failures tested, no network — is met.

**Left for milestone 3:** degraded runs must be excluded from, or labelled in,
the evaluation, or they will read as a ranking regression. `musicbrainz_degraded`
is the column to filter on. Milestone 2's evidence file (ticket 07) is where
that line belongs; it does not exist yet.
