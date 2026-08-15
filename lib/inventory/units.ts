import { Prisma } from '@prisma/client';
import { ConflictError } from '@/lib/utils/api-error';

// Master spec §13 lists a bare `units` table with no further detail. This
// module implements the single-level conversion chain schema.prisma's
// "Phase 9 — Inventory" comment block (#3) documents: a "base" unit has
// baseUnitId = null; a "derived" unit points at exactly one base unit with
// a conversionFactor (how many of the derived unit equal one base unit —
// e.g. Gram.conversionFactor = 1000 with Gram.baseUnitId = Kilogram.id).
// Pure, DB-free arithmetic on purpose, same "the algorithm is testable in
// isolation" discipline as lib/crm/rfm.ts — InventoryService fetches the
// Unit rows and hands them here.

export interface UnitLike {
  id: string;
  baseUnitId: string | null;
  conversionFactor: Prisma.Decimal | string | number;
}

/** A derived unit's own base must itself be a base unit (depth capped at 1). */
export function assertSingleLevelChain(unit: UnitLike, baseUnit: UnitLike | null): void {
  if (unit.baseUnitId && baseUnit && baseUnit.baseUnitId) {
    throw new ConflictError(
      'A unit\'s base unit must itself be a base unit (depth 1) — chained conversions are not supported.',
    );
  }
}

/** Returns the id of the "root" base unit a given unit is expressed in terms of (itself, if it is already a base unit). */
function rootBaseId(unit: UnitLike): string {
  return unit.baseUnitId ?? unit.id;
}

function toBaseQuantity(unit: UnitLike, quantity: Prisma.Decimal): Prisma.Decimal {
  if (!unit.baseUnitId) return quantity;
  return quantity.dividedBy(new Prisma.Decimal(unit.conversionFactor));
}

function fromBaseQuantity(unit: UnitLike, baseQuantity: Prisma.Decimal): Prisma.Decimal {
  if (!unit.baseUnitId) return baseQuantity;
  return baseQuantity.times(new Prisma.Decimal(unit.conversionFactor));
}

/**
 * Converts `quantity` expressed in `fromUnit` into the equivalent quantity
 * expressed in `toUnit`. Both units must share the same root base unit (or
 * be the same unit) — e.g. converting grams to kilograms works because
 * both ultimately relate to the same base; converting grams to milliliters
 * does not, and throws, since nothing in this schema says how dense the
 * ingredient is.
 */
export function convertQuantity(fromUnit: UnitLike, toUnit: UnitLike, quantity: Prisma.Decimal | string | number): Prisma.Decimal {
  const qty = new Prisma.Decimal(quantity);
  if (fromUnit.id === toUnit.id) return qty;
  if (rootBaseId(fromUnit) !== rootBaseId(toUnit)) {
    throw new ConflictError(
      `Cannot convert between incompatible units (ids ${fromUnit.id} and ${toUnit.id} do not share a base unit).`,
    );
  }
  const base = toBaseQuantity(fromUnit, qty);
  return fromBaseQuantity(toUnit, base);
}
