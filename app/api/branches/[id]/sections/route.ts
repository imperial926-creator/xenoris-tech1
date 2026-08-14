import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createTableSectionSchema } from '@/lib/validation/table';
import { TableService } from '@/services/tables/TableService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_VIEW);
    const sections = await TableService.listSections(session.organizationId, params.id);
    return NextResponse.json({ sections });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_MANAGE);
    const body = await request.json();
    const input = createTableSectionSchema.parse(body);
    const section = await TableService.createSection(
      session.organizationId,
      params.id,
      input,
      session.userId,
    );
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
