import { PrismaClient } from '@prisma/client';

// Standard Next.js dev-mode singleton to avoid exhausting Postgres connections
// across hot reloads. See: https://www.prisma.io/docs/guides/nextjs
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
