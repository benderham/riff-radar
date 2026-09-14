# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual strings used in this repo's issue tracker.

This repo uses a local-markdown tracker (see `issue-tracker.md`), so there are no tracker labels to apply. Each role is written verbatim as the value of the `Status:` line near the top of the issue file, e.g. `Status: ready-for-agent`.

| Label in mattpocock/skills | Value in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), set the `Status:` line to the corresponding value from this table.

The five roles are all about work that has not happened yet, so this repo adds one value of its own for work that has: `done`, meaning implemented, evidenced in the issue file, and accepted by Ben. Ticket 02 is the first to carry it.

`/wayfinder` uses its own `Status:` values (`claimed` / `resolved`) on wayfinding tickets; those are separate from the triage roles above.

Edit the right-hand column to match whatever vocabulary you actually use.
