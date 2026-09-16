# 02: The HTTP adapter tries again, three times, and says so

**What to build:** Bounded retry with exponential backoff inside `src/adapters/http.ts`, and an `attempts` count on `HttpResponse`.

**Blocked by:** 01

**Status:** ready-for-agent

## Why

Nothing in the project retries anything. A single dropped packet loses a step; a provider having a bad five seconds loses a run. The adapter is already the one place that performs a request and already owns the promise that nothing below the clients throws (ADR-0043), so "and try again when the category says to" belongs there and nowhere else.

The alternative — a helper each client wraps its own call in — is four call sites and four chances to forget one, with the forgotten one invisible until a Friday.

## What

Three attempts total. Backoff of roughly 1s, 2s, 4s with jitter. Retry only `transient` and `rate_limited`; every other category is an answer and returns immediately. Honour `Retry-After` when the provider states it, as seconds or as an HTTP date, capped so a hostile value cannot stall a run.

`HttpResponse` gains `attempts: number`, always at least 1. Without it, retry makes the system quietly more reliable and completely unexplainable.

## Acceptance criteria

- [ ] `get`, `post` and `patch` all retry, through the shared `withBody` path for the latter two
- [ ] A `transient` response is retried up to three attempts total, then returned as-is — it still does not throw
- [ ] `refused`, `not_found` and `malformed` are returned on the first attempt, with no delay
- [ ] `Retry-After` in seconds and as an HTTP date are both honoured, and a value beyond a sensible cap is clamped
- [ ] Backoff is jittered, and time passes through a new `sleep(ms)` on `ClockPort` rather than a raw timer — the tests fake it, record the delay sequence and assert its shape, and the suite never actually sleeps for seven seconds
- [ ] The adapter takes the clock at construction, beside `fetchImpl`
- [ ] The MusicBrainz gate stops calling `setTimeout` directly and uses the same `sleep`, so there is one place in the project where time passes (ADR-0018)
- [ ] `HttpResponse.attempts` is set on every response, and a retried call surfaces it in the client's warning so it reaches the trace
- [ ] `npm run trace` prints the attempt count where it is above one
- [ ] MusicBrainz's one-request-per-second policy is unchanged and still lives in its client — it is politeness, not a failure response — and a test proves retry and the gate compose without double-sleeping
- [ ] No per-run retry budget, deliberately

## Notes

A retried request inflates its step's `duration_ms`, which is correct and will make milestone 3's latency figures lumpy; `attempts` is what explains the lumps.

Three attempts against a dead provider costs about seven seconds per call before the run learns anything. That is the arithmetic that makes ticket 05 necessary rather than merely nice: 23 lookups against a blocked MusicBrainz would now take three minutes to fail.

See ADR-0049.
