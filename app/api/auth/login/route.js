import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '@/lib/server/config';
import { findLoginRecordByCode, findLoginRecordByUsername, findUserById } from '@/lib/server/db';
import { rateLimit, signToken } from '@/lib/server/auth';
import { HttpError, clientIp, json, readJson, route, validate } from '@/lib/server/http';

// Compared against when the account doesn't exist, so response time doesn't
// reveal whether a username/code is valid. Built lazily to keep cold starts fast.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('timing-equaliser', config.bcryptCost));

const loginSchema = z.union([
  z.object({ code: z.string().trim().toUpperCase().min(4).max(32), password: z.string().min(1).max(200) }),
  z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) }),
]);

/** Workers sign in with { code, password }; admins with { username, password }. */
export const POST = route(async (request) => {
  await rateLimit(`login:${clientIp(request)}`, { windowSeconds: 15 * 60, max: 20 });
  const { password, ...identity } = validate(loginSchema, await readJson(request));
  const record =
    'code' in identity ? await findLoginRecordByCode(identity.code) : await findLoginRecordByUsername(identity.username);

  const passwordOk = await bcrypt.compare(password, record?.password_hash ?? getDummyHash());
  if (!record || !passwordOk) throw new HttpError(401, 'Invalid credentials');
  if (!record.active) throw new HttpError(403, 'Account is deactivated. Contact your administrator.');

  const user = await findUserById(record.id);
  return json({ token: signToken(user), role: user.role, user });
});
