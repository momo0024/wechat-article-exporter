import { randomUUID } from 'node:crypto';
import { deleteCookie, getCookie, setCookie } from 'h3';

const STORAGE_KEY_PREFIX = 'app:session:';
const SESSION_TTL_SECONDS = 72 * 3600; // 72 hours

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'admin';

export function getSessionStorageKey(token: string): string {
  return `${STORAGE_KEY_PREFIX}${token}`;
}

export function generateToken(): string {
  return randomUUID();
}

/**
 * Create a session and return the token.
 */
export async function createSession(username: string): Promise<string> {
  const token = generateToken();
  const key = getSessionStorageKey(token);
  const store = useStorage();
  await store.setItem(key, {
    username,
    createdAt: Date.now(),
  });
  return token;
}

/**
 * Validate a session token. Returns the session data or null.
 */
export async function validateSession(token: string): Promise<{ username: string; createdAt: number } | null> {
  if (!token) return null;
  const key = getSessionStorageKey(token);
  const store = useStorage();
  const session = await store.getItem(key);
  return session || null;
}

/**
 * Destroy a session.
 */
export async function destroySession(token: string): Promise<void> {
  const key = getSessionStorageKey(token);
  const store = useStorage();
  await store.removeItem(key);
}

/**
 * Set session cookie on the event.
 */
export function setSessionCookie(event: H3Event, token: string): void {
  setCookie(event, 'app-auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  });
}

/**
 * Get session token from the event's cookies.
 */
export function getSessionTokenFromEvent(event: H3Event): string | undefined {
  return getCookie(event, 'app-auth-token');
}

/**
 * Clear session cookie.
 */
export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, 'app-auth-token', {
    path: '/',
  });
}
