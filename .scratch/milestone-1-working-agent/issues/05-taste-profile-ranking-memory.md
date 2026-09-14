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
