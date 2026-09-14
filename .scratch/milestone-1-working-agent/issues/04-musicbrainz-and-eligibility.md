# 04: MusicBrainz enrichment and eligibility

**What to build:** Candidates are identified in MusicBrainz so that Release Identity rests on an identifier rather than string matching, and enriched with the release type, tracklist, duration, date, label and personnel that the rules need. A Candidate MusicBrainz has never heard of is marked Unverified and kept — absence is missing evidence, not invalidity. With that data in hand, the agent discards everything that is not an Eligible Release, so Ben's five slots go to new work.

**Blocked by:** 02

**Status:** ready-for-agent

## Acceptance criteria

- [ ] `lookup_release` reaches MusicBrainz through the `http` port with a descriptive User-Agent
- [ ] No more than one request per second is made, and the limit lives in the client
- [ ] A Candidate found in MusicBrainz carries its release-group identifier; one that is not is marked `unverified` and continues
- [ ] Partial MusicBrainz data enriches what it can and leaves the rest absent
- [ ] Release Identity prefers the MusicBrainz release-group identifier and falls back to artist and title only when Unverified
- [ ] An album is eligible; an EP is eligible only with at least 4 tracks and at least 20 minutes
- [ ] Live albums, singles, splits, compilations, reissues and remasters are excluded
- [ ] A Total Re-record is eligible; a partial re-record, a covers album and another band's version are not
- [ ] A release is eligible when any credible Source places its earliest official release date inside the resolved range, with the disagreement recorded
- [ ] Only already-issued releases are considered
- [ ] Where data needed to confirm eligibility is missing, the release is excluded
- [ ] Eligibility rules are tested directly as pure functions, including both EP thresholds, the Total Re-record carve-out and the missing-data exclusion
- [ ] The MusicBrainz client is tested through the `http` port against recorded fixture bodies including a partial-data response
- [ ] A live smoke test against MusicBrainz exists, invoked separately and excluded from the automated suite
