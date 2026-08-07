-- 0004_replies — replies in place.
--
-- One short line pinned under a drop, writable only by a device that has a
-- `reveals` row for it (proof the server verified it within 50 m) and readable
-- only by the same. A drop stops being a dead letter and becomes a place with
-- history.
--
-- Down path (not automatic — see the reports change below):
--   DELETE FROM reports WHERE reply_id IS NOT NULL;
--   ALTER TABLE reports DROP CONSTRAINT reports_target_chk;
--   ALTER TABLE reports DROP COLUMN reply_id;
--   ALTER TABLE reports ALTER COLUMN drop_id SET NOT NULL;
--   ALTER TABLE drops DROP COLUMN reply_count;
--   DROP TABLE replies;

CREATE TABLE IF NOT EXISTS replies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices(id),
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'visible',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replies_body_len CHECK (char_length(body) BETWEEN 1 AND 140),
  CONSTRAINT replies_status_chk CHECK (status IN ('visible', 'hidden', 'pending'))
);

CREATE INDEX IF NOT EXISTS replies_drop_idx ON replies (drop_id);
CREATE INDEX IF NOT EXISTS replies_device_idx ON replies (device_id);

-- One reply per device per drop. Enforced here, not just in the UI.
CREATE UNIQUE INDEX IF NOT EXISTS replies_drop_device_uniq ON replies (drop_id, device_id);

-- Denormalised "voices here" counter so nearby can show it without an N+1.
-- Counts `visible` replies only.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS reply_count integer NOT NULL DEFAULT 0;

-- Reports must be able to target a reply as well as a drop. A nullable
-- reply_id + XOR check keeps both foreign keys real, and the existing
-- REPORT_HIDE_THRESHOLD count query still works per-target with one WHERE.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reply_id uuid REFERENCES replies(id) ON DELETE CASCADE;
ALTER TABLE reports ALTER COLUMN drop_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_target_chk'
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_target_chk
      CHECK ((drop_id IS NOT NULL) <> (reply_id IS NOT NULL));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS reports_reply_idx ON reports (reply_id);
