# 01: Metal Archives as a third source

**What to build:** Discovery reads Metal Archives' release browser for the Run's window, alongside the two existing Sources. It is the source Ben already checks by hand for obscure releases, and it is comprehensive where the other two are curated: for the week of 8–14 September 2026 it lists **280 releases**, against Loudwire's 22 and Wikipedia's 6.

**Blocked by:** milestone 1 complete (tickets 03–07). Adding a third Source while three of four actions are still fake would mean re-testing discovery against a loop that is not finished.

**Status:** needs-triage

## Why this is not simply a fourth line in `SOURCES`

Everything below was checked live on 14 September 2026, against the real site.

**It is structured JSON, not a page.** `https://www.metal-archives.com/release/ajax-upcoming/json/1` backs the browser at `/release/upcoming` and takes `fromDate` and `toDate` as `YYYY-MM-DD`, plus `iDisplayStart`, `iDisplayLength` and `includeVersions`. Each row is a fixed six-column array: band (with URL), album (with URL), type, genre, release date, date added.

This cuts against ADR-0003, which puts the model in charge of extraction because hand-written scrapers break when a site is redesigned. That reasoning is about parsing prose out of a laid-out page. A fixed-column JSON response is a different thing, and a deterministic parser over it would be cheaper, faster, exactly reproducible, and — unlike the extraction call — free. **This ticket must decide that explicitly and record it**, because it is the first Source that would not go through the model.

**Its date range reaches backwards.** The year dropdown runs from 2000 to 2026 and the endpoint honours a past `fromDate`/`toDate` at day granularity. ADR-0002 dropped Metal Archives on the grounds that an upcoming-releases page "contributes nothing to a backward window"; that premise is false for this endpoint, and the ADR needs amending on its consequences rather than overturning on its decision — nothing here proposes an unreleased album.

**It is paged, at 100 rows.** `iDisplayLength=500` still returns 100, with `iTotalRecords` giving the true count. A week needs three requests, and the client has to page rather than assume one.

**The volume is the real design problem.** Of the first 100 rows: 27 Full-length, 22 EP, 37 Single, 8 Demo, 3 Compilation, 2 Split, 1 Live album. Roughly half are ineligible on type alone, and the row carries the type, so eligibility can cut deterministically before anything reaches the model or the loop. Even so, a week is on the order of 130 candidates after that cut, against 28 today — and ticket 02 has already been bitten once by a tool result too large for the loop to carry from step to step.

**Robots and terms need Ben's judgement, not the agent's.** `robots.txt` allows `User-agent: *` with `Crawl-delay: 3` and disallows only `/affiliate/`, `/history/`, `/report/`, `/forum/` and `/users/` — the endpoint is not excluded, and a low-volume manual run is within it. But the same file disallows `ClaudeBot`, `GPTBot`, `CCBot`, `Google-Extended` and `meta-externalagent` outright, and sets `Content-Signal: search=yes, ai-train=no, use=reference`. Riff Radar is none of those crawlers, trains nothing, and cites every source URL it uses — which reads as within `use=reference` — but the site's intent towards AI tooling is legible and deserves a deliberate decision rather than an inference. **Ben decides before any code.**

## Acceptance criteria

- [ ] A decision is recorded on whether a fixed-column JSON Source is parsed deterministically or extracted by the model, amending or narrowing ADR-0003
- [ ] A decision is recorded on reading the site at all, against its `robots.txt` content signals; the ticket does not proceed without it
- [ ] ADR-0002 is amended: a backward window can read this endpoint, and no upcoming release is ever proposed
- [ ] ADR-0001 and ADR-0031 record the source list as it then stands
- [ ] The client pages until `iTotalRecords` is satisfied, and a partial page set is a warning rather than a silent short read
- [ ] `Crawl-delay: 3` is honoured between requests
- [ ] Rows ineligible on type — Single, Demo, Split, Compilation, Live album — are cut before the model sees anything, deterministically and as a tested pure function
- [ ] A Candidate from this Source carries its band and album URLs as provenance
- [ ] The genre string is retained, because the taste profile weights genre (ticket 05)
- [ ] The loop's tool result stays bounded whatever the week's volume, and the bound is tested
- [ ] Release Identity deduplicates across all three Sources, so a release on Loudwire and here is one Candidate
- [ ] A recorded fixture of the JSON response is committed and the client is tested through the `http` port against it
- [ ] `npm run smoke:sources` covers the third Source

## Comments

**14 September 2026, Ben:** Raised it — `/release/upcoming` has a range search, it is very comprehensive, and it is where he checks for obscure releases by hand. That is the coverage gap the two curated Sources leave, and the reason this is worth a ticket rather than a note.
