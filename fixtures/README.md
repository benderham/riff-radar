# Recorded fixtures

Bodies the source clients are tested against, so that a client is exercised for
real through the `http` port rather than stubbed out (ADR-0018).

These three were **written by hand, not recorded from the live sites**: the
sandbox this project was built in denies outbound network access, so the pages
could not be fetched to record them. They reproduce each site's listing shape —
Album of the Year's block per release, Wikipedia's release table, Loudwire's
day-headed calendar — at a size worth reading in a diff, and they carry the
things the stripper has to survive: inline scripts, styles, comments, entities,
and markup wrapped around the text that matters.

`npm run smoke:sources` is what checks them against reality. When it disagrees
with a fixture, replace the fixture with the real body.
