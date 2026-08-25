import { NextRequest, NextResponse } from 'next/server';
import { SubscriptionWebhookService } from '@/services/platform-billing/SubscriptionWebhookService';
import { log } from '@/lib/monitoring/logger';

/**
 * Master spec §36-37: secure payment-provider webhook receiver. Publicly
 * reachable by design (a payment gateway calls this from ITS servers, not
 * from a browser with a session cookie) — the entire security boundary is
 * `SubscriptionWebhookService.handle`'s signature verification against
 * `SUBSCRIPTION_PAYMENT_WEBHOOK_SECRET`, checked before anything in the
 * payload is trusted. Deliberately reads the RAW body (`request.text()`,
 * not `request.json()`) — signature verification must run over the exact
 * bytes the provider signed, not a re-serialized (potentially
 * byte-different) parse of them.
 */
export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text();
    const signature = request.headers.get('x-webhook-signature') ?? '';
    const result = await SubscriptionWebhookService.handle(rawPayload, signature);
    return NextResponse.json(result);
  } catch (error) {
    // Deliberately NOT routed through toErrorResponse: this endpoint has no
    // session/permission errors to map, and a provider's webhook delivery
    // system needs a plain non-2xx status to trigger its own retry — the
    // response body detail those errors carry is for a logged-in human,
    // not for the gateway's retry logic.
    log.error('Subscription webhook processing failed', error);
    return NextResponse.json({ error: 'Webhook rejected.' }, { status: 400 });
  }
}
