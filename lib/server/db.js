// Data-access module. All SQL lives here; route handlers never build queries.
// Talks to Supabase Postgres over its connection pooler (DATABASE_URL).
import 'server-only';
import postgres from 'postgres';
import { customAlphabet } from 'nanoid';
import { HttpError } from './http';

// No 0/O, 1/I/L: codes are read aloud and typed on phones.
const generateCode = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 8);

const createClient = () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    // Supabase's transaction pooler (port 6543) doesn't support prepared statements.
    prepare: false,
    ssl: local ? false : 'require',
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
    // bigint identity columns: return numbers (ids stay far below 2^53).
    types: {
      bigint: { to: 20, from: [20], serialize: (value) => String(value), parse: (value) => Number(value) },
    },
  });
};

// One client per server instance, created on first use (so `next build` needs no
// DATABASE_URL) and reused across hot reloads in dev.
const db = () => (globalThis.__fleetSql ??= createClient());

const USER_COLUMNS = `u.id, u.enrollment_code, u.username, u.display_name, u.role, u.active, u.on_duty,
  u.consent_policy_version, u.consent_at, u.created_at`;

// ---------- users ----------

export const findUserById = async (id) => {
  const [user] = await db().unsafe(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  return user;
};

export const findLoginRecordByUsername = async (username) =>
  (await db()`SELECT id, password_hash, active, role FROM users WHERE lower(username) = lower(${username})`)[0];

export const findLoginRecordByCode = async (code) =>
  (await db()`SELECT id, password_hash, active, role FROM users WHERE enrollment_code = ${code}`)[0];

/** Creates a user with a collision-checked, DB-unique enrollment code. */
export const createUser = async ({ username, passwordHash, displayName, role }) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [{ id }] = await db()`
        INSERT INTO users (enrollment_code, username, password_hash, display_name, role)
        VALUES (${generateCode()}, ${username}, ${passwordHash}, ${displayName}, ${role})
        RETURNING id`;
      return findUserById(id);
    } catch (error) {
      if (error.code !== '23505') throw error;
      if (error.constraint_name === 'users_username_lower_key') throw new HttpError(409, 'Username already exists');
      // Enrollment-code collision: draw a new one.
    }
  }
  throw new Error('Could not generate a unique enrollment code');
};

export const listWorkersWithStatus = async () => {
  const rows = await db().unsafe(`
    SELECT ${USER_COLUMNS},
      p.lat AS last_lat, p.lng AS last_lng, p.accuracy AS last_accuracy,
      p.battery AS last_battery, p.recorded_at AS last_seen
    FROM users u
    LEFT JOIN LATERAL (
      SELECT lat, lng, accuracy, battery, recorded_at FROM location_pings
      WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1
    ) p ON true
    WHERE u.role = 'worker'
    ORDER BY lower(u.display_name)`);
  return rows.map(({ last_lat, last_lng, last_accuracy, last_battery, last_seen, ...user }) => ({
    ...user,
    last_seen,
    last_location:
      last_lat === null ? null : { lat: last_lat, lng: last_lng, accuracy: last_accuracy, battery: last_battery },
  }));
};

export const getPasswordHash = async (id) => (await db()`SELECT password_hash FROM users WHERE id = ${id}`)[0]?.password_hash;

