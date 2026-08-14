import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_NAMES,
} from '@/lib/auth/constants';

describe('RBAC constants', () => {
  it('defines default permissions for every role', () => {
    for (const role of ROLE_NAMES) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('grants CUSTOMER no administrative/staff permissions', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
  });

  it('grants OWNER and ADMINISTRATOR every catalog permission', () => {
    const allKeys = PERMISSION_CATALOG.map((p) => p.key).sort();
    expect([...DEFAULT_ROLE_PERMISSIONS.OWNER].sort()).toEqual(allKeys);
    expect([...DEFAULT_ROLE_PERMISSIONS.ADMINISTRATOR].sort()).toEqual(allKeys);
  });

  it('only grants DRIVER delivery-related permissions', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.DRIVER).toEqual(['delivery:manage']);
  });

  it('every default-granted permission exists in the catalog', () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const role of ROLE_NAMES) {
      for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(catalogKeys.has(key)).toBe(true);
      }
    }
  });

  it('has no duplicate permission keys in the catalog', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
