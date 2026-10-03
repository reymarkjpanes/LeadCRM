import { PrismaClient } from '@prisma/client';
import { installTenantScoping } from '../core/tenant/tenant-prisma';

// ── Singleton raw Prisma client ───────────────────────
// This is the default export used by all repositories and services.
// It is the standard PrismaClient — full model type safety included.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
installTenantScoping(prisma);

export default prisma;

// ── Tenant-scoped Prisma extension ───────────────────
// Returns a client that auto-injects tenantId on read operations.
// Use in service layer when you want automatic tenant scoping.
// Note: $extends returns an extended client — types differ from raw PrismaClient.
export function createTenantClient(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }: { args: Record<string, unknown>; query: (args: unknown) => unknown }) {
          args.where = { ...(args.where as object ?? {}), tenantId };
          return query(args);
        },
        async findFirst({ args, query }: { args: Record<string, unknown>; query: (args: unknown) => unknown }) {
          args.where = { ...(args.where as object ?? {}), tenantId };
          return query(args);
        },
        async count({ args, query }: { args: Record<string, unknown>; query: (args: unknown) => unknown }) {
          args.where = { ...(args.where as object ?? {}), tenantId };
          return query(args);
        },
      },
    },
  });
}
