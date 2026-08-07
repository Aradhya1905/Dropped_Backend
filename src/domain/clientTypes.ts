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
import type { EchoInterval } from './echo.js';
import type { RevealCondition } from './solar.js';

export type { EchoInterval };

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
 * An optional second condition on top of the 50 m rule. `night` opens between
 * sunset and sunrise *at the drop's coordinate*; `day` is the exact inverse.
 * Absent means no condition, which is the vast majority of drops.
 *
 * Re-exported from `domain/solar`, which owns the arithmetic behind it.
 */
export type { RevealCondition };
export { REVEAL_CONDITIONS } from './solar.js';

/** Max length of a reply. Deliberately short — one line, not a comment thread. */
export const MAX_REPLY_LENGTH = 140;

/** A reply as the API returns it. Authorship is never on the wire. */
export interface ApiReply {
  id: string;
  body: string;
  /** ms epoch. */
  createdAt: number;
  /** True when the requesting device wrote it (drives the delete affordance). */
  mine: boolean;
}

/**
 * What a sealed secret gives away from inside the whisper band (150–50 m): its
 * mood and the first word or two, never the body. Server-computed — see
 * `domain/teaser.ts`.
 */
export interface Whisper {
  mood: Mood;
  teaser: string;
}

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
  /** Visible replies pinned here. Reading them still requires standing here. */
  replyCount: number;
  sealed: boolean;
  saved: boolean;
  hearted: boolean;
  /** Present on nearby results: server-computed metres from the query point. */
  distanceMeters?: number;
  /**
   * ms epoch when this drop fades out of `nearby` and stops being revealable.
   * Absent = forever. Drives the client's "fades in N days" countdown.
   */
  expiresAt?: number;
  /**
   * Present only on a **sealed** nearby result inside the whisper band. Never
   * accompanies `body` — once you're close enough to read the secret there is
   * nothing left to whisper.
   */
  whisper?: Whisper;
  /**
   * Whether a share link may resolve to this drop. Drives whether the client
   * offers a share sheet at all — a link to an opted-out drop 404s, so
   * offering one would hand someone a dead link.
   */
  shareable: boolean;
  /**
   * The extra condition guarding this drop, if any. Sent on sealed rows too —
   * that is the point: the pin says *when* it opens without saying *what* it
   * says, so someone can plan the walk instead of arriving at the wrong hour.
   */
  revealCondition?: RevealCondition;
}

/**
 * What a shared link is allowed to reveal about a spot before anyone walks
 * there — `GET /drops/:id/preview`.
 *
 * Note what is NOT here: no `body`, no `sealed`, no per-device flags, and the
 * `coordinate` is the coarsened one (~100 m, see domain/coarsen), never the
 * stored point. A link is forwardable, so this shape is the whole of what a
 * stranger with the URL can learn.
 */
export interface DropPreview {
  id: string;
  coordinate: Coordinate;
  placeLabel?: string;
  city?: string;
  mood: Mood;
  /** ms epoch. */
  createdAt: number;
  revealCount: number;
  /** ms epoch when the drop fades. Absent = forever. */
  expiresAt?: number;
}

/**
 * How a device came to stand at a place a round interval ago:
 * - `dropped` — it left the secret there;
 * - `found`   — it walked there and revealed someone else's.
 *
 * Kept on the wire because the two deserve different words: "a year ago you
 * left something here" is not "a year ago you found something here".
 */
export type EchoKind = 'dropped' | 'found';

/**
 * One anniversary — `GET /drops/echoes`.
 *
 * `secret` is the ordinary secret shape, and obeys the ordinary rule: sealed
 * unless this device has revealed it (or wrote it). An echo is a reminder that
 * you were here, never a way to read something you haven't walked to.
 */
export interface Echo {
  secret: ApiSecret;
  interval: EchoInterval;
  kind: EchoKind;
  /** ms epoch of the drop / reveal being remembered. */
  stoodAt: number;
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
