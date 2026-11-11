// Integration tests: run the built Next.js server against a real Postgres
// database and exercise every API route over HTTP.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postgres npm test
//
// WARNING: the target database is wiped (all fleet tables truncated). Never
// point TEST_DATABASE_URL at your Supabase project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable Postgres database');
if (/supabase\.(co|com)/.test(DATABASE_URL)) throw new Error('Refusing to wipe a Supabase database in tests');

const PORT = 3123;
const base = `http://127.0.0.1:${PORT}`;
const schemaPath = fileURLToPath(new URL('../supabase/schema.sql', import.meta.url));
const sql = postgres(DATABASE_URL, { prepare: false, onnotice: () => {} });
let server;

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const state = {};

before(async () => {
  await sql.unsafe('DROP TABLE IF EXISTS call_events, location_pings, duty_sessions, rate_limits, users CASCADE');
  await sql.unsafe(readFileSync(schemaPath, 'utf8'));

  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL,
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      POLICY_VERSION: 'test-v1',
      BCRYPT_COST: '4',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Next.js server did not start (did you run `npm run build`?)');
});

after(async () => {
  server?.kill();
  await sql.end();
});

test('admin seeded by schema.sql logs in and creates a worker with a unique code', async () => {
  const login = await call('POST', '/auth/login', { body: { username: 'ADMIN', password: 'CHANGE-ME-NOW' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, 'admin');
  state.admin = login.body.token;

  const created = await call('POST', '/admin/users', {
    token: state.admin,
    body: { username: 'ravi', password: 'worker-pass', display_name: 'Ravi K' },
  });
  assert.equal(created.status, 201);
  assert.match(created.body.enrollment_code, /^[2-9A-HJKMNP-Z]{8}$/);
  state.code = created.body.enrollment_code;
  state.workerId = created.body.user.id;
  assert.equal(typeof state.workerId, 'number');

  const second = await call('POST', '/admin/users', {
    token: state.admin,
    body: { username: 'priya', password: 'worker-pass', display_name: 'Priya' },
  });
  assert.notEqual(second.body.enrollment_code, state.code);

  const dup = await call('POST', '/admin/users', {
    token: state.admin,
    body: { username: 'RAVI', password: 'worker-pass', display_name: 'dup' },
  });
  assert.equal(dup.status, 409);

  const invalid = await call('POST', '/admin/users', { token: state.admin, body: { username: 'x' } });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.issues.length > 0);
});

test('worker logs in with code + password; wrong password rejected', async () => {
  const bad = await call('POST', '/auth/login', { body: { code: state.code, password: 'nope' } });
  assert.equal(bad.status, 401);
  const login = await call('POST', '/auth/login', { body: { code: state.code.toLowerCase(), password: 'worker-pass' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, 'worker');
  state.worker = login.body.token;
});

test('auth: missing/garbage tokens rejected; worker cannot reach admin endpoints', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'garbage' })).status, 401);
  assert.equal((await call('GET', '/admin/users', { token: state.worker })).status, 403);
  assert.equal((await call('POST', '/me/duty', { token: state.admin, body: { on_duty: true } })).status, 403);
});

test('going on duty requires policy acknowledgement', async () => {
  const blocked = await call('POST', '/me/duty', { token: state.worker, body: { on_duty: true } });
  assert.equal(blocked.status, 409);
  const stale = await call('POST', '/me/consent', { token: state.worker, body: { policy_version: 'old' } });
  assert.equal(stale.status, 409);
  const ok = await call('POST', '/me/consent', { token: state.worker, body: { policy_version: 'test-v1' } });
  assert.equal(ok.body.policy.acknowledged, true);
});

test('location is rejected off duty and accepted on duty', async () => {
  const ping = () => ({ lat: 12.97, lng: 77.59, accuracy: 120, battery: 80, recorded_at: Date.now() });
  const off = await call('POST', '/ingest/location', { token: state.worker, body: { pings: [ping()] } });
  assert.equal(off.status, 409);

  const on = await call('POST', '/me/duty', { token: state.worker, body: { on_duty: true } });
  assert.equal(on.body.user.on_duty, true);
  assert.ok(on.body.duty_session.started_at);

  const stale = { ...ping(), recorded_at: Date.now() - 3600_000 };
  const accepted = await call('POST', '/ingest/location', { token: state.worker, body: { pings: [ping(), stale] } });
  assert.deepEqual(accepted.body, { accepted: 1, dropped: 1 });

  const invalid = await call('POST', '/ingest/location', { token: state.worker, body: { pings: [{ lat: 200, lng: 0, recorded_at: 1 }] } });
  assert.equal(invalid.status, 400);

  await call('POST', '/me/duty', { token: state.worker, body: { on_duty: false } });
  const afterOff = await call('POST', '/ingest/location', { token: state.worker, body: { pings: [ping()] } });
  assert.equal(afterOff.status, 409);
});

