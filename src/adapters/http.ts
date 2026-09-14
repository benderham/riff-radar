/**
 * HTTP, over built-in `fetch`.
 *
 * The only code in the project that performs a request. It reports what came
 * back and judges none of it: a 403 from a site that has decided it dislikes us
 * is a fact the client above needs to see and record, not an exception thrown
 * from the bottom of the stack.
 *
 * `fetchImpl` is injected for the adapter's own tests only. Everything else
 * reaches HTTP through the port.
 */

import { HTTP_TIMEOUT_MS, USER_AGENT } from '../../config.ts'
import type { HttpPort } from '../ports.ts'

export const httpAdapter = (fetchImpl: typeof fetch = globalThis.fetch): HttpPort => ({
  async get(url, headers = {}) {
    const response = await fetchImpl(url, {
      // The project's own identification leads, and a caller's headers follow,
      // because a search API's key is an addition to who we are and not a
      // disguise: nothing here ever claims to be a browser (ADR-0031).
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', ...headers },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    }
  },
})
