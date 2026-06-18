/**
 * Shared domain types for Dropped — COPY of the client's contract.
 *
 * Source of truth: C:\My_Projects\Dropped\src\types\index.ts
 * Keep in sync. The API's responses are SUPERSETS of these shapes (same field
 * names, casing, and ms-epoch `createdAt`), so the client's types still parse.
 *
 * The whole app is: a `Secret` is `Drop`ped at a `Coordinate`; another user
 * walks toward it; once within range its `RevealState` flips to `revealed`.
 */

/** A WGS-84 lat/lng point. */
export interface Coordinate {
  lat: number;
  lng: number;
}

/** Where a secret was pinned. */
export interface Drop {
  id: string;
  coordinate: Coordinate;
  /** Optional human label, e.g. "Blue Tokai, Indiranagar". */
  placeLabel?: string;
  /** ms epoch. */
  createdAt: number;
}

/** The anonymous confession itself, tied to one drop. */
export interface Secret {
  id: string;
  /** The text the author left. */
  body: string;
  drop: Drop;
  createdAt: number;
  /** How many people have revealed it (server-owned). */
  revealCount?: number;
}

/**
 * Per-viewer reveal state for a secret:
 * - `locked`  — too far, contents hidden
 * - `near`    — inside the "getting warmer" radius, still hidden
 * - `revealed`— within the 50 m unlock radius, contents shown
 */
export type RevealState = 'locked' | 'near' | 'revealed';

/** Default unlock radius in meters. */
export const REVEAL_RADIUS_M = 50;

// --- Server additive fields (supersets of the client types) -----------------

/** Mood/emotion tag carried by a drop. Mirrors the client composer's options. */
export type Mood = 'joy' | 'ache' | 'trouble' | 'wonder';
export const MOODS: readonly Mood[] = ['joy', 'ache', 'trouble', 'wonder'];

/** Max length of a secret body (the composer caps at ~280). */
export const MAX_BODY_LENGTH = 280;

/**
 * A secret as the API returns it. Superset of the client `Secret`:
 * - `mood`, `hearts`, `stoodHere` are server-owned counters/metadata.
 * - `sealed` is true when the body is withheld (nearby query, pre-reveal).
 * - `saved` / `hearted` reflect the requesting device's relationship to it.
 * When `sealed` is true, `body` is omitted.
 */
export interface ApiSecret extends Omit<Secret, 'body'> {
  body?: string;
  mood: Mood;
  hearts: number;
  stoodHere: number;
  sealed: boolean;
  saved: boolean;
  hearted: boolean;
  /** Present on nearby results: server-computed metres from the query point. */
  distanceMeters?: number;
}

/**
 * Per-device aggregate stats for the Trail "receipt" header. All server-owned;
 * `streakDays` counts consecutive days with a reveal OR a drop ending
 * today/yesterday. (Steps are a separate endpoint — see `DeviceSteps`.)
 */
export interface DeviceStats {
  droppedTotal: number;
  droppedThisMonth: number;
  foundTotal: number;
  foundThisMonth: number;
  citiesVisited: number;
  streakDays: number;
}

/**
 * The single steps number for the Trail receipt (`GET /devices/me/steps`).
 * Counted on-device and synced as day-tagged deltas; the server aggregates by a
 * configurable scope (day / month / lifetime), so the client just renders it.
 */
export interface DeviceSteps {
  steps: number;
}
