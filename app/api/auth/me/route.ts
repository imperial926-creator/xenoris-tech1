import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { AuthService } from '@/services/auth/AuthService';
import { toErrorResponse } from '@/lib/utils/api-error';
import { requireAuthenticated } from '@/lib/auth/rbac';

export async function GET() {
  try {
    const session = requireAuthenticated(await getSession());
    const user = await AuthService.getSessionUser(session);
    return NextResponse.json({ user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
