/**
 * route.repo — the only place that touches the route_cache / routing_usage SQL.
 *
 * route_cache stores GeoJSON LineString geometries keyed by quantized endpoints
 * (lat/lng ×1e4) + profile; getCached enforces the TTL in the query. routing_usage
 * is a per-(provider, YYYY-MM) counter the service checks before each upstream call.
 */
import { sqlClient } from '../db/client.js';

export type RouteProvider = 'ors' | 'mapbox';

/** A GeoJSON LineString as the providers return it ([lng, lat] pairs). */
export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Quantized cache key (integers, lat/lng ×1e4). */
export interface RouteKey {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  profile: string;
}

/** A normalized route, the unit stored and returned. */
export interface CachedRoute {
  provider: RouteProvider;
  geometry: RouteGeometry;
  distanceMeters: number;
  durationSeconds: number;
}

export const routeRepo = {
  /** Freshest cached route for this key that is younger than ttlDays, or null. */
  async getCached(key: RouteKey, ttlDays: number): Promise<CachedRoute | null> {
    const rows = await sqlClient<
      {
        provider: RouteProvider;
        geometry: RouteGeometry;
        distanceMeters: number;
        durationSeconds: number;
      }[]
    >`
      SELECT
        provider,
        geometry,
        distance_meters  AS "distanceMeters",
        duration_seconds AS "durationSeconds"
      FROM route_cache
      WHERE from_lat = ${key.fromLat}
        AND from_lng = ${key.fromLng}
        AND to_lat   = ${key.toLat}
        AND to_lng   = ${key.toLng}
        AND profile  = ${key.profile}
        AND created_at > now() - (${ttlDays} * interval '1 day')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  },

  /** Insert a freshly fetched route into the cache. */
  async putCached(key: RouteKey, route: CachedRoute): Promise<void> {
    await sqlClient`
      INSERT INTO route_cache (
        from_lat, from_lng, to_lat, to_lng, profile,
        provider, geometry, distance_meters, duration_seconds
      ) VALUES (
        ${key.fromLat}, ${key.fromLng}, ${key.toLat}, ${key.toLng}, ${key.profile},
        ${route.provider}, ${JSON.stringify(route.geometry)}::jsonb,
        ${route.distanceMeters}, ${route.durationSeconds}
      )
    `;
  },

  /** Upstream calls this provider has made in the given YYYY-MM (0 if none). */
  async usageThisMonth(provider: RouteProvider, yyyymm: string): Promise<number> {
    const rows = await sqlClient<{ count: number }[]>`
      SELECT count FROM routing_usage
      WHERE provider = ${provider} AND yyyymm = ${yyyymm}
      LIMIT 1
    `;
    return rows[0]?.count ?? 0;
  },

  /** Increment this provider's monthly counter (upsert). */
  async incrementUsage(provider: RouteProvider, yyyymm: string): Promise<void> {
    await sqlClient`
      INSERT INTO routing_usage (provider, yyyymm, count)
      VALUES (${provider}, ${yyyymm}, 1)
      ON CONFLICT (provider, yyyymm)
      DO UPDATE SET count = routing_usage.count + 1, updated_at = now()
    `;
  },
};
