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

Both are whole and unedited, deliberately. A fixture someone
tidied is a fixture that can lie about what the stripper survives — and both
real pages corrected a guess made against a hand-written one: the text cap was
too low for Loudwire, and a year-long calendar had to be scoped to the run's
window before it would fit a run's budget at all.

`npm run smoke:sources` is what checks them against reality. When it disagrees
with a fixture, replace the fixture with the real body.
