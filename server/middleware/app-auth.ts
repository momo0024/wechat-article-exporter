import { getSessionTokenFromEvent, validateSession } from '~/server/utils/app-auth';

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  // 不拦截登录 API 和 session 检查 API
  if (url.pathname.startsWith('/api/app/login') || url.pathname.startsWith('/api/app/session')) {
    return;
  }

  // 只拦截 /api/ 下的其他接口
  if (!url.pathname.startsWith('/api/')) {
    return;
  }

  const token = getSessionTokenFromEvent(event);
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: '未登录',
    });
  }

  const session = await validateSession(token);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: '会话已过期',
    });
  }
});
