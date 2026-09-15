# 05: Deliberate memory

**What to build:** The agent knows what Ben likes, and it knows what it has already proposed. The Taste Profile — hand-edited, versioned, never written by the agent — is read at the start of a Run and demonstrably changes the order of the Shortlist. Artists Ben always wants are guaranteed a slot; artists he never wants never appear; artists he is curious about get into ranking and compete on merit. Adjacency — label, personnel, genre — surfaces artists he would merely have heard of. Releases already in Notion are suppressed on Release Identity, so re-running a week proposes nothing twice.

Most of the ranking is arithmetic Ben can reason about. The model contributes only the resemblance judgement and the one-line Rationale, and must cite the Source text it relied on for each.

**Blocked by:** 04

**Status:** ready-for-agent

## Acceptance criteria

- [ ] The Taste Profile loads from a fixed path as JSON (ADR-0022), is validated with Zod, and fails loudly rather than silently loading empty lists
- [ ] The profile is never written by the agent, at any point, by any path
- [ ] The profile carries a top-level `version` key, hand-incremented on every edit; that value is what the Run records as `profile_version`
- [ ] A profile missing its `version` key fails validation rather than loading
- [ ] The profile sits in the request's stable prefix
- [ ] `artists.always` guarantees a Shortlist slot; `artists.watch` guarantees entry into ranking but no slot; `artists.exclude` is a hard filter
- [ ] Label and genre exclusions apply strong negative weight rather than filtering, so a mistagged record can still reach the Shortlist on other signals
- [ ] Artist tier, label, genre and personnel are scored deterministically into a base score
- [ ] `vibe_notes` is the only model judgement, and both it and the Rationale must cite Source text; an uncited judgement does not contribute
- [ ] A missing ranking signal removes that signal and the release proceeds — the opposite of the eligibility rule
- [ ] Releases already present in Notion are suppressed on Release Identity regardless of their Status
- [ ] Past Run traces are never sent to the model
- [ ] A Run demonstrably ranks differently under two different profiles, evidenced from the trace
- [ ] Ranking arithmetic, artist tiers and negative weights are tested directly as pure functions
- [ ] Suppression is tested end to end through the ports

## Comments

### What MusicBrainz actually offers Adjacency (probed live, 15 September 2026)

Ticket 04 left label and personnel unfetched, so this is the survey of what is
available before that gap is closed. Every row below was checked against the
live service, not the documentation.

| Signal | Where it lives | Cost | Coverage for this project's music |
| --- | --- | --- | --- |
| Label | `release?inc=labels` → `label-info[].label.name`, with catalogue number | free for an EP, which already fetches a release; one more request for an album | Good — Debemur Morti Productions and Century Media both present |
| Genre | `release-group/<id>?inc=genres` | one request | Excellent, and specific: `dissonant death metal`, `technical death metal`, `atmospheric sludge metal` |
| Band members | `artist/<id>?inc=artist-rels` → `member of band` | one request per artist | Good — Ulcerate returned its full current *and* past lineup |
| Producer, engineer, mix | `release?inc=recordings+recording-level-rels` | one request, and 86 KB on a well-documented album | **Effectively zero.** See below |

**Do not build a producer signal.** The relation types exist and work — Nirvana's
*Nevermind* returns `producer → Butch Vig` along with `engineer`, `mix` and
`recording` — but they sit at the *recording* level rather than the release, and
they are unpopulated for the music Riff Radar is for. Blood Incantation's
*Absolute Elsewhere* (2024) and Ulcerate's *Cutting the Throat of God* (2024)
each returned **no credits at any level**: not on the release, not on the
recordings. Two flagship, heavily edited modern metal albums.

CONTEXT.md's Adjacency says "its personnel", and `member of band` serves that
better than production credits would even if they were populated: it is one
cheap request, and it is the relation that actually matters here — the drummer
from Ulcerate starting a new band is how an artist Ben has merely heard of
reaches the Shortlist. Following a member's *other* bands needs a second hop per
member, which is where the request budget would go if that is wanted.

Genre is the best value of the four: cheap, well populated, and specific enough
to tell dissonant death metal from technical death metal.

**Not established:** whether genres are populated as well for obscure bands.
Ulcerate and Metallica both had them; the long tail was not sampled, and the long
tail is where a run actually lives. Worth one probe before genre is weighted
heavily.
