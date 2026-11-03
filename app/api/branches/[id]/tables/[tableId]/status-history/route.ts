import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { TableService } from '@/services/tables/TableService';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; tableId: string }> }
) {
  const params = await props.params;
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_VIEW);
    const history = await TableService.getStatusHistory(
      session.organizationId,
      params.id,
      params.tableId,
    );
    return NextResponse.json({ history });
  } catch (error) {
    return toErrorResponse(error);
  }
}
