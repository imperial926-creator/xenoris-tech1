import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateTableSchema } from '@/lib/validation/table';
import { TableService } from '@/services/tables/TableService';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; tableId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_VIEW);
    const table = await TableService.getTable(session.organizationId, params.id, params.tableId);
    return NextResponse.json({ table });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; tableId: string } },
) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_MANAGE);
    const body = await request.json();
    const input = updateTableSchema.parse(body);
    const table = await TableService.updateTable(
      session.organizationId,
      params.id,
      params.tableId,
      input,
      session.userId,
    );
    return NextResponse.json({ table });
  } catch (error) {
    return toErrorResponse(error);
  }
}
