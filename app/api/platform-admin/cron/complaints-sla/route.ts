import { NextRequest, NextResponse } from 'next/server';
import { ComplaintService } from '@/services/platform-analytics/ComplaintService';
import { log } from '@/lib/monitoring/logger';

// Same external-scheduler pattern as
// /api/platform-admin/cron/subscription-retries — see that route's header.
export async function POST(request: NextRequest) {
  const expected = process.env.PLATFORM_CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const result = await ComplaintService.escalateOverdue();
    return NextResponse.json(result);
  } catch (error) {
    log.error('Complaint SLA escalation cron run failed', error);
    return NextResponse.json({ error: 'Escalation run failed.' }, { status: 500 });
  }
}
