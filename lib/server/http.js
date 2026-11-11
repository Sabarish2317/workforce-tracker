import 'server-only';
import { z } from 'zod';

const MAX_BODY_BYTES = 256 * 1024;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

/**
 * Wraps a route handler: HttpErrors become JSON error responses; anything
 * else is logged (never with request bodies) and returned as a generic 500.
 */
export const route = (handler) => async (request, context) => {
  try {
    return await handler(request, context);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, ...error.extra }, error.status, error.headers);
    }
    console.error(`[api] ${request.method} ${new URL(request.url).pathname}`, error);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const readJson = async (request) => {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'Malformed JSON');
  }
};

/** Parses data with the schema; throws a 400 listing the issues on failure. */
export const validate = (schema, data) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'Invalid request', {
      issues: result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    });
  }
  return result.data;
};

export const searchParams = (request) => Object.fromEntries(new URL(request.url).searchParams);

/** Client IP as seen by Vercel's edge (first hop of x-forwarded-for). */
export const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';

// ---------- shared schemas ----------

/** Accepts an ISO-8601 string or epoch milliseconds; normalises to an ISO UTC string. */
export const timestamp = z
  .union([z.iso.datetime({ offset: true }), z.number().int().positive()])
  .transform((value) => new Date(value).toISOString());

export const limitQuery = (max) =>
  z.object({ limit: z.coerce.number().int().min(1).max(max).default(Math.min(100, max)) });

export const idParam = z.object({ id: z.coerce.number().int().positive() });
