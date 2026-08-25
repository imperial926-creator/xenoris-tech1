import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { RestaurantDirectoryService } from '@/services/customer/RestaurantDirectoryService';
import type { LogAnalyticsEventInput } from '@/lib/validation/analytics-event';

/**
 * CAPP Phase 11 — the customer-app-facing half of spec § 57 "Analytics."
 * Writes one `CustomerAnalyticsEvent` row per call — see that model's
 * schema.prisma comment for exactly which six event types this covers and
 * why the rest of spec § 57's funnel isn't logged here. Public/optional-auth
 * by design: `customerAccountId` is whatever the caller already resolved
 * from an optional bearer token (or `null` for a not-yet-signed-in diner),
 * mirroring how `RestaurantDirectoryService.getPublicMenu` itself requires
 * no auth — a diner browsing before creating an account still generates
 * real, useful engagement data.
 */
export class CustomerAnalyticsService {
  static async logEvent(publicCode: string, customerAccountId: string | null, input: LogAnalyticsEventInput) {
    const { organizationId } = await RestaurantDirectoryService.resolveStorefront(publicCode);
    await prisma.customerAnalyticsEvent.create({
      data: {
        organizationId,
        customerAccountId,
        eventType: input.eventType,
        menuItemId: input.menuItemId,
        promotionId: input.promotionId,
      },
    });
    // No return value — this is fire-and-forget telemetry from the mobile
    // client's point of view (see MobileScreens' `logAnalyticsEvent` calls,
    // every one of them wrapped in a `.catch(() => {})`); nothing downstream
    // needs the created row's id.
    return { success: true as const };
  }
}
