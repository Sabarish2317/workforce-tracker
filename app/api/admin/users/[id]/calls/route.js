import { listCalls } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { loadWorker } from '@/lib/server/admin';
import { json, limitQuery, route, searchParams, validate } from '@/lib/server/http';

export const GET = route(async (request, context) => {
  await authenticate(request, 'admin');
  const worker = await loadWorker(context);
  const { limit } = validate(limitQuery(500), searchParams(request));
  return json({ calls: await listCalls(worker.id, limit) });
});
