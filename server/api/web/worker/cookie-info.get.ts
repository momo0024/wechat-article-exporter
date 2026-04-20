import { setCookie as setResponseCookie } from 'h3';
import { getEffectiveSessionExpiresAt, getRemainingSessionSeconds } from '~/server/kv/cookie';
import { getPool } from '~/server/db/postgres';
import { cookieStore } from '~/server/utils/CookieStore';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

/**
 * GET /api/web/worker/cookie-info
 *
 * 返回当前请求绑定的有效登录过期时间，并顺带刷新浏览器中的 auth-key
 */
export default defineEventHandler(async (event) => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    return { valid: false, expiresAt: null };
  }

  const pool = getPool();
  const now = Math.round(Date.now() / 1000);
  const res = await pool.query(
    `SELECT expires_at FROM session WHERE auth_key = $1 AND expires_at > $2 LIMIT 1`,
    [authKey, now]
  );

  const accountCookie = await cookieStore.getAccountCookie(authKey);
  if (res.rows.length === 0 || !accountCookie || accountCookie.isExpired) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    return { valid: false, expiresAt: null };
  }

  const sessionExpiresAt = Number(res.rows[0].expires_at || 0) * 1000;
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
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    return { valid: false, expiresAt: null };
  }

  setResponseCookie(event, 'auth-key', authKey, {
    path: '/',
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  });

  return { valid: true, expiresAt };
});
