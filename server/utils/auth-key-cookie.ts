import { getRequestHeader, type H3Event } from 'h3';

function shouldUseSecureCookie(event: H3Event): boolean {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto') || getRequestHeader(event, 'x-forwarded-protocol');
  if (typeof forwardedProto === 'string' && forwardedProto.trim()) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }

  const forwardedSsl = getRequestHeader(event, 'x-forwarded-ssl');
  if (typeof forwardedSsl === 'string' && forwardedSsl.trim()) {
    return forwardedSsl.split(',')[0].trim().toLowerCase() === 'on';
  }

  return Boolean((event.node.req.socket as { encrypted?: boolean }).encrypted);
}

export function getAuthKeyCookieBaseOptions(event: H3Event) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureCookie(event),
  };
}

function appendCookieSecurity(parts: string[], secure: boolean): string[] {
  if (secure) {
    parts.push('Secure');
  }

  parts.push('HttpOnly', 'SameSite=Lax');
  return parts;
}

export function createCookieHeader(event: H3Event, input: { name: string; value: string; maxAge: number; expires?: Date }): string {
  const parts = [
    `${input.name}=${input.value}`,
    'Path=/',
    `Expires=${(input.expires || new Date(Date.now() + input.maxAge * 1000)).toUTCString()}`,
    `Max-Age=${input.maxAge}`,
  ];

  return appendCookieSecurity(parts, shouldUseSecureCookie(event)).join('; ');
}

export function createExpiredCookieHeader(event: H3Event, name: string): string {
  const parts = [
    `${name}=EXPIRED`,
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ];

  return appendCookieSecurity(parts, shouldUseSecureCookie(event)).join('; ');
}