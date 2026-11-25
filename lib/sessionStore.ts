/**
 * Session store backed by Upstash Redis.
 * Replaces the previous in-memory Map so sessions survive across
 * Vercel serverless function instances.
 *
 * Key pattern : session:{TOKEN}
 * TTL         : 3600 seconds (1 hour)
 */

import { Redis } from '@upstash/redis';

export interface SessionData {
  token: string;
  channelName: string;
  createdAt: number;
  /** Incremented by the Pusher auth endpoint (once per real member subscription). */
  memberCount: number;
}

/** @deprecated Use SessionData. Kept for any consumers that import SessionRecord. */
export type SessionRecord = SessionData;

export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour (informational)
export const MAX_MEMBERS = 6;

const KEY_PREFIX = 'session:';
const SESSION_TTL_SECONDS = 3600;

// Lazy singleton — only created when a function is first called at runtime,
// not at module-load time (which would break builds without real env vars).
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
  }

  _redis = new Redis({ url, token });
  return _redis;
}

/** Exported for callers that need direct Redis access. */
export function getRedisClient(): Redis {
  return getRedis();
}

function key(token: string): string {
  return `${KEY_PREFIX}${token}`;
}

export async function createSession(token: string, data: SessionData): Promise<void> {
  await getRedis().set(key(token), JSON.stringify(data), { ex: SESSION_TTL_SECONDS });
}

export async function getSession(token: string): Promise<SessionData | null> {
  const raw = await getRedis().get<string>(key(token));
  if (raw === null || raw === undefined) return null;
  // @upstash/redis may auto-parse JSON; handle both string and object
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }
  return raw as unknown as SessionData;
}

export async function deleteSession(token: string): Promise<void> {
  await getRedis().del(key(token));
}

/**
 * Increment the member count for a session and persist the updated record.
 * Returns null if the session does not exist.
 */
export async function incrementMemberCount(token: string): Promise<SessionData | null> {
  const session = await getSession(token);
  if (!session) return null;
  session.memberCount += 1;
  await createSession(token, session); // also resets TTL
  return session;
}
