import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE_NAME } from '@/lib/auth/constants';
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

const PROTECTED_PREFIXES = ['/dashboard'];

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
const RATE_LIMITED_AUTH_PREFIXES = ['/api/auth/login', '/api/auth/register'];

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
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
