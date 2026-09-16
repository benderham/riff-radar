# 06: Validated, idempotent Notion writes

**What to build:** A Run that found something worth hearing puts it in Ben's Notion database, with `Status = Proposed` and an Apple Music link he can click when he is ready to listen. The write happens after the loop has terminated and the Shortlist has passed validation — the model cannot write, early or otherwise. Before writing anything the agent checks Ben's database has the properties it expects, and refuses outright if it does not, so a Run never leaves the database half-updated. `--dry-run` does everything except write.

Cover art is fetched where it exists and never costs a Run when it does not.

**Blocked by:** 01, 05

**Status:** ready-for-human

## Acceptance criteria

- [x] The write is post-loop code; writing to Notion is not an action and is unreachable from the model
- [x] Notion authenticates with an integration token from the environment
- [x] Before any write, every property in the specification is verified to exist with the expected type; any mismatch blocks the write entirely and names what is missing
- [x] The agent never creates or alters the database schema
- [x] The write is all-or-nothing — no partial write is possible
- [x] Every record carries `Status = Proposed`, the Run identifier, at least one Source URL, its Rationale, and a constructed Apple Music search URL
- [x] `Rating` is never written by the agent, at any point, by any path
- [x] Album cover art is fetched best-effort from the Cover Art Archive; its absence or failure never fails a Run — tested, but `coverartarchive.org` is denied to this sandbox, so `npm run smoke:coverart` has never reached the archive
- [x] The write is blocked by any of: `--dry-run`, failed Shortlist validation, zero items, a Termination Reason other than `completed` or `completed_short`, a failed schema preflight, or missing credentials
- [x] `notion_write_performed` is recorded on the Run
- [x] Re-running the same window proposes no duplicate rows
- [x] The preflight, the dry-run path and the all-or-nothing behaviour are each tested through the ports against recorded fixture bodies
- [x] A live smoke test against Notion in dry-run exists, invoked separately and excluded from the automated suite — `npm run smoke:notion` preflights the real database and prints the page it would create; it passes

## What is left for Ben

- Allow `coverartarchive.org` to the sandbox and run `npm run smoke:coverart`. Until then the cover fetch is tested but has never met the archive; a run is unaffected either way, because no cover is silence.
- Run the thing for real without `--dry-run` once, and look at the rows. Every automated test and the dry-run smoke test agree with each other about a body this project wrote; only a real write proves Notion accepts it (the lesson of ADR-0041).
