import { describe, it, expect } from 'vitest';
import { canSeatParty, selectTables, type AssignableTable } from '@/lib/utils/table-assignment';

function table(id: string, capacity: number, sectionName: string | null = null): AssignableTable {
  return { id, capacity, section: sectionName ? { name: sectionName } : null };
}

describe('selectTables', () => {
  it('picks the smallest single table that fits the party', () => {
    const tables = [table('small', 2), table('medium', 4), table('large', 8)];
    const result = selectTables(tables, 3, undefined);
    expect(result).toEqual({ tableIds: ['medium'], preferenceHonored: false });
  });

  it('combines tables when no single table is big enough', () => {
    const tables = [table('a', 2), table('b', 2), table('c', 2)];
    const result = selectTables(tables, 5, undefined);
    // Greedy accumulation in list order: a(2) + b(2) = 4, still short; + c(2) = 6, meets 5.
    expect(result).toEqual({ tableIds: ['a', 'b', 'c'], preferenceHonored: false });
  });

  it('returns null when even every table combined cannot seat the party', () => {
    const tables = [table('a', 2), table('b', 2)];
    expect(selectTables(tables, 10, undefined)).toBeNull();
  });

  it('honors a matching seating preference (case-insensitive substring)', () => {
    const tables = [table('indoor-1', 4, 'Main Hall'), table('patio-1', 4, 'Outdoor Patio')];
    const result = selectTables(tables, 2, 'outdoor');
    expect(result).toEqual({ tableIds: ['patio-1'], preferenceHonored: true });
  });

  it('falls back to any available table (and reports it) when the preference has no room', () => {
    const tables = [table('indoor-1', 4, 'Main Hall')];
    const result = selectTables(tables, 2, 'outdoor patio');
    expect(result).toEqual({ tableIds: ['indoor-1'], preferenceHonored: false });
  });

  it('falls back when the preference matches tables that exist but cannot fit the party', () => {
    const tables = [table('patio-1', 2, 'Outdoor Patio'), table('hall-1', 8, 'Main Hall')];
    // Patio matches the preference but only seats 2; party of 6 must fall back.
    const result = selectTables(tables, 6, 'outdoor');
    expect(result).toEqual({ tableIds: ['hall-1'], preferenceHonored: false });
  });

  it('treats tables with no section as never matching a preference', () => {
    const tables = [table('unassigned', 4, null)];
    const result = selectTables(tables, 2, 'outdoor');
    expect(result).toEqual({ tableIds: ['unassigned'], preferenceHonored: false });
  });
});

describe('canSeatParty', () => {
  it('mirrors selectTables success/failure without a preference', () => {
    expect(canSeatParty([table('a', 4)], 4)).toBe(true);
    expect(canSeatParty([table('a', 4)], 5)).toBe(false);
    expect(canSeatParty([], 1)).toBe(false);
  });
});
