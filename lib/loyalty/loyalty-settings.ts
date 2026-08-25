/**
 * CAPP Phase 10 — spec § 37 "Customer loyalty": points, membership tiers.
 * Reads `Organization.customerAppSettings.loyalty`, the same "JSON column
 * code supplies defaults for" pattern
 * `lib/notifications/customer-app-settings.ts`'s `resolveCustomerNotificationSettings`
 * already established for `customerAppSettings.notifications` — no new
 * schema column for a handful of restaurant-tunable numbers.
 *
 * Spec § 37's "Promotion + loyalty points" vs. "Promotion OR loyalty
 * points... must be configurable" is not a knob this file exposes: this
 * build allows at most one promotion redemption per order (established
 * since CAPP Phase 8 — `OrderService.createOrder` accepts a single
 * `promoCode`), and LOYALTY_REWARD is itself just one `PromotionDiscountType`
 * among the others. With only one discount possible per order regardless of
 * type, "stacking" is structurally always "OR" — making it configurable
 * would require multi-discount-per-order support this codebase doesn't
 * have, which is out of scope this phase. Flagged here, not silently
 * assumed to be solved.
 */

export interface LoyaltyTierThreshold {
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  /** Minimum `LoyaltyAccount.lifetimePoints` to hold this tier. Ascending, starting at 0. */
  minLifetimePoints: number;
}

export interface LoyaltySettings {
  /**
   * Spec § 37 "Points" / "Repeat-order rewards": pesos of net order value
   * (subtotal minus discount — see LoyaltyService.earnPointsForOrder for why
   * tax/delivery fee are excluded) a diner must spend to earn 1 point.
   * Default ₱50 spent = 1 point.
   */
  currencyPerPoint: number;
  /** Ascending by minLifetimePoints; index 0 must be 0 (everyone starts at the base tier). */
  tiers: LoyaltyTierThreshold[];
}

const DEFAULT_TIERS: LoyaltyTierThreshold[] = [
  { tier: 'BRONZE', minLifetimePoints: 0 },
  { tier: 'SILVER', minLifetimePoints: 500 },
  { tier: 'GOLD', minLifetimePoints: 2000 },
  { tier: 'PLATINUM', minLifetimePoints: 5000 },
];

const DEFAULTS: LoyaltySettings = {
  currencyPerPoint: 50,
  tiers: DEFAULT_TIERS,
};

const VALID_TIERS = new Set(DEFAULT_TIERS.map((t) => t.tier));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTierList(value: unknown): value is LoyaltyTierThreshold[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (v): v is LoyaltyTierThreshold =>
      isRecord(v) &&
      typeof v.tier === 'string' &&
      VALID_TIERS.has(v.tier as LoyaltyTierThreshold['tier']) &&
      typeof v.minLifetimePoints === 'number' &&
      Number.isFinite(v.minLifetimePoints),
  );
}

export function resolveLoyaltySettings(customerAppSettings: unknown): LoyaltySettings {
  const raw = isRecord(customerAppSettings) && isRecord(customerAppSettings.loyalty) ? customerAppSettings.loyalty : {};
  const currencyPerPoint =
    typeof raw.currencyPerPoint === 'number' && raw.currencyPerPoint > 0 ? raw.currencyPerPoint : DEFAULTS.currencyPerPoint;
  const tiers = isValidTierList(raw.tiers)
    ? [...raw.tiers].sort((a, b) => a.minLifetimePoints - b.minLifetimePoints)
    : DEFAULTS.tiers;
  return { currencyPerPoint, tiers };
}

/** The highest tier whose threshold `lifetimePoints` meets or exceeds — `tiers` must be ascending (resolveLoyaltySettings guarantees this). */
export function resolveTier(lifetimePoints: number, tiers: LoyaltyTierThreshold[]): LoyaltyTierThreshold['tier'] {
  let current: LoyaltyTierThreshold['tier'] = tiers[0]?.tier ?? 'BRONZE';
  for (const threshold of tiers) {
    if (lifetimePoints >= threshold.minLifetimePoints) current = threshold.tier;
  }
  return current;
}
