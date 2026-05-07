import { setCookie as setResponseCookie } from 'h3';
import { getEffectiveSessionExpiresAt, getRemainingSessionSeconds, resolveSessionExpiresAtMs } from '~/server/kv/cookie';
import { getPool } from '~/server/db/postgres';
import { getAuthKeyCookieBaseOptions } from '~/server/utils/auth-key-cookie';
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
  const res = await pool.query(
    `SELECT created_at, expires_at FROM session WHERE auth_key = $1 AND expires_at > 0 LIMIT 1`,
    [authKey]
  );

  const accountCookie = await cookieStore.getAccountCookie(authKey);
  const sessionExpiresAt = res.rows[0]
    ? resolveSessionExpiresAtMs({
        createdAtSeconds: Number(res.rows[0].created_at || 0),
        expiresAtSeconds: Number(res.rows[0].expires_at || 0),
      })
    : null;

  if (res.rows.length === 0 || !accountCookie || accountCookie.isExpired || !sessionExpiresAt) {
    setResponseCookie(event, 'auth-key', 'EXPIRED', {
      expires: new Date(0),
      maxAge: 0,
      ...getAuthKeyCookieBaseOptions(event),
    });
    return { valid: false, expiresAt: null };
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
    return { valid: false, expiresAt: null };
  }

  setResponseCookie(event, 'auth-key', authKey, {
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
    ...getAuthKeyCookieBaseOptions(event),
  });

  return { valid: true, expiresAt };
});
