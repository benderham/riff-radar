# Riff Radar

Riff Radar finds metal albums released in a recent date range, checks them against Ben's explicit taste profile, and proposes a small shortlist for him to listen to and judge. This file defines the project's language. It is a glossary only: no implementation detail, no specification.

## Language

**Run**:
One manually started execution covering a single resolved date range.
_Avoid_: job, batch, session

**Source**:
One of the fixed, configured websites the agent reads to discover releases.
_Avoid_: feed, provider, site

**Candidate**:
A release extracted from a source that has not yet been judged eligible.
_Avoid_: result, hit, suggestion

**Eligible Release**:
A candidate that passes the format and novelty rules: a full album or a substantial EP, first released in the range, and not a live album, single, compilation, reissue or remaster. A total re-record counts as eligible. A release credited to more than one artist is judged on all of them, and one artist on the Taste Profile's excluded list makes the release ineligible whatever the others are.
_Avoid_: valid release, qualifying album

**Total Re-record**:
An original band re-recording substantially the full tracklist of its own earlier release. A partial re-record, a covers album, or another band's version is not one.

**Shortlist**:
The ranked set of eligible releases a run proposes, never more than five.
_Avoid_: results, recommendations, picks

**Shortlist Item**:
One release on the shortlist, carrying its rank, its rationale, and the sources its facts came from.

**Release Identity**:
What makes two records the same release. A MusicBrainz release-group identifier where one exists; otherwise the release is marked unverified and identity falls back to artist and title.
_Avoid_: key, dedup key

**Date Disagreement**:
Two or more sources stating different release dates for the same release. Every stated date is kept; none is chosen on the sources' behalf.
_Avoid_: date conflict, mismatch

**Source Text**:
The page a source served, stored exactly as received so that an extraction can be re-examined without fetching again.
_Avoid_: snapshot, cache, scrape

**Unverified**:
A release the agent could not find in MusicBrainz. Unverified means missing evidence, never invalidity.
_Avoid_: unknown, invalid, unmatched

**Taste Profile**:
The explicit, versioned, hand-edited statement of what Ben wants surfaced and what he wants suppressed. It changes only through a reviewed edit, never by the agent.
_Avoid_: preferences, model, profile

**Adjacency**:
The reasons a release might appeal to Ben other than the artist itself: its label, its personnel, its genre, and its stated resemblance to things he already likes. Adjacency is how an artist he has merely heard of reaches the shortlist.
_Avoid_: similarity, affinity, recommendation signal

**Status**:
Ben's verdict on whether a proposed release belonged on the list at all. It measures the agent.
_Avoid_: state, approval

**Rating**:
Ben's verdict on an album after listening to it: Nope, OK, Rotate, or AOTY. It measures the recommendation, not the agent.
_Avoid_: score, rank, grade

**Rank**:
A shortlist item's position relative to the others in the same run. Distinct from Rating.

**Termination Reason**:
The single recorded explanation of why a run stopped. Every run has exactly one.
_Avoid_: exit code, outcome, result
