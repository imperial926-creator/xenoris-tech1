import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateTableSectionSchema } from '@/lib/validation/table';
import { TableService } from '@/services/tables/TableService';

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string; sectionId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_MANAGE);
    const body = await request.json();
    const input = updateTableSectionSchema.parse(body);
    const section = await TableService.updateSection(
      session.organizationId,
      params.id,
      params.sectionId,
      input,
      session.userId,
    );
    return NextResponse.json({ section });
  } catch (error) {
    return toErrorResponse(error);
  }
}
