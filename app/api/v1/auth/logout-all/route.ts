import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSession, requireCustomerAuthenticated } from '@/lib/customer-auth/guard';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { toErrorResponse } from '@/lib/utils/api-error';

// "Log out everywhere" (spec § 7) — requires a currently-valid access token
// (identifies which account), then revokes every refresh token on file for
// it, including the one belonging to this very request's device.
export async function POST(request: NextRequest) {
  try {
    const session = requireCustomerAuthenticated(await getCustomerSession(request));
    await CustomerAccountService.logoutAll(session.customerAccountId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
