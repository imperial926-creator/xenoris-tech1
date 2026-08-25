import { describe, it, expect } from 'vitest';
import { createMenuItemSchema, createModifierGroupSchema } from '@/lib/validation/menu';

describe('menu item price validation', () => {
  const base = { categoryId: 'cat_1', name: 'Test Item' };

  it('accepts a whole-number price', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: '100' });
    expect(result.success).toBe(true);
  });

  it('accepts a price with 2 decimal places', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: '99.99' });
    expect(result.success).toBe(true);
  });

  it('accepts a numeric price and normalizes it to a string', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: 150.5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.price).toBe('150.5');
  });

  it('rejects a price with more than 2 decimal places', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: '99.999' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative price', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: '-10.00' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric price', () => {
    const result = createMenuItemSchema.safeParse({ ...base, price: 'free' });
    expect(result.success).toBe(false);
  });
});

describe('modifier group validation', () => {
  it('accepts a valid SINGLE-selection group', () => {
    const result = createModifierGroupSchema.safeParse({
      name: 'Size',
      selectionType: 'SINGLE',
      minSelect: 1,
      maxSelect: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a SINGLE-selection group with maxSelect > 1', () => {
    const result = createModifierGroupSchema.safeParse({
      name: 'Size',
      selectionType: 'SINGLE',
      maxSelect: 2,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a MULTIPLE-selection group with maxSelect > 1', () => {
    const result = createModifierGroupSchema.safeParse({
      name: 'Add-ons',
      selectionType: 'MULTIPLE',
      minSelect: 0,
      maxSelect: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects minSelect greater than maxSelect', () => {
    const result = createModifierGroupSchema.safeParse({
      name: 'Add-ons',
      selectionType: 'MULTIPLE',
      minSelect: 3,
      maxSelect: 1,
    });
    expect(result.success).toBe(false);
  });
});
