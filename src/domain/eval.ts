/**
 * Defects: seven words for a run that was wrong rather than broken.
 *
 * The project already says what broke outside a run (Failure Category) and why
 * a run stopped (Termination Reason). Neither says the agent was wrong: a run
 * can end `completed` with every error column clean, having left an eligible
 * release off, cited a fact no page carried, or spent twenty steps to propose
 * three items. A Defect is the third vocabulary, and it is asserted by a grader
 * against a labelled case — never recorded by a run about itself, which is why
 * nothing here touches the trace schema (ADR-0059).
 *
 * Everything is a pure function over data the store already produces, so a test
 * hand-writes its input rather than needing a realistic trace (ADR-0064).
 *
 * Three rules are easy to get wrong and are therefore stated:
 *
 * - **Unlabelled is no opinion.** Only an explicit `ineligible` label or a date
 *   outside the window makes a shortlist item `spurious`. A release the case
 *   never labelled is missing evidence, the same rule the back-test applies to
 *   a proposal absent from the Known Set.
 * - **`wasteful` is not `max_steps_exceeded`.** Hitting the ceiling and
 *   stopping is a Termination Reason. `wasteful` is *completing*, having spent
 *   more than the case allowed.
 * - **`spurious` is not a second `validateShortlist`.** A shipped shortlist has
 *   already passed the validator; re-running it would grade the validator.
 */

import { z } from 'zod'

import { SOURCES } from '../../config.ts'
import type { Candidate } from './candidates.ts'
import type { Usage } from './cost.ts'
import { NO_USAGE, addUsage } from './cost.ts'
import { artistTitleIdentity, normaliseName } from './candidates.ts'
import { isRetryable } from './failure.ts'
import { htmlToText } from './html-text.ts'
import { citedVibes, rankShortlist } from './ranking.ts'
import type { Score } from './ranking.ts'
import type { TerminationReason } from './run.ts'
import type { ShortlistItem } from './shortlist.ts'
import { releaseIdentity } from './shortlist.ts'
import type { StoredSourceText, TracedStep } from '../store/store.ts'
import type { TasteProfile } from './taste-profile.ts'
import type { DateWindow } from './window.ts'

/**
 * Constrained the way the six Failure Categories are constrained by a CHECK,
 * because the point of a vocabulary is that it can be counted.
 */
export const DEFECTS = [
  'unlisted',
  'missed',
  'spurious',
  'ungrounded',
  'misranked',
  'wasteful',
  'escaped',
] as const

export type Defect = (typeof DEFECTS)[number]

/** The sources a case may serve from a fixture: the configured ones, and no others. */
const SOURCE_IDS = Object.keys(SOURCES) as [keyof typeof SOURCES, ...(keyof typeof SOURCES)[]]

export interface Finding {
  readonly defect: Defect
  /** The release the finding is about, where it is about one. */
  readonly release?: string
  readonly detail: string
}

/**
 * What a case says about the releases in its window.
 *
 * Keyed on artist and title rather than on a MusicBrainz id: the labels are
 * hand-written against the committed calendar bytes, long before any lookup,
 * and `releaseIdentity` already falls back to the same function. Defined here
 * rather than in the case manifest so the domain does not depend on the fixture
 * format — the manifest's schema imports this.
 */
export interface CaseLabels {
  readonly eligible: readonly string[]
  readonly ineligible: readonly string[]
}

/** What a case allows a run to spend, from its manifest. */
export interface CaseBudget {
  readonly steps: number
  readonly costUsd: number
}

/** The completed run a grader reads, as `scripts/eval.ts` assembles it from the store. */
export interface GradedRun {
  /** Final and ranked, as the `finish` step recorded it. */
  readonly shortlist: readonly ShortlistItem[]
  readonly candidates: readonly Candidate[]
  readonly window: DateWindow
  readonly profile: TasteProfile
  readonly sourceTexts: readonly StoredSourceText[]
  readonly steps: readonly TracedStep[]
  readonly terminationReason: TerminationReason
  readonly cost: number
  readonly labels: CaseLabels
  readonly budget: CaseBudget
}

const identityOf = (item: ShortlistItem): string =>
  artistTitleIdentity(item.artist ?? '', item.title ?? '')

/** A label as it was written, and the two halves a page has to carry. */
const parseLabel = (label: string): { readonly artist: string; readonly title: string } => {
  const [artist = '', title = ''] = label.split('|')
  return { artist, title }
}

const normalisedLabel = (label: string): string => {
  const { artist, title } = parseLabel(label)
  return artistTitleIdentity(artist, title)
}

