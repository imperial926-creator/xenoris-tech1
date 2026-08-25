import { NextRequest, NextResponse } from 'next/server';
import { AnomalyDetectionService } from '@/services/platform-analytics/AnomalyDetectionService';
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
    const results = await AnomalyDetectionService.runDailySweep();
    return NextResponse.json({ results });
  } catch (error) {
    log.error('Anomaly sweep cron run failed', error);
    return NextResponse.json({ error: 'Anomaly sweep failed.' }, { status: 500 });
  }
}
