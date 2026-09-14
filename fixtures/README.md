# Recorded fixtures

Bodies the source clients are tested against, so that a client is exercised for
real through the `http` port rather than stubbed out (ADR-0018).

| file | what it is |
| --- | --- |
| `loudwire.html` | The live Loudwire calendar, fetched 14 September 2026. 434 KB, verbatim. |
| `wikipedia.html` | The live Wikipedia year page, fetched 14 September 2026. 1.5 MB, verbatim. |
| `aoty-challenge.html` | What Album of the Year actually served that day: a Cloudflare bot challenge behind a 403 (ADR-0031). |
| `aoty.html` | **Hand-written.** The listing shape Album of the Year is documented to have, since the live page cannot be read. |

The three captures are whole and unedited, deliberately. A fixture someone
tidied is a fixture that can lie about what the stripper survives — and both
real pages corrected a guess made against a hand-written one: the text cap was
too low for Loudwire, and a year-long calendar had to be scoped to the run's
window before it would fit a run's budget at all.

`npm run smoke:sources` is what checks them against reality. When it disagrees
with a fixture, replace the fixture with the real body.
