# Milestone 1: Working agent

The definition agreed on 11 September 2026. Scope comes from `docs/project-brief.md`; the reasoning behind each choice is in `docs/decisions.md`; the vocabulary is in `CONTEXT.md`. This document is the specification, not a rationale.

Milestone 1 passes when one run shows a terminating agent loop, a source fetch, a MusicBrainz request, enforced guardrails, deliberate memory, and a complete audit trace.

## Manual workflow being replaced

Friday morning, weekly. Ben checks four sites for new metal releases, picks out artists he knows or that look interesting, copies up to five into Notion, and adds an Apple Music link to each. He listens in his own time and rates each one Nope, OK, Rotate or AOTY. Capacity is five a week.

The agent replaces discovery, selection and record creation. It does not replace listening or rating.

## Agent workflow

1. Resolve the date range to absolute dates.
2. Preflight the Notion schema.
3. Loop: the model chooses one action per step.
4. On termination, validate the shortlist.
5. If nothing blocks the write, upsert the shortlist to Notion.
6. Persist the trace and final run state.

## CLI input

```
riff-radar run [--last-days N] [--dry-run]
```

`--last-days` defaults to 7 and resolves to an absolute range at the start of the run. The resolved range, not the flag, is what the trace records. The shortlist size is fixed at five in configuration and is not a flag.

## Sources

| Source | Included |
|---|---|
| `albumoftheyear.org/genre/40-metal/recent/` | yes |
| `en.wikipedia.org/wiki/2026_in_heavy_metal_music` | yes |
| `loudwire.com/2026-hard-rock-metal-album-release-calendar/` | yes |
| `metal-archives.com/release/upcoming` | no — upcoming only, see ADR-0002 |

## Eligibility

A candidate is an eligible release when all hold:

- it is an album, or an EP with at least 4 tracks and at least 20 minutes;
- it is a first release, or a total re-record;
- it is not a live album, single, split, compilation, reissue or remaster;
- its earliest official release date falls inside the resolved range;
- its artist is not in the taste profile's `exclude` list.

Where sources disagree on the date, the release is eligible if any credible source places it in range, and the disagreement is recorded. Where data needed to confirm eligibility is missing, the release is excluded (ADR-0010).

## Taste profile

Versioned, hand-edited, at a fixed path. Never written by the agent.

```yaml
artists:
  always:  []   # guaranteed a shortlist slot
  watch:   []   # guaranteed entry into ranking
  exclude: []   # never surfaced

labels:    { include: [], exclude: [] }
genres:    { include: [], exclude: [] }
personnel: { include: [], exclude: [] }
vibe_notes:{ include: [], exclude: [] }
```

The first four match release attributes deterministically. `vibe_notes` is the only model judgement, and requires a citation. Artist `exclude` is a hard filter; genre and label `exclude` are negative weights (ADR-0007).

## Actions

| Action | Purpose |
|---|---|
| `fetch_source(source_id)` | Fetch and clean one configured source |
| `lookup_release(artist, title)` | MusicBrainz identification and enrichment |
| `web_search(query)` | Enrichment and disambiguation only; never originates a candidate |
| `finish(shortlist)` | Structured final output |

Writing to Notion is not an action (ADR-0005). Every proposed action is schema-validated before dispatch, and both the proposal and the dispatch are recorded (ADR-0012).

## Termination

Exactly one reason is recorded per run.

| Reason | Write |
|---|---|
| `completed` — `finish()` called, 5 valid items | yes |
| `completed_short` — `finish()` called, 1–4 valid items | yes |
| `no_candidates` — nothing eligible found | no |
| `validation_failed` — `finish()` called, shortlist invalid | no |
| `invalid_action_limit` — 3 consecutive invalid actions | no |
| `max_steps_exceeded` — 30 steps | no |
| `budget_exceeded` — token or cost ceiling reached | no |
| `tool_failure` — unrecoverable tool error | no |
| `aborted` — interrupted | no |

`completed_short` is a success. A quiet release week is a real answer; padding to five would be worse than reporting three.

## Valid shortlist

Shortlist level:

- between 1 and 5 items;
- no two items share a release identity.

Item level, all required:

- artist; album title; release date inside the resolved range;
- at least one source URL;
- rank; rationale;
- a MusicBrainz ID, or an explicit `unverified: true` marker.

