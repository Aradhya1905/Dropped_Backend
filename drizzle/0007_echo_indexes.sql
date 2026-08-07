-- 0007_echo_indexes — make the anniversary-echo lookup selective.
--
-- `GET /drops/echoes` asks a question no earlier route asked: "everything THIS
-- device dropped or revealed, whose timestamp lands in one of three week-wide
-- windows". Both halves are keyed by device first, then filtered on time:
--
--   reveals: device_id = $1 AND created_at BETWEEN …
--   drops:   device_id = $1 AND created_at BETWEEN …
--
-- `reveals` had no index on device_id at all — its primary key is
-- (drop_id, device_id), which cannot serve a lookup that doesn't know the drop.
-- Without this, every echo check sequentially scans every reveal ever recorded,
-- and the client polls this endpoint from a location watch.
--
-- `drops_device_idx` already exists on (device_id) alone; the composite below
-- lets the time window be answered from the index rather than by fetching every
-- drop the device ever made.
--
-- Down path:
--   DROP INDEX IF EXISTS reveals_device_created_idx;
--   DROP INDEX IF EXISTS drops_device_created_idx;

CREATE INDEX IF NOT EXISTS reveals_device_created_idx
  ON reveals (device_id, created_at);

CREATE INDEX IF NOT EXISTS drops_device_created_idx
  ON drops (device_id, created_at);