/**
 * A release no source carried is a coverage gap rather than an agent failure.
 *
 * `fixtures/wikipedia.html` loses 36% of itself to truncation, concentrated in
 * the later months a real run queries, so without this word the gap is counted
 * as the model being bad at its job and fixed in the wrong half of the system
 * (ADR-0059, carried-forward item 1).
 *
 * Both halves have to be on the *same line*, which is a rule about these pages
 * rather than a nicety: a calendar row stays one line of date, artist and title
 * through `htmlToText` by design (ADR-0013), while a whole-page search finds
 * almost any artist and almost any title somewhere in 120,000 characters and
 * would report a covered release as listed for the wrong reason. Lines are
 * split before normalising, because `normaliseName` collapses the newlines.
 *
 * Only the `eligible` labels are checked. Nothing consults an ineligible
 * release's coverage: the word exists to hold `missed` back, and `missed` reads
 * the same list.
 */
export const unlisted = (run: GradedRun): Finding[] => {
  const lines = run.sourceTexts.flatMap((each) =>
    htmlToText(each.rawBody).split('\n').map(normaliseName),
  )

  return run.labels.eligible
    .filter((label) => {
      const { artist, title } = parseLabel(label)
      const [one, other] = [normaliseName(artist), normaliseName(title)]
      return !lines.some((line) => line.includes(one) && line.includes(other))
    })
    .map((label) => ({
      defect: 'unlisted' as const,
      release: label,
      detail: 'no stored source text lists this release',
    }))
}

/** A release the case labels eligible, absent from the shortlist. */
export const missed = (run: GradedRun): Finding[] => {
  const shortlisted = new Set(run.shortlist.map(identityOf))

  return run.labels.eligible
    .filter((label) => !shortlisted.has(normalisedLabel(label)))
    .map((label) => ({
      defect: 'missed' as const,
      release: label,
      detail: 'labelled eligible and not on the shortlist',
    }))
}

/** A shortlist item the case labels ineligible, or one dated outside the window. */
export const spurious = (run: GradedRun): Finding[] => {
  const ineligible = new Set(run.labels.ineligible.map(normalisedLabel))

  return run.shortlist.flatMap((item) => {
    const release = releaseIdentity(item)
    const date = item.releaseDate ?? ''

    if (ineligible.has(identityOf(item))) {
      return [{ defect: 'spurious' as const, release, detail: 'labelled ineligible' }]
    }

    return date < run.window.from || date > run.window.to
      ? [
          {
            defect: 'spurious' as const,
            release,
            detail: `dated ${date || 'nothing'}, outside ${run.window.from}..${run.window.to}`,
          },
        ]
      : []
  })
}

/**
 * A claim with nothing behind it: a shortlist item carrying no source URL, or a
 * vibe note whose quote is in none of the pages this run stored.
 *
 * The citation rule is called rather than restated — one copy of it, in
 * `citedVibes`, checked against the Source Text the item names (ADR-0040).
 *
 * The factual half is per *item*, not per field, because that is all the
 * provenance a shortlist item carries: `sourceUrls` stands behind the whole
 * record and no field names its own source. `validateShortlist` already refuses
 * an item with no URL, so on a shipped shortlist this branch is unreachable and
 * only fires when a refused shortlist is graded — which is worth grading, since
 * a repair the validator turned down is still a thing the model did.
 */
export const ungrounded = (run: GradedRun): Finding[] => {
  const vibes = citedVibes(run.shortlist, run.sourceTexts)

  return run.shortlist.flatMap((item) => {
    const release = releaseIdentity(item)

    if (!(item.sourceUrls ?? []).some((url) => url.trim() !== '')) {
      return [{ defect: 'ungrounded' as const, release, detail: 'no source URL' }]
    }

    const vibe = vibes.get(identityOf(item))
    return vibe !== undefined && !vibe.cited
      ? [
          {
            defect: 'ungrounded' as const,
            release,
            detail: `vibe quote is in no stored source text: ${vibe.quote}`,
          },
        ]
      : []
  })
}

/** Guaranteed first, then total: the two keys the shortlist is ordered on. */
const ordering = (score: Score): readonly [number, number] => [Number(score.guaranteed), score.total]

const above = (one: readonly [number, number], other: readonly [number, number]): boolean =>
  one[0] > other[0] || (one[0] === other[0] && one[1] > other[1])

/**
 * The shipped order contradicting the profile's own arithmetic.
 *
 * The scores come from `rankShortlist`, so what is compared is the ordering the
 * run should have produced from the same inputs rather than a second copy of
 * the arithmetic. A guaranteed slot above a higher-scoring release is correct
 * and not a defect: `artists.always` is a slot, not a score (ADR-0007). Equal
 * scores are an order the profile does not decide, so ties never fire — which
 * means a run whose profile matched nothing, like `3e657aa3`, grades clean
 * here. That is the right answer and not a blind spot: when every score is
 * zero, no order contradicts the arithmetic. A profile that *should* have
 * scored and did not is ticket 01's bug, and it shows up as `missed`.
 */
