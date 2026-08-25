import { z } from 'zod';

// Registration creates a brand-new Organization plus its first user, who is
// granted the OWNER role. This is the "sign up my restaurant" flow. Inviting
// additional staff into an existing organization is a separate, permissioned
// flow (user:manage) added alongside Phase 2 staff management UI — not part
// of this open self-registration schema.
export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  organizationEmail: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  currency: z.string().trim().length(3).default('PHP'),
  timezone: z.string().trim().min(1).default('Asia/Manila'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required.'),
  // A user's email is only unique per-organization, so login must disambiguate
  // which organization they're signing into.
  organizationEmail: z.string().trim().toLowerCase().email(),
});
export type LoginInput = z.infer<typeof loginSchema>;
