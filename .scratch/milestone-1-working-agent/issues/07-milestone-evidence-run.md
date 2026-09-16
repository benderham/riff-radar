# 07: Full run and milestone evidence

**What to build:** One real Run, start to finish, that demonstrates the milestone. Ben types one command; the agent reads the three Sources, identifies what it found, discards what is ineligible, ranks the survivors against his Taste Profile, and proposes up to five records to Notion with `Status = Proposed`. The Run is then reconstructed entirely from its persisted trace — what was proposed, what was dispatched, what each tool returned, why it stopped, and what it cost — with no tooling beyond a SQL client.

This ticket produces evidence, not features. If something needed here is missing, that is a defect in an earlier ticket.

**Blocked by:** 03, 06

**Status:** ready-for-human

## Acceptance criteria

- [x] The five Notion properties that must be added by hand exist before the Run — confirmed live by the preflight, which passes
- [x] One command completes the workflow from CLI input to proposed Notion records
- [x] The Run ends with exactly one recorded Termination Reason, not by exhausting patience or crashing
- [x] At least one configured Source was fetched and Candidates extracted from it
- [x] At least one Candidate was looked up in MusicBrainz, with the request and its result recorded
- [x] At least one guardrail is observably enforced in the trace rather than merely present in code
- [x] The Taste Profile was read and demonstrably affected ranking, and releases already in Notion were suppressed on Release Identity
- [x] The Run is fully reconstructable from persisted records alone
- [x] The successful Run trace is committed or linked — `docs/evidence/milestone-1-run-bae956af.json` and `…-10a5e3a1.json`, summarised in `docs/evidence/milestone-1.md`
- [x] At least one proposed Notion record produced by that Run exists
- [x] The manual workflow and the agent workflow in `docs/specs/milestone-1-working-agent.md` are confirmed to still describe what was built, and corrected where they do not
- [x] Anything learned that changes an architectural choice is recorded in `docs/decisions.md`; the step ceiling of 30 and the EP thresholds are revisited against what the Run actually did
- [x] A diary entry is appended to `docs/diary.md`

## What is left for Ben

- Judge the nine proposed records. Every one is `Status = Proposed`; the agent measures itself on what he sets them to.
- Run it once from his own machine when MusicBrainz stops blocking his IP. Everything else has met the real services; that network path has not.
