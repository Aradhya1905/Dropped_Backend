/**
 * routing.http — thin wrappers over the two upstream walking-route providers.
 *
 * Each takes the origin/destination and returns a normalized
 * { geometry, distanceMeters, durationSeconds } (GeoJSON LineString, [lng,lat]),
 * or throws on a non-2xx / malformed response. Keys come from env; the calling
 * service decides ordering, quota, and caching. Built-in fetch — no dependency.
 */
import { env } from '../config/env.js';
import type { Coordinate } from '../domain/clientTypes.js';
import type { RouteGeometry } from '../repositories/route.repo.js';

/** Normalized upstream result (provider-agnostic). */
export interface UpstreamRoute {
  geometry: RouteGeometry;
  distanceMeters: number;
  durationSeconds: number;
}

/** Upstream request timeout — keep the endpoint snappy; we fall back on failure. */
const TIMEOUT_MS = 6_000;

function isLineString(g: unknown): g is RouteGeometry {
  return (
    typeof g === 'object' &&
    g !== null &&
    (g as { type?: unknown }).type === 'LineString' &&
    Array.isArray((g as { coordinates?: unknown }).coordinates)
  );
}

/**
 * OpenRouteService foot-walking, GeoJSON output.
 * POST /v2/directions/foot-walking/geojson with the API key in Authorization.
 */
export async function fetchOrsFootRoute(
  from: Coordinate,
  to: Coordinate,
): Promise<UpstreamRoute> {
  const res = await fetch(
    'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
    {
      method: 'POST',
      headers: {
        Authorization: env.ORS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new Error(`ORS ${res.status}`);
  }
  const data = (await res.json()) as {
    features?: {
      geometry?: unknown;
      properties?: { summary?: { distance?: number; duration?: number } };
    }[];
  };
  const feature = data.features?.[0];
  const summary = feature?.properties?.summary;
  if (!feature || !isLineString(feature.geometry) || !summary) {
    throw new Error('ORS malformed response');
  }
  return {
    geometry: feature.geometry,
    distanceMeters: Math.round(summary.distance ?? 0),
    durationSeconds: Math.round(summary.duration ?? 0),
  };
}

/**
 * Mapbox Directions, walking profile, full GeoJSON geometry.
 * GET /directions/v5/mapbox/walking/{coords}?geometries=geojson&overview=full
 */
export async function fetchMapboxWalkingRoute(
  from: Coordinate,
  to: Coordinate,
): Promise<UpstreamRoute> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&access_token=${encodeURIComponent(env.MAPBOX_TOKEN)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Mapbox ${res.status}`);
  }
  const data = (await res.json()) as {
    routes?: { geometry?: unknown; distance?: number; duration?: number }[];
  };
  const route = data.routes?.[0];
  if (!route || !isLineString(route.geometry)) {
    throw new Error('Mapbox malformed response');
  }
  return {
    geometry: route.geometry,
    distanceMeters: Math.round(route.distance ?? 0),
    durationSeconds: Math.round(route.duration ?? 0),
  };
}
