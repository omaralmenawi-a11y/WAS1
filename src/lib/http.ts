import { cookies } from 'next/headers';
import { AppError } from './errors';
import { SESSION_COOKIE } from './cookies';

export { SESSION_COOKIE };

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json({ error: e.code, message: e.messageAr }, { status: e.status });
  }
  console.error(e);
  return Response.json({ error: 'INTERNAL', message: 'حدث خطأ غير متوقع، حاول مرة أخرى' }, { status: 500 });
}

/** Wraps a route handler body so AppErrors become JSON error responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}

export async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export async function setSessionCookie(token: string, maxAgeSec: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSec,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
