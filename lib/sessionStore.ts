/**
 * In-memory session store shared across API routes.
 * Exported as a module-level singleton so both /api/session and /api/pusher/auth
 * can read and mutate the same Map within a single Node.js process lifetime.
 */

export interface SessionRecord {
  token: string;
  channelName: string;
  createdAt: number;
  /** Incremented by the Pusher auth endpoint (once per real member subscription). */
  memberCount: number;
}

export const sessions = new Map<string, SessionRecord>();

export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
export const MAX_MEMBERS = 6;

export function pruneExpired(): void {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}
