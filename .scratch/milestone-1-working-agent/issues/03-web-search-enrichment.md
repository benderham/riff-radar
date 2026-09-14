# 03: Web search for disambiguation

**What to build:** When the agent meets an artist it cannot resolve, it can spend a step on a web search to settle the ambiguity. The search informs the agent; it never introduces a release. `web_search` stops being a fake.

**Blocked by:** 01

**Status:** ready-for-agent

## Acceptance criteria

- [ ] `web_search` performs a real search through the `http` port and returns results to the model
- [ ] A search result cannot become a Candidate — the path from search to Shortlist does not exist in code, rather than being discouraged in the prompt
- [ ] The query, its result and its duration are recorded on the step like any other tool call
- [ ] A failed or empty search is an ordinary step result, not a Run failure
- [ ] Tested through the `http` port against a recorded fixture body
