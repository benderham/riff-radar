# Riff Radar Project Diary

Plain-language updates for people following the project, written at the end of a working session. Newest entries first. Keep these readable by anyone — no jargon, no code; the technical record lives in decisions.md and git history.

## 11 September 2026 — Setting up the ground rules for coding assistants

The goal today was housekeeping rather than building: give the coding assistants a clear, written answer to three questions they kept having to guess at. Where do tasks and specs live? What words do we use to mark a task as "ready" or "needs more detail"? And which documents should be read before touching anything? Those answers now live in a new `docs/agents/` folder, with a short summary in `AGENTS.md` pointing at them. Tasks will be kept as plain markdown files in the project rather than in an external tool, which suits a small solo project and keeps everything in one place.

Two things came out of it that were worth catching. The project brief had moved into the `docs` folder at some point, but several documents still pointed at its old location — those are fixed. And the assistants' default setup expects one file per decision in a `docs/adr/` folder, which contradicts our existing habit of keeping all decisions in a single `decisions.md`. We kept our habit and wrote the difference down, so nobody quietly starts a second decision log. Next: back to the actual product work, starting with the first milestone in the project brief.
