import type { ItemStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';

export type StaffRequestView = {
  id: string;
  number: number;
  branchId: string;
  gateId: string;
  gateName: string;
  open: boolean;
  etaSeconds: number | null;
  locationAt: string | null;
  arrivedAt: string | null;
  verifiedAt: string | null;
  requesterName: string;
  items: { itemId: string; studentId: string; studentName: string; classroomName: string; status: ItemStatus }[];
};

export type OwnerRequestView = {
  id: string;
  number: number;
  gateName: string;
  open: boolean;
  etaSeconds: number | null;
  items: { itemId: string; studentId: string; studentName: string; status: ItemStatus }[];
};

export type BoardEntry = { number: number; gateName: string; status: 'PREPARING' | 'READY' | 'GONE' };

const include = {
  items: { include: { student: { include: { classroom: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.PickupRequestInclude;

export type RequestForViews = Prisma.PickupRequestGetPayload<{ include: typeof include }> & {
  gate: { name: string };
  requester: { name: string };
};

/** One include for items/students/classrooms; gate and requester have no Prisma relation, so they are fetched in parallel. */
export async function loadRequestForViews(requestId: string): Promise<RequestForViews | null> {
  const r = await prisma.pickupRequest.findUnique({ where: { id: requestId }, include });
  if (!r) return null;
  const [gate, requester] = await Promise.all([
    prisma.gate.findUnique({ where: { id: r.gateId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: r.requesterId }, select: { name: true } }),
  ]);
  return { ...r, gate: { name: gate?.name ?? '' }, requester: { name: requester?.name ?? '' } };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toStaffView(r: RequestForViews): StaffRequestView {
  return {
    id: r.id,
    number: r.number,
    branchId: r.branchId,
    gateId: r.gateId,
    gateName: r.gate.name,
    open: r.open,
    etaSeconds: r.etaSeconds,
    locationAt: iso(r.locationAt),
    arrivedAt: iso(r.arrivedAt),
    verifiedAt: iso(r.verifiedAt),
    requesterName: r.requester.name,
    items: r.items.map((i) => ({
      itemId: i.id,
      studentId: i.studentId,
      studentName: i.student.fullName,
      classroomName: i.student.classroom.name,
      status: i.status,
    })),
  };
}

export function toOwnerView(r: RequestForViews): OwnerRequestView {
  return {
    id: r.id,
    number: r.number,
    gateName: r.gate.name,
    open: r.open,
    etaSeconds: r.etaSeconds,
    items: r.items.map((i) => ({ itemId: i.id, studentId: i.studentId, studentName: i.student.fullName, status: i.status })),
  };
}

/** READY if any item is READY; else PREPARING if any is; else GONE (closed or only en route). */
export function toBoardEntry(r: RequestForViews): BoardEntry {
  let status: BoardEntry['status'] = 'GONE';
  if (r.open) {
    if (r.items.some((i) => i.status === 'READY')) status = 'READY';
    else if (r.items.some((i) => i.status === 'PREPARING')) status = 'PREPARING';
  }
  return { number: r.number, gateName: r.gate.name, status };
}
