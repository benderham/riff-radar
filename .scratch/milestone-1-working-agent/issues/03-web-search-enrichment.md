# 03: Web search for disambiguation

**What to build:** When the agent meets an artist it cannot resolve, it can spend a step on a web search to settle the ambiguity. The search informs the agent; it never introduces a release. `web_search` stops being a fake.

**Blocked by:** 01

**Status:** ready-for-human — implemented and tested; the live smoke test and its evidence need Ben's Brave key

## Acceptance criteria

- [x] `web_search` performs a real search through the `http` port and returns results to the model — Brave's API, authenticated by a header the port now carries (ADR-0032)
- [x] A search result cannot become a Candidate — `web_search` cannot reach `context.candidates`, and `validateShortlist` rejects any item naming a release no Source listed
- [x] The query, its result and its duration are recorded on the step like any other tool call
- [x] A failed or empty search is an ordinary step result, not a Run failure — a warning on the step, `error` left null
- [~] Tested through the `http` port against **an invented body of Brave's documented shape**, not a capture: capturing one needs a key this repository does not have. `npm run smoke:search` checks the shape against reality, and the first real response replaces the invented body with a fixture (ADR-0032)

## What remains

A live search, run by Ben with a Brave key: `npm run smoke:search`. If the real body parses, this ticket is `done`; if it does not, the fixture and the client's schema change to match what Brave actually serves.
