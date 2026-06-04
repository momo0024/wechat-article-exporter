import { getSessionTokenFromEvent, validateSession } from '~/server/utils/app-auth';

export default defineEventHandler(async (event) => {
  const token = getSessionTokenFromEvent(event);
  if (!token) {
    return { authenticated: false };
  }

  const session = await validateSession(token);
  if (!session) {
    return { authenticated: false };
  }

  return { authenticated: true, username: session.username };
});
