import { NextRequest, NextResponse } from 'next/server';
import { customerLogoutSchema } from '@/lib/validation/customer-auth';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { toErrorResponse } from '@/lib/utils/api-error';

// Revokes exactly one device's refresh token — "log out this device". Takes
// the refresh token in the body (not the access token / Authorization
// header) because that's the credential actually being revoked; the access
// token simply expires on its own within CUSTOMER_ACCESS_TTL_SECONDS.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = customerLogoutSchema.parse(body);
    await CustomerAccountService.logout(input.refreshToken);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
