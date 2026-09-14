import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveWindow } from './window.ts'

// `now` is always constructed with local-time components, because the window is
// resolved in local time: the run means "the past week as Ben experienced it".
const localNoon = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0)

test('a seven-day window covers seven dates, ending today', () => {
  assert.deepEqual(resolveWindow(localNoon(2026, 9, 14), 7), {
    from: '2026-09-08',
    to: '2026-09-14',
  })
})

test('a one-day window is today alone', () => {
  assert.deepEqual(resolveWindow(localNoon(2026, 9, 14), 1), {
    from: '2026-09-14',
    to: '2026-09-14',
  })
})

test('the window crosses a month boundary', () => {
  assert.deepEqual(resolveWindow(localNoon(2026, 3, 3), 7), {
    from: '2026-02-25',
    to: '2026-03-03',
  })
})

test('the window crosses a year boundary', () => {
  assert.deepEqual(resolveWindow(localNoon(2026, 1, 2), 7), {
    from: '2025-12-27',
    to: '2026-01-02',
  })
})

test('the window uses the local date, not the UTC date', () => {
  // 09:00 on 14 September in Sydney is still 23:00 on 13 September in UTC.
  const sydneyMorning = new Date('2026-09-13T23:00:00Z')
  const expectedLocalDay = String(sydneyMorning.getDate()).padStart(2, '0')
  assert.equal(resolveWindow(sydneyMorning, 1).to.slice(-2), expectedLocalDay)
})

test('months and days are zero-padded', () => {
  assert.deepEqual(resolveWindow(localNoon(2026, 1, 9), 2), {
    from: '2026-01-08',
    to: '2026-01-09',
  })
})
