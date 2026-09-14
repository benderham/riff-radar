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
  async get(url) {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    }
  },
})
