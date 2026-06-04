import { ADMIN_PASSWORD, ADMIN_USERNAME, createSession, setSessionCookie } from '~/server/utils/app-auth';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { username, password } = body || {};

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    throw createError({
      statusCode: 401,
      statusMessage: '用户名或密码错误',
    });
  }

  const token = await createSession(username);
  setSessionCookie(event, token);

  return { success: true };
});
