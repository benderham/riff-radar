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

- [ ] Two consecutive failed lookups — categories `transient` or `unavailable` — flip the run to Degraded; one failure followed by a success does not
- [ ] In Degraded mode `lookup_release` makes no request and returns immediately, saying MusicBrainz is unavailable and what that means for the verdict
- [ ] A release with no lookup is judged by `isEligible` on its source's stated format, reusing the ADR-0045 path rather than a second one
- [ ] `runs.musicbrainz_degraded` is set, and the shortlist items say the release was judged without MusicBrainz
- [ ] The Notion record states it too, so Ben knows which proposals rest on weaker evidence
- [ ] The trace names all three losses explicitly — reissue and remaster detection, the EP thresholds, and the three ranking terms — rather than leaving them to be inferred
- [ ] **No new termination reason.** A degraded run ends `completed`, `completed_short` or `no_candidates` like any other
- [ ] The counter is **recomputed** on resume from the trailing `lookup_release` steps, not stored — it is derivable, and ADR-0046 stores only what is not
- [ ] Tested against recorded fixtures for a blocked provider and for a 503, without a network

## Notes

A degraded run can propose a reissue or a live album that a source mislabelled, with nothing to catch it. That is the same narrow exposure ADR-0045 already accepted, now reachable by an outage instead of by a missing field.

Two consecutive failures is a low bar and a single flaky minute will trip it. The alternative is a run that spends its ceiling discovering the same fact more slowly.

Milestone 3 must exclude or label degraded runs in its evaluation, or they will read as a ranking regression. Worth a line in the evidence file.

See ADR-0052.
