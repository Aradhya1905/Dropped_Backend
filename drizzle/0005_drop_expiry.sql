-- 0005_drop_expiry — expiring drops.
--
-- An author picks how long a drop lives: 7 days, 30 days, or forever. NULL is
-- forever, so every pre-existing row keeps its current behaviour. After expiry
-- the drop leaves `nearby` and can no longer be revealed — but the row stays:
-- reports and moderation history reference it, the author still sees it in
-- their own Trail, and anyone who already saved or revealed it keeps their copy.
--
-- Down path:
--   DROP INDEX IF EXISTS drops_expires_idx;
--   ALTER TABLE drops DROP COLUMN expires_at;

ALTER TABLE drops ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Partial: most rows are forever (NULL) and don't belong in the index.
CREATE INDEX IF NOT EXISTS drops_expires_idx
  ON drops (expires_at)
  WHERE expires_at IS NOT NULL;
