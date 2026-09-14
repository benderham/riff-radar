/**
 * The seam.
 *
 * Everything non-deterministic or outside the process is reached through this
 * one injected object (ADR-0018), so tests substitute the outside world in a
 * single place. SQLite is deliberately not here: tests use a real in-memory
 * database instead.
 *
 * Only `clock` exists so far. The `model` and `http` ports arrive with the loop
 * and the first live client; declaring them before anything implements or calls
 * them would be a guess about their shape.
 */

export interface ClockPort {
  /** The current instant. Local-time components are what resolve the window. */
  now(): Date
}

export interface Ports {
  readonly clock: ClockPort
}
