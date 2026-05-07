import { getPool } from '~/server/db/postgres';
import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
}

export interface SessionProfileValue {
  nickname: string;
  avatar: string;
}

const DEFAULT_SESSION_TTL_HOURS = 72;
const MAX_SESSION_TTL_HOURS = 72;

export function getSessionTtlHours(): number {
  const rawValue = Number(process.env.SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return DEFAULT_SESSION_TTL_HOURS;
  }

  return Math.min(MAX_SESSION_TTL_HOURS, Math.max(1, Math.floor(rawValue)));
}

export function getSessionTtlSeconds(): number {
  return getSessionTtlHours() * 60 * 60;
}

export function resolveSessionExpiresAtMs(input: {
  createdAtSeconds?: number | null;
  expiresAtSeconds?: number | null;
}): number | null {
  if (typeof input.expiresAtSeconds === 'number' && Number.isFinite(input.expiresAtSeconds) && input.expiresAtSeconds <= 0) {
    return null;
  }

  const candidates = [
    typeof input.expiresAtSeconds === 'number' && Number.isFinite(input.expiresAtSeconds) && input.expiresAtSeconds > 0
      ? input.expiresAtSeconds * 1000
      : null,
    typeof input.createdAtSeconds === 'number' && Number.isFinite(input.createdAtSeconds) && input.createdAtSeconds > 0
      ? (input.createdAtSeconds + getSessionTtlSeconds()) * 1000
      : null,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

export function getEffectiveSessionExpiresAt(input: {
  sessionExpiresAtMs?: number | null;
  cookieExpiresAtMs?: number | null;
}): number | null {
  const candidates = [input.sessionExpiresAtMs, input.cookieExpiresAtMs]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

export function getRemainingSessionSeconds(expiresAtMs: number | null, nowMs = Date.now()): number {
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
}

export async function getSessionExpiresAt(key: CookieKVKey): Promise<number | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT created_at, expires_at FROM session WHERE auth_key = $1 AND expires_at > 0 LIMIT 1`,
      [key]
    );
    if (res.rows.length === 0) {
      return null;
    }

    return resolveSessionExpiresAtMs({
      createdAtSeconds: Number(res.rows[0].created_at || 0),
      expiresAtSeconds: Number(res.rows[0].expires_at || 0),
    });
  } catch (err) {
    console.error('session expiry query failed:', err);
    return null;
  }
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const pool = getPool();
  try {
    const now = Math.round(Date.now() / 1000);
    const expiresAt = now + getSessionTtlSeconds();
    await pool.query(
      `INSERT INTO session (auth_key, token, cookies, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (auth_key) DO UPDATE SET
         token = EXCLUDED.token,
         cookies = EXCLUDED.cookies`,
      [key, data.token, JSON.stringify(data.cookies), now, expiresAt]
    );
    return true;
  } catch (err) {
    console.error('session insert failed:', err);
    return false;
  }
}

export async function setLoginSessionCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const pool = getPool();
  try {
    const now = Math.round(Date.now() / 1000);
    const expiresAt = now + getSessionTtlSeconds();
    await pool.query(
      `INSERT INTO session (auth_key, token, cookies, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (auth_key) DO UPDATE SET
         token = EXCLUDED.token,
         cookies = EXCLUDED.cookies,
         created_at = EXCLUDED.created_at,
         expires_at = EXCLUDED.expires_at`,
      [key, data.token, JSON.stringify(data.cookies), now, expiresAt]
    );
    await pool.query(`DELETE FROM session WHERE auth_key <> $1`, [key]);
    return true;
  } catch (err) {
    console.error('login session insert failed:', err);
    return false;
  }
}

export async function updateSessionProfile(key: CookieKVKey, data: SessionProfileValue): Promise<boolean> {
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE session
       SET nickname = $2,
           avatar = $3
       WHERE auth_key = $1`,
      [key, data.nickname, data.avatar]
    );
    return true;
  } catch (err) {
    console.error('session profile update failed:', err);
    return false;
  }
}

export async function getMpCookie(key: CookieKVKey): Promise<CookieKVValue | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT token, cookies, created_at, expires_at FROM session WHERE auth_key = $1 AND expires_at > 0 LIMIT 1`,
      [key]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const expiresAtMs = resolveSessionExpiresAtMs({
      createdAtSeconds: Number(row.created_at || 0),
      expiresAtSeconds: Number(row.expires_at || 0),
    });
    if (getRemainingSessionSeconds(expiresAtMs) <= 0) {
      return null;
    }

    return {
      token: row.token,
      cookies: row.cookies,
    };
  } catch (err) {
    console.error('session query failed:', err);
    return null;
  }
}

export async function getLatestSessionAuthKey(): Promise<string | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT auth_key
       FROM session
       ORDER BY created_at DESC, auth_key DESC
       LIMIT 1`
    );
    if (res.rows.length === 0) {
      return null;
    }

    return res.rows[0].auth_key || null;
  } catch (err) {
    console.error('latest session key query failed:', err);
    return null;
  }
}

export async function removeMpCookie(key: CookieKVKey): Promise<boolean> {
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE session
       SET expires_at = 0
       WHERE auth_key = $1`,
      [key]
    );
    return true;
  } catch (err) {
    console.error('session invalidate failed:', err);
    return false;
  }
}

export async function removeAllSessions(): Promise<boolean> {
  const pool = getPool();
  try {
    await pool.query(`DELETE FROM session`);
    return true;
  } catch (err) {
    console.error('session clear failed:', err);
    return false;
  }
}

export async function cleanExpiredSessions(): Promise<void> {
  const pool = getPool();
  try {
    const now = Math.round(Date.now() / 1000);
    await pool.query(`DELETE FROM session WHERE expires_at <= $1 OR created_at <= $2`, [now, now - getSessionTtlSeconds()]);
  } catch (err) {
    console.error('session cleanup failed:', err);
  }
}
