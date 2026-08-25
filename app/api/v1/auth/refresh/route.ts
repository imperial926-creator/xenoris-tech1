import { NextRequest, NextResponse } from 'next/server';
import { customerRefreshSchema } from '@/lib/validation/customer-auth';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { toErrorResponse } from '@/lib/utils/api-error';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = customerRefreshSchema.parse(body);
    const result = await CustomerAccountService.refresh(input.refreshToken);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