export const misranked = (run: GradedRun): Finding[] => {
  const byIdentity = new Map(
    rankShortlist(
      run.shortlist,
      run.candidates,
      run.profile,
      citedVibes(run.shortlist, run.sourceTexts),
    ).map(({ item, score }) => [identityOf(item), score]),
  )

  const scores = run.shortlist.map(
    (item) => byIdentity.get(identityOf(item)) ?? { total: 0, guaranteed: false, signals: [] },
  )

  return run.shortlist.flatMap((item, position) => {
    const next = scores[position + 1]
    const here = scores[position]
    if (next === undefined || here === undefined) return []

    return above(ordering(next), ordering(here))
      ? [
          {
            defect: 'misranked' as const,
            release: releaseIdentity(item),
            detail: `ranked above ${releaseIdentity(run.shortlist[position + 1]!)}, which scores higher`,
          },
        ]
      : []
  })
}

/**
 * A run that finished the job and spent more than the case allows.
 *
 * Only a completed run can be wasteful. A run the ceiling or the budget stopped
 * has a Termination Reason for that, and counting it twice would make the two
 * vocabularies say the same thing.
 *
 * Deliberately not `WRITE_PERMITTED`, which happens to hold the same two words
 * for an unrelated reason: that list is what may reach Notion, and borrowing it
 * would make this rule move whenever the write policy did.
 */
const COMPLETED: readonly TerminationReason[] = ['completed', 'completed_short']

export const wasteful = (run: GradedRun): Finding[] => {
  if (!COMPLETED.includes(run.terminationReason)) return []

  const findings: Finding[] = []
  if (run.steps.length > run.budget.steps) {
    findings.push({
      defect: 'wasteful',
      detail: `${run.steps.length} steps against a budget of ${run.budget.steps}`,
    })
  }
  if (run.cost > run.budget.costUsd) {
    findings.push({
      defect: 'wasteful',
      detail: `$${run.cost.toFixed(4)} against a budget of $${run.budget.costUsd.toFixed(4)}`,
    })
  }
  return findings
}

/**
 * A failure milestone 2 built recovery for, that the run did not survive.
 *
 * `isRetryable` decides what recovery exists for, so this cannot drift from the
 * retry policy it is grading. A `refused` or `not_found` ending a run is the
 * design working: asking again asks the same thing.
 *
 * The failure that ended the run is the *last* one recorded, identified by
 * position rather than by category — the same rule the repair counter follows
 * (ADR-0053). Counted per run, not per failing step: a run that retried three
 * transient failures and survived them has escaped nothing, and it is the one
 * it did not survive that this is about.
 */
export const escaped = (run: GradedRun): Finding[] => {
  if (run.terminationReason !== 'tool_failure') return []

  const failures = run.steps.flatMap((step) =>
    step.failureCategory === null ? [] : [{ tool: step.toolName, category: step.failureCategory }],
  )

  const fatal = failures.at(-1)
  if (fatal === undefined || !isRetryable(fatal.category)) return []

  return [
    {
      defect: 'escaped',
      detail: `${fatal.tool ?? 'a tool'} failed ${fatal.category} and ended the run`,
    },
  ]
}

/**
 * Every defect in one run.
 *
 * `unlisted` runs first and takes its releases off what `missed` is allowed to
 * see, which is the rule ticket 02 sets: a release no source carried is not one
 * the agent failed to find. The suppression lives here rather than inside
 * `missed`, so each grader stays independently testable, and it matches on the
 * normalised identity rather than on the string `unlisted` happened to report,
 * so that a change to either finding's wording cannot silently disarm it.
 */
export const gradeRun = (run: GradedRun): Finding[] => {
  const coverage = unlisted(run)
  const gaps = new Set(coverage.map((finding) => normalisedLabel(finding.release ?? '')))

  const listed: GradedRun = {
    ...run,
    labels: {
      ...run.labels,
      eligible: run.labels.eligible.filter((label) => !gaps.has(normalisedLabel(label))),
    },
  }

  return [
    ...coverage,
    ...missed(listed),
    ...spurious(run),
    ...ungrounded(run),
    ...misranked(run),
    ...wasteful(run),
    ...escaped(run),
  ]
}

const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/

/** A file under `fixtures/`, and never one outside it. */
const safePath = z
  .string()
  .regex(SAFE_PATH, 'must be a relative path with no leading slash')
  .refine((value) => !value.includes('..'), 'must not climb out of fixtures/')

