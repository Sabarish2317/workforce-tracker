import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '@/lib/server/config';
import { getPasswordHash, updatePassword } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { HttpError, json, readJson, route, validate } from '@/lib/server/http';

const schema = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(8).max(200) });

export const POST = route(async (request) => {
  const user = await authenticate(request);
  const { current_password: current, new_password: next } = validate(schema, await readJson(request));
  if (!(await bcrypt.compare(current, await getPasswordHash(user.id)))) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  await updatePassword(user.id, await bcrypt.hash(next, config.bcryptCost));
  return json({ ok: true });
});
