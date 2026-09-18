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

**Failure Category**:
What went wrong outside the process, in one of six words. Distinct from Termination Reason: a category describes a failed external call, a reason describes a stopped run.
_Avoid_: error type, error code, failure mode

**Attempt**:
One request sent to a provider. A single external call is up to three of them: the adapter asks again when the Failure Category says asking again could help, and the count reaches the trace so a slow step is explained rather than wondered about. This is the only sense in which the project retries anything — Resume is not a retry, and neither is a Re-run.
_Avoid_: try, request count, redelivery

**Checkpoint**:
The recorded step a run can be restarted from. The trace is the checkpoint; there is no separate saved state.
_Avoid_: snapshot, savepoint, recovery point

**Resume**:
Continuing one interrupted run from its last checkpoint, with its working memory and its spent budget carried over. Always asked for by name.
_Avoid_: retry, restart, continue

**Re-run**:
A new run over a window an earlier run already covered. It inherits nothing, and what the earlier run wrote to Notion is suppressed, so it proposes what Ben has not seen. Distinct from Resume.
_Avoid_: rerun of, repeat, second pass

**Degraded**:
A run that finished without a provider it would normally use, judging on weaker evidence and recording what it could not check.
_Avoid_: fallback, partial, best-effort

**Golden Case**:
One recorded set of Source, MusicBrainz and Notion responses plus the arguments that ask for them, replayed through the real loop so that a Run happens against fixed bytes. The set of them is the Golden Dataset.
_Avoid_: test case, scenario, fixture

**Defect**:
Something an evaluation found wrong with a Run, in one of seven words. Distinct from both its siblings: a Failure Category describes a failed external call, a Termination Reason describes a stopped Run, and a Defect describes a Run that was wrong. Asserted by the grader against a labelled case, never recorded by a Run about itself.
_Avoid_: error, bug, miss, failure mode

**Back-test**:
A Run over a window in the past, judged against the albums Ben already has in Notion for that window. It measures coverage, never ranking.
_Avoid_: replay, historical run, regression run

**Known Set**:
The albums Ben logged for a given window and rated anything other than Nope, excluding anything this agent wrote and anything still unrated. It is a partial reference set: absence from it is missing evidence, never proof that a release is bad.
_Avoid_: ground truth, expected results, answer key

**Acceptance Rate**:
The share of proposals whose Status is not rejected. It measures the agent, and it moves without Ben listening to anything.
_Avoid_: hit rate, precision

**Taste Yield**:
The share of rated proposals rated Rotate or AOTY. It measures the recommendation rather than the agent, it moves over months, and it is read beside Shortlist Fill Rate — the share of Runs that proposed a full five — because yield alone rewards proposing fewer and safer.
_Avoid_: quality score, success rate
