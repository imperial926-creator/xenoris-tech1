import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { NotFoundError, ConflictError } from '@/lib/utils/api-error';
import { getSubscriptionGatewayProvider } from '@/lib/platform-billing/SubscriptionGatewayProvider';
import { writePlatformAuditLog } from '@/lib/platform-admin/audit';
import { ActionCenterService, TASK_TYPES } from './ActionCenterService';
import type { IssueRefundInput } from '@/lib/validation/platform-billing';

/** Master spec §39 — authorized administrators only (enforced by the route handler's requirePlatformAdmin). */
export class PlatformRefundService {
  static async issue(input: IssueRefundInput, platformAdminId: string) {
    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== 'SUCCEEDED') {
      throw new ConflictError('Only a succeeded payment can be refunded.');
    }
    if (!payment.providerPaymentId) {
      throw new ConflictError('Payment has no provider reference to refund against.');
    }

    const gateway = getSubscriptionGatewayProvider();
    const gatewayResult = await gateway.refund({
      providerPaymentId: payment.providerPaymentId,
      amount: input.amount,
    });

    return prisma.$transaction(async (tx) => {
      const refund = await tx.platformRefund.create({
        data: {
          paymentId: payment.id,
          organizationId: payment.organizationId,
          amount: input.amount ?? payment.amount,
          reason: input.reason,
          administratorId: platformAdminId,
          providerReference: gatewayResult.providerReference,
          status: gatewayResult.status === 'succeeded' ? 'SUCCEEDED' : gatewayResult.status === 'failed' ? 'FAILED' : 'PENDING',
          refundedAt: gatewayResult.status === 'succeeded' ? new Date() : null,
        },
      });

      if (gatewayResult.status === 'succeeded') {
        await tx.subscriptionPayment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      }

      await ActionCenterService.createTask(tx, {
        type: TASK_TYPES.REFUND,
        title: `Refund issued for organization ${payment.organizationId}`,
        description: input.reason,
        organizationId: payment.organizationId,
        subscriptionId: payment.subscriptionId,
      });

      await writePlatformAuditLog(tx, {
        platformAdminId,
        action: 'refund.issue',
        entityType: 'PlatformRefund',
        entityId: refund.id,
        newValue: { paymentId: payment.id, amount: refund.amount, reason: input.reason },
      });

      return refund;
    });
  }

  static async listForOrganization(organizationId: string) {
    return prisma.platformRefund.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }
}
