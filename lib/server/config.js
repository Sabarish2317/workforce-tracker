import 'server-only';

const INSECURE_PLACEHOLDER = 'dev-insecure-secret-change-me';

const intFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
};

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || INSECURE_PLACEHOLDER;

/** Read lazily so `next build` works without runtime secrets. */
export const getJwtSecret = () => {
  if (isProduction && (jwtSecret === INSECURE_PLACEHOLDER || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
  }
  return jwtSecret;
};

export const config = {
  tokenTtl: process.env.TOKEN_TTL || '7d',
  // Bump when the workforce-monitoring policy text changes; workers must
  // re-acknowledge before they can go on duty again.
  policyVersion: process.env.POLICY_VERSION || '2026-11-v2',
  bcryptCost: intFromEnv('BCRYPT_COST', 12),
};
