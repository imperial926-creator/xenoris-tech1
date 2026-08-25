'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  promoPrice: string | null;
  currency: string;
  billingIntervalMonths: number;
  features: string[];
}

interface OwnerSubscription {
  id: string;
  status: 'INCOMPLETE' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
  plan: { id: string; name: string; features: string[] } | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  gracePeriodEndsAt: string | null;
  paymentMethod: { cardBrand: string | null; lastFour: string | null } | null;
}

const STATUS_LABEL: Record<OwnerSubscription['status'], string> = {
  INCOMPLETE: 'Incomplete — payment not yet confirmed',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment past due — retrying automatically',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<OwnerSubscription['status'], string> = {
  INCOMPLETE: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-green-100 text-green-800',
  PAST_DUE: 'bg-amber-100 text-amber-800',
  SUSPENDED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function BillingBoard({
  initialSubscription,
  plans,
}: {
  initialSubscription: OwnerSubscription | null;
  plans: Plan[];
}) {
  const [subscription, setSubscription] = useState(initialSubscription);
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? '');
  const [checkout, setCheckout] = useState<null | {
    restaurant: { name: string };
    plan: { name: string; features: string[] };
    billing: { price: string; discount: string; tax: string; total: string; currency: string; interval: string };
    checkout: { checkoutUrl?: string; clientSecret?: string } | null;
    gatewayError: string | null;
  }>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveOrPending =
    subscription && ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'].includes(subscription.status);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start checkout.');
      setCheckout(data.checkout);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function cancelSubscription() {
    if (!confirm('Cancel your subscription? Your restaurant account will lose access once the current period ends.')) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/subscription/cancel', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not cancel.');
      setSubscription(data.subscription);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    // Rendered inline further down too, but a top-level banner keeps a
    // gateway/network error visible even once the user scrolls past the
    // control that triggered it.
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Your restaurant&apos;s access to this platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {subscription ? (
            <>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_TONE[subscription.status])}>
                  {STATUS_LABEL[subscription.status]}
                </span>
                {subscription.plan && <span className="text-sm font-medium">{subscription.plan.name}</span>}
              </div>
              {subscription.status === 'PAST_DUE' && subscription.gracePeriodEndsAt && (
                <p className="text-sm text-amber-700">
                  Please update your payment method to prevent interruption of your restaurant account.
                  Grace period ends {new Date(subscription.gracePeriodEndsAt).toLocaleDateString()}.
                </p>
              )}
              {subscription.status === 'SUSPENDED' && (
                <p className="text-sm text-red-700">
                  Your restaurant subscription is currently on hold because your subscription payment
                  could not be completed.
                </p>
              )}
              {subscription.nextBillingDate && (
                <p className="text-sm text-muted-foreground">
                  Next billing date: {new Date(subscription.nextBillingDate).toLocaleDateString()}
                </p>
              )}
              {subscription.paymentMethod?.lastFour && (
                <p className="text-sm text-muted-foreground">
                  Payment method: {subscription.paymentMethod.cardBrand ?? 'Card'} ending in{' '}
                  {subscription.paymentMethod.lastFour}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This restaurant is not yet subscribed. Choose a plan below to get started.
            </p>
          )}
        </CardContent>
        {hasActiveOrPending && subscription?.status !== 'CANCELLED' && (
          <CardFooter className="gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/billing/history">View payment history</Link>
            </Button>
            <Button variant="destructive" onClick={cancelSubscription} disabled={loading}>
              Cancel subscription
            </Button>
          </CardFooter>
        )}
      </Card>

      {!hasActiveOrPending && (
        <Card>
          <CardHeader>
            <CardTitle>Choose a plan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  selectedPlanId === plan.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent',
                )}
              >
                <p className="font-medium">{plan.name}</p>
                {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                <p className="mt-2 text-lg font-semibold">
                  {plan.currency} {plan.promoPrice ?? plan.monthlyPrice}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    / {plan.billingIntervalMonths === 1 ? 'month' : `${plan.billingIntervalMonths} months`}
                  </span>
                </p>
                {plan.features?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {plan.features.map((f) => (
                      <li key={f}>• {f}</li>
                    ))}
                  </ul>
                )}
              </button>
            ))}
          </CardContent>
          <CardFooter>
            <Button onClick={startCheckout} disabled={loading || !selectedPlanId}>
              {loading ? 'Loading...' : 'Subscribe'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {checkout && (
        <Card>
          <CardHeader>
            <CardTitle>Subscription Checkout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Restaurant</span>
              <span>{checkout.restaurant.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span>{checkout.plan.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Billing</span>
              <span>{checkout.billing.interval}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subscription Price</span>
              <span>
                {checkout.billing.currency} {checkout.billing.price}
              </span>
            </div>
            {Number(checkout.billing.discount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span>
                  −{checkout.billing.currency} {checkout.billing.discount}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax/Fees</span>
              <span>
                {checkout.billing.currency} {checkout.billing.tax}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>TOTAL</span>
              <span>
                {checkout.billing.currency} {checkout.billing.total}
              </span>
            </div>
            <div className="flex justify-between pt-1 text-muted-foreground">
              <span>Payment Method</span>
              <span>Credit/Debit Card</span>
            </div>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            {checkout.checkout?.checkoutUrl ? (
              <Button asChild>
                <a href={checkout.checkout.checkoutUrl}>Continue to Secure Payment</a>
              </Button>
            ) : (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {checkout.gatewayError ??
                  'Secure payment is not available yet — the SaaS Owner has not finished connecting a payment provider.'}
              </div>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
