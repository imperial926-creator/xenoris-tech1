import { z } from 'zod';

// Unlike lib/validation/auth.ts's registerSchema (which creates an
// Organization), this creates a CustomerAccount — a platform-wide identity
// with no organization/branch attached. See
// docs/customer-app/architecture.md § 3 for why these are separate models.
//
// Phase 1 scope note: the spec (§ 6/§ 7) allows registering with email OR
// mobile number, and `CustomerAccount.mobile` already exists in the schema
// for it — but mobile registration only makes sense paired with a working
// OTP provider (lib/customer-auth/OtpProvider.ts), which is an unconfigured
// seam this phase. Requiring email here (not mobile) is a scope decision,
// not an oversight; mobile+OTP registration is a later-phase addition, not
// a new migration.
export const customerRegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60).optional(),
  marketingOptIn: z.boolean().default(false),
  // Registration is also acceptance of terms/privacy policy — the app can't
  // submit this form without both being true; these timestamps back that up.
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service to register.' }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Privacy Policy to register.' }),
  }),
  deviceInfo: z.string().trim().max(200).optional(),
});
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

export const customerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required.'),
  deviceInfo: z.string().trim().max(200).optional(),
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export const customerRefreshSchema = z.object({
  refreshToken: z.string().trim().min(1),
});
export type CustomerRefreshInput = z.infer<typeof customerRefreshSchema>;

export const customerLogoutSchema = z.object({
  refreshToken: z.string().trim().min(1),
});
export type CustomerLogoutInput = z.infer<typeof customerLogoutSchema>;
