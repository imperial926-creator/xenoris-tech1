import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { updateTableStatusSchema } from '@/lib/validation/table';
import { TableService } from '@/services/tables/TableService';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; tableId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_MANAGE);
    const body = await request.json();
    const input = updateTableStatusSchema.parse(body);
    const table = await TableService.updateStatus(
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
