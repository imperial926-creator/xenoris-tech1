
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, SESSION_TTL_SECONDS } from './constants';

export interface SessionPayload {
  userId: string;
  organizationId: string;
  email: string;
  // Role names held by the user, denormalized into the token so most requests
  // can authorize without an extra DB round trip. Permission-sensitive
  // mutations still re-check against the DB in the service layer — the token
  // is a fast path, not the source of truth.
  roles: string[];
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'AUTH_SECRET is not set (or too short). Set a long random value in your environment — see .env.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());

    if (
      typeof payload.userId === 'string' &&
      typeof payload.organizationId === 'string' &&
      typeof payload.email === 'string' &&
      Array.isArray(payload.roles)
    ) {
      return {
        userId: payload.userId,
        organizationId: payload.organizationId,
        email: payload.email,
        roles: payload.roles as string[],
      };
    }

    return null;
  } catch {
    // Expired, malformed, or forged token — treat as no session.
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) return null;

  return verifySessionToken(token);
}

