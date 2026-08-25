import bcrypt from 'bcryptjs';

// Cost factor 12 per CLAUDE.md security rules — deliberately more expensive
// than bcryptjs's default (10) to raise the cost of offline brute-forcing.
const SALT_ROUNDS = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  if (plainTextPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, passwordHash);
}
