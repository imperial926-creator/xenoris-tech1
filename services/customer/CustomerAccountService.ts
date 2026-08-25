import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  createCustomerAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '@/lib/customer-auth/session';
import { writeAuditLog } from '@/lib/audit/log';
import { ConflictError, NotFoundError } from '@/lib/utils/api-error';
import { CustomerUnauthenticatedError } from '@/lib/customer-auth/guard';
import type {
  CustomerLoginInput,
  CustomerRegisterInput,
} from '@/lib/validation/customer-auth';

export interface CustomerAuthResult {
  accessToken: string;
  refreshToken: string;
  customer: {
    id: string;
    email: string | null;
    firstName: string;
    lastName: string | null;
  };
}

/**
 * Owns CustomerAccount — the platform-wide customer identity used by the
 * mobile app, deliberately separate from the staff `User`/RBAC model. See
 * docs/customer-app/architecture.md § 3–4 for the full reasoning.
 *
 * Audit-log note: `writeAuditLog` (lib/audit/log.ts) requires an
 * organizationId because `audit_logs` is an org-scoped table — appropriate
 * for staff actions, but CustomerAccount register/login/refresh/logout are
 * platform-wide and have no organization at the point they happen. They are
 * intentionally NOT written to audit_logs rather than forced in with a fake
 * or arbitrary organizationId. `getOrCreateCustomerProfile` below, which
 * *is* org-scoped (it creates a `Customer` CRM row), does audit-log — see
 * that method.
 */
export class CustomerAccountService {
  static async register(
    input: CustomerRegisterInput,
    context: { deviceInfo?: string | null },
  ): Promise<CustomerAuthResult> {
    const existing = await prisma.customerAccount.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError('An account already exists with that email.');
    }

    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.customerAccount.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          marketingOptIn: input.marketingOptIn,
          termsAcceptedAt: now,
          privacyAcceptedAt: now,
        },
      });
      // Every account gets a notification-preference row up front (defaults
      // defined on the model itself) so downstream notification code
      // (Phase 9) never has to special-case "preferences not set yet".
      await tx.customerNotificationPreference.create({
        data: { customerAccountId: created.id },
      });
      return created;
    });

    return this.issueTokenPair(account.id, account.email, context.deviceInfo ?? null);
  }

  static async login(
    input: CustomerLoginInput,
    context: { deviceInfo?: string | null },
  ): Promise<CustomerAuthResult> {
    const account = await prisma.customerAccount.findUnique({ where: { email: input.email } });
    // Same generic "Account" message on both "no such email" and "wrong
    // password" — do not reveal whether an email is registered.
    if (!account || !account.passwordHash || account.status !== 'ACTIVE') {
      throw new NotFoundError('Account');
    }
    const passwordOk = await verifyPassword(input.password, account.passwordHash);
    if (!passwordOk) {
      throw new NotFoundError('Account');
    }
    return this.issueTokenPair(account.id, account.email, context.deviceInfo ?? null);
  }

  /**
   * Rotation-on-use: the presented refresh token is revoked and a brand-new
   * refresh+access pair issued, rather than re-using the same refresh token.
   * This makes a stolen-and-replayed refresh token detectable — if the
   * legitimate device later presents the same (now-revoked) token, that's a
   * signal the token was compromised (a real implementation would revoke
   * the whole family / alert here; this phase just refuses the reuse, which
   * already blocks the attack from silently continuing).
   */
  static async refresh(refreshToken: string): Promise<CustomerAuthResult> {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await prisma.customerRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new CustomerUnauthenticatedError();
    }
    const account = await prisma.customerAccount.findUnique({ where: { id: stored.customerAccountId } });
    if (!account || account.status !== 'ACTIVE') {
      throw new CustomerUnauthenticatedError();
    }

    await prisma.customerRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(account.id, account.email, stored.deviceInfo);
  }

  /** Revokes exactly the refresh token presented — "log out this device". */
  static async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await prisma.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active refresh token for the account — "log out everywhere". */
  static async logoutAll(customerAccountId: string): Promise<void> {
    await prisma.customerRefreshToken.updateMany({
      where: { customerAccountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Lazily links (or creates) the per-organization CRM `Customer` row for a
   * CustomerAccount the first time it interacts with a given restaurant —
   * e.g. placing an order, making a reservation. Mirrors the existing
   * `Customer.userId` optional-link pattern exactly (see schema.prisma).
   * This is the one CustomerAccountService method that touches an
   * org-scoped table, so — unlike register/login/refresh/logout above — it
   * does write an audit_logs entry.
   */
  /**
   * Read-only counterpart to `getOrCreateCustomerProfile` — CAPP Phase 3's
   * "view my reservations" list must never conjure a `Customer` CRM row
   * into existence just because a diner opened the tab (that row is a
   * write with its own audit-logged side effects, appropriate only when an
   * actual reservation/order is being placed). Returns `null` when this
   * CustomerAccount has never interacted with this organization yet — an
   * empty reservation history, not an error.
   */
  static async findCustomerProfile(organizationId: string, customerAccountId: string) {
    return prisma.customer.findFirst({ where: { organizationId, customerAccountId } });
  }

  static async getOrCreateCustomerProfile(organizationId: string, customerAccountId: string) {
    const existing = await prisma.customer.findFirst({
      where: { organizationId, customerAccountId },
    });
    if (existing) return existing;

    const account = await prisma.customerAccount.findUnique({ where: { id: customerAccountId } });
    if (!account) throw new NotFoundError('Account');

    // A CustomerAccount's email/mobile may already exist as a staff-entered
    // walk-in Customer row (e.g. taken over the phone) for this
    // organization; link to that row rather than creating a duplicate.
    const byContact = account.email
      ? await prisma.customer.findFirst({
          where: { organizationId, email: account.email, customerAccountId: null },
        })
      : null;

    if (byContact) {
      const linked = await prisma.customer.update({
        where: { id: byContact.id },
        data: { customerAccountId },
      });
      await writeAuditLog(prisma, {
        organizationId,
        action: 'customer.link_account',
        entityType: 'Customer',
        entityId: linked.id,
        newValue: { customerAccountId },
      });
      return linked;
    }

    const created = await prisma.customer.create({
      data: {
        organizationId,
        customerAccountId,
        firstName: account.firstName,
        lastName: account.lastName,
        email: account.email,
      },
    });
    await writeAuditLog(prisma, {
      organizationId,
      action: 'customer.create_from_account',
      entityType: 'Customer',
      entityId: created.id,
      newValue: { customerAccountId, firstName: created.firstName, email: created.email },
    });
    return created;
  }

  private static async issueTokenPair(
    customerAccountId: string,
    email: string | null,
    deviceInfo: string | null,
  ): Promise<CustomerAuthResult> {
    const account = await prisma.customerAccount.findUniqueOrThrow({
      where: { id: customerAccountId },
    });
    const accessToken = await createCustomerAccessToken({ customerAccountId, email });
    const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();

    await prisma.customerRefreshToken.create({
      data: { customerAccountId, tokenHash, deviceInfo, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      customer: {
        id: account.id,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
      },
    };
  }
}
