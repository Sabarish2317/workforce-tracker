import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '@/lib/server/config';
import { createUser, listWorkersWithStatus } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth';
import { json, readJson, route, validate } from '@/lib/server/http';

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, digits, dot, underscore or hyphen'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  display_name: z.string().trim().min(1).max(120),
});

export const GET = route(async (request) => {
  await authenticate(request, 'admin');
  return json({ users: await listWorkersWithStatus() });
});

/** Creates a worker and returns their unique enrollment code. */
export const POST = route(async (request) => {
  await authenticate(request, 'admin');
  const { username, password, display_name: displayName } = validate(createUserSchema, await readJson(request));
  const passwordHash = await bcrypt.hash(password, config.bcryptCost);
  const user = await createUser({ username, passwordHash, displayName, role: 'worker' });
  return json({ user, enrollment_code: user.enrollment_code }, 201);
});
