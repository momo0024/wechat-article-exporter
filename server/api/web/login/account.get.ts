import { parseCookies, setCookie as setResponseCookie } from 'h3';
import { getEffectiveSessionExpiresAt, getRemainingSessionSeconds } from '~/server/kv/cookie';
import { getPool } from '~/server/db/postgres';
import { cookieStore } from '~/server/utils/CookieStore';

export default defineEventHandler(async (event) => {
  const authKey = getRequestHeader(event, 'X-Auth-Key') || parseCookies(event)['auth-key'];
  if (!authKey) {
    return null;
  }

  const pool = getPool();
  const now = Math.round(Date.now() / 1000);
  const sessionRes = await pool.query(
    `SELECT nickname, avatar, expires_at
     FROM session
     WHERE auth_key = $1 AND expires_at > $2
     LIMIT 1`,
    [authKey, now],
  );

  const accountCookie = await cookieStore.getAccountCookie(authKey);

  if (sessionRes.rows.length === 0 || !accountCookie || accountCookie.isExpired) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
    });
    return null;
  }

  const row = sessionRes.rows[0];
  const sessionExpiresAt = Number(row.expires_at || 0) * 1000;
  const expiresAt = getEffectiveSessionExpiresAt({
    sessionExpiresAtMs: sessionExpiresAt,
    cookieExpiresAtMs: accountCookie.expiresAt,
  });
  const maxAge = getRemainingSessionSeconds(expiresAt);

  if (maxAge <= 0) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
    });
    return null;
  }

  setResponseCookie(event, 'auth-key', authKey, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
  });

  return {
    nickname: row.nickname || '',
    avatar: row.avatar || '',
    expires: new Date(expiresAt || sessionExpiresAt).toString(),
  };
});