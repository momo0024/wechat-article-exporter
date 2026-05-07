import { parseCookies, setCookie as setResponseCookie } from 'h3';
import { getEffectiveSessionExpiresAt, getRemainingSessionSeconds, resolveSessionExpiresAtMs } from '~/server/kv/cookie';
import { getPool } from '~/server/db/postgres';
import { getAuthKeyCookieBaseOptions } from '~/server/utils/auth-key-cookie';
import { cookieStore } from '~/server/utils/CookieStore';

export default defineEventHandler(async (event) => {
  const authKey = getRequestHeader(event, 'X-Auth-Key') || parseCookies(event)['auth-key'];
  if (!authKey) {
    return null;
  }

  const pool = getPool();
  const sessionRes = await pool.query(
    `SELECT nickname, avatar, created_at, expires_at
     FROM session
     WHERE auth_key = $1 AND expires_at > 0
     LIMIT 1`,
    [authKey],
  );

  const accountCookie = await cookieStore.getAccountCookie(authKey);
  const row = sessionRes.rows[0];
  const sessionExpiresAt = row
    ? resolveSessionExpiresAtMs({
        createdAtSeconds: Number(row.created_at || 0),
        expiresAtSeconds: Number(row.expires_at || 0),
      })
    : null;

  if (sessionRes.rows.length === 0 || !accountCookie || accountCookie.isExpired || !sessionExpiresAt) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      expires: new Date(0),
      maxAge: 0,
      ...getAuthKeyCookieBaseOptions(event),
    });
    return null;
  }

  const expiresAt = getEffectiveSessionExpiresAt({
    sessionExpiresAtMs: sessionExpiresAt,
    cookieExpiresAtMs: accountCookie.expiresAt,
  });
  const maxAge = getRemainingSessionSeconds(expiresAt);

  if (maxAge <= 0) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      expires: new Date(0),
      maxAge: 0,
      ...getAuthKeyCookieBaseOptions(event),
    });
    return null;
  }

  setResponseCookie(event, 'auth-key', authKey, {
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
    ...getAuthKeyCookieBaseOptions(event),
  });

  return {
    nickname: row.nickname || '',
    avatar: row.avatar || '',
    expires: new Date(expiresAt || sessionExpiresAt).toString(),
  };
});