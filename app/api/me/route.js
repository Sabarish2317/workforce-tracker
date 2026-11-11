import { authenticate } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { profile } from '@/lib/server/profile';

export const GET = route(async (request) => {
  const user = await authenticate(request);
  return json(await profile(user.id));
});
