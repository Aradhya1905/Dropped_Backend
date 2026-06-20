-- 0003_routing — walking-route cache + per-provider monthly usage counter.
--
-- Backs GET /route/foot, the server-side proxy to OpenRouteService / Mapbox.
-- route_cache is keyed by quantized endpoints (lat/lng ×1e4 ≈ 11 m) + profile so
-- GPS jitter and many users walking to the same drop reuse one upstream call;
-- rows expire via ROUTE_CACHE_TTL_DAYS (enforced in the SELECT). routing_usage
-- counts upstream calls per (provider, YYYY-MM) so we stop before a free-tier cap.

CREATE TABLE IF NOT EXISTS route_cache (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_lat          integer     NOT NULL,
  from_lng          integer     NOT NULL,
  to_lat            integer     NOT NULL,
  to_lng            integer     NOT NULL,
  profile           text        NOT NULL,
  provider          text        NOT NULL,
  geometry          jsonb       NOT NULL,
  distance_meters   integer     NOT NULL,
  duration_seconds  integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS route_cache_key_idx
  ON route_cache (from_lat, from_lng, to_lat, to_lng, profile);

CREATE TABLE IF NOT EXISTS routing_usage (
  provider   text        NOT NULL,
  yyyymm     text        NOT NULL,
  count      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, yyyymm)
);
