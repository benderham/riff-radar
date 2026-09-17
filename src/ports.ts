/**
 * The seam.
 *
 * Everything non-deterministic or outside the process is reached through this
 * one injected object (ADR-0018), so tests substitute the outside world in a
 * single place. SQLite is deliberately not here: tests use a real in-memory
 * database instead.
 *
 * `model` is shaped by what the loop needs rather than by what the provider
 * returns: messages in, one response out, usage counted three ways. `http` is
 * deliberately low-level — status, headers and body — so that the clients above
 * it are exercised for real against recorded fixture bodies rather than stubbed
 * out: a source page changing shape is only visible at the raw-response level.
 */

import type { Usage } from './domain/cost.ts'

export interface ClockPort {
  /** The current instant. Local-time components are what resolve the window. */
  now(): Date

  /**
   * Time passing, in the one place the project lets it (ADR-0018).
   *
   * Retry backoff and MusicBrainz's one-second gate both wait here rather than
   * reaching for a timer, so a test controls both by faking one method — and a
   * suite that would otherwise spend seven seconds per retry case spends none.
   */
  sleep(ms: number): Promise<void>
}

export interface HttpResponse {
  readonly status: number
  /** Lowercased names, as `fetch` reports them. */
  readonly headers: Record<string, string>
  readonly body: string
  /**
   * How many requests this response cost, counting the one that produced it.
   * Always at least one (ADR-0049). Above one, a client says so in its warning,
   * which is what stops a retried call from being silently slow in the trace.
   */
  readonly attempts: number
}

export interface HttpPort {
  /**
   * Resolves for any status, and for no status at all: a request that never
   * gets an answer comes back as status zero with the reason in the body
   * (ADR-0043). Nothing here rejects.
   *
   * `headers` exists for the one caller that needs it: a search API
   * authenticates with a key in a header. It is additive — the project's own
   * user agent is always sent — and never carries a secret into the trace,
   * because nothing records the request headers.
   */
  get(
    url: string,
    headers?: Record<string, string>,
    options?: {
      /**
       * False to report a redirect rather than follow it. One caller needs it:
       * the Cover Art Archive answers "there is art" with a 307 and "there is
       * none" with a 404, so the redirect *is* the answer, and following it
       * would download an image to learn what its status line already said.
       */
      readonly followRedirects?: boolean
    },
  ): Promise<HttpResponse>

  /**
   * The same contract as `get`, with a body. It exists for the one caller that
   * needs it: the search API takes its query in a JSON body rather than a query
   * string (ADR-0033). Sources are read with `get` and always will be.
   */
  post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>

  /**
   * The same contract again, for the one caller that needs it: undoing a
   * partial Notion write archives the pages already created, and Notion
   * archives a page with a PATCH. Nothing else patches anything.
   */
  patch(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>
}

/** A tool call as the model proposed it. `argumentsJson` is untrusted text. */
export interface ProposedToolCall {
  readonly id: string
  readonly name: string
  readonly argumentsJson: string
}

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  /** Present on assistant messages that proposed calls, and echoed back. */
  readonly toolCalls?: readonly ProposedToolCall[]
  /** Present on tool messages: which call this answers. */
  readonly toolCallId?: string
}

/** A tool as offered to the model: the JSON schema is derived, never hand-kept. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

export interface ModelResponse {
  readonly content: string
  readonly toolCalls: readonly ProposedToolCall[]
  readonly usage: Usage
  /**
   * False when the provider reported no cached-token breakdown, in which case
   * every input token is priced as uncached and the cost is an upper bound
   * (ADR-0020).
   */
  readonly cacheReported: boolean
  /** The response body as received, for the trace. */
  readonly raw: unknown
}

export interface ModelPort {
  complete(request: {
    readonly messages: readonly ModelMessage[]
    readonly tools: readonly ToolDefinition[]
  }): Promise<ModelResponse>
}

export interface Ports {
  readonly clock: ClockPort
  readonly model: ModelPort
  readonly http: HttpPort
}
