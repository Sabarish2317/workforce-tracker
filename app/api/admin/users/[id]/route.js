import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '@/lib/server/config';
import { findUserById, setActive, updateDisplayName, updatePassword } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { loadWorker } from '@/lib/server/admin';
import { json, readJson, route, validate } from '@/lib/server/http';

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
    display_name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

/** Deactivate / reactivate, reset password, or rename a worker. */
export const PATCH = route(async (request, context) => {
  await authenticate(request, 'admin');
  const worker = await loadWorker(context);
  const { active, password, display_name: displayName } = validate(patchSchema, await readJson(request));
  if (password !== undefined) await updatePassword(worker.id, await bcrypt.hash(password, config.bcryptCost));
  if (displayName !== undefined) await updateDisplayName(worker.id, displayName);
  if (active !== undefined) await setActive(worker.id, active);
  return json({ user: await findUserById(worker.id) });
});
