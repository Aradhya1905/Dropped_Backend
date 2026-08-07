-- 0009_device_erasure — the panic wipe (FUN_TODOs/14).
--
-- Backs `DELETE /devices/me`: erase everything that identifies a device while
-- leaving the world it walked through intact. It is also the data-deletion
-- answer Google Play and the App Store both require of a location + UGC app,
-- so this surface is permanent — see the "do not roll back" note at the bottom.
--
-- Two things this file establishes.
--
-- 1. THE SENTINEL DEVICE.
--
--    `drops.device_id` and `replies.device_id` are both NOT NULL REFERENCES
--    devices(id), and a drop must survive its author: someone else already
--    walked 50 m to read it, and the premise of the app is that it happened
--    *here*. So the erase re-points those rows at one shared, permanent row
--    rather than deleting them or making the column nullable.
--
--    Shared, not one-per-wipe, and that is the whole point: a per-wipe tombstone
--    would still say "these fourteen confessions are by the same person", which
--    is a real deanonymisation vector across a map of coordinates. Every erased
--    author collapses into the same row and becomes indistinguishable.
--
--    It is inserted here rather than at runtime because the erase transaction
--    depends on it: if it is missing, the UPDATE fails the FK and the whole wipe
--    rolls back. Its id is deliberately NOT a UUID, so the X-Device-Id plugin
--    (which requires one) can never authenticate as it.
--
-- 2. THE REPLIES UNIQUE INDEX BECOMES PARTIAL.
--
--    `replies_drop_device_uniq` enforces one reply per device per drop. Once two
--    different erased devices have both replied to the same drop, both rows
--    carry the sentinel id and the index rejects the second — the wipe would
--    fail on a stranger's unrelated history. The rule exists to stop one person
--    posting twice; an erased device cannot post at all, so excluding it costs
--    nothing.
--
--    COUPLING, read before changing either side: src/repositories/reply.repo.ts
--    infers this index in its `ON CONFLICT (drop_id, device_id) WHERE device_id
--    <> '__deleted__'` clause. Postgres matches a partial index only when the
--    predicate matches, so the two predicates must stay character-identical.
--
-- Down path:
--   DROP INDEX IF EXISTS replies_drop_device_uniq;
--   CREATE UNIQUE INDEX replies_drop_device_uniq ON replies (drop_id, device_id);
--   -- and only then, once nothing references it:
--   DELETE FROM devices WHERE id = '__deleted__';

INSERT INTO devices (id) VALUES ('__deleted__') ON CONFLICT (id) DO NOTHING;

DROP INDEX IF EXISTS replies_drop_device_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS replies_drop_device_uniq
  ON replies (drop_id, device_id)
  WHERE device_id <> '__deleted__';

-- The erase deletes by device_id from five tables. `reveals`, `saves`, `hearts`
-- and `device_steps` all lead their primary key with device_id, so those are
-- already index-supported. `reports` is keyed by (drop_id) / (reply_id) only,
-- which would make the wipe a sequential scan of the moderation log.
CREATE INDEX IF NOT EXISTS reports_device_idx ON reports (device_id);

-- NOTE: rolling this back is not the same as rolling back a feature. Once the
-- app has advertised a delete-my-data route in a store listing, withdrawing it
-- is a compliance regression, not a revert.
