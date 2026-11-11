import { z } from 'zod';
import { indexesWithinDuty, insertCalls } from '@/lib/server/db';
import { authenticate, rateLimit } from '@/lib/server/auth';
import { json, readJson, route, timestamp, validate } from '@/lib/server/http';

const CLOCK_SKEW_SECONDS = 120;

// One entry from the phone's call log, already filtered on the device to
// calls made or received while this worker was on duty.
const callSchema = z.object({
  client_id: z.string().min(1).max(64),
  direction: z.enum(['outgoing', 'incoming', 'missed']),
  contact_name: z.string().trim().max(120).optional(),
  // Withheld / unknown callers arrive as an empty string.
  contact_number: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9+*#() -]*$/, 'Invalid phone number')
    .transform((value) => value || 'Unknown'),
  started_at: timestamp,
  duration_sec: z.number().int().min(0).max(24 * 3600),
});

export const POST = route(async (request) => {
  const user = await authenticate(request, 'worker');
  await rateLimit(`ingest:${user.id}`, { windowSeconds: 60, max: 30 });
  const { calls } = validate(z.object({ calls: z.array(callSchema).min(1).max(200) }), await readJson(request));

  // Same rule as location: keep only calls that started during one of this
  // worker's duty sessions. The phone already filters, but an old or buggy
  // client (or a shared phone's earlier user) must not leak through. Calls
  // may arrive after going off duty (the last call of a shift), so the check
  // is per call, not "on duty now".
  const keep = await indexesWithinDuty(user.id, calls.map((c) => c.started_at), CLOCK_SKEW_SECONDS);
  const inWindow = calls.filter((_, i) => keep.has(i));
  const inserted = inWindow.length ? await insertCalls(user.id, inWindow) : 0;
  return json({ accepted: inWindow.length, dropped: calls.length - inWindow.length, inserted });
});
