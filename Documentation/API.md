# Dropped — API Reference (for the frontend)

Base URL (local): `http://localhost:3000`
Interactive docs (test in browser): `http://localhost:3000/docs`
Machine-readable spec: [`openapi.json`](./openapi.json) — import into codegen / Postman / Orval.

---

## Conventions (apply to every request)

- **Auth header — required on every route except `GET /health`:**
  `X-Device-Id: <uuid v4>` (e.g. `f47ac10b-58cc-4372-a567-0e02b2c3d479`).
  This *is* the identity — no accounts. The device is registered lazily on first
  request. A missing/invalid id → `401 { message: "Missing or invalid X-Device-Id header" }`.
- **Content type:** `application/json` for all bodies.
- **Timestamps:** `createdAt` is a **ms-epoch number**.
- **Coordinates:** `{ lat, lng }` in WGS-84. `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`.
- **Errors:** always `{ message: string }`. Some carry extra fields (e.g. reveal
  failures add `distanceMeters`).

---

## Shared types (paste into the frontend)

```ts
export type Mood = 'joy' | 'ache' | 'trouble' | 'wonder';

export interface Coordinate {
  lat: number; // -90..90
  lng: number; // -180..180
}

export interface ApiDrop {
  id: string;
  coordinate: Coordinate;
  placeLabel?: string;
  createdAt: number; // ms epoch
}

/** The core object returned by drops/nearby/reveal/trail endpoints. */
export interface ApiSecret {
  id: string;
  body?: string;            // omitted when sealed === true
  drop: ApiDrop;
  createdAt: number;        // ms epoch
  revealCount?: number;
  mood: Mood;
  hearts: number;
  stoodHere: number;
  sealed: boolean;          // true => body withheld (you haven't revealed it)
  saved: boolean;           // this device's relationship
  hearted: boolean;
  distanceMeters?: number;  // present on nearby + reveal responses
}

export interface ApiError {
  message: string;
  distanceMeters?: number;  // on a failed reveal (403)
}
```

---

## Endpoints

### `GET /health`  · *public, no header*
Liveness + DB ping.
- **200** → `{ "ok": true }`

---

### `GET /devices/me`
This device's summary and remaining daily drop quota.
- **200** →
  ```ts
  { deviceId: string; createdAt: number; dropsQuotaRemaining: number }
  ```

---

### `POST /drops`
Create a drop (screened by moderation on ingest).

**Request body:**
```ts
{
  body: string;          // 1..280 chars
  mood: Mood;            // 'joy' | 'ache' | 'trouble' | 'wonder'
  coordinate: Coordinate;
  placeLabel?: string;   // max 120 chars
}
```
- **201** → `ApiSecret` (unsealed — it's the author's own; `sealed: false`, `body` present)
- **422** → `{ message }` — content hard-blocked by moderation
- **429** → `{ message }` — daily quota exhausted (default 5/day)

---

### `GET /drops/nearby`
Visible drops near a point, nearest first. Each is **sealed** (`sealed: true`,
no `body`) unless this device already revealed it.

**Query params:**
| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `lat` | number | ✅ | -90..90 |
| `lng` | number | ✅ | -180..180 |
| `radiusMeters` | number | ❌ | > 0; default 500, capped at 2000 |

- **200** → `{ secrets: ApiSecret[] }` (each has `distanceMeters`)

---

### `POST /drops/{id}/reveal`
Server-verified 50 m reveal. The coordinate is a **one-shot** position — used once
for the distance check, never stored.

**Path param:** `id` (uuid)
**Request body:**
```ts
{ coordinate: Coordinate }
```
- **200** → `ApiSecret` (unsealed; `body` present, counters bumped)
- **403** → `{ message: "Too far to reveal", distanceMeters: number }`
- **404** → `{ message }` — drop missing or not visible

---

### `POST /drops/{id}/save` · `DELETE /drops/{id}/save`
Bookmark / un-bookmark. **Path param:** `id` (uuid)
- **200** → `{ saved: boolean }`

---

### `POST /drops/{id}/heart` · `DELETE /drops/{id}/heart`
Heart / un-heart. **Path param:** `id` (uuid)
- **200** → `{ hearted: boolean; hearts: number }`

---

### `POST /drops/{id}/report`
Report a drop. Past the hide threshold (default 3 distinct reporters) the drop is
shadow-removed. **Path param:** `id` (uuid)

**Request body:**
```ts
{ reason: string } // 1..280 chars
```
- **200** → `{ reported: true }`

---

### `GET /drops/trail/found` · `/saved` · `/dropped`
Per-device scrapbook. Entries are **unsealed** (earned or owned).
- `found` = revealed by this device · `saved` = bookmarked · `dropped` = authored.

**Query params:**
| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer | ❌ | 1..100, default 50 |
| `offset` | integer | ❌ | ≥ 0, default 0 |

- **200** → `{ secrets: ApiSecret[]; total: number }`

---

## Quick reference

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ ok: true }` |
| GET | `/devices/me` | — | device summary |
| POST | `/drops` | create body | `201 ApiSecret` |
| GET | `/drops/nearby` | — (query) | `{ secrets }` |
| POST | `/drops/{id}/reveal` | `{ coordinate }` | `ApiSecret` |
| POST/DELETE | `/drops/{id}/save` | — | `{ saved }` |
| POST/DELETE | `/drops/{id}/heart` | — | `{ hearted, hearts }` |
| POST | `/drops/{id}/report` | `{ reason }` | `{ reported: true }` |
| GET | `/drops/trail/{found\|saved\|dropped}` | — (query) | `{ secrets, total }` |

> **Tip for the frontend:** point an OpenAPI codegen tool (e.g. `openapi-typescript`,
> `orval`, or `@hey-api/openapi-ts`) at [`openapi.json`](./openapi.json) to generate
> a fully-typed client automatically, instead of hand-writing these types.
