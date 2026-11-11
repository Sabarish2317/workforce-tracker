import { z } from 'zod';
import { getOpenSession, insertPings } from '@/lib/server/db';
import { authenticate, rateLimit } from '@/lib/server/auth';
import { HttpError, json, readJson, route, timestamp, validate } from '@/lib/server/http';

// Device clocks drift; tolerate small skew around the duty window.
const CLOCK_SKEW_MS = 2 * 60 * 1000;

const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  battery: z.number().int().min(0).max(100).optional(),
  recorded_at: timestamp,
});

export const POST = route(async (request) => {
  const user = await authenticate(request, 'worker');
  await rateLimit(`ingest:${user.id}`, { windowSeconds: 60, max: 30 });
  const { pings } = validate(z.object({ pings: z.array(pingSchema).min(1).max(500) }), await readJson(request));

  // Server-side duty gate: an old or buggy client must not be able to upload
  // off-shift location. user_id comes from the token and duty state from the
  // database, never from the request.
  const session = await getOpenSession(user.id);
  if (!session) throw new HttpError(409, 'Off duty: location not accepted', { accepted: 0 });

  const windowStart = new Date(session.started_at).getTime() - CLOCK_SKEW_MS;
  const windowEnd = Date.now() + CLOCK_SKEW_MS;
  const inWindow = pings.filter((ping) => {
    const at = Date.parse(ping.recorded_at);
    return at >= windowStart && at <= windowEnd;
  });
  const accepted = inWindow.length ? await insertPings(user.id, inWindow) : 0;
  return json({ accepted, dropped: pings.length - accepted });
});
