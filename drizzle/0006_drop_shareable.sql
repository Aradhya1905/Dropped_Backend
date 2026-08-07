-- 0006_drop_shareable — the author's opt-out from share-a-spot links.
--
-- A confession meant for strangers walking past is a different thing from one
-- broadcast into a group chat. `shareable = false` makes `GET /drops/:id/preview`
-- 404 for that drop, so a link to it resolves to nothing.
--
-- Defaults to true, which is what every row predating this migration gets: the
-- share affordance is new, so nobody has had the chance to decline it, and the
-- previous behaviour (no links existed at all) is unaffected either way.
--
-- Note this is an opt-out on the *link*, not on the drop. An opted-out drop is
-- still findable by walking, which is the app's whole premise.
--
-- Down path:
--   ALTER TABLE drops DROP COLUMN shareable;

ALTER TABLE drops
  ADD COLUMN IF NOT EXISTS shareable boolean NOT NULL DEFAULT true;
