import { z } from 'zod';
import { config } from '@/lib/server/config';
import { recordConsent } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { HttpError, json, readJson, route, validate } from '@/lib/server/http';
import { profile } from '@/lib/server/profile';

/** Worker acknowledges the current monitoring-policy version shown in the app. */
export const POST = route(async (request) => {
  const user = await authenticate(request, 'worker');
  const { policy_version: version } = validate(z.object({ policy_version: z.string().min(1).max(64) }), await readJson(request));
  if (version !== config.policyVersion) {
    throw new HttpError(409, 'Policy version is out of date', { policy_version: config.policyVersion });
  }
  await recordConsent(user.id, config.policyVersion);
  return json(await profile(user.id));
});
