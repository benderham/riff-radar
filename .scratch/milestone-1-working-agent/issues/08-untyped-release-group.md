# 08: A release group MusicBrainz has not typed is judged on the source's word

**What to build:** A release MusicBrainz knows about but has not given a primary type is treated the way a release MusicBrainz has never heard of is already treated: the source's stated format decides, and the release is marked Unverified rather than excluded outright. Today it is excluded, which means the run trusts *less* evidence more than it trusts *more* evidence.

**Blocked by:** 04

**Status:** ready-for-agent

## Why

Three runs on 16 September 2026 died at `validation_failed` on *Mother of Millions — T*, a record Ben actually likes. The data is not ambiguous:

```
release-group 8c8418df-b881-491e-bbdc-39454b80f78d
  title            T
  primary-type     null
  secondary-types  []
  first-release    2026-09-11
  releases         2026-09-11 · Official · 10 tracks
```

One official release, dated inside the window, ten tracks. The only thing missing is a field nobody has filled in at MusicBrainz. `formatVerdict` in `src/domain/eligibility.ts` answers `MusicBrainz states no release type` and the release is refused — while an identical record MusicBrainz had never heard of would have passed on Loudwire's "full-length", because the `found: false` branch below it falls back to the source's stated format.

That ordering is backwards. An untyped release group carries *more* evidence than an absent one: a confirmed identity, a confirmed date, a confirmed track count, a confirmed official release. The rule that governs the weaker case should govern the stronger one.

## Acceptance criteria

- [ ] A release group with no `primary-type` falls through to the same source-format rule that an unheard-of release already uses: a stated album format passes, a stated live album, single or compilation does not, and no stated format at all still excludes
- [ ] A release group with no `primary-type` is reported as Unverified — the Notion row and the shortlist item say so, exactly as an unheard-of release does, because MusicBrainz has not in fact confirmed what it is
- [ ] Every other MusicBrainz verdict is unchanged: a stated `Single`, `Broadcast` or `Other`, and every excluded secondary type, still exclude on MusicBrainz's word rather than the source's
- [ ] The release-group date still governs: an untyped group first released before the window is still a reissue, and the new path cannot smuggle one in
- [ ] An EP that MusicBrainz types as an EP still pays for its second request and still meets the track and duration thresholds; an untyped group is not a way around them
- [ ] `lookup_release` reports the resulting verdict to the model as it now does for every other case
- [ ] Tested against a recorded fixture of a real untyped release group — capture *T*'s, since it is the record that found this
- [ ] The decision is recorded in `docs/decisions.md`, amending ADR-0034, including what it costs: a source that mislabels an untyped release is now believed

## Notes

Ben's other fix is upstream and is not this ticket: MusicBrainz is user-editable, and setting *T*'s primary type to `Album` corrects the record for everyone. Both are worth doing. This ticket exists because the next untyped release group will not be one anybody noticed.
