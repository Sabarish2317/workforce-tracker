import { z } from 'zod';
import { setDuty } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { HttpError, json, readJson, route, validate } from '@/lib/server/http';
import { hasCurrentConsent, profile } from '@/lib/server/profile';

export const POST = route(async (request) => {
  const user = await authenticate(request, 'worker');
  const { on_duty: onDuty } = validate(z.object({ on_duty: z.boolean() }), await readJson(request));
  if (onDuty && !hasCurrentConsent(user)) {
    throw new HttpError(409, 'Acknowledge the monitoring policy before going on duty');
  }
  await setDuty(user.id, onDuty);
  return json(await profile(user.id));
});
