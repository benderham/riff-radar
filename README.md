# Riff Radar

Riff Radar is a personal learning project for building a custom agent loop from scratch. The agent searches for newly released metal albums, enriches candidates with MusicBrainz, ranks them against an explicit taste profile, and writes a sourced shortlist to Notion for human review.

The project is intentionally small. Its purpose is to make agent execution understandable, recoverable, measurable, and explainable.

## Goals

1. Complete one useful workflow and expose every step.
2. Produce predictable structured outputs and resume after failure.
3. Measure failures, quality, latency, and cost.
4. Explain and defend the system to technical and non-technical audiences.

## Version 1 boundaries

- One agent and one process
- Command-line interface
- SQLite for state, checkpoints, and traces
- Web search, MusicBrainz, and Notion tools
- Manual execution and human review
- No agent framework, sub-agents, RAG, scheduling, email, or custom UI

See [project-brief.md](docs/project-brief.md) for the complete scope and milestones. Coding agents must follow [AGENTS.md](AGENTS.md).

## Project records

- `docs/diary.md` contains a short entry for each working session or day.
- `docs/decisions.md` contains architectural decisions in ADR format.

## Getting started

Requires Node 22.22 or later.

```sh
npm install
```

Four credentials must be set before a run will start. Copy the example file and
fill it in:

```sh
cp .env.example .env
```

```sh
FIREWORKS_API_KEY=...     # the model provider
TAVILY_API_KEY=...        # web search, for disambiguation only
# MusicBrainz needs no key: it asks only for a contactable user agent, which config.ts carries.
NOTION_TOKEN=...          # Notion integration token
NOTION_DATABASE_ID=...    # the database proposals are written to
```

`.env` is gitignored and read by Node itself — no dependency, no loader. Exported
shell variables still work and take precedence over the file, which is what makes
a one-off override possible without editing it.

Then:

```sh
npm run riff-radar -- run                      # the past seven days
npm run riff-radar -- run --last-days 14       # a wider window
npm run riff-radar -- run --dry-run            # everything except the Notion write
npm run riff-radar -- run --resume <run-id>    # continue a run that was killed
```

`--resume` continues one interrupted run from its last recorded step, using that
run's window rather than a new one. It takes the first few characters of a run
id, the same as `npm run trace`, and refuses a prefix that matches two runs. Without it a run is always new, even when an
unfinished run over the same dates exists: continuing work and asking the
question again are different requests, and nothing guesses which was meant.

A run appends one row to `riff-radar.db`, readable with any SQL client:

```sh
sqlite3 riff-radar.db 'SELECT run_id, resolved_from, resolved_to, termination_reason FROM runs'
sqlite3 riff-radar.db 'SELECT step_index, kind, tool_name, validation_result FROM steps ORDER BY step_index'
```

## Development

```sh
npm test              # node:test, beside the source
npm run typecheck     # tsc --noEmit
npm run check:layering  # domain/ imports nothing from clients/ or adapters/
npm run check         # all three
npm run smoke:model       # one live call to the model provider, never in the suite
npm run smoke:sources     # the two release calendars, against their fixtures
npm run smoke:search      # one live search, to check the provider's response shape
npm run smoke:musicbrainz # an album, an EP and a release nobody has entered
```
