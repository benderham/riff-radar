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

/** Formats a Date as `YYYY-MM-DD` using its local-time components. */
export const toLocalDate = (at: Date): string => {
  const year = String(at.getFullYear()).padStart(4, '0')
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const resolveWindow = (now: Date, lastDays: number): DateWindow => {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('cannot resolve a window from an invalid date')
  }
  if (!Number.isInteger(lastDays) || lastDays < 1) {
    throw new RangeError(`--last-days must be a whole number of days, 1 or more; got ${lastDays}`)
  }

  // Constructing through the local-time components rather than subtracting
  // milliseconds keeps the arithmetic correct across DST transitions, where a
  // day is not always 24 hours long.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (lastDays - 1))

  return { from: toLocalDate(start), to: toLocalDate(now) }
}
