/**
 * routing.service — the brain behind GET /route/foot.
 *
 * Flow: quantize the endpoints → return a fresh cache hit if one exists → else
 * try providers in order (ORS, then Mapbox), skipping any with no key or whose
 * monthly counter is at the cap → on success cache the result + bump the counter
 * → return it. If every provider is unavailable or fails, return
 * { available: false } so the client simply draws no path.
 *
 * This is GUIDANCE only: the 50 m reveal is enforced elsewhere with PostGIS
 * straight-line distance and never depends on this.
 */
import { env } from '../config/env.js';
import type { Coordinate } from '../domain/clientTypes.js';
import {
  routeRepo,
  type CachedRoute,
  type RouteKey,
  type RouteProvider,
} from '../repositories/route.repo.js';
import {
  fetchMapboxWalkingRoute,
  fetchOrsFootRoute,
  type UpstreamRoute,
} from './routing.http.js';

const PROFILE = 'foot';

/** Quantize a coordinate to integers (lat/lng ×1e4 ≈ 11 m) for cache/quota keys. */
const q = (n: number): number => Math.round(n * 1e4);

/** Current calendar month as `YYYY-MM` (server clock; quota windows are coarse). */
function currentYyyyMm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface ProviderEntry {
  name: RouteProvider;
  key: string;
  limit: number;
  call: (from: Coordinate, to: Coordinate) => Promise<UpstreamRoute>;
}

/** The result the controller serializes. */
export interface FootRouteResult {
  available: boolean;
  provider: RouteProvider | null;
  geometry: CachedRoute['geometry'] | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

const UNAVAILABLE: FootRouteResult = {
  available: false,
  provider: null,
  geometry: null,
  distanceMeters: null,
  durationSeconds: null,
};

const toResult = (r: CachedRoute): FootRouteResult => ({
  available: true,
  provider: r.provider,
  geometry: r.geometry,
  distanceMeters: r.distanceMeters,
  durationSeconds: r.durationSeconds,
});

export const routingService = {
  async footRoute(from: Coordinate, to: Coordinate): Promise<FootRouteResult> {
    const key: RouteKey = {
      fromLat: q(from.lat),
      fromLng: q(from.lng),
      toLat: q(to.lat),
      toLng: q(to.lng),
      profile: PROFILE,
    };

    const cached = await routeRepo.getCached(key, env.ROUTE_CACHE_TTL_DAYS);
    if (cached) {
      return toResult(cached);
    }

    const providers: ProviderEntry[] = [
      {
        name: 'ors',
        key: env.ORS_API_KEY,
        limit: env.ORS_MONTHLY_LIMIT,
        call: fetchOrsFootRoute,
      },
      {
        name: 'mapbox',
        key: env.MAPBOX_TOKEN,
        limit: env.MAPBOX_MONTHLY_LIMIT,
        call: fetchMapboxWalkingRoute,
      },
    ];

    const yyyymm = currentYyyyMm();

    for (const p of providers) {
      if (!p.key) continue; // provider not configured
      const used = await routeRepo.usageThisMonth(p.name, yyyymm);
      if (used >= p.limit) continue; // monthly cap reached

      try {
        const upstream = await p.call(from, to);
        const route: CachedRoute = { provider: p.name, ...upstream };
        // Count first (the call already consumed quota), then cache best-effort.
        await routeRepo.incrementUsage(p.name, yyyymm);
        await routeRepo.putCached(key, route);
        return toResult(route);
      } catch {
        // Try the next provider; total failure falls through to UNAVAILABLE.
      }
    }

    return UNAVAILABLE;
  },
};
