import type { User } from '@prisma/client';
import { prisma } from '../db';
import { assertBranchAccess, requireRole } from '../authz';
import { NotFound } from '../errors';
import { now, riyadhDay } from '../time';
import { listStaffRequests } from '../pickup/staff';
import { topStatus } from '../pickup/staff-client';
import type { StaffRequestView } from '../pickup/views';
import { describeAudit, PICKUP_AUDIT_ACTIONS } from './audit-text';

export type AuditEvent = { id: string; at: string; action: string; text: string };

export type Dashboard = {
  branch: { id: string; name: string; boardToken: string };
  counts: { open: number; enRoute: number; preparing: number; ready: number; deliveredToday: number };
  avgWaitSecToday: number | null;
  requests: StaffRequestView[];
  recent: AuditEvent[];
};

/** Last pickup events of a branch, newest first, already mapped to Arabic text. */
export async function listBranchAudit(actor: User, branchId: string, limit = 20): Promise<AuditEvent[]> {
  requireRole(actor, 'SCHOOL_ADMIN', 'PLATFORM_ADMIN');
  await assertBranchAccess(actor, branchId);
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { schoolId: true } });
  if (!branch) throw new NotFound();
  const take = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  const rows = await prisma.auditLog.findMany({
    where: {
      schoolId: branch.schoolId,
      action: { in: [...PICKUP_AUDIT_ACTIONS] },
      data: { path: ['branchId'], equals: branchId },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), action: r.action, text: describeAudit(r) }));
}

export async function getDashboard(actor: User, branchId: string, at: Date = now()): Promise<Dashboard> {
  requireRole(actor, 'SCHOOL_ADMIN', 'PLATFORM_ADMIN');
  await assertBranchAccess(actor, branchId);
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true, boardToken: true } });
  if (!branch) throw new NotFound();

  const day = new Date(`${riyadhDay(at).date}T00:00:00Z`);
  const [requests, delivered, recent] = await Promise.all([
    listStaffRequests(actor, { branchId }, at),
    prisma.pickupItem.findMany({
      where: { status: 'DELIVERED', request: { branchId, day } },
      select: { readyAt: true, deliveredAt: true },
    }),
    listBranchAudit(actor, branchId, 20),
  ]);

  const counts = { open: requests.length, enRoute: 0, preparing: 0, ready: 0, deliveredToday: delivered.length };
  for (const r of requests) {
    const s = topStatus(r);
    if (s === 'READY') counts.ready++;
    else if (s === 'PREPARING') counts.preparing++;
    else counts.enRoute++;
  }
  const waits = delivered.flatMap((i) => (i.readyAt && i.deliveredAt ? [(i.deliveredAt.getTime() - i.readyAt.getTime()) / 1000] : []));
  const avgWaitSecToday = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;

  return { branch, counts, avgWaitSecToday, requests, recent };
}
