-- The trace.
--
-- Three tables: one row per run, one row per step, one row per source fetch. Everything is plain columns of
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
  cost_is_upper_bound   INTEGER NOT NULL DEFAULT 0 CHECK (cost_is_upper_bound IN (0, 1)),
  -- The run this one resumed, when it is a resume (ADR-0047). A resumed run is
  -- a new row and inherits its parent's ceilings, so the pair is read as a
  -- chain and this column is the link.
  resumed_from          TEXT REFERENCES runs(run_id),
  -- 1 when MusicBrainz stopped being asked partway through (ADR-0052), so a
  -- run judged on its sources' word is distinguishable from one that was not.
  musicbrainz_degraded  INTEGER NOT NULL DEFAULT 0 CHECK (musicbrainz_degraded IN (0, 1))
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
  -- A step that failed sets `error`; a step that succeeded on a source that
  -- disappointed sets `warning` (ADR-0030). Separate columns because a SQL
  -- reader must be able to tell a broken run from a quiet one without joining.
  error                 TEXT,
  warning               TEXT,
  -- What kind of thing broke outside the run, beside the prose that says it in
  -- words (ADR-0048). Constrained the way termination_reason is, because the
  -- point of the column is that it can be counted rather than parsed.
  failure_category      TEXT CHECK (failure_category IN (
                          'transient', 'rate_limited', 'refused',
                          'not_found', 'malformed', 'unavailable'
                        )),
  -- The run's candidate list after this step, as JSON. The one part of a step
  -- a resume cannot replay from the trace it already holds (ADR-0046).
  candidates_after      TEXT,
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cost                  REAL NOT NULL DEFAULT 0,
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS steps_by_run ON steps (run_id, step_index);

-- What a source actually served, kept because extraction is a model call and so
-- is not byte-reproducible (ADR-0003): an extraction that looks wrong is
-- re-examined from the stored body rather than by fetching the page again, by
-- which time it may have changed. The body is stored raw; the cleaned text the
-- model saw is a pure function of it and is reproduced rather than duplicated.
CREATE TABLE IF NOT EXISTS source_texts (
  source_text_id  TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs(run_id),
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  fetched_at      TEXT NOT NULL,
  status          INTEGER NOT NULL,
  raw_body        TEXT NOT NULL,
  truncated       INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  warning         TEXT
);

CREATE INDEX IF NOT EXISTS source_texts_by_run ON source_texts (run_id, fetched_at);
