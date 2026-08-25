'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PaymentAnalytics {
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  refunds: number;
  recoveredPayments: number;
  paymentSuccessRate: number;
  paymentFailureRate: number;
  paymentRecoveryRate: number;
  averagePaymentValue: string;
  grossRevenue: string;
  netRevenue: string;
}
interface SubscriptionAnalytics {
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  suspendedSubscriptions: number;
  cancelledSubscriptions: number;
  newSubscriptionsLast30Days: number;
  cancellationsLast30Days: number;
  churnRate: number;
  mrr: string;
  arr: string;
  averageRevenuePerRestaurant: string;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

// Master spec §44/§46/§47.
export default function PlatformAdminAnalyticsPage() {
  const [payments, setPayments] = useState<PaymentAnalytics | null>(null);
  const [subs, setSubs] = useState<SubscriptionAnalytics | null>(null);

  useEffect(() => {
    fetch('/api/platform-admin/analytics/payments').then((r) => r.json()).then((d) => setPayments(d.analytics));
    fetch('/api/platform-admin/analytics/subscriptions').then((r) => r.json()).then((d) => setSubs(d.analytics));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>

      <Card>
        <CardHeader>
          <CardTitle>Subscription Revenue</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {subs && (
            <>
              <Stat label="MRR" value={`₱${subs.mrr}`} />
              <Stat label="ARR" value={`₱${subs.arr}`} />
              <Stat label="Active Subscriptions" value={subs.activeSubscriptions} />
              <Stat label="Avg Revenue / Restaurant" value={`₱${subs.averageRevenuePerRestaurant}`} />
              <Stat label="Past Due" value={subs.pastDueSubscriptions} />
              <Stat label="Suspended" value={subs.suspendedSubscriptions} />
              <Stat label="New (30d)" value={subs.newSubscriptionsLast30Days} />
              <Stat label="Churn Rate" value={`${subs.churnRate}%`} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {payments && (
            <>
              <Stat label="Total Payments" value={payments.totalPayments} />
              <Stat label="Success Rate" value={`${payments.paymentSuccessRate}%`} />
              <Stat label="Failure Rate" value={`${payments.paymentFailureRate}%`} />
              <Stat label="Recovery Rate" value={`${payments.paymentRecoveryRate}%`} />
              <Stat label="Gross Revenue" value={`₱${payments.grossRevenue}`} />
              <Stat label="Net Revenue" value={`₱${payments.netRevenue}`} />
              <Stat label="Avg Payment Value" value={`₱${payments.averagePaymentValue}`} />
              <Stat label="Refunds" value={payments.refunds} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
