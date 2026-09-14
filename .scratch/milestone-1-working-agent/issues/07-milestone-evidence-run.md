# 07: Full run and milestone evidence

**What to build:** One real Run, start to finish, that demonstrates the milestone. Ben types one command; the agent reads the three Sources, identifies what it found, discards what is ineligible, ranks the survivors against his Taste Profile, and proposes up to five records to Notion with `Status = Proposed`. The Run is then reconstructed entirely from its persisted trace — what was proposed, what was dispatched, what each tool returned, why it stopped, and what it cost — with no tooling beyond a SQL client.

This ticket produces evidence, not features. If something needed here is missing, that is a defect in an earlier ticket.

**Blocked by:** 03, 06

**Status:** ready-for-agent

## Acceptance criteria

- [ ] The five Notion properties that must be added by hand exist before the Run — the schema preflight blocks every write until they do
- [ ] One command completes the workflow from CLI input to proposed Notion records
- [ ] The Run ends with exactly one recorded Termination Reason, not by exhausting patience or crashing
- [ ] At least one configured Source was fetched and Candidates extracted from it
- [ ] At least one Candidate was looked up in MusicBrainz, with the request and its result recorded
- [ ] At least one guardrail is observably enforced in the trace rather than merely present in code
- [ ] The Taste Profile was read and demonstrably affected ranking, and releases already in Notion were suppressed on Release Identity
- [ ] The Run is fully reconstructable from persisted records alone
- [ ] The successful Run trace is committed or linked
- [ ] At least one proposed Notion record produced by that Run exists
- [ ] The manual workflow and the agent workflow in `docs/specs/milestone-1-working-agent.md` are confirmed to still describe what was built, and corrected where they do not
- [ ] Anything learned that changes an architectural choice is recorded in `docs/decisions.md`; the step ceiling of 30 and the EP thresholds are revisited against what the Run actually did
- [ ] A diary entry is appended to `docs/diary.md`
