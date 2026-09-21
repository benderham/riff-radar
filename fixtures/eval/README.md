# Golden Cases

One directory per case: `<NN>-<slug>/case.json` plus the bodies it records under
`responses/`. `case.json` is validated by `caseSchema` in `src/domain/eval.ts`
and refused loudly — a case that does not parse is not a case that runs with
defaults (ADR-0058).

Both `sources` and `responses` name files relative to `fixtures/`, never to the
case directory, so a body two cases share is referenced twice rather than copied
twice. The two Source pages are always shared this way: twelve copies of 1.9MB
to vary a date range is storage bought for nothing (ADR-0062). So are the three
Notion bodies every case needs — the suppression read, the schema and a created
page — which is why they sit in `fixtures/` rather than under a case.

The suppression read is `notion-query-empty.json` in every case, and that is
deliberate rather than lazy: Ben's real database holds the very albums a
historical week is being measured against, so a realistic suppression read would
suppress precisely the Known Set and every back-test would score zero. An empty
database is the question "what would this week have proposed, the first time
anyone asked".

A `responses` value is a file path for the ordinary recording, which means a
200. The object form — `{ "status": 503, "headers": {...}, "file": "..." }` —
records everything else, because two of the seven Defects are about failure and
a format that can only record success cannot carry those cases at all.

`responses` keys are URL **prefixes**, and the longest match wins. That is what
makes a broad recording a fallback: a case can answer every MusicBrainz
release-group query with one not-found body, and a harvested case overrides it
per release with a longer key carrying the encoded query. A URL matching no key
is a missing recording and throws — it is never quietly a 404, because a graded
defect has to be about the agent rather than about the fixture. A configured
source absent from `sources` is the one deliberate exception: it answers 404, and
the run degrades with a warning the way it would against a source that was down
(ADR-0030).

`00-smoke` is not one of the twenty, and the runner skips it: a slug starting
`00-` is a fixture of the runner rather than a Golden Case, because a pass that
included it would skew the mean cost, the median latency and every defect count
ADR-0065's budgets are set against. `npm run eval --case 00-smoke` still runs
it. It exists to prove the runner and to be the worked example the schema is
written against: one source, no MusicBrainz coverage, an empty Notion database.

A case that throws — a recording nobody made, a file that moved — is reported
and skipped rather than ending the pass: every case before it has already been
paid for at the model, and a report that never gets written is that spend thrown
away.

## The harvested twelve

`npm run harvest -- --list` prints them; `npm run harvest -- --week 2026-01-16` makes
one. The weeks are not chosen by hand: they are the earliest twelve of the frozen
Known Set (`weeksToHarvest`), which is where `fixtures/wikipedia.html` is least
affected by its 36% truncation, and the busy week among them is what the
above-cap regime of `hits / min(k, 5)` is read against (ADR-0062).

Each case's `now` is **noon UTC**. `resolveWindow` reads the local date of the
instant, so a case pinned near an edge of the day replays a different week on a
machine in another timezone; noon UTC has the most room on both sides, and every
zone from UTC-11 to UTC+11 reads the same date from it. (New Zealand in daylight
saving, at UTC+13, is the exception — a pass run there resolves one day later.)

`labels.eligible` is that week's Known Set, derived from `known-set.json` rather
than written by anyone: it is a frozen file and a rule, and nothing in a
harvested case labels rank order or desirability (ADR-0060). `labels.ineligible`
is empty in the twelve. `spurious` still fires on a shortlist item dated outside
the window, which needs no label, and the eight mutated cases of ticket 06 are
built for the rest of that side — a reissue, an EP on both sides of both
thresholds, a release MusicBrainz has never heard of. A Known Set member the
eligibility rules would themselves refuse (one of the ten EPs in the set) is
labelled eligible here and will read as `missed`; the lookups recorded in the
case are what a later pass can correct that from, with no re-harvest.

`budget` is uniform across the twelve and provisional. `wasteful` means
"completed, having spent more than the case allowed", and what a week of real
MusicBrainz coverage costs is not known until the baseline has run, so one
number is carried for all twelve and revisited in ticket 09 (ADR-0065).

Harvest records **more lookups than the run asked for**: after the run, every
candidate it extracted and every Known Set member for the week is looked up.
The model is the one thing a pass does not freeze, so tomorrow's run asks
questions today's did not, and an unrecorded URL throws by design. The seeding
is what makes the case survive model drift without being re-harvested.

`sample-report.json` is a **constructed** pass, not a recorded one: four cases
with numbers chosen to exercise the arithmetic — two defect words, an incomplete
run, an even count for the median. `aggregate` is unit-tested against it, so the
arithmetic has a subject that does not move. A real single-case pass is in
`docs/evidence/eval-00-smoke.json`.
