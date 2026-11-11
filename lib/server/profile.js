import 'server-only';
import { config } from './config';
import { findUserById, getOpenSession } from './db';

export const hasCurrentConsent = (user) => user.consent_policy_version === config.policyVersion;

/** The /me payload shared by the profile, consent and duty routes. */
export const profile = async (userId) => {
  const user = await findUserById(userId);
  return {
    user,
    policy: { version: config.policyVersion, acknowledged: hasCurrentConsent(user) },
    duty_session: user.on_duty ? ((await getOpenSession(userId)) ?? null) : null,
  };
};
