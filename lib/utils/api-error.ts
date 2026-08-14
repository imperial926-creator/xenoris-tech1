import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError, UnauthenticatedError } from '@/lib/auth/rbac';

/**
 * Centralized mapping from thrown errors to HTTP responses, so every route
 * handler can just `try { ... } catch (e) { return toErrorResponse(e); }`
 * instead of re-implementing status-code logic per route.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: error.flatten() },
      { status: 422 },
    );
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  // Never leak internal error details to the client for unexpected errors.
  console.error('Unhandled API error:', error);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}

export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found.`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
