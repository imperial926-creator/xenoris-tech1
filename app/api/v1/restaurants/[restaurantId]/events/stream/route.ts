import { NextRequest, NextResponse } from 'next/server';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import { getCustomerSession } from '@/lib/customer-auth/guard';
import { prisma } from '@/lib/db/prisma';
import { toErrorResponse } from '@/lib/utils/api-error';
import { log } from '@/lib/monitoring/logger';

/**
 * CAPP Phase 7 — the real-time sync stream (spec § 43), design decided in
 * docs/customer-app/architecture.md § 6: a short-interval poll of the
 * `RealtimeEvent` outbox, pushed to the client as real Server-Sent Events
 * over one open connection. That design was written in Phase 1 but never
 * actually built — this route (and lib/realtime/emit.ts's writer) is the
 * first real implementation. See architecture.md § 16 for the full record.
 *
 * Unlike every other bearer-auth customer route, authentication here is
 * OPTIONAL, not required: `getCustomerSession` returns `null` for a missing
 * or invalid token instead of throwing (see lib/customer-auth/guard.ts), and
 * this route treats that as a valid state rather than a 401. A signed-in
 * diner receives both broadcast events (e.g. `MenuItemAvailabilityChanged`,
 * addressed to nobody in particular) and their own personal events (their
 * own `OrderAccepted`, filtered by `RealtimeEvent.customerAccountId` —
 * never another diner's). An anonymous browser receives only the broadcast
 * events — a diner looking at the menu before creating an account still
 * needs to see availability change live.
 */

// Short enough to feel live (see architecture.md § 6's "the event still
// reaches the client as a real server-push... only the outbox-to-SSE hand
// -off is poll-based" framing), long enough not to hammer the DB per open
// connection.
const POLL_INTERVAL_MS = 3000;
// Comment-only ping so intermediary proxies/load balancers don't treat a
// quiet connection as idle and close it.
const KEEPALIVE_INTERVAL_MS = 20000;
// This route has no long-running server process behind it — it's a plain
// Next.js Route Handler, so a connection can't stay open forever without
// risking a platform-enforced execution-time cutoff. Closing cleanly here
// (rather than being killed mid-write) lets a standards-compliant
// `EventSource` reconnect on its own, resuming via `Last-Event-ID` below —
// so this cap is invisible to the app as anything other than a brief
// reconnect, not a real interruption of "live".
const MAX_CONNECTION_MS = 4 * 60 * 1000;
const MAX_EVENTS_PER_POLL = 50;

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { restaurantId: string } },
) {
  let organizationId: string;
  try {
    ({ organizationId } = await RestaurantDirectoryService.resolveStorefront(params.restaurantId));
  } catch (error) {
    return toErrorResponse(error);
  }

  // Optional auth — see this file's header comment for why this route
  // alone doesn't call requireCustomerAuthenticated.
  const session = await getCustomerSession(request);
  const customerAccountId = session?.customerAccountId ?? null;

  // Resume from where a reconnecting EventSource left off (it sends back
  // the last `id:` field this route ever gave it) rather than replaying
  // this restaurant's whole event history or, worse, silently dropping
  // whatever happened during the gap. Falls back to "now" for a first-time
  // connection or an id this outbox no longer recognizes.
  let cursor: { createdAt: Date; id: string } = { createdAt: new Date(), id: '' };
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) {
    const last = await prisma.realtimeEvent.findUnique({
      where: { id: lastEventId },
      select: { createdAt: true, id: true },
    });
    if (last) cursor = last;
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client already disconnected between our check and this
          // write — cleanup() below will catch up via the abort listener.
          closed = true;
        }
      };

      const poll = async () => {
        if (closed) return;
        try {
          const events = await prisma.realtimeEvent.findMany({
            where: {
              organizationId,
              // Broadcast events (customerAccountId: null) always match;
              // a personal event only matches for the diner it's addressed
              // to. When nobody is signed in, the second branch of this OR
              // is simply never satisfiable (no valid customerAccountId to
              // compare against), so only broadcasts get through.
              OR: [{ customerAccountId: null }, ...(customerAccountId ? [{ customerAccountId }] : [])],
              AND: [
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                },
              ],
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: MAX_EVENTS_PER_POLL,
          });

          for (const event of events) {
            enqueue(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
            cursor = { createdAt: event.createdAt, id: event.id };
          }
        } catch (error) {
          // Never let one failed poll kill the connection — the next
          // interval tick just tries again from the same cursor.
          log.error('realtime event stream poll failed', error, { organizationId });
        }
      };

      const cleanup = () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(keepAliveTimer);
        clearTimeout(closeTimer);
      };

      enqueue(': connected\n\n');
      void poll();
      const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
      const keepAliveTimer = setInterval(() => enqueue(': keep-alive\n\n'), KEEPALIVE_INTERVAL_MS);
      const closeTimer = setTimeout(() => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by the client — nothing left to do.
        }
      }, MAX_CONNECTION_MS);

      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable response buffering on nginx-fronted deployments — without
      // this, events can sit in a proxy buffer instead of reaching the
      // client as they're written.
      'X-Accel-Buffering': 'no',
    },
  });
}
