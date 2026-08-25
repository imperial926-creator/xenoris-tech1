import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { requireAuthenticated } from '@/lib/auth/rbac';
import { toErrorResponse } from '@/lib/utils/api-error';
import { ComplaintService } from '@/services/platform-analytics/ComplaintService';
import { prisma } from '@/lib/db/prisma';

const createSchema = z.object({
  category: z.enum(['BILLING', 'TECHNICAL', 'SERVICE_QUALITY', 'FEATURE_REQUEST', 'ACCOUNT', 'OTHER']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
});

// Restaurant-owner-facing complaint intake — "raise a complaint TO the
// SaaS platform" (distinct from CustomerReview, a diner reviewing the
// restaurant). No special permission required beyond being logged in —
// any staff member should be able to flag a problem to the platform.
export async function GET() {
  try {
    const session = requireAuthenticated(await getSession());
    const complaints = await prisma.complaint.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ complaints });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = requireAuthenticated(await getSession());
    const body = createSchema.parse(await request.json());
    const complaint = await ComplaintService.create({
      organizationId: session.organizationId,
      raisedByUserId: session.userId,
      ...body,
    });
    return NextResponse.json({ complaint }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
