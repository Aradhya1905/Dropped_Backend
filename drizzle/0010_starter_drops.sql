-- 0010_starter_drops — shared, expiring starter drops seeded into empty areas.
--
-- When a device onboards somewhere with no drops within STARTER_CHECK_RADIUS_M,
-- the server pins a few "starter" drops around it (authored by a system device).
-- They expire so real drops take over.
--
-- `drops.expires_at` (+ its partial index) already exists in the live DB from
-- the abandoned 0005_drop_expiry; IF NOT EXISTS makes this a no-op there and
-- creates it on a fresh database. NULL = never expires, so existing rows are
-- unaffected.
--
-- `devices.starter_claimed_at` records that a device has used its one
-- onboarding seed attempt (whether or not anything was seeded).
--
-- Down path:
--   ALTER TABLE devices DROP COLUMN starter_claimed_at;
--   (leave drops.expires_at — it predates this migration in the live DB)

ALTER TABLE drops ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS drops_expires_idx
  ON drops (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS starter_claimed_at timestamptz;
