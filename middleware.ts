import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE_NAME } from '@/lib/auth/constants';
import { PLATFORM_ADMIN_COOKIE_NAME } from '@/lib/platform-admin/constants';
import { checkRateLimit, clientKeyFromHeaders } from '@/lib/security/rate-limit';

// Runs on the Edge runtime, so it re-implements the minimal "is there a
// validly-signed session cookie" check rather than importing lib/auth/session
// (which is marked server-only and pulls in Node-only deps transitively via
// Prisma elsewhere in the app). This only gates page navigation for UX; every
// API route still independently re-checks auth + permissions server-side via
// lib/auth/rbac.ts, which is the actual security boundary.
async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return false;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

// Phase 17 — Platform Subscription Billing. Same "Edge-safe re-check, not
// the real security boundary" caveat as hasValidSession above: every
// /api/platform-admin/** route independently re-verifies via
// requirePlatformAdmin (lib/platform-admin/guard.ts), which additionally
// re-checks the account's status against the database on every request —
// this only gates page navigation for UX. Uses a completely separate
// cookie and secret from staff sessions (PLATFORM_ADMIN_COOKIE_NAME /
// PLATFORM_ADMIN_AUTH_SECRET) — see lib/platform-admin/constants.ts's
// header for why a third, non-org-scoped admin actor needs its own
// session space entirely.
async function hasValidPlatformAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(PLATFORM_ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  const secret = process.env.PLATFORM_ADMIN_AUTH_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

const PROTECTED_PREFIXES = ['/dashboard'];
// Every /platform-admin/** page requires a session EXCEPT the login page
// itself, which obviously must stay reachable while logged out.
const PLATFORM_ADMIN_PREFIX = '/platform-admin';
const PLATFORM_ADMIN_LOGIN_PATH = '/platform-admin/login';

// Phase 15 hardening (master spec §42 "Rate limiting", §67 security review).
// Auth endpoints get a tight limit — they're the classic credential-
// stuffing/brute-force target and see legitimately low request volume from
// any single real user. Every other /api/* route gets a much looser limit
// as pure defense-in-depth against a runaway client or scripted abuse; it
// is not a substitute for per-endpoint authorization, which every route
// handler still independently enforces (see hasValidSession's own comment
// above — same "middleware is UX/defense-in-depth, not the real boundary"
// principle applies here).
const AUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const API_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
// CAPP Phase 12 hardening: this originally only listed the staff auth
// routes. The customer-app's own login/register live under a completely
// different path prefix (`/api/v1/auth/**`, not `/api/auth/**`), so
// `'/api/v1/auth/login'.startsWith('/api/auth/login')` was false and both
// fell through to the generic 120 req/min `/api/*` bucket instead of the
// intended 10 req/min brute-force-resistant bucket — a real gap, not a
// stylistic one, since CustomerAccountService.login has no other lockout.
// Phase 17 adds '/api/platform-admin/login' to this same list for the
// identical reason — a third credential-stuffing target, same tight bucket.
//
// Known residual gap, stated plainly rather than silently accepted: even at
// the correct 10 req/min, this limiter is keyed by IP (see
// `clientKeyFromHeaders`'s own comment on that header being spoofable off a
// trusted proxy) and there is no secondary per-account lockout — neither the
// staff nor the customer login path has one. Adding real per-account lockout
// is a genuine feature (a failed-attempt counter, a way to clear it, a UX
// for "account temporarily locked") that touches staff auth too, not a
// CAPP-scoped fix, so it's flagged here for a future pass rather than
// bolted on asymmetrically for just the customer path.
const RATE_LIMITED_AUTH_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/platform-admin/login',
];

function rateLimitFor(pathname: string): { limit: number; windowMs: number; bucket: string } | null {
  if (RATE_LIMITED_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { ...AUTH_RATE_LIMIT, bucket: 'auth' };
  }
  if (pathname.startsWith('/api/')) {
    return { ...API_RATE_LIMIT, bucket: 'api' };
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const rateLimit = rateLimitFor(pathname);
  if (rateLimit) {
    const clientKey = clientKeyFromHeaders(request.headers);
    const result = checkRateLimit(`${rateLimit.bucket}:${clientKey}`, rateLimit.limit, rateLimit.windowMs, Date.now());
    if (!result.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      );
    }
  }

  if (pathname.startsWith(PLATFORM_ADMIN_PREFIX) && pathname !== PLATFORM_ADMIN_LOGIN_PATH) {
    const authenticated = await hasValidPlatformAdminSession(request);
    if (!authenticated) {
      const loginUrl = new URL(PLATFORM_ADMIN_LOGIN_PATH, request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const authenticated = await hasValidSession(request);
  if (!authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/platform-admin/:path*', '/api/:path*'],
};
