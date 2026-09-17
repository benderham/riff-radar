# 02: The HTTP adapter tries again, three times, and says so

**What to build:** Bounded retry with exponential backoff inside `src/adapters/http.ts`, and an `attempts` count on `HttpResponse`.

**Blocked by:** 01

**Status:** done

## Why

Nothing in the project retries anything. A single dropped packet loses a step; a provider having a bad five seconds loses a run. The adapter is already the one place that performs a request and already owns the promise that nothing below the clients throws (ADR-0043), so "and try again when the category says to" belongs there and nowhere else.

The alternative — a helper each client wraps its own call in — is four call sites and four chances to forget one, with the forgotten one invisible until a Friday.

## What

Three attempts total. Backoff of roughly 1s, 2s, 4s with jitter. Retry only `transient` and `rate_limited`; every other category is an answer and returns immediately. Honour `Retry-After` when the provider states it, as seconds or as an HTTP date, capped so a hostile value cannot stall a run.

`HttpResponse` gains `attempts: number`, always at least 1. Without it, retry makes the system quietly more reliable and completely unexplainable.

## Acceptance criteria

- [x] `get`, `post` and `patch` all retry, through the shared `withBody` path for the latter two
- [x] A `transient` response is retried up to three attempts total, then returned as-is — it still does not throw
- [x] `refused`, `not_found` and `malformed` are returned on the first attempt, with no delay
- [x] `Retry-After` in seconds and as an HTTP date are both honoured, and a value beyond a sensible cap is clamped
- [x] Backoff is jittered, and time passes through a new `sleep(ms)` on `ClockPort` rather than a raw timer — the tests fake it, record the delay sequence and assert its shape, and the suite never actually sleeps for seven seconds
- [x] The adapter takes the clock at construction, beside `fetchImpl`
- [x] The MusicBrainz gate stops calling `setTimeout` directly and uses the same `sleep`, so there is one place in the project where time passes (ADR-0018)
- [x] `HttpResponse.attempts` is set on every response, and a retried call surfaces it in the client's warning so it reaches the trace
- [x] `npm run trace` prints the attempt count where it is above one
- [x] MusicBrainz's one-request-per-second policy is unchanged and still lives in its client — it is politeness, not a failure response — and a test proves retry and the gate compose without double-sleeping
- [x] No per-run retry budget, deliberately

## Notes

A retried request inflates its step's `duration_ms`, which is correct and will make milestone 3's latency figures lumpy; `attempts` is what explains the lumps.

Three attempts against a dead provider costs about seven seconds per call before the run learns anything. That is the arithmetic that makes ticket 05 necessary rather than merely nice: 23 lookups against a blocked MusicBrainz would now take three minutes to fail.

See ADR-0049.

## Comments

**17 September 2026 — implemented.** `attempted` in `src/adapters/http.ts` is the retry loop, shared by `get` and by the `withBody` path that `post` and `patch` both take. `ClockPort` gained `sleep`, `src/adapters/clock.ts` is the one implementation that really waits, and `HttpResponse` carries `attempts`. 390 tests, `npm run check` green in about two seconds — the suite never sleeps.

Two things the ticket did not spell out, both settled in ADR-0049's implementation note. MusicBrainz's own three-attempt loop and `MUSICBRAINZ_MAX_ATTEMPTS` were **deleted** rather than left beside the adapter's: keeping both would have cost one lookup up to nine requests, and "retry belongs there and nowhere else" is the whole decision. Its one-request-per-second gate is untouched and now waits through the clock; a test drives the real adapter through `lookupRelease` and proves the two compose with exactly one wait. And `Retry-After` is clamped at ten seconds, so the worst a hostile header costs a run is twenty seconds.

The criterion about `npm run trace` needed more than the ticket implied. A *failed* retried call explains itself through `describeStatus`, inside a warning it was going to write anyway — but a call that succeeded on the third ask writes no warning at all, and that is precisely the lumpy step the count exists to explain. `retriedNote` and `warned` in `src/domain/http-outcome.ts` fix it: sources, search and MusicBrainz now say "answered after N attempts" on the success path too, joined with whatever else the step had to report rather than overwriting it. `scripts/trace.ts` itself needed no change, and no column was added — the four columns of milestone 2 are the four columns of milestone 2.

Cover art was again the client with nothing to wire: it swallows every outcome by design and records no warning to put a count beside.
