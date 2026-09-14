/**
 * The seam.
 *
 * Everything non-deterministic or outside the process is reached through this
 * one injected object (ADR-0018), so tests substitute the outside world in a
 * single place. SQLite is deliberately not here: tests use a real in-memory
 * database instead.
 *
 * `model` is shaped by what the loop needs rather than by what the provider
 * returns: messages in, one response out, usage counted three ways. The `http`
 * port arrives with the first live client.
 */

import type { Usage } from './domain/cost.ts'

export interface ClockPort {
  /** The current instant. Local-time components are what resolve the window. */
  now(): Date
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
}
