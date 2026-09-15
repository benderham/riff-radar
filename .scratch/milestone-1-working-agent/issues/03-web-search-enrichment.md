# 03: Web search for disambiguation

**What to build:** When the agent meets an artist it cannot resolve, it can spend a step on a web search to settle the ambiguity. The search informs the agent; it never introduces a release. `web_search` stops being a fake.

**Blocked by:** 01

**Status:** done

## Acceptance criteria

- [x] `web_search` performs a real search through the `http` port and returns results to the model — Tavily's API, a POST the port now carries (ADR-0033)
- [x] A search result cannot become a Candidate — `web_search` cannot reach `context.candidates`, and `validateShortlist` rejects any item naming a release no Source listed
- [x] The query, its result and its duration are recorded on the step like any other tool call
- [x] A failed or empty search is an ordinary step result, not a Run failure — a warning on the step, `error` left null
- [x] Tested through the `http` port against `fixtures/tavily-search.json`, **a real captured response**, not an invented body

## Evidence

`npm run check` — 181 tests pass, typecheck clean, layering clean.

`npm run smoke:search` against the live API, 15 September 2026, exit 0:

```
query: ulcerate cutting the throat of god metal album
status: 200

Cutting the Throat of God
  https://en.wikipedia.org/wiki/Cutting_the_Throat_of_God
  Cutting the Throat of God is the seventh studio album by New Zealand technical
  death metal band Ulcerate. It was released on 14 June 2024 through Debemur
```

Five results, no warning: the body Tavily serves is the shape the client parses.

## Comments

The provider changed from Brave to Tavily before Brave was ever used — no Brave key ever existed here, so no Brave response was captured or parsed. ADR-0033 records the swap and the `http` port's new `post`.

`https://tavily.com/agent-setup/SKILL.md` was blocked during implementation and read afterwards, once Ben allowed `www.tavily.com`. This project is its Path B (integrate Tavily into an application), whose instructions were already met; it found one real gap, a missing 400-character ceiling on the query, now enforced by the action schema. Its Autonomous Setup path — installing the `tvly` CLI and Tavily's Agent Skills globally into the coding agent — was deliberately not run: it changes Ben's machine rather than this repository. See ADR-0033.