export const updatePassword = (id, passwordHash) => db()`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;

export const updateDisplayName = (id, displayName) => db()`UPDATE users SET display_name = ${displayName} WHERE id = ${id}`;

export const setActive = (id, active) =>
  db().begin(async (tx) => {
    await tx`UPDATE users SET active = ${active} WHERE id = ${id}`;
    if (!active) await endDuty(tx, id);
  });

export const recordConsent = (id, policyVersion) =>
  db()`UPDATE users SET consent_policy_version = ${policyVersion}, consent_at = now() WHERE id = ${id}`;

// ---------- duty ----------

const endDuty = async (tx, userId) => {
  await tx`UPDATE duty_sessions SET ended_at = now() WHERE user_id = ${userId} AND ended_at IS NULL`;
  await tx`UPDATE users SET on_duty = false WHERE id = ${userId}`;
};

export const setDuty = (userId, onDuty) =>
  db().begin(async (tx) => {
    // Row lock serialises concurrent toggles from the same worker.
    const [current] = await tx`SELECT on_duty FROM users WHERE id = ${userId} FOR UPDATE`;
    if (onDuty && !current.on_duty) {
      await tx`INSERT INTO duty_sessions (user_id) VALUES (${userId})`;
      await tx`UPDATE users SET on_duty = true WHERE id = ${userId}`;
    } else if (!onDuty && current.on_duty) {
      await endDuty(tx, userId);
    }
  });

export const getOpenSession = async (userId) =>
  (await db()`SELECT id, started_at FROM duty_sessions WHERE user_id = ${userId} AND ended_at IS NULL`)[0];

export const listSessions = (userId, limit) =>
  db()`SELECT id, started_at, ended_at FROM duty_sessions WHERE user_id = ${userId} ORDER BY started_at DESC LIMIT ${limit}`;

// ---------- ingest ----------

export const insertPings = async (userId, pings) => {
  const rows = pings.map((p) => ({
    user_id: userId,
    lat: p.lat,
    lng: p.lng,
    accuracy: p.accuracy ?? null,
    battery: p.battery ?? null,
    recorded_at: p.recorded_at,
  }));
  await db()`INSERT INTO location_pings ${db()(rows, 'user_id', 'lat', 'lng', 'accuracy', 'battery', 'recorded_at')}`;
  return rows.length;
};

/** Indexes of the given ISO instants that fall inside one of the user's duty sessions (± skew). */
export const indexesWithinDuty = async (userId, isoTimes, skewSeconds) => {
  const rows = await db()`
    SELECT (u.i - 1)::int AS i
    FROM unnest(${isoTimes}::timestamptz[]) WITH ORDINALITY AS u(t, i)
    WHERE EXISTS (
      SELECT 1 FROM duty_sessions s
      WHERE s.user_id = ${userId}
        AND s.started_at <= u.t + make_interval(secs => ${skewSeconds})
        AND (s.ended_at IS NULL OR s.ended_at >= u.t - make_interval(secs => ${skewSeconds}))
    )`;
  return new Set(rows.map((r) => r.i));
};

/** Idempotent on (user_id, client_id) so the phone can safely re-sync. */
export const insertCalls = async (userId, calls) => {
  const rows = calls.map((c) => ({
    user_id: userId,
    client_id: c.client_id,
    direction: c.direction,
    contact_name: c.contact_name ?? null,
    contact_number: c.contact_number,
    started_at: c.started_at,
    duration_sec: c.duration_sec,
  }));
  const inserted = await db()`
    INSERT INTO call_events ${db()(rows, 'user_id', 'client_id', 'direction', 'contact_name', 'contact_number', 'started_at', 'duration_sec')}
    ON CONFLICT (user_id, client_id) DO NOTHING
    RETURNING id`;
  return inserted.length;
};

// ---------- admin reads ----------

export const listLocations = (userId, { limit, since }) =>
  db()`
    SELECT id, lat, lng, accuracy, battery, recorded_at, received_at FROM location_pings
    WHERE user_id = ${userId} AND recorded_at >= ${since ?? '-infinity'}::timestamptz
    ORDER BY recorded_at DESC LIMIT ${limit}`;

export const listCalls = (userId, limit) =>
  db()`
    SELECT id, direction, contact_name, contact_number, started_at, duration_sec, received_at
    FROM call_events WHERE user_id = ${userId} ORDER BY started_at DESC LIMIT ${limit}`;

export const getMetrics = async (dayStartIso) =>
  (
    await db()`
      SELECT
        (SELECT count(*) FROM users WHERE role = 'worker' AND active)::int AS active_workers,
        (SELECT count(*) FROM users WHERE role = 'worker' AND on_duty)::int AS on_duty,
        (SELECT count(*) FROM location_pings WHERE recorded_at >= ${dayStartIso})::int AS pings_today,
        (SELECT count(*) FROM call_events WHERE started_at >= ${dayStartIso})::int AS calls_today,
        (SELECT count(*) FROM call_events WHERE started_at >= ${dayStartIso} AND direction = 'missed')::int AS missed_today,
        (SELECT coalesce(sum(duration_sec), 0) FROM call_events WHERE started_at >= ${dayStartIso})::int AS call_seconds_today`
  )[0];

// ---------- rate limiting ----------

/** Fixed-window counter shared by every serverless instance. Returns the hit count in the current window. */
export const hitRateLimit = async (key, windowSeconds) =>
  (
    await db()`
      INSERT INTO rate_limits AS r (key, window_start, count) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN r.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE r.window_start END
      RETURNING count, window_start`
  )[0];
