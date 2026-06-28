# Walking-route proxy — `GET /route/foot`

_2026-06-20_

Server-side proxy that returns a walking route from a point to a sealed drop, so
the client can draw the path on the Walk screen. Keys stay server-side; the
client only talks to us.

## Contract

`GET /route/foot?fromLat&fromLng&toLat&toLng` (flat query params; requires the
usual `X-Device-Id` header like every non-public route).

Always **200**. When no provider can serve it, `available` is false and the rest
are null — the client then draws nothing.

```jsonc
{
  "available": true,
  "provider": "ors",            // 'ors' | 'mapbox' | null
  "geometry": { "type": "LineString", "coordinates": [[lng,lat], …] },
  "distanceMeters": 608,
  "durationSeconds": 438
}
```

Guidance only — the 50 m reveal still uses straight-line PostGIS distance
(`/drops/:id/reveal`) and never depends on this.

## Flow

`routingService.footRoute` (`src/services/routing.service.ts`):

1. **Quantize** both endpoints to integers ×1e4 (≈11 m) — the cache/quota key.
2. **Cache** lookup (`route_cache`, fresh within `ROUTE_CACHE_TTL_DAYS`) → return.
3. Else try providers in order, skipping any with no key or whose monthly counter
   is at the cap:
   - **ORS** — `POST /v2/directions/foot-walking/geojson`, `Authorization: <key>`.
   - **Mapbox** — `GET /directions/v5/mapbox/walking/{coords}?geometries=geojson&overview=full`.
   On success: increment `routing_usage`, write `route_cache`, return.
4. All unavailable / failed → `{ available: false }` (not cached).

HTTP wrappers (`src/services/routing.http.ts`) use built-in `fetch` (6 s
timeout) and normalize to `{ geometry, distanceMeters, durationSeconds }`.

## Schema

Migration `drizzle/0003_routing.sql` (idempotent), tables mirrored in
`src/db/schema.ts`:

- **`route_cache`** — quantized `from_lat/from_lng/to_lat/to_lng` + `profile`,
  `provider`, `geometry` jsonb (GeoJSON LineString), `distance_meters`,
  `duration_seconds`, `created_at`. Indexed on the four coords + profile. The
  big win: many users walking to the same drop (and your own GPS jitter) reuse
  one upstream call.
- **`routing_usage`** — `(provider, yyyymm)` PK + `count`. Per-provider monthly
  counter checked before each upstream call.

Repo: `src/repositories/route.repo.ts` (`getCached` / `putCached` /
`usageThisMonth` / `incrementUsage`). Route + controller + schema:
`src/routes/route.routes.ts`, `src/controllers/route.controller.ts`,
`src/schemas/route.schema.ts`; registered in `src/routes/index.ts`.

## Config (`.env`)

| Var | Default | Notes |
| --- | --- | --- |
| `ORS_API_KEY` | `''` | empty = ORS disabled (skipped) |
| `MAPBOX_TOKEN` | `''` | empty = Mapbox disabled (skipped) |
| `ORS_MONTHLY_LIMIT` | `60000` | safety cap under the ~2,500/day free tier |
| `MAPBOX_MONTHLY_LIMIT` | `90000` | safety cap under the 100k/mo free tier |
| `ROUTE_CACHE_TTL_DAYS` | `21` | walking networks are ~static |

With **neither** key set the endpoint just returns `{ available: false }` and the
server still boots — keys are optional.

## Ops notes

- The deploy script (`/deployInServer`) runs `db:migrate` and restarts pm2, but
  **does not touch `.env`** — the keys must be added to the server's
  `~/Dropped_Backend/.env` separately (the app reads the `.env` file at boot from
  its cwd; a plain `pm2 restart` re-reads it).
- **jsonb gotcha (fixed):** postgres.js 3.4.5's `sql.json()` helper failed to
  serialize the GeoJSON object for the jsonb column ("string argument … Received
  an instance of Object"); since the service swallows provider errors, this made
  valid routes silently return `available: false`. `putCached` now inserts
  `${JSON.stringify(geometry)}::jsonb`.

## Verify

```bash
curl -s "https://droppeddev.duckdns.org/route/foot?fromLat=12.9716&fromLng=77.5946&toLat=12.9740&toLng=77.5970" \
  -H "X-Device-Id: <uuid-v4>"
```

Expect `available:true` with a LineString. A second identical call is served from
`route_cache` (no new upstream hit; `routing_usage` unchanged). Set both monthly
limits to `0` to confirm the `{ available:false }` fallback.
