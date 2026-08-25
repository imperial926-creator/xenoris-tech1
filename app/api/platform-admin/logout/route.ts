import { NextResponse } from 'next/server';
import { clearPlatformAdminSessionCookie } from '@/lib/platform-admin/session';

export async function POST() {
  await clearPlatformAdminSessionCookie();
  return NextResponse.json({ success: true });
}
