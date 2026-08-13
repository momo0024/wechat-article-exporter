import { getPool } from '~/server/db/postgres';
import { resolveSessionExpiresAtMs } from '~/server/kv/cookie';
import { AccountCookie, getTokenFromStore } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';
import { enforceRateLimit } from '~/server/utils/rate-limit';

interface SearchBizQuery {
  begin?: number;
  size?: number;
  keyword: string;
}

export default defineEventHandler(async event => {
  // 分级限流（查询类）：游客 5 次/分钟（按 IP），会员 100 次/分钟（按 X-Api-Token）
  // membership.enabled=false 时不会限速
  await enforceRateLimit(event, 'query');

  let token = await getTokenFromStore(event);
  let cookie: string | null = null;

  if (!token) {
    const pool = getPool();
    const sessionRes = await pool.query(
      `SELECT auth_key, token, cookies, created_at, expires_at FROM session WHERE expires_at > 0 ORDER BY created_at DESC LIMIT 1`
    );
    const session = sessionRes.rows[0];
    if (session?.token && session?.cookies) {
      const accountCookie = AccountCookie.create(session.token, session.cookies);
      const sessionExpiresAtMs = resolveSessionExpiresAtMs({
        createdAtSeconds: Number(session.created_at || 0),
        expiresAtSeconds: Number(session.expires_at || 0),
      });
      if (!accountCookie.isExpired && sessionExpiresAtMs) {
        token = session.token;
        cookie = accountCookie.toString();
      }
    }
  }

  if (!token) {
    return {
      base_resp: {
        ret: -1,
        err_msg: '未登录或登录已过期',
      },
    };
  }

  const query = getQuery<SearchBizQuery>(event);
  if (!query.keyword) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'keyword不能为空',
      },
    };
  }

  const keyword = query.keyword;
  const begin: number = query.begin || 0;
  const size: number = query.size || 5;

  const params: Record<string, string | number> = {
    action: 'search_biz',
    begin: begin,
    count: size,
    query: keyword,
    token: token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  };

  return proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/searchbiz',
    query: params,
    cookie: cookie || undefined,
    parseJson: true,
  }).catch(e => {
    return {
      base_resp: {
        ret: -1,
        err_msg: '搜索公众号接口失败，请稍后重试',
      },
    };
  });
});
