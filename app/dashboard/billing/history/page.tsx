import { getSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { PERMISSIONS } from '@/lib/auth/constants';
import { PlatformInvoiceService } from '@/services/platform-billing/PlatformInvoiceService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Master spec §48: restaurant owner's own payment history/invoices/
// receipts — "only permitted non-sensitive payment information."
export default async function BillingHistoryPage() {
  const session = await requirePermission(await getSession(), PERMISSIONS.BILLING_VIEW);
  const invoices = await PlatformInvoiceService.listForOrganization(session.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment History</h1>
        <p className="text-sm text-muted-foreground">Every subscription invoice issued to this restaurant.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Invoice #</th>
                  <th className="py-2">Billing Period</th>
                  <th className="py-2">Total</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Issued</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{inv.invoiceNumber}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(inv.billingPeriodStart).toLocaleDateString()} –{' '}
                      {new Date(inv.billingPeriodEnd).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      {inv.currency} {inv.total.toString()}
                    </td>
                    <td className="py-2">{inv.status}</td>
                    <td className="py-2 text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
