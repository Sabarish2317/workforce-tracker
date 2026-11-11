import { z } from 'zod';
import { listLocations } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { loadWorker } from '@/lib/server/admin';
import { json, limitQuery, route, searchParams, validate } from '@/lib/server/http';

const querySchema = limitQuery(2000).extend({ since: z.iso.datetime({ offset: true }).optional() });

export const GET = route(async (request, context) => {
  await authenticate(request, 'admin');
  const worker = await loadWorker(context);
  const { limit, since } = validate(querySchema, searchParams(request));
  return json({ locations: await listLocations(worker.id, { limit, since }) });
});
