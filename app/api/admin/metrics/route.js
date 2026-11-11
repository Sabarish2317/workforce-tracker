import { getMetrics } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';

// India Standard Time has no DST, so a fixed offset is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const startOfTodayIst = () => {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - IST_OFFSET_MS).toISOString();
};

export const GET = route(async (request) => {
  await authenticate(request, 'admin');
  return json(await getMetrics(startOfTodayIst()));
});
