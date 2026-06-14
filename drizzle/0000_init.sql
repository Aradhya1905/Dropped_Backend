-- Dropped — initial schema.
-- Standard PostGIS only (ST_DWithin, geography), so it replays on any Postgres.

CREATE EXTENSION IF NOT EXISTS postgis;
-- gen_random_uuid() lives in pgcrypto on older Postgres; harmless if already present.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Anonymous identity: id is the X-Device-Id UUID the client sends.
CREATE TABLE IF NOT EXISTS devices (
  id          text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Drops: a secret pinned to a geography point.
CREATE TABLE IF NOT EXISTS drops (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    text NOT NULL REFERENCES devices(id),
  body         text NOT NULL,
  mood         text NOT NULL,
  place_label  text,
  geog         geography(Point, 4326) NOT NULL,
  status       text NOT NULL DEFAULT 'visible',
  reveal_count integer NOT NULL DEFAULT 0,
  stood_here   integer NOT NULL DEFAULT 0,
  heart_count  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drops_body_len CHECK (char_length(body) BETWEEN 1 AND 280),
  CONSTRAINT drops_mood_chk CHECK (mood IN ('joy', 'ache', 'trouble', 'wonder')),
  CONSTRAINT drops_status_chk CHECK (status IN ('visible', 'hidden', 'pending'))
);

-- GiST index is what makes "drops within 50 m of a point" fast.
CREATE INDEX IF NOT EXISTS drops_geog_gix ON drops USING gist (geog);
CREATE INDEX IF NOT EXISTS drops_device_idx ON drops (device_id);
CREATE INDEX IF NOT EXISTS drops_status_idx ON drops (status);

-- Reveals: one row per (drop, device). Drives reveal_count + the Found trail.
CREATE TABLE IF NOT EXISTS reveals (
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, device_id)
);

-- Saves (bookmarks), keyed by device.
CREATE TABLE IF NOT EXISTS saves (
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, device_id)
);

-- Hearts ("I feel this"), keyed by device.
CREATE TABLE IF NOT EXISTS hearts (
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, device_id)
);

-- Reports feed moderation; N reports flip a drop to 'pending'.
CREATE TABLE IF NOT EXISTS reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices(id),
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_drop_idx ON reports (drop_id);