test('call-log entries: only on-duty calls kept, idempotent, syncable after going off duty', async () => {
  await call('POST', '/me/duty', { token: state.worker, body: { on_duty: true } });
  const onDutyCall = {
    client_id: 'log-101',
    direction: 'outgoing',
    contact_name: 'Customer',
    contact_number: '+91 98765 43210',
    started_at: new Date().toISOString(),
    duration_sec: 42,
  };
  // e.g. left on a shared phone by a previous user, days before this worker's shift
  const oldCall = { ...onDutyCall, client_id: 'log-7', direction: 'incoming', started_at: Date.now() - 2 * 86400_000 };
  const first = await call('POST', '/ingest/calls', { token: state.worker, body: { calls: [onDutyCall, oldCall] } });
  assert.deepEqual(first.body, { accepted: 1, dropped: 1, inserted: 1 });

  await call('POST', '/me/duty', { token: state.worker, body: { on_duty: false } });
  const retry = await call('POST', '/ingest/calls', { token: state.worker, body: { calls: [onDutyCall] } });
  assert.deepEqual(retry.body, { accepted: 1, dropped: 0, inserted: 0 });

  const withheld = { ...onDutyCall, client_id: 'log-102', direction: 'missed', contact_number: '', duration_sec: 0 };
  const bad = await call('POST', '/ingest/calls', { token: state.worker, body: { calls: [{ ...withheld, direction: 'voicemail' }] } });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/ingest/calls', { token: state.worker, body: { calls: [withheld] } });
  assert.equal(ok.body.inserted, 1);
});

test('admin reads worker data and metrics', async () => {
  const users = await call('GET', '/admin/users', { token: state.admin });
  const ravi = users.body.users.find((u) => u.id === state.workerId);
  assert.equal(ravi.last_location.lat, 12.97);
  assert.equal(users.body.users.some((u) => u.role === 'admin'), false);

  const locations = await call('GET', `/admin/users/${state.workerId}/locations?limit=10`, { token: state.admin });
  assert.equal(locations.body.locations.length, 1);
  const since = new Date(Date.now() + 60_000).toISOString();
  const none = await call('GET', `/admin/users/${state.workerId}/locations?since=${encodeURIComponent(since)}`, { token: state.admin });
  assert.equal(none.body.locations.length, 0);

  const calls = await call('GET', `/admin/users/${state.workerId}/calls`, { token: state.admin });
  assert.equal(calls.body.calls.length, 2);
  const missed = calls.body.calls.find((c) => c.direction === 'missed');
  assert.equal(missed.contact_number, 'Unknown');
  const sessions = await call('GET', `/admin/users/${state.workerId}/sessions`, { token: state.admin });
  assert.equal(sessions.body.sessions.length, 2);
  assert.ok(sessions.body.sessions[0].ended_at);

  assert.equal((await call('GET', '/admin/users/999999/calls', { token: state.admin })).status, 404);

  const metrics = await call('GET', '/admin/metrics', { token: state.admin });
  assert.deepEqual(metrics.body, {
    active_workers: 2,
    on_duty: 0,
    pings_today: 1,
    calls_today: 2,
    missed_today: 1,
    call_seconds_today: 42,
  });
});

test('password change works for the signed-in user', async () => {
  const wrong = await call('POST', '/me/password', { token: state.admin, body: { current_password: 'x', new_password: 'new-admin-pass' } });
  assert.equal(wrong.status, 401);
  const ok = await call('POST', '/me/password', {
    token: state.admin,
    body: { current_password: 'CHANGE-ME-NOW', new_password: 'new-admin-pass' },
  });
  assert.equal(ok.status, 200);
  const login = await call('POST', '/auth/login', { body: { username: 'admin', password: 'new-admin-pass' } });
  assert.equal(login.status, 200);
});

test('deactivation ends duty and revokes access immediately', async () => {
  await call('POST', '/me/duty', { token: state.worker, body: { on_duty: true } });
  const patched = await call('PATCH', `/admin/users/${state.workerId}`, { token: state.admin, body: { active: false } });
  assert.equal(patched.body.user.active, false);
  assert.equal(patched.body.user.on_duty, false);
  const me = await call('GET', '/me', { token: state.worker });
  assert.equal(me.status, 401);
  const login = await call('POST', '/auth/login', { body: { code: state.code, password: 'worker-pass' } });
  assert.equal(login.status, 403);
});

test('login is rate limited per IP', async () => {
  let last;
  for (let i = 0; i < 25 && last?.status !== 429; i += 1) {
    last = await call('POST', '/auth/login', { body: { username: 'nobody', password: 'x' } });
  }
  assert.equal(last.status, 429);
});

test('retention function purges expired rows', async () => {
  const old = new Date(Date.now() - 100 * 86400_000);
  await sql`INSERT INTO location_pings (user_id, lat, lng, recorded_at) VALUES (${state.workerId}, 1, 1, ${old})`;
  await sql`SELECT public.fleet_purge_expired(90, 180)`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM location_pings WHERE recorded_at < now() - interval '90 days'`;
  assert.equal(n, 0);
  const [{ kept }] = await sql`SELECT count(*)::int AS kept FROM location_pings`;
  assert.equal(kept, 1);
});
