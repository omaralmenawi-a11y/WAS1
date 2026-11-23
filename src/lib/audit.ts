import type { Prisma } from '@prisma/client';
import { prisma } from './db';

type Db = Pick<Prisma.TransactionClient, 'auditLog'>;

export async function writeAudit(
  a: { schoolId?: string | null; actorId?: string | null; action: string; entity: string; entityId: string; data?: unknown },
  db: Db = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: a.schoolId ?? null,
      actorId: a.actorId ?? null,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      data: (a.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}
