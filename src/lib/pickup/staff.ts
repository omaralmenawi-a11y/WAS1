import type { User } from '@prisma/client';
import { prisma } from '../db';
import { assertBranchAccess } from '../authz';
import { Forbidden, NotFound, ValidationError } from '../errors';
import { now, riyadhDay } from '../time';
import { sortStaffViews } from './staff-client';
import { loadRequestForViews, toStaffView, type StaffRequestView } from './views';

/** Open requests of today for the staff's branch (and gates, when assigned), most actionable first. */
export async function listStaffRequests(
  user: User,
  opts: { q?: string; branchId?: string } = {},
  at: Date = now(),
): Promise<StaffRequestView[]> {
  if (user.role !== 'STAFF' && user.role !== 'SCHOOL_ADMIN' && user.role !== 'PLATFORM_ADMIN') throw new Forbidden();
  let branchId: string;
  if (user.role === 'STAFF') {
    if (!user.branchId) throw new NotFound();
    branchId = user.branchId;
  } else {
    if (!opts.branchId) throw new ValidationError('حدد الفرع');
    await assertBranchAccess(user, opts.branchId);
    branchId = opts.branchId;
  }

  const q = opts.q?.trim();
  const where: Record<string, unknown> = {
    branchId,
    open: true,
    day: new Date(`${riyadhDay(at).date}T00:00:00Z`),
  };
  if (user.role === 'STAFF' && user.gateIds.length > 0) where.gateId = { in: user.gateIds };
  if (q) {
    const num = /^\d+$/.test(q) ? Number(q) : null;
    where.OR = [
      { items: { some: { student: { fullName: { contains: q, mode: 'insensitive' } } } } },
      ...(num !== null && num <= 2_000_000_000 ? [{ number: num }] : []),
    ];
  }

  const rows = await prisma.pickupRequest.findMany({ where, select: { id: true } });
  const loaded = await Promise.all(rows.map((r) => loadRequestForViews(r.id)));
  const views = loaded.filter((r): r is NonNullable<typeof r> => !!r).map(toStaffView);
  return sortStaffViews(views);
}
