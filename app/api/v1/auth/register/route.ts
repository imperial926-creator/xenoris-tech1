import { NextRequest, NextResponse } from 'next/server';
import { customerRegisterSchema } from '@/lib/validation/customer-auth';
import { CustomerAccountService } from '@/services/customer/CustomerAccountService';
import { toErrorResponse } from '@/lib/utils/api-error';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = customerRegisterSchema.parse(body);
    const result = await CustomerAccountService.register(input, {
      deviceInfo: input.deviceInfo ?? request.headers.get('user-agent'),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
