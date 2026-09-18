# Riff Radar

## Purpose

Build Riff Radar as a learning exercise in custom agent loops. Optimise for Ben's understanding, observable behaviour, and small reversible steps. The authoritative product scope is `docs/project-brief.md`.

## Read before changing code

Before starting work:

1. Read `docs/project-brief.md`.
2. Read the active ticket or explicitly stated session outcome.
3. Read relevant entries in `docs/decisions.md`.
4. Check `docs/diary.md` for the latest state and next action.

If these sources conflict, stop and ask which should win. Do not silently reinterpret the scope.

## Work on one outcome at a time

Implement one ticket or one explicitly agreed outcome per session.

Before editing, state:

- the intended outcome;
- its acceptance criteria;
- the files expected to change;
- the test or observation that will prove completion.

Do not implement follow-on tickets, adjacent improvements, or speculative abstractions. If required work falls outside the active outcome, stop and explain the dependency.

## Scope boundaries

Version 1 is limited to:

- one agent and one process;
- a command-line interface;
- one SQLite database for state, checkpoints, and traces;
- a versioned local taste profile;
- explicit tools for web search, MusicBrainz, and Notion;
- structured actions and structured final output;
- manual runs and human review of proposed Notion records.

Do not add:

- sub-agents;
- an agent framework;
- RAG, embeddings, or a vector database;
- a web interface;
- scheduling, email, or notifications;
- more external providers without approval;
- self-modifying prompts, tools, or memory;
- unrelated refactors or infrastructure.

Do not add a dependency without first explaining why the standard library or an existing dependency is insufficient and receiving approval.

## Design rules

- Keep the agent loop visible in application code.
- Keep tool implementations behind small typed interfaces.
- Separate current run state from immutable trace records.
- Validate all model-produced actions before dispatch.
- Validate the final shortlist before external writes.
- Checkpoint after every completed model or tool step.
- Make Notion writes idempotent.
- Treat missing MusicBrainz data as uncertainty, not invalidity.
- Preserve source URLs for factual release data.
- Bound retries and obey provider rate limits.
- Prefer deterministic code for validation, deduplication, accounting, and state transitions.
- Use the model only where interpretation or choice is required.

## Testing

Use test-driven development at the important seams:

- loop termination and maximum-step behaviour;
- action-schema validation;
- tool dispatch;
- candidate normalisation and deduplication;
- checkpoint and resume behaviour;
- retry and failure classification;
- idempotent Notion writes;
- token and cost accounting.

Tests must not depend on live external services. Use small recorded fixtures or fakes for automated tests. Keep at least one separately invoked smoke test for each live integration.

Do not weaken an assertion or delete a failing test merely to make the suite pass. Explain any required change to expected behaviour.

## External actions and secrets

- Never commit API keys, tokens, personal listening history, or detailed taste data. The one declared exception is the frozen Known Set, `known-set.json`, which ADR-0066 commits so the Back-test can be checked.
- Read credentials from environment variables.
- Do not print secrets in traces, errors, fixtures, or diary entries.
- Redact sensitive request headers and provider responses before logging.
- Do not write to Notion until the candidate shortlist has passed validation.
- Default new Notion records to `Status = Proposed`.
- Do not publish, email, schedule, or notify anyone.

## Observability and evidence

Every run must make it possible to reconstruct:

- the prompt and configuration version;
- each model response;
- each proposed and dispatched tool call;
- each tool result or error;
- state transitions and checkpoints;
- timestamps and duration;
- token usage and estimated cost;
- the termination or escalation reason.

Do not claim a milestone is complete without its required evidence from `docs/project-brief.md`.

## Documentation

At the end of each working session or day, append one or two paragraphs to `docs/diary.md` stating:

- the intended outcome;
- what was completed;
- what was learned;
- the next action.

Keep the diary concise. It is an execution record, not a transcript.

Record decisions that affect architecture, dependencies, persistence, schemas, external providers, safety boundaries, or evaluation in `docs/decisions.md` using ADR style. Include context, decision, consequences, and status. Do not create separate ADR files unless Ben changes this convention.

Update `docs/project-brief.md` only when the agreed scope or milestone definitions change.

## Completion protocol

Before declaring the active outcome complete:

1. Run relevant tests and static checks.
2. Run a live smoke test only when the active outcome requires it.
3. Review the diff for unrelated changes.
4. Summarise changed files and the execution path.
5. Record unresolved risks or follow-up work.
6. Append the concise diary entry.
7. Stop. Do not begin the next outcome.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, decisions in `docs/decisions.md`. See `docs/agents/domain.md`.
