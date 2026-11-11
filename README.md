# Workforce Tracker: admin panel + API

One Next.js app, deployed on Vercel, that serves:

- **`/`**: the admin panel: live map of on-duty workers, shift history, call records, and adding or deactivating workers.
- **`/api/...`**: the JSON API used by the admin panel and the Android app (login, duty on/off, location and call-log ingest, admin reads).

Data lives in **Supabase Postgres**. The companion Android app talks to this same deployment over HTTPS.

Location and call records are collected **only while a worker is On Duty**. The server enforces this rule as well as the app.

## Setup

### 1. Supabase

1. Create a project. Pick the **Mumbai (ap-south-1)** region to keep data in India.
2. Open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql), and run it. It's safe to re-run. It:
   - creates the tables and indexes;
   - locks the tables against Supabase's public REST and GraphQL APIs (RLS on, no policies);
   - schedules the hourly retention purge (pg_cron);
   - creates the first admin: **`admin` / `CHANGE-ME-NOW`**. Change the password in the file before running it, or right after your first sign-in.
3. Go to **Connect → Transaction pooler** and copy the URI (port 6543). That is `DATABASE_URL`.

### 2. Vercel

1. Import this repository. The framework is Next.js.
2. Add these environment variables (see [`.env.example`](.env.example)):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Supabase transaction-pooler URI |
   | `JWT_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `TOKEN_TTL` | optional, default `7d` |
   | `POLICY_VERSION` | optional; bump it when the monitoring policy changes, so workers must re-acknowledge it |

3. Deploy. `https://<app>.vercel.app/api/health` should return `{"ok":true}`.

`DATABASE_URL` and `JWT_SECRET` are server-only. Never put them in the Android app or in client code.

### 3. Android app

Set `fleetApiUrl=https://<app>.vercel.app` in the Android project's `gradle.properties`, then build the release APK.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and JWT_SECRET
npm run dev                  # http://localhost:3000
```

## Tests

The integration tests start the built app and run every API route against a real Postgres. **The target database is wiped**, so use a throwaway one; the suite refuses Supabase URLs.

```bash
npm run build
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/fleet_test npm test
```

## Layout

```
app/page.js            admin UI (client component)
app/api/**/route.js    API route handlers
components/            dashboard UI
lib/api.js             browser API client
lib/server/            server-only: db.js (all SQL), auth.js, http.js, config.js
supabase/schema.sql    database schema
test/                  integration tests
```