A missing MusicBrainz ID is valid; a missing source URL is not. Provenance is the thing that cannot be reconstructed later.

## Memory across runs

Only two things cross a run boundary: the versioned taste profile, and the set of releases already in Notion, which are suppressed on release identity regardless of Status. Past traces are never fed to the model (ADR-0009).

## Trace

`runs`: run_id · started_at · ended_at · cli_args · resolved_from · resolved_to · prompt_version · profile_version · action_schema_version · model_id · termination_reason · tokens_in · tokens_out · estimated_cost · shortlist_size · notion_write_performed

`steps`: step_id · run_id · step_index · timestamp · duration_ms · kind · model_response · proposed_action · validation_result · dispatched_action · tool_name · tool_args · tool_result · error · tokens_in · tokens_out · cost

Raw fetched source text is stored, since extraction is model-dependent and replay depends on it (ADR-0003).

## Notion

Required properties. The five marked **new** do not exist in the database yet and must be added by hand before a run can write.

| Property | Type | Written by |
|---|---|---|
| Title | title | agent |
| Artist | text | agent |
| Release Date | date | agent |
| Album Cover | files | agent, best-effort via Cover Art Archive |
| Apple Music Link | url | agent, as a constructed search URL |
| Rating | select — Nope / OK / Rotate / AOTY | Ben only |
| **Status** | select — Proposed / Confirmed / Rejected | agent writes `Proposed`; Ben sets the rest |
| **MusicBrainz ID** | text | agent |
| **Source URL** | url | agent |
| **Rationale** | text | agent |
| **Run ID** | text | agent |

## What blocks a Notion write

Any one of these blocks the write entirely. Writes are all-or-nothing; there is no partial write.

- `--dry-run`;
- shortlist validation failed;
- zero items;
- termination reason not `completed` or `completed_short`;
- Notion schema preflight failed;
- missing credentials.

## Technology

TypeScript on Node 22.22. Dependencies: `typescript` and `tsx` (development only), `zod` (runtime). The built-in `node:test`, `node:sqlite` and `fetch` replace a test runner, a database driver and an HTTP client. `node:sqlite` warns on every run; suppress with `--disable-warning=ExperimentalWarning`, never globally.

HTML cleaning is a hand-written tag stripper. The model performs extraction, so the text only needs to be roughly clean. Taking an HTML parsing dependency later requires its own ADR.

### Model

| | |
|---|---|
| Provider | Fireworks, OpenAI-compatible endpoint, called with built-in `fetch` |
| Model | DeepSeek V4.1 Flash |
| Model ID | **unconfirmed** — likely `accounts/fireworks/models/deepseek-v4p1-flash`; confirm from the Fireworks dashboard |
| Price | **unconfirmed** — public sources disagree; confirm from the Fireworks dashboard before cost accounting reports real numbers |
| Context | ~1M tokens; compaction is not a concern at 30 steps |

Actions travel as native tool calls. The model does not enforce a JSON schema on tool-call arguments, so arguments are untrusted: parse, then validate against the action schema, before every dispatch.

### Invalid actions

A failed validation is returned to the model as that step's result, and it may try again. Three consecutive invalid actions terminate the run with `invalid_action_limit`.

## Seams and testing

One injection point, `Ports`, with three members:

| Port | Shape |
|---|---|
| `model` | send a request, get a response |
| `http` | GET a URL, return status, headers and body |
| `clock` | `now()` |

`http` is deliberately low-level. The MusicBrainz client, the Notion client, the cover art fetch and the source fetchers sit above it as ordinary code, tested for real against recorded fixture bodies.

SQLite is not behind a port. Tests use a real in-memory database.

Tested directly as pure functions, with no seam: action validation, candidate normalisation and deduplication, eligibility rules, ranking arithmetic, shortlist validation, cost accounting.

MusicBrainz requires a descriptive User-Agent and allows 1 request per second. That rate limit lives in the MusicBrainz client above the `http` port, and shapes the loop's wall-clock time.

## Out of scope for Milestone 1

Absolute `--from`/`--to` dates (Milestone 3 will need them for the golden dataset), checkpoint and resume, retry classification, evaluation, and any change to the listening or rating workflow.
