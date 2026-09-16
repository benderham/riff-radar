# Riff Radar project brief

## Summary

Riff Radar is a personal learning project that reads a fixed set of configured release sources for newly released metal albums, verifies and enriches candidates with MusicBrainz, ranks them against a small explicit taste profile, and writes a sourced shortlist to Notion for human review. The project exists to learn how a custom agent loop works by building the loop, tool dispatch, state, recovery, evaluation, and operational evidence directly rather than adopting an agent framework.

## Intended outcome

Produce a small agent system that:

1. Completes one useful workflow and exposes every step it takes.
2. Produces predictable structured outputs and resumes after failure.
3. Has documented failure modes, evaluation results, latency, and cost.
4. Can be explained to an engineer and a non-technical decision-maker.

## User and workflow

The sole user is Ben. A run is started manually with a backward-looking release-date window; only releases that already exist are considered. The agent discovers candidate metal releases, enriches and validates the candidates, ranks them, and writes no more than five records to a Notion database with `Status = Proposed`. Ben decides what to listen to and records subsequent feedback. The system does not publish reviews or take consequential action without human involvement.

## Version 1 workflow

1. Validate the requested date range.
2. Ask the model to choose the next action.
3. Fetch the configured release sources and extract candidates. Web search is available for enrichment and disambiguation only, and never originates a candidate.
4. Query MusicBrainz to identify or enrich candidates when possible.
5. Normalise and deduplicate candidates.
6. Rank candidates against the configured taste profile and retain supporting evidence.
7. Validate the final shortlist.
8. Upsert proposed records into Notion.
9. Persist the completed trace and run state.

The loop ends when the workflow succeeds, continuation would be unsafe or unsupported, or the maximum step count is reached.

## Milestones

### 1. Working agent

The system completes the workflow from CLI input to proposed Notion records. The milestone passes when one run shows a terminating agent loop, a source fetch, a MusicBrainz request, enforced guardrails, deliberate memory, and a complete audit trace.

### 2. Recoverable system

Failure points milestone 1 exposed and left alone are listed in `.scratch/milestone-2-recoverable-system/carried-forward.md`, with the evidence behind each. Read it before writing this milestone's tickets.

Agent actions and final outputs use validated schemas. State is checkpointed after every completed step, external failures follow explicit retry or escalation behaviour, and interrupted runs can resume without repeating completed work or duplicating Notion records.

### 3. Measurable system

A 20-case golden dataset covers normal, missing, duplicate, ambiguous, conflicting, and failed-tool scenarios. A repeatable evaluation command reports correctness, required steps, grounding, escalation behaviour, latency, token use, estimated cost, and failure categories. At least one controlled change is evaluated against the baseline.

### 4. Defensible system

The repository contains a concise case study covering the workflow, architecture, iterations, evaluation evidence, economics, limitations, and autonomy boundary. The system can be demonstrated and explained separately to engineering and non-technical audiences.

## Scope boundaries

Version 1 uses:

- one agent;
- one process;
- one SQLite database for run state, checkpoints, and traces;
- a command-line entry point;
- a small versioned taste-profile file;
- configured release sources, MusicBrainz, web search, and Notion behind explicit tool interfaces;
- structured model actions and final output;
- manual execution and human review.

Version 1 excludes:

- sub-agents;
- agent frameworks;
- RAG, embeddings, or a vector database;
- a web interface;
- scheduling, email, or notifications;
- automated listening or claims based on unheard music;
- self-modifying prompts, tools, or memory;
- additional music providers unless a milestone cannot be met without one.

Only releases that have already been issued are eligible; upcoming releases are out of scope for version 1. Absence from MusicBrainz is treated as missing evidence, not proof that a release is invalid. Notion writes occur only after shortlist validation and must be idempotent.

## Memory model

- **Working memory:** state for the current run, including completed actions, tool results, pending work, and errors.
- **Procedural memory:** the versioned system prompt, action schemas, and tool instructions.
- **Semantic memory:** the explicit taste profile. It changes only through a reviewed edit.
- **Episodic record:** immutable run steps and timestamps stored in SQLite.

No general-purpose long-term memory is required.

## Success measures

- A complete run can be inspected step by step.
- Interrupted runs resume from their latest valid checkpoint.
- Repeated execution does not create duplicate Notion records.
- Factual shortlist fields retain their source.
- Evaluation results are repeatable against the same versions and dataset.
- Each run reports duration, token usage, estimated cost, and failure category.
- Recommendation usefulness is measured through shortlist acceptance and post-listening feedback, separately from metadata correctness.

## Delivery evidence

The final repository should link or contain:

- a successful end-to-end trace;
- a deliberately interrupted and resumed trace;
- the golden dataset and evaluation runner;
- baseline and improved evaluation reports;
- a cost and latency summary;
- architecture decisions in `docs/decisions.md`;
- a concise execution diary in `docs/diary.md`;
- an engineering explanation, executive explanation, and demo script.

## Working records

At the end of each working session or day, append one or two short paragraphs to `docs/diary.md` covering the intended outcome, completed work, learning, and next action. Record architectural decisions in ADR style in `docs/decisions.md`. Do not duplicate those records in this brief.
