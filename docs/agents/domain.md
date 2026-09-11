# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Riff Radar is a **single-context** repo: one `CONTEXT.md` at the root, one decisions file.

## Before exploring, read these

- **`docs/project-brief.md`**: the authoritative product scope and milestone definitions. Read this first; it wins over any inference from the code.
- **`CONTEXT.md`** at the repo root: the domain glossary.
- **`docs/decisions.md`**: this repo's ADR record. It is a **single file** holding all ADR-style entries (context, decision, consequences, status) — not a `docs/adr/` directory of one file per decision. Read the entries that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Writing decisions

`/domain-modeling` and any other skill that records a decision **appends an entry to `docs/decisions.md`**. Do not create `docs/adr/` or separate per-ADR files — `AGENTS.md` fixes this convention, and changing it is Ben's call.

## File structure

```
/
├── AGENTS.md
├── CLAUDE.md                  ← imports AGENTS.md
├── CONTEXT.md                 ← glossary (created lazily)
├── docs/
│   ├── project-brief.md       ← authoritative scope
│   ├── decisions.md           ← all ADRs, one file
│   ├── diary.md               ← execution record
│   └── agents/                ← this configuration
└── .scratch/                  ← issues and specs
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing entry in `docs/decisions.md`, surface it explicitly rather than silently overriding:

> _Contradicts the "event-sourced orders" decision, but worth reopening because…_
