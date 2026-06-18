-- 0001_drop_city — add an optional city label to drops.
--
-- Powers the Trail "cities" stat: distinct cities a device has dropped in or
-- revealed. Reverse-geocoded client-side at drop time and sent on create.
-- Nullable, so existing rows (and drops without a resolved city) are fine.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS city text;
