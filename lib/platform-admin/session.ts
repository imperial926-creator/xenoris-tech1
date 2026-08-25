import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { PLATFORM_ADMIN_COOKIE_NAME, PLATFORM_ADMIN_SESSION_TTL_SECONDS } from './constants';

export interface PlatformAdminSessionPayload {
  platformAdminId: string;
  email: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.PLATFORM_ADMIN_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'PLATFORM_ADMIN_AUTH_SECRET is not set (or too short). Set a long random value in your ' +
        'environment — see .env.example. This must be a DIFFERENT secret than AUTH_SECRET and ' +
        'CUSTOMER_AUTH_SECRET: the platform-admin token space must never be forgeable from a ' +
        'leaked staff or customer secret, or vice versa.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createPlatformAdminSessionToken(
  payload: PlatformAdminSessionPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PLATFORM_ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyPlatformAdminSessionToken(
  token: string,
): Promise<PlatformAdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.platformAdminId === 'string' && typeof payload.email === 'string') {
      return { platformAdminId: payload.platformAdminId, email: payload.email };
    }
    return null;
  } catch {
    // Expired, malformed, or forged token — treat identically as "no session".
    return null;
  }
}

export async function setPlatformAdminSessionCookie(token: string): Promise<void> {
  cookies().set(PLATFORM_ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PLATFORM_ADMIN_SESSION_TTL_SECONDS,
  });
}

export async function clearPlatformAdminSessionCookie(): Promise<void> {
  cookies().set(PLATFORM_ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function getPlatformAdminSession(): Promise<PlatformAdminSessionPayload | null> {
  const token = cookies().get(PLATFORM_ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyPlatformAdminSessionToken(token);
}
