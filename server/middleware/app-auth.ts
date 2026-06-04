import { getSessionTokenFromEvent, validateSession } from '~/server/utils/app-auth';

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  // 不拦截微信相关接口和公开接口
  if (url.pathname.startsWith('/api/web/')
    || url.pathname.startsWith('/api/public/')
    || url.pathname.startsWith('/api/store/')) {
    return;
  }

  // 只拦截 /api/app/ 下的系统接口
  if (!url.pathname.startsWith('/api/app/')) {
    return;
  }

  // 不拦截登录和 session 检查
  if (url.pathname.startsWith('/api/app/login')
    || url.pathname.startsWith('/api/app/session')) {
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