/**
 * A recorded answer: a file for the ordinary case, and a status for the cases
 * the ordinary one cannot express.
 *
 * A bare path means 200, which is what almost every recording is. The object
 * form exists because two of the seven Defects are about failure — `escaped` is
 * at zero tolerance in ADR-0065 — and a format that can only record success is
 * a format in which those cases cannot be written at all. Tickets 05 and 06
 * inherit this, so it is settled before twenty manifests exist rather than
 * after.
 */
const recordedResponse = z.union([
  safePath,
  z
    .object({
      status: z.number().int().min(0).max(599),
      /** Absent is an empty body, which is what a refusal usually has. */
      file: safePath.optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
])

/**
 * A Golden Case, as `fixtures/eval/<NN>-<slug>/case.json` states it.
 *
 * Refused loudly rather than defaulted: a case that does not parse is not a
 * case that runs with assumptions nobody wrote down, and a pass whose cases
 * quietly differ from their manifests measures nothing (ADR-0058).
 *
 * `args` is a real argv fragment, parsed by `parseCliArgs` like any other, so a
 * case cannot drift from the CLI it is meant to be exercising. Both `sources`
 * and `responses` name files relative to `fixtures/` rather than to the case
 * directory, so a body two cases share is referenced twice instead of copied
 * twice (ADR-0062). `responses` keys are URL prefixes, longest match first.
 */
export const caseSchema = z
  .object({
    slug: z.string().min(1),
    args: z.array(z.string()),
    /** The instant the fake clock reports, so a January window is a fixed question. */
    now: z.iso.datetime({ offset: true }),
    sources: z.partialRecord(z.enum(SOURCE_IDS), safePath),
    labels: z.object({
      eligible: z.array(z.string()),
      ineligible: z.array(z.string()),
    }),
    budget: z.object({
      steps: z.number().int().positive(),
      costUsd: z.number().positive(),
    }),
    responses: z.record(z.string().min(1), recordedResponse),
  })
  .strict()

export type EvalCase = z.infer<typeof caseSchema>

/** One case's run, graded. The unit both the report and the comparison are made of. */
export interface CaseResult {
  readonly slug: string
  readonly runId: string
  readonly terminationReason: TerminationReason
  readonly defects: readonly Finding[]
  readonly steps: number
  /** Wall clock around the run. Real, because the model in a pass is real (ADR-0058). */
  readonly latencyMs: number
  readonly tokens: Usage
  readonly cost: number
}

export interface PassTotals {
  readonly cases: number
  /** Every word, including the ones at zero: a taxonomy reports its absences. */
  readonly defects: Record<Defect, number>
  readonly incomplete: number
  readonly steps: number
  readonly tokens: Usage
  readonly cost: number
  readonly meanCost: number
  readonly medianLatencyMs: number
}

/**
 * What produced a pass, pinned so that two passes can be told apart by more
 * than their numbers. ADR-0058 compares deltas against a noise floor, which
 * means nothing if the prompt, the profile or the model moved in between.
 */
export interface PassConfiguration {
  readonly at: string
  readonly promptVersion: number
  readonly profileVersion: number
  readonly modelId: string
}

export interface PassReport {
  readonly configuration: PassConfiguration
  readonly cases: readonly CaseResult[]
  readonly totals: PassTotals
}

/**
 * The middle value, and the midpoint of the middle two where there is no
 * middle. Median rather than mean, because one 44-second source fetch against a
 * provider having a bad afternoon should not become the number a later pass is
 * compared against.
 */
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0

  const sorted = [...values].sort((one, other) => one - other)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * A pass, summed. Pure arithmetic over the case results, so the report a person
 * reads and the numbers a comparison is drawn from are the same thing, and an
 * empty pass totals to zero rather than to `NaN`.
 */
export const aggregate = (
  cases: readonly CaseResult[],
  configuration: PassConfiguration,
): PassReport => {
  const defects = Object.fromEntries(DEFECTS.map((defect) => [defect, 0])) as Record<Defect, number>
  for (const each of cases) {
    for (const finding of each.defects) defects[finding.defect] += 1
  }

  const cost = cases.reduce((total, each) => total + each.cost, 0)

  return {
    configuration,
    cases,
    totals: {
      cases: cases.length,
      defects,
      incomplete: cases.filter((each) => !COMPLETED.includes(each.terminationReason)).length,
      steps: cases.reduce((total, each) => total + each.steps, 0),
      tokens: cases.reduce((total, each) => addUsage(total, each.tokens), NO_USAGE),
      cost,
      meanCost: cases.length === 0 ? 0 : cost / cases.length,
      medianLatencyMs: median(cases.map((each) => each.latencyMs)),
    },
  }
}
