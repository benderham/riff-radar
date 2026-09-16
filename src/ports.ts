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
}

export interface HttpResponse {
  readonly status: number
  /** Lowercased names, as `fetch` reports them. */
  readonly headers: Record<string, string>
  readonly body: string
}

export interface HttpPort {
  /**
   * Resolves for any status. Only a transport failure rejects.
   *
   * `headers` exists for the one caller that needs it: a search API
   * authenticates with a key in a header. It is additive — the project's own
   * user agent is always sent — and never carries a secret into the trace,
   * because nothing records the request headers.
   */
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>

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
