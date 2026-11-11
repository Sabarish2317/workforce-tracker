import 'server-only';
import jwt from 'jsonwebtoken';
import { config, getJwtSecret } from './config';
import { findUserById, hitRateLimit } from './db';
import { HttpError } from './http';

export const signToken = (user) =>
  jwt.sign({ role: user.role }, getJwtSecret(), {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.tokenTtl,
  });

/**
 * Verifies the bearer token, then re-loads the user so deactivation or a
 * role change takes effect immediately rather than at token expiry.
 * Pass a role to restrict the route.
 */
export const authenticate = async (request, role) => {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing bearer token');
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const user = await findUserById(Number(payload.sub));
  if (!user || !user.active) throw new HttpError(401, 'Account is inactive');
  if (role && user.role !== role) throw new HttpError(403, 'Forbidden');
  return user;
};

/** Shared (database-backed) fixed-window rate limit; throws 429 when exceeded. */
export const rateLimit = async (key, { windowSeconds, max }) => {
  const { count, window_start: windowStart } = await hitRateLimit(key, windowSeconds);
  if (count > max) {
    const retryAfter = Math.max(1, Math.ceil(windowSeconds - (Date.now() - new Date(windowStart).getTime()) / 1000));
    const error = new HttpError(429, 'Too many requests');
    error.headers = { 'Retry-After': String(retryAfter) };
    throw error;
  }
};
