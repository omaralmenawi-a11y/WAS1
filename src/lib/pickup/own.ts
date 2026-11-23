import type { User } from '@prisma/client';
import { prisma } from '../db';
import { NotFound } from '../errors';
import { now, riyadhDay } from '../time';
import { pickupCode, qrPayload } from './code';

/** Current rotating code for the requester's own open request from today. Everyone else sees NotFound. */
export async function getOwnPickupCode(user: User, requestId: string, at: Date = now()): Promise<{ code: string; qr: string; expiresInSec: number }> {
  const req = await prisma.pickupRequest.findUnique({ where: { id: requestId } });
  if (!req || req.requesterId !== user.id || !req.open || req.day.toISOString().slice(0, 10) !== riyadhDay(at).date) throw new NotFound();
  const sec = Math.floor(at.getTime() / 1000);
  return { code: pickupCode(requestId, at), qr: qrPayload(requestId, at), expiresInSec: 60 - (sec % 60) };
}

export type OwnRequestSummary = {
  id: string;
  number: number;
  day: string;
  open: boolean;
  gateName: string;
  createdAt: string;
  childNames: string[];
  deliveredAt: string | null;
  deliveredByName: string | null;
};

export async function listOwnRequests(user: User, opts: { open?: boolean; limit: number }): Promise<OwnRequestSummary[]> {
  const rows = await prisma.pickupRequest.findMany({
    where: { requesterId: user.id, ...(opts.open === undefined ? {} : { open: opts.open }) },
    include: { items: { include: { student: { select: { fullName: true } } }, orderBy: { id: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(opts.limit, 100)),
  });
  const gateIds = [...new Set(rows.map((r) => r.gateId))];
  const staffIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.deliveredById)).filter((x): x is string => !!x))];
  const [gates, staff] = await Promise.all([
    prisma.gate.findMany({ where: { id: { in: gateIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }),
  ]);
  const gateName = new Map(gates.map((g) => [g.id, g.name]));
  const staffName = new Map(staff.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const delivered = r.items.filter((i) => i.status === 'DELIVERED' && i.deliveredAt).sort((x, y) => y.deliveredAt!.getTime() - x.deliveredAt!.getTime())[0];
    return {
      id: r.id,
      number: r.number,
      day: r.day.toISOString().slice(0, 10),
      open: r.open,
      gateName: gateName.get(r.gateId) ?? '',
      createdAt: r.createdAt.toISOString(),
      childNames: r.items.map((i) => i.student.fullName),
      deliveredAt: delivered?.deliveredAt?.toISOString() ?? null,
      deliveredByName: delivered?.deliveredById ? (staffName.get(delivered.deliveredById) ?? null) : null,
    };
  });
}
