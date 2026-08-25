import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { SubscriptionService } from '@/services/platform-billing/SubscriptionService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Master spec §13's "Payment Successful" confirmation screen. Note what
// this page does NOT do: it never marks the subscription active itself —
// it only DISPLAYS whatever SubscriptionService.getForOrganization
// currently reports, which only becomes ACTIVE once
// SubscriptionWebhookService has processed a verified webhook (master spec
// §11). A restaurant owner landing here moments before that webhook
// arrives correctly sees "Incomplete", not a lie.
export default async function BillingSuccessPage() {
  const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
  const subscription = await SubscriptionService.getForOrganization(session.organizationId);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment Successful</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Your subscription payment has been submitted for processing.</p>
          {subscription ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span>{subscription.plan?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subscription</span>
                <span>{subscription.status}</span>
              </div>
              {subscription.nextBillingDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Next Billing Date</span>
                  <span>{new Date(subscription.nextBillingDate).toLocaleDateString()}</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              We haven&apos;t received confirmation from the payment provider yet — this page will
              reflect ACTIVE status automatically once it does.
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <Button asChild variant="outline">
              <Link href="/dashboard/billing/history">View Invoice</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
