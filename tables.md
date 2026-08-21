# Database — Tables & Connection Guide

## What kind of database is this?

This backend uses **PostgreSQL** (with the **PostGIS** extension for geo queries),
hosted on **Neon** (a cloud Postgres provider). The ORM is **Drizzle**, with the
`postgres.js` driver.

> ⚠️ **SSMS will NOT work.** SQL Server Management Studio only connects to Microsoft
> SQL Server. This is PostgreSQL — a different engine. Use a Postgres client instead
> (see [Connecting](#connecting-to-the-database) below).

The app reads a single `DATABASE_URL` from `.env`, so switching hosts is a one-line change.

---

## Connecting to the database

### Connection details (from `.env`)

| Field    | Value |
|----------|-------|
| Host     | `ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech` |
| Port     | `5432` (default) |
| Database | `neondb` |
| User     | `neondb_owner` |
| Password | `npg_faF6lqUixZr8` |
| SSL      | **Required** (`sslmode=require`) |

Full connection string:

```
postgresql://neondb_owner:npg_faF6lqUixZr8@ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

### Recommended clients (instead of SSMS)

1. **DBeaver** (free, recommended) — https://dbeaver.io
   - New Connection → **PostgreSQL**
   - Fill in Host / Port / Database / User / Password from the table above
   - In **SSL** tab: enable SSL (mode = `require`)
   - Connect, then expand `neondb` → `Schemas` → `public` → `Tables`

2. **pgAdmin** (official Postgres GUI) — https://www.pgadmin.org
   - Register → Server → enter the same connection details, SSL mode = Require

3. **Neon web console** (no install) — https://console.neon.tech
   - Open your project → **Tables** to browse data, or **SQL Editor** to run queries

4. **psql** (command line), if installed:
   ```bash
   psql "postgresql://neondb_owner:npg_faF6lqUixZr8@ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
   ```

---

## Migrations — READ BEFORE ADDING ONE

`yarn db:migrate` (`src/db/migrate.ts`) runs the hand-authored `.sql` files in
`drizzle/` in filename order, and records each **filename** in a `_migrations`
table so it is only applied once. It keys off the filename and nothing else.

**The live database is ahead of this branch.** The abandoned FUN_TODOs work
applied six further migrations to Neon on 2026-08-07 and they are permanently
recorded in `_migrations`, even though the files do not exist on `main`:

| Recorded in `_migrations` | Added to the live DB |
|---|---|
| `0004_replies.sql` | `replies` table; `drops.reply_count`; `reports.reply_id`; `reports.drop_id` made nullable + `reports_target_chk` |
| `0005_drop_expiry.sql` | `drops.expires_at` + partial index |
| `0006_drop_shareable.sql` | `drops.shareable` (NOT NULL DEFAULT true) |
| `0007_echo_indexes.sql` | `reveals_device_created_idx`, `drops_device_created_idx` |
| `0008_reveal_condition.sql` | `drops.reveal_condition` + CHECK |
| `0009_device_erasure.sql` | `__deleted__` sentinel device row; `replies_drop_device_uniq` made partial; `reports_device_idx` |

All of it is additive and **unused by `main`** — every column is either nullable
or defaulted, no query on this branch names any of them, and no row exercises
them. `main` deploys against this schema unchanged; `db:migrate` is a no-op.
The tables and columns below therefore document `main`'s view, not the full
live schema.

> ⚠️ **Number the next migration `0010` or higher.** A new file named
> `0004_*.sql` (or any of `0005`–`0009`) matches a name already in
> `_migrations`, so the migrator prints `• skip … (already applied)` and
> **silently never runs it** — a schema change that looks like it succeeded and
> did nothing.

To undo any of the six, the down path is written in the header comment of the
corresponding file on the `feature/funToDos` branch. Deleting the `_migrations`
rows is part of that; leaving them is what makes the numbering rule above.

---

## Tables

There are **7 tables**, all in the `public` schema.

### `devices`
Anonymous identity. One row per device. `id` is the `X-Device-Id` UUID the client generates.

| Column      | Type                       | Notes |
|-------------|----------------------------|-------|
| id          | text                       | **PK**. The client-generated device UUID |
| created_at  | timestamptz                | NOT NULL, defaults to `now()` |

### `drops`
The core content — a "drop" left at a geographic location.

| Column        | Type                     | Notes |
|---------------|--------------------------|-------|
| id            | uuid                     | **PK**, defaults to random UUID |
| device_id     | text                     | NOT NULL, **FK → devices.id** |
| body          | text                     | NOT NULL. The message text |
| mood          | text                     | NOT NULL |
| place_label   | text                     | Nullable. Human-readable place name |
| city          | text                     | Nullable |
| geog          | geography(Point, 4326)   | NOT NULL. PostGIS point; read/written via raw SQL |
| status        | text                     | NOT NULL, default `'visible'`. One of `visible` / `hidden` / `pending` |
| reveal_count  | integer                  | NOT NULL, default `0` |
| stood_here    | integer                  | NOT NULL, default `0` |
| heart_count   | integer                  | NOT NULL, default `0` |
| created_at    | timestamptz              | NOT NULL, default `now()` |

Indexes: `drops_geog_gix` (GiST on `geog`, for nearby/`ST_DWithin`), `drops_device_idx` (device_id), `drops_status_idx` (status).

### `reveals`
One row per (drop, device) reveal. Drives `reveal_count` and the "Found" trail.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `saves`
Saves / bookmarks, keyed by device. Drives the "Saved" trail and the `saved` flag.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `hearts`
Hearts ("I feel this"), keyed by device. Drives `heart_count` and the `hearted` flag.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `device_steps`
Per-device, per-day step counts. Backs the Trail "steps" stat. Updated via raw SQL upsert.

| Column     | Type        | Notes |
|------------|-------------|-------|
| device_id  | text        | NOT NULL, **FK → devices.id** |
| day        | date        | NOT NULL |
| steps      | integer     | NOT NULL, default `0` |
| updated_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`device_id`, `day`).

### `reports`
Moderation reports. Once N reports accumulate (`REPORT_HIDE_THRESHOLD`, default 3),
the reported drop flips to `pending` (shadow-removed).

| Column     | Type        | Notes |
|------------|-------------|-------|
| id         | uuid        | **PK**, defaults to random UUID |
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| reason     | text        | NOT NULL |
| created_at | timestamptz | NOT NULL, default `now()` |

Index: `reports_drop_idx` (drop_id).

---

## Relationships at a glance

```
devices ──< drops ──< reveals
   │          │   └──< saves
   │          │   └──< hearts
   │          │   └──< reports
   │          └──(referenced by all above)
   └──< device_steps
   └──(device_id referenced by drops, reveals, saves, hearts, reports, device_steps)
```

All child tables of `drops` (reveals, saves, hearts, reports) cascade-delete when a
drop is deleted. `device_id` foreign keys do **not** cascade.

---

## Quick query to list tables yourself

Once connected with any Postgres client:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Source of truth for the schema: [src/db/schema.ts](src/db/schema.ts) and the migration [drizzle/0000_init.sql](drizzle/0000_init.sql).
