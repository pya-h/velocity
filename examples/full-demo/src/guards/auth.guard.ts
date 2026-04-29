/**
 * Shared authentication guard — encrypted session cookie.
 *
 * Reads the VeloSession (AES-256-GCM encrypted + HMAC signed),
 * verifies it, and populates `req.user` with the authenticated user's info.
 *
 * Usage:
 *   @Guards(authGuard)         — any logged-in user
 *   @Guards(adminGuard)        — admin role only
 */
import type { GuardFunction } from '@velocity/framework';

/** Shape of the user data stored in the session and attached to req.user. */
export interface SessionUser {
  username: string;
  role: string;
}

/**
 * Verifies the encrypted session cookie and attaches user data to `req.user`.
 * Returns false (→ 403) if no valid session exists.
 */
export const authGuard: GuardFunction = (req) => {
  const session = req.session;
  if (!session || !session.valid) return false;

  const data = session.data as SessionUser | null;
  if (!data?.username || !data?.role) return false;

  // Attach user data — accessible in handlers via `user` param injection or `req.user`
  (req as any).user = data;
  return true;
};

/**
 * Admin-only guard — requires a valid session with role === 'admin'.
 */
export const adminGuard: GuardFunction = (req) => {
  if (!authGuard(req)) return false;
  return ((req as any).user as SessionUser).role === 'admin';
};
