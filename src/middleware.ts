import { NextResponse, type NextRequest } from 'next/server';

// Edge middleware cannot reach the DB: it only checks the cookie is present.
// Real validation happens in the layouts (requirePageUser) and API routes.
export function middleware(req: NextRequest) {
  if (!req.cookies.get('wasl_session')?.value) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/parent/:path*', '/staff/:path*', '/school/:path*', '/admin/:path*'] };
