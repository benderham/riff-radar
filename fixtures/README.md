# Recorded fixtures

Bodies the source clients are tested against, so that a client is exercised for
real through the `http` port rather than stubbed out (ADR-0018).

Everything here is a capture of a real response. A page nobody served is not a
fixture: a test that needs an invented body declares one inline, where the
reader can see what is being claimed about it.

| file | what it is |
| --- | --- |
| `loudwire.html` | The live Loudwire calendar, fetched 14 September 2026. 434 KB, verbatim. |
| `wikipedia.html` | The live Wikipedia year page, fetched 14 September 2026. 1.5 MB, verbatim. |
| `tavily-search.json` | A live Tavily search response, fetched 15 September 2026. Verbatim. |
| `musicbrainz-release-group.json` | A release-group search that finds an album. Ulcerate, 15 September 2026. |
| `musicbrainz-not-found.json` | A release-group search that finds nothing at all. |
| `musicbrainz-partial.json` | A real release group that states a type and no date: the partial-data case. |
| `musicbrainz-ep-recordings.json` | The second request an EP costs, with its tracks and their lengths. |

`tavily-search.json` reads oddly and is not edited: `response_time` is `0` because the
query had been asked minutes earlier and Tavily served it from its cache, and
`answer` is `null` because the client does not ask for one. Its `request_id`
differs from the earlier call's, which is how you can tell it is its own response
rather than a trimmed copy of one.

All of them are whole and unedited, deliberately. A fixture someone
tidied is a fixture that can lie about what the stripper survives — and both
real pages corrected a guess made against a hand-written one: the text cap was
too low for Loudwire, and a year-long calendar had to be scoped to the run's
window before it would fit a run's budget at all.

`npm run smoke:sources`, `npm run smoke:search` and `npm run smoke:musicbrainz` are what check them against reality. When it disagrees
with a fixture, replace the fixture with the real body.
