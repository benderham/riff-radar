# 04: MusicBrainz enrichment and eligibility

**What to build:** Candidates are identified in MusicBrainz so that Release Identity rests on an identifier rather than string matching, and enriched with the release type, tracklist, duration, date, label and personnel that the rules need. A Candidate MusicBrainz has never heard of is marked Unverified and kept — absence is missing evidence, not invalidity. With that data in hand, the agent discards everything that is not an Eligible Release, so Ben's five slots go to new work.

**Blocked by:** 02

**Status:** done

## Acceptance criteria

- [x] `lookup_release` reaches MusicBrainz through the `http` port with a descriptive User-Agent — the repository URL, not Ben's address (ADR-0034)
- [x] No more than one request per second is made, and the limit lives in the client
- [x] A Candidate found in MusicBrainz carries its release-group identifier; one that is not is marked `unverified` and continues
- [x] Partial MusicBrainz data enriches what it can and leaves the rest absent
- [x] Release Identity prefers the MusicBrainz release-group identifier and falls back to artist and title only when Unverified — `releaseIdentityOf`, with `collapseByReleaseGroup` spending the proof where it is produced
- [x] An album is eligible; an EP is eligible only with at least 4 tracks and at least 20 minutes
- [x] Live albums, singles, compilations, reissues and remasters are excluded — **splits no longer are**, by amendment (ADR-0036)
- [x] A Total Re-record is eligible — the other three exclusions are **accepted as out of scope**, not outstanding; see **The scope Ben accepted** below
- [x] A release is eligible when any credible Source places its earliest official release date inside the resolved range, with the disagreement recorded
- [x] Only already-issued releases are considered
- [x] Where data needed to confirm eligibility is missing, the release is excluded (ADR-0035)
- [x] Eligibility rules are tested directly as pure functions, including both EP thresholds, the Total Re-record carve-out and the missing-data exclusion
- [x] The MusicBrainz client is tested through the `http` port against recorded fixture bodies including a partial-data response
- [x] A live smoke test against MusicBrainz exists, invoked separately and excluded from the automated suite

## The scope Ben accepted

Two thirds of the re-record carve-out fall out of MusicBrainz's data model rather than a rule of ours, and were verified against the live service: a **total re-record** gets its own release group with its own date, so it qualifies like any other new album, while a **reissue or remaster** stays inside the original's release group and excludes itself on that group's date. Exodus is the worked example — one group dated 1985 holding fifteen releases, and a separate group for the 2008 re-record.

**A covers album, a partial re-record and another band's version are none of them excluded, and Ben accepted that on 15 September 2026** — the records are rare enough that the slots they would cost are not worth a rule the data cannot support. Each is its own release group with its own date, and MusicBrainz has no secondary type for any of them, so all three pass as new albums. This is a closed decision, not work deferred to ticket 05. An earlier draft of this section claimed the match rule handled the third; that was wrong, and a review caught it.

One of the two items below was resolved the same day; the other remains open.

**Label and personnel are not fetched.** The ticket's opening paragraph asks for them. A release group carries neither, so each would cost a further request per candidate. Nothing ranks on them until ticket 05, so the request was not made — a deferral ticket 05 has to close, not a quiet drop.

~~**`artistCount > 1` is a proxy for a split, not the rule.**~~ **Resolved** — Ben overturned it the same day. A release is judged on *who* made it rather than how many: the lookup carries the credited artists' names, and any one of them on `artists.exclude` sinks the release. A split and a collaboration are indistinguishable in the data, so both stand or fall on taste. See ADR-0036; this also enforces an `artists.exclude` rule the prompt had claimed since the beginning and no code applied.

## Evidence

`npm run check` — 238 tests pass, typecheck clean, layering clean.

`npm run smoke:musicbrainz` against the live service, 15 September 2026, exit 0:

```
Ulcerate — Cutting the Throat of God  (expecting an album, 3196ms)
  c302ec77-589f-462f-b6b3-d63508886978  Album  2024-06-14

Ulcerate Fester — Unceasing Life  (expecting an EP, with its tracks counted, 2118ms)
  dd8a80d5-83d7-41b9-bc06-2efdfe80d5f4  EP  1991-03
  4 tracks, 27 minutes

Vaultwraith Of Nowhere — Crimson Nadir Unreleased  (expecting nothing at all, 797ms)
  not found
```

The EP case names *Ulcerate Fester* deliberately: it is a different band from Ulcerate, and a fuzzy search offers its EP up when asked about Ulcerate. Getting it right exercises the match rule as well as the second request.

## Comments

Four things the live service taught that no fixture would have — a 200 with an error body, frequent load-shedding, a fuzzy scored search that offers a different band, and partial dates like `1985`. All four are in ADR-0034, and each one changed the client.

One bug was found by a test rather than by the service: the rate limiter is module-level and assumed a monotonic clock, so a test that restarts its clock left the gate trying to wait out a day. A clock that has gone backwards now owes nothing, which is also what should happen after an NTP correction in production.
