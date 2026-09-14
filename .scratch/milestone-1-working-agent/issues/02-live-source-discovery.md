# 02: Discovery is live

**What to build:** The agent reads the same three websites Ben reads. `fetch_source` stops being a fake: it retrieves a configured Source over HTTP, reduces the page to roughly clean text, hands that text to the model, and gets back Candidates. The raw fetched text is kept, so an extraction that looks wrong can be re-examined without refetching. The same release listed on two Sources becomes one Candidate carrying both provenance URLs.

A Candidate may only ever originate from a configured Source.

**Blocked by:** 01

**Status:** needs-review

## Acceptance criteria

- [x] The `http` port returns status, headers and body, and its adapter is the only code performing the request
- [x] The Sources from the specification are configured and fetchable; the excluded upcoming-releases site is absent — **two, not three**: Album of the Year answers every request with a bot challenge and was dropped (ADR-0031)
- [x] HTML is reduced by a hand-written tag stripper — no parsing dependency
- [x] The model extracts Candidates from cleaned text; there is no per-Source parser
- [x] The raw fetched text of every Source is persisted against the Run
- [x] A Source that normally yields Candidates and yields none records a warning on the Run
- [x] Candidates are normalised and deduplicated on Release Identity, and a Candidate seen on several Sources retains every Source URL
- [x] Where Sources disagree on a release date, every date is retained and the disagreement recorded rather than silently resolved
- [x] Source clients are tested for real against recorded fixture bodies through the `http` port, not stubbed out
- [x] Normalisation and deduplication are tested directly as pure functions
