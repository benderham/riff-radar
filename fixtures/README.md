# Recorded fixtures

Bodies the source clients are tested against, so that a client is exercised for
real through the `http` port rather than stubbed out (ADR-0018).

`loudwire.html` is **a verbatim capture**, fetched 14 September 2026, whole and
unedited — 434 KB of it, because a fixture someone tidied is a fixture that can
lie about what the stripper survives.

`aoty.html` and `wikipedia.html` are still **written by hand**: those two hosts
were not reachable from the sandbox when they were needed. They reproduce each
source's listing shape —
Album of the Year's block per release, Wikipedia's release table, Loudwire's
day-headed calendar — at a size worth reading in a diff, and they carry the
things the stripper has to survive: inline scripts, styles, comments, entities,
and markup wrapped around the text that matters.

`npm run smoke:sources` is what checks them against reality. Run on 14 September
2026 it read the live Loudwire calendar and extracted 22 releases inside a
seven-day window for USD 0.005, and recorded warnings for the other two sources,
which were unreachable. When it disagrees with a fixture, replace the fixture
with the real body.
