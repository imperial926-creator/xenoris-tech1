import 'server-only';
import type { NextRequest } from 'next/server';
import { extractBearerToken, verifyCustomerAccessToken, type CustomerAccessPayload } from './session';

export class CustomerUnauthenticatedError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'CustomerUnauthenticatedError';
  }
}

/** Reads and verifies the bearer access token off an inbound request. */
export async function getCustomerSession(
  request: NextRequest,
): Promise<CustomerAccessPayload | null> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return null;
  return verifyCustomerAccessToken(token);
}

export function requireCustomerAuthenticated(
  session: CustomerAccessPayload | null,
): CustomerAccessPayload {
  if (!session) throw new CustomerUnauthenticatedError();
  return session;
}
