import { clearSessionCookie, destroySession, getSessionTokenFromEvent } from '~/server/utils/app-auth';

export default defineEventHandler(async (event) => {
  const token = getSessionTokenFromEvent(event);
  if (token) {
    await destroySession(token);
  }
  clearSessionCookie(event);
  return { success: true };
});
