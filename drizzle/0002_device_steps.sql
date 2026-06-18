-- 0002_device_steps — per-device, per-day step counts.
--
-- Powers the Trail "steps" stat. Stored date-wise so the displayed scope
-- (day / month / lifetime) is a backend decision (STEP_SCOPE in step.service),
-- not a schema change. The client counts steps locally while the app is open
-- and syncs day-tagged deltas; the upsert accumulates them per (device, day).

CREATE TABLE IF NOT EXISTS device_steps (
  device_id  text        NOT NULL REFERENCES devices(id),
  day        date        NOT NULL,
  steps      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, day)
);
