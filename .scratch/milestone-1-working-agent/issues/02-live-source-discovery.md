# 02: Discovery is live

**What to build:** The agent reads the same three websites Ben reads. `fetch_source` stops being a fake: it retrieves a configured Source over HTTP, reduces the page to roughly clean text, hands that text to the model, and gets back Candidates. The raw fetched text is kept, so an extraction that looks wrong can be re-examined without refetching. The same release listed on two Sources becomes one Candidate carrying both provenance URLs.

A Candidate may only ever originate from a configured Source.

**Blocked by:** 01

**Status:** done

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

## Evidence

**Live run `1c1d7454-ca92-49d2-9e78-527a0efc8359`, 14 September 2026, window 2026-09-08 to 2026-09-14, dry run.**

Ten steps, `completed`, five shortlist items, USD 0.01731 measured rather than bounded (`cost_is_upper_bound = 0`). Both Sources returned HTTP 200 and are stored whole against the Run: Wikipedia 1,509,845 bytes, truncated, 6 Candidates; Loudwire 434,102 bytes, untruncated, 22 Candidates. No warnings on any step.

Three of the five Shortlist Items carry both Source URLs, which is deduplication on Release Identity visible in the output rather than only in a unit test — Archgoat's *Nightbringer, Lightbringer* among them, the same release the smoke test watched arrive from both pages.

The two extraction calls account for 42,542 of the Run's 45,962 uncached input tokens. Every step after them runs almost entirely on cache: step 9 was billed 218 uncached against 4,066 cached. Discovery is the cost of a Run; the loop around it is nearly free.

**What this evidence does not show.** `lookup_release` is still the fake from ticket 01, so every `musicbrainzId` on that Shortlist is invented (`fake-mbid-necropolitan`) and the rationales cite a confirmation the tool fabricated. Artists, titles, dates and Source URLs are real and came from the pages; the verification did not. This is the evidence for ticket 02's claim — that live discovery reaches a Shortlist — and not the milestone evidence run, which ticket 07 requires with no fakes left.

