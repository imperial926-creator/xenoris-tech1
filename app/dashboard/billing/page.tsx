import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { SubscriptionService } from '@/services/platform-billing/SubscriptionService';
import { SubscriptionPlanService } from '@/services/platform-billing/SubscriptionPlanService';
import { BillingBoard } from '@/components/billing/billing-board';

// Master spec §54: restaurant owner dashboard's "extremely simple"
// subscription entry point. Deliberately shows ONLY [SUBSCRIBE] / current
// plan + status — never merchant info, bank account, or settlement
// details (see BillingBoard and SubscriptionService.toOwnerFacingSubscription
// for where that's structurally enforced, not just a UI choice).
export default async function BillingPage() {
  const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
  const [subscription, plans] = await Promise.all([
    SubscriptionService.getForOrganization(session.organizationId),
    SubscriptionPlanService.listActive(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your restaurant&apos;s own subscription to this platform. No bank transfer instructions,
          no merchant information — just a card payment that renews automatically.
        </p>
      </div>
      <BillingBoard
        initialSubscription={subscription}
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          monthlyPrice: p.monthlyPrice.toFixed(2),
          promoPrice: p.promoPrice ? p.promoPrice.toFixed(2) : null,
          currency: p.currency,
          billingIntervalMonths: p.billingIntervalMonths,
          features: p.features as string[],
        }))}
      />
    </div>
  );
}
