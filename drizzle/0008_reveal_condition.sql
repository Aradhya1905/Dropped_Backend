-- 0008_reveal_condition — time-gated drops.
--
-- An author may add ONE condition on top of the 50 m rule: readable only after
-- dark, or only in daylight. NULL is "no condition", so every pre-existing row
-- keeps its current behaviour and the overwhelming majority of drops are
-- untouched by this feature.
--
-- Sunrise/sunset are computed at read time from the drop's own coordinate (see
-- src/domain/solar.ts) — nothing about the sun is stored, because storing it
-- would mean storing a timezone, and a timezone is exactly what this feature
-- avoids needing.
--
-- Numbered 0008, not 0007: the anniversary-echo work (FUN_TODOs/08) has 0007
-- in flight. The migrator keys off filenames in a `_migrations` table and sorts
-- them, so a gap is harmless if that work never lands — a duplicate number
-- would not be.
--
-- Down path:
--   ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_reveal_condition_chk;
--   ALTER TABLE drops DROP COLUMN reveal_condition;

ALTER TABLE drops ADD COLUMN IF NOT EXISTS reveal_condition text;

-- Only the two conditions the composer offers. Deliberately narrow: weather
-- gating ("when it's raining") needs an external API and is a separate ticket,
-- and one condition per drop is a product decision — 50 m is already a hard
-- ask, and 50 m AND midnight AND rain means nobody ever reads it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drops_reveal_condition_chk'
  ) THEN
    ALTER TABLE drops ADD CONSTRAINT drops_reveal_condition_chk
      CHECK (reveal_condition IS NULL OR reveal_condition IN ('night', 'day'));
  END IF;
END
$$;

-- No index: the column is not a search predicate. Every read that cares about
-- it has already narrowed to one drop (the reveal) or to a small radius
-- (nearby), and it is NULL on nearly every row.
