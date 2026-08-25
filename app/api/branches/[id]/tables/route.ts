import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { toErrorResponse } from '@/lib/utils/api-error';
import { createTableSchema } from '@/lib/validation/table';
import { TableService } from '@/services/tables/TableService';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_VIEW);
    const tables = await TableService.listTables(session.organizationId, params.id);
    return NextResponse.json({ tables });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission(await getSession(), PERMISSIONS.TABLE_MANAGE);
    const body = await request.json();
    const input = createTableSchema.parse(body);
    const table = await TableService.createTable(
      session.organizationId,
      params.id,
      input,
      session.userId,
    );
    return NextResponse.json({ table }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
