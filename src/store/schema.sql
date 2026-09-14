-- The trace.
--
-- Two tables: one row per run, one row per step. Everything is plain columns of
-- text, integers and reals so that a run can be read back with a SQL client and
-- nothing else.
--
-- A run's row is written when it starts and completed when it ends, so a run
-- that dies leaves evidence that it existed. `termination_reason` is therefore
-- nullable, but constrained to the nine documented reasons, and application code
-- refuses to set it twice: exactly one reason per run.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id                TEXT PRIMARY KEY,
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  cli_args              TEXT NOT NULL,
  resolved_from         TEXT NOT NULL,
  resolved_to           TEXT NOT NULL,
  prompt_version        INTEGER NOT NULL,
  profile_version       INTEGER NOT NULL,
  action_schema_version INTEGER NOT NULL,
  model_id              TEXT NOT NULL,
  termination_reason    TEXT CHECK (termination_reason IN (
                          'completed', 'completed_short', 'no_candidates', 'validation_failed',
                          'invalid_action_limit', 'max_steps_exceeded', 'budget_exceeded',
                          'tool_failure', 'aborted'
                        )),
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  estimated_cost        REAL NOT NULL DEFAULT 0,
  shortlist_size        INTEGER NOT NULL DEFAULT 0,
  notion_write_performed INTEGER NOT NULL DEFAULT 0 CHECK (notion_write_performed IN (0, 1)),
  -- 1 when the provider reported no cached-token breakdown, so every input
  -- token was priced as uncached and estimated_cost is a ceiling (ADR-0020).
  cost_is_upper_bound   INTEGER NOT NULL DEFAULT 0 CHECK (cost_is_upper_bound IN (0, 1))
);

-- The proposed action, the validation result and the dispatched action are
-- separate columns so that a rejected action is visible rather than absent
-- (ADR-0012): a step whose proposed_action failed validation has no
-- dispatched_action, and the reason sits between them.
CREATE TABLE IF NOT EXISTS steps (
  step_id               TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES runs(run_id),
  step_index            INTEGER NOT NULL,
  timestamp             TEXT NOT NULL,
  duration_ms           INTEGER,
  kind                  TEXT NOT NULL,
  model_response        TEXT,
  proposed_action       TEXT,
  validation_result     TEXT,
  dispatched_action     TEXT,
  tool_name             TEXT,
  tool_args             TEXT,
  tool_result           TEXT,
  error                 TEXT,
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cost                  REAL NOT NULL DEFAULT 0,
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS steps_by_run ON steps (run_id, step_index);
