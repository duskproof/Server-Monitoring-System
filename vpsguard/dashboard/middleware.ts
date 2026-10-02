import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'vpsguard_session';

const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Edge guard: visitors without a session cookie never reach dashboard routes,
 * and authenticated users are bounced away from the auth screens.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAuthenticated = request.cookies.get(SESSION_COOKIE)?.value === '1';
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.json|robots.txt).*)'],
};
