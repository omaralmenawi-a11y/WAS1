// Pure cookie helpers with no Next.js imports. server.ts loads the socket layer before
// next().prepare(), so anything it imports must stay free of next/headers and next/navigation.

export const SESSION_COOKIE = 'wasl_session';

/** Reads one cookie from a Cookie header (first occurrence wins). Returns undefined when absent, empty or badly encoded. */
export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
