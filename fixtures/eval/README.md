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

## The mutated eight

The scenarios the brief demands and history did not supply. Harvesting twelve
real weeks gave normal and missing for free; duplicates, ambiguity, conflicting
dates and a failed tool are here, hand-built, along with the two rules that had
never fired outside a unit test in any run ever made — the EP thresholds and the
`artists.always` guarantee (carried-forward item 4).

| Case | Brief scenario | What it mutates |
|---|---|---|
| `01-duplicate` | duplicate | one release listed by both Sources, spelled `Winter Of The Ledger` and `Winter of the Ledger` |
| `02-ambiguous` | ambiguous | five MusicBrainz answers to one artist name, the first a namesake dated 2011 |
| `03-conflicting` | conflicting | two Sources stating different dates, and a MusicBrainz that knows neither release |
| `04-degraded` | failed-tool | every MusicBrainz URL answers 503, and the run degrades (ADR-0030, ADR-0052) |
| `05-recovers` | failed-tool | one lookup fails and the ask after it is answered (ADR-0067) |
| `06-ep-boundary` | EP thresholds | four EPs: 3 tracks, 4 tracks at 18 minutes, 4 at 21, 6 at 45 |
| `07-always-list` | always-list | seven eligible releases against a cap of five, one of them by an always-list artist |
| `08-unverified` | unverified | two releases MusicBrainz has never heard of, one stated `LP` and one stated `EP` |

Their Source pages are **not** the two committed calendars. Each case carries its
own small `loudwire.html` and, where the scenario needs two Sources, its own
`wikipedia.html`: same structure, a handful of rows. A five-row page is what
makes every lookup enumerable, which is what lets a case record every URL a run
can ask for, and the 1.9MB pages would carry twelve months of real releases into
a case that is about four of them. The MusicBrainz bodies are **synthetic** —
shaped like the harvested recordings, filled with the releases these pages
invent — which is the one place in the dataset where the answers were written
rather than recorded. Every band in them is invented too, with one unavoidable
exception: `07-always-list` has to name an artist that is actually on
`artists.always`, so it names Opeth, and the album, the label and the dates
around that name are invented like everything else here. Nothing in these
fixtures is a claim about a real release.

Labels are eligibility only, the same rule the harvested twelve follow, and for
these cases they are also **checkable**: `npm test` looks up every labelled
release through the case's own recordings and asserts that `isEligible` returns
what the label claims. The cases are written by the same party being measured
(spec.md's stated conflict), so no label here is an opinion — each one is
re-derived from the recorded bytes by the function the run itself uses. Eleven
of the sixteen labels are settled that way. The other five are the ones
MusicBrainz cannot settle — `03-conflicting`, `04-degraded` and the two
unheard-of releases in `08-unverified` — where eligibility turns on the format
and the dates the model extracts from the page, and those are proved by replay.

Each replayed once on 21 September 2026: all eight `completed`, **no defects in
any of them**, 6 to 11 steps, 19 to 67 seconds, $0.0015 to $0.0052, $0.0219 for
the eight. What that silence is worth differs by case, and it is worth writing
down which claims it actually supports.

- **`07-always-list`** is the strongest of them. Seven eligible releases against
  a cap of five means two cannot fit, and six of the seven carry a label and a
  genre the Taste Profile scores while the Opeth release carries none — so
  nothing but the guarantee keeps it on the list. The run `completed` with a
  full five and no `missed` against the one labelled release, which is
  `artists.always` doing its job, for the first time outside a unit test.
- **`06-ep-boundary`** is settled before the model is involved: the four
  thresholds are asserted against the recorded bodies in `npm test`, and the
  replay adds that neither EP below a threshold was proposed and neither above
  one was left off.
- **`03-conflicting`** puts `Fen Psalms` on two Sources nine days apart, one
  date inside the window and one outside it, with MusicBrainz silent. A run that
  kept one stated date rather than every stated date loses the release and
  reports `missed`. It reported none.
- **`05-recovers`** proposed the release whose first lookup answered 503, which
  is the run asking again and the sequence answering (ADR-0067).
- **`01-duplicate`** proves less than the others and the honest statement is
  that the two spellings differ only in case, so they merge at
  `mergeCandidates` before any lookup happens. No Defect counts duplication —
  a shortlist carrying one release twice is refused by `validateShortlist`, not
  graded — so what the case adds over the existing unit tests is that
  normalisation holds end to end across two real-shaped Source pages.
- **`02-ambiguous`** is a test of `MUSICBRAINZ_MIN_SCORE` rather than of
  disambiguation. The 2011 namesake answers first and is rejected for scoring
  88; the same-name group at 93 sits after the match and would be taken if it
  ever came first. Written the other way round the case was unwinnable —
  identification is first-match-wins — which is carried-forward item 7 and its
  own ticket, not a fixture nothing can ever pass.
