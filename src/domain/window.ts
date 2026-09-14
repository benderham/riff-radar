/**
 * Resolving the date window.
 *
 * A run is started with a relative flag (`--last-days 7`) but means an absolute
 * pair of dates. Resolution happens once, at the start of the run, and the
 * resolved range is what the trace records: `7` means something different every
 * day, so a stored `7` would tell a later reader nothing.
 *
 * The window is a pair of `YYYY-MM-DD` strings rather than instants, because
 * releases carry dates and not times. Both ends are inclusive, and `lastDays`
 * counts days including today: seven days ending Monday the 14th starts on
 * Tuesday the 8th. Resolution is in local time, so a Friday-morning run means
 * the week the person running it just lived through.
 */

/** An inclusive range of local calendar dates, each `YYYY-MM-DD`. */
export interface DateWindow {
  readonly from: string
  readonly to: string
}

/** Formats a Date as `YYYY-MM-DD` from its local-time components. */
export const toLocalDate = (at: Date): string => at.toLocaleDateString('en-CA')

/** `lastDays` is validated where it is parsed, in `parseCliArgs`. */
export const resolveWindow = (now: Date, lastDays: number): DateWindow => {
  // Constructing through the local-time components rather than subtracting
  // milliseconds keeps the arithmetic correct across DST transitions, where a
  // day is not always 24 hours long.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (lastDays - 1))

  return { from: toLocalDate(start), to: toLocalDate(now) }
}
