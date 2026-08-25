import { NextRequest, NextResponse } from 'next/server';
import { registerSchema } from '@/lib/validation/auth';
import { AuthService } from '@/services/auth/AuthService';
import { setSessionCookie } from '@/lib/auth/session';
import { toErrorResponse } from '@/lib/utils/api-error';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = registerSchema.parse(body);
    const ipAddress = request.headers.get('x-forwarded-for');

    const result = await AuthService.register(input, ipAddress);
    await setSessionCookie(result.token);

    return NextResponse.json({ user: result.user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
