# Golden Cases

One directory per case: `<NN>-<slug>/case.json` plus the bodies it records under
`responses/`. `case.json` is validated by `caseSchema` in `src/domain/eval.ts`
and refused loudly — a case that does not parse is not a case that runs with
defaults (ADR-0058).

Both `sources` and `responses` name files relative to `fixtures/`, never to the
case directory, so a body two cases share is referenced twice rather than copied
twice. The two Source pages are always shared this way: twelve copies of 1.9MB
to vary a date range is storage bought for nothing (ADR-0062).

`responses` keys are URL **prefixes**, and the longest match wins. That is what
makes a broad recording a fallback: a case can answer every MusicBrainz
release-group query with one not-found body, and a harvested case overrides it
per release with a longer key carrying the encoded query. A URL matching no key
is a missing recording and throws — it is never quietly a 404, because a graded
defect has to be about the agent rather than about the fixture. A configured
source absent from `sources` is the one deliberate exception: it answers 404, and
the run degrades with a warning the way it would against a source that was down
(ADR-0030).

`00-smoke` is not one of the twenty. It exists to prove the runner and to be the
worked example the schema is written against: one source, no MusicBrainz
coverage, an empty Notion database.

`sample-report.json` is a **constructed** pass, not a recorded one: four cases
with numbers chosen to exercise the arithmetic — two defect words, an incomplete
run, an even count for the median. `aggregate` is unit-tested against it, so the
arithmetic has a subject that does not move. A real single-case pass is in
`docs/evidence/eval-00-smoke.json`.
