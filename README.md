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

Three environment variables must be set before a run will start:

```sh
export FIREWORKS_API_KEY=...     # the model provider
export NOTION_TOKEN=...          # Notion integration token
export NOTION_DATABASE_ID=...    # the database proposals are written to
```

Then:

```sh
npm run riff-radar -- run                      # the past seven days
npm run riff-radar -- run --last-days 14       # a wider window
npm run riff-radar -- run --dry-run            # everything except the Notion write
```

A run appends one row to `riff-radar.db`, readable with any SQL client:

```sh
sqlite3 riff-radar.db 'SELECT run_id, resolved_from, resolved_to, termination_reason FROM runs'
```

## Development

```sh
npm test              # node:test, beside the source
npm run typecheck     # tsc --noEmit
npm run check:layering  # domain/ imports nothing from clients/ or adapters/
npm run check         # all three
```
