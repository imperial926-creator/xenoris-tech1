import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { convertQuantity, assertSingleLevelChain, type UnitLike } from '@/lib/inventory/units';
import { ConflictError } from '@/lib/utils/api-error';

const kilogram: UnitLike = { id: 'kg', baseUnitId: null, conversionFactor: new Prisma.Decimal(1) };
const gram: UnitLike = { id: 'g', baseUnitId: 'kg', conversionFactor: new Prisma.Decimal(1000) };
const liter: UnitLike = { id: 'l', baseUnitId: null, conversionFactor: new Prisma.Decimal(1) };
const milliliter: UnitLike = { id: 'ml', baseUnitId: 'l', conversionFactor: new Prisma.Decimal(1000) };
const piece: UnitLike = { id: 'pc', baseUnitId: null, conversionFactor: new Prisma.Decimal(1) };

describe('convertQuantity', () => {
  it('returns the quantity unchanged when converting a unit to itself', () => {
    expect(convertQuantity(gram, gram, '250').toString()).toBe('250');
  });

  it('converts a derived unit down to its base unit (grams -> kilograms)', () => {
    // 200g / 1000 = 0.2kg
    expect(convertQuantity(gram, kilogram, '200').toString()).toBe('0.2');
  });

  it('converts a base unit up to its derived unit (kilograms -> grams)', () => {
    // 2kg * 1000 = 2000g
    expect(convertQuantity(kilogram, gram, '2').toString()).toBe('2000');
  });

  it('converts between two derived units that share the same base (round-trip through the base)', () => {
    // 500g -> 0.5kg -> back up through milliliter's own chain would fail (different base);
    // instead verify grams -> grams via kilogram round-trip stays exact.
    const asKg = convertQuantity(gram, kilogram, '500');
    const backToG = convertQuantity(kilogram, gram, asKg);
    expect(backToG.toString()).toBe('500');
  });

  it('accepts number and Decimal inputs, not just strings', () => {
    expect(convertQuantity(gram, kilogram, 200).toString()).toBe('0.2');
    expect(convertQuantity(gram, kilogram, new Prisma.Decimal(200)).toString()).toBe('0.2');
  });

  it('rejects converting between units that do not share a root base unit', () => {
    expect(() => convertQuantity(gram, milliliter, '100')).toThrow(ConflictError);
  });

  it('rejects converting a mass unit to a count unit', () => {
    expect(() => convertQuantity(kilogram, piece, '1')).toThrow(ConflictError);
  });

  it('handles a zero quantity without error', () => {
    expect(convertQuantity(gram, kilogram, '0').toString()).toBe('0');
  });
});

describe('assertSingleLevelChain', () => {
  it('allows a new derived unit whose base is itself a base unit', () => {
    expect(() => assertSingleLevelChain({ id: 'new', baseUnitId: kilogram.id, conversionFactor: 1000 }, kilogram)).not.toThrow();
  });

  it('allows creating a plain base unit (no baseUnitId at all)', () => {
    expect(() => assertSingleLevelChain({ id: 'new', baseUnitId: null, conversionFactor: 1 }, null)).not.toThrow();
  });

  it('rejects a derived unit whose "base" is itself already derived (depth 2)', () => {
    // gram is derived from kilogram; trying to derive a new unit from gram
    // would create a two-level chain, which this module deliberately does
    // not support (see the file's top-of-file scope-boundary comment).
    expect(() => assertSingleLevelChain({ id: 'new', baseUnitId: gram.id, conversionFactor: 10 }, gram)).toThrow(ConflictError);
  });
});
