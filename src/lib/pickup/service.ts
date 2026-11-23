import { z } from 'zod';
import { Prisma, type ItemStatus, type PickupItem, type PickupRequest, type Role, type User } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertBranchAccess } from '../authz';
import { Conflict, Forbidden, NotFound, RateLimitError, ValidationError } from '../errors';
import { buildScheduleCtxs, listChildrenForUser, SCHEDULE_INCLUDE } from '../guardian/children';
import { notify } from '../notify';
import { emitPickupChanged } from '../realtime';
import { canRequestNow } from '../schedule';
import { now, riyadhDay } from '../time';
import { checkPickupCode, parseQr } from './code';
import { etaSeconds, haversineMeters } from './eta';
import { nextStatus } from './state';

type Tx = Prisma.TransactionClient;

const ACTIVE: ItemStatus[] = ['EN_ROUTE', 'PREPARING', 'READY'];
const STAFF_ROLES: Role[] = ['STAFF', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN'];
const VERIFY_VALID_MS = 10 * 60_000;
const VERIFY_FAIL_LIMIT = 10;
const VERIFY_FAIL_WINDOW_MS = 5 * 60_000;
const NUMBER_RETRIES = 3;

const dayDate = (at: Date) => new Date(`${riyadhDay(at).date}T00:00:00Z`);

function isUnique(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function requireStaffLike(user: User): void {
  if (!STAFF_ROLES.includes(user.role)) throw new Forbidden();
}

async function loadRequest(id: string): Promise<PickupRequest> {
  const r = await prisma.pickupRequest.findUnique({ where: { id } });
  if (!r) throw new NotFound();
  return r;
}

/** Row lock serialising mutations on one request; returns the fresh row. */
async function lockRequest(tx: Tx, id: string): Promise<PickupRequest> {
  await tx.$queryRaw`SELECT id FROM "PickupRequest" WHERE id = ${id} FOR UPDATE`;
  const r = await tx.pickupRequest.findUnique({ where: { id } });
  if (!r) throw new NotFound();
  return r;
}

const isToday = (req: PickupRequest, at: Date) => req.day.toISOString().slice(0, 10) === riyadhDay(at).date;
const STALE = 'هذا الطلب لم يعد صالحاً';

/** Closes the request when no item is active any more; clears the parent's last location. */
async function closeIfDone(tx: Tx, requestId: string, at: Date): Promise<boolean> {
  const active = await tx.pickupItem.count({ where: { requestId, status: { in: ACTIVE } } });
  if (active > 0) return false;
  await tx.pickupRequest.update({
    where: { id: requestId },
    data: { open: false, closedAt: at, lat: null, lng: null, locationAt: null, etaSeconds: null },
  });
  return true;
}

export async function createRequest(user: User, studentIds: string[], at: Date = now()) {
  if (user.role !== 'GUARDIAN') throw new Forbidden();
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) throw new ValidationError('اختر طالباً واحداً على الأقل');

  const visible = new Set((await listChildrenForUser(user)).map((c) => c.studentId));
  if (ids.some((id) => !visible.has(id))) throw new NotFound();

  const students = await prisma.student.findMany({ where: { id: { in: ids } }, include: SCHEDULE_INCLUDE });
  if (new Set(students.map((s) => s.branchId)).size > 1) throw new ValidationError('لا يمكن جمع أبناء من فروع مختلفة في طلب واحد');
  const first = students[0];

  const school = await prisma.school.findUniqueOrThrow({ where: { id: first.schoolId } });
  const ctxs = await buildScheduleCtxs(students, riyadhDay(at).date);
  for (const s of students) {
    const can = canRequestNow(ctxs.get(s.id)!, school.pickupLeadMin, school.pickupTailMin, at);
    if (!can.ok) throw new ValidationError(`${s.fullName}: ${can.reasonAr}`);
  }

  const youngest = [...students].sort((a, b) => a.classroom.grade.localeCompare(b.classroom.grade, 'ar', { numeric: true }))[0];
  const day = dayDate(at);

  for (let attempt = 1; ; attempt++) {
    try {
      const request = await prisma.$transaction(async (tx) => {
        const stale = await tx.pickupRequest.findMany({
          where: { open: true, day: { lt: day }, items: { some: { studentId: { in: ids }, status: { in: ACTIVE } } } },
          select: { id: true, schoolId: true },
          orderBy: { id: 'asc' },
        });
        for (const st of stale) {
          await lockRequest(tx, st.id);
          await tx.pickupItem.updateMany({
            where: { requestId: st.id, status: { in: ACTIVE } },
            data: { status: 'CANCELLED', cancelledAt: at, cancelReason: 'انتهى اليوم الدراسي' },
          });
          await closeIfDone(tx, st.id, at);
          await writeAudit({ schoolId: st.schoolId, actorId: user.id, action: 'PICKUP_AUTO_CLOSED', entity: 'PickupRequest', entityId: st.id, data: {} }, tx);
        }
        const busy = await tx.pickupItem.findFirst({
          where: { studentId: { in: ids }, status: { in: ACTIVE } },
          include: { student: { select: { fullName: true } }, request: { select: { requesterId: true } } },
        });
        if (busy) {
          const who = await tx.user.findUnique({ where: { id: busy.request.requesterId }, select: { name: true } });
          throw new Conflict(`يوجد طلب نشط لـ${busy.student.fullName} من ${who?.name ?? ''}`);
        }

        const max = await tx.pickupRequest.aggregate({ where: { branchId: first.branchId, day }, _max: { number: true } });
        const created = await tx.pickupRequest.create({
          data: {
            schoolId: first.schoolId,
            branchId: first.branchId,
            gateId: youngest.defaultGateId,
            number: (max._max.number ?? 0) + 1,
            day,
            requesterId: user.id,
            items: { create: ids.map((studentId) => ({ studentId, status: 'EN_ROUTE' as const })) },
          },
          include: { items: true },
        });
        await writeAudit(
          { schoolId: created.schoolId, actorId: user.id, action: 'PICKUP_CREATED', entity: 'PickupRequest', entityId: created.id, data: { number: created.number, studentIds: ids } },
          tx,
        );
        return created;
      });
      await emitPickupChanged(request.id);
      return request;
    } catch (e) {
      if (isUnique(e)) {
        const target = String(e.meta?.target ?? '');
        if (target.includes('number') && attempt < NUMBER_RETRIES) continue;
        if (!target.includes('number')) throw new Conflict('يوجد طلب نشط لأحد الأبناء');
      }
      throw e;
    }
  }
}

export async function advanceItem(staff: User, itemId: string, action: 'PREPARE' | 'READY', at: Date = now()): Promise<PickupItem> {
  requireStaffLike(staff);
  const item = await prisma.pickupItem.findUnique({ where: { id: itemId }, include: { request: true } });
  if (!item) throw new NotFound();
  await assertBranchAccess(staff, item.request.branchId);
  const to = nextStatus(item.status, action);

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, item.requestId);
    const res = await tx.pickupItem.updateMany({
      where: { id: itemId, status: item.status },
      data: action === 'PREPARE' ? { status: to, preparingAt: at } : { status: to, readyAt: at },
    });
    if (res.count !== 1) throw new Conflict('تغيرت حالة العنصر، حدّث الصفحة');
    await writeAudit(
      { schoolId: item.request.schoolId, actorId: staff.id, action: action === 'PREPARE' ? 'ITEM_PREPARING' : 'ITEM_READY', entity: 'PickupItem', entityId: itemId, data: { requestId: item.requestId } },
      tx,
    );
    return tx.pickupItem.findUniqueOrThrow({ where: { id: itemId } });
  });
  if (to === 'READY') await notify([item.request.requesterId], 'ITEM_READY', { requestId: item.requestId, itemId });
  await emitPickupChanged(item.requestId);
  return updated;
}

export async function changeGate(staff: User, requestId: string, gateId: string, at: Date = now()): Promise<void> {
  requireStaffLike(staff);
  const req = await loadRequest(requestId);
  await assertBranchAccess(staff, req.branchId);
  const gate = await prisma.gate.findFirst({ where: { id: gateId, branchId: req.branchId } });
  if (!gate) throw new NotFound();
  await prisma.$transaction(async (tx) => {
    const locked = await lockRequest(tx, requestId);
    if (!locked.open) throw new Conflict('الطلب مغلق');
    await tx.pickupRequest.update({ where: { id: requestId }, data: { gateId } });
    await writeAudit(
      { schoolId: req.schoolId, actorId: staff.id, action: 'GATE_CHANGED', entity: 'PickupRequest', entityId: requestId, data: { from: req.gateId, to: gateId, at: at.toISOString() } },
      tx,
    );
  });
  await emitPickupChanged(requestId);
}

type VerifyInput = { requestId?: string; code: string } | { qr: string };
export type VerifyResult = {
  requestId: string;
  recipient: { name: string; role: Role; photoKey: string | null };
  items: { itemId: string; studentName: string; status: ItemStatus }[];
};

const WRONG_CODE = 'الرمز غير صحيح';

export async function verifyRecipient(staff: User, input: VerifyInput, at: Date = now()): Promise<VerifyResult> {
  requireStaffLike(staff);

  const failures = await prisma.verifyAttempt.count({
    where: { staffId: staff.id, ok: false, createdAt: { gt: new Date(at.getTime() - VERIFY_FAIL_WINDOW_MS), lte: at } },
  });
  if (failures >= VERIFY_FAIL_LIMIT) throw new RateLimitError();
  const fail = async (): Promise<never> => {
    await prisma.verifyAttempt.create({ data: { staffId: staff.id, ok: false, createdAt: at } });
    throw new ValidationError(WRONG_CODE);
  };

  let requestId: string;
  let code: string;
  let method: 'CODE' | 'QR';
  let requested: string | undefined;
  if ('qr' in input) {
    const parsed = parseQr(input.qr);
    if (!parsed) return fail();
    ({ requestId: requested, code } = parsed);
    method = 'QR';
  } else {
    requested = input.requestId;
    code = input.code;
    method = 'CODE';
  }

  if (requested) {
    const req = await prisma.pickupRequest.findUnique({ where: { id: requested } });
    if (!req) return fail();
    await assertBranchAccess(staff, req.branchId);
    if (!isToday(req, at)) throw new ValidationError(STALE);
    if (!req.open || !checkPickupCode(req.id, code, at)) return fail();
    requestId = req.id;
  } else {
    if (!staff.branchId) throw new ValidationError('حدد الطلب لإدخال الرمز');
    const open = await prisma.pickupRequest.findMany({ where: { branchId: staff.branchId, day: dayDate(at), open: true }, select: { id: true } });
    const hits = open.filter((r) => checkPickupCode(r.id, code, at));
    if (hits.length === 0) return fail();
    if (hits.length > 1) throw new ValidationError('تعارض في الرمز، استخدم مسح QR');
    requestId = hits[0].id;
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockRequest(tx, requestId);
    if (!locked.open) throw new ValidationError(WRONG_CODE);
    const req = await tx.pickupRequest.update({
      where: { id: requestId },
      data: { verifiedAt: at, verifiedById: staff.id, verifyMethod: method },
    });
    const [requester, items] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: req.requesterId } }),
      tx.pickupItem.findMany({ where: { requestId }, include: { student: { select: { fullName: true } } }, orderBy: { id: 'asc' } }),
    ]);
    await tx.verifyAttempt.create({ data: { staffId: staff.id, ok: true, createdAt: at } });
    await writeAudit(
      { schoolId: req.schoolId, actorId: staff.id, action: 'RECIPIENT_VERIFIED', entity: 'PickupRequest', entityId: requestId, data: { method } },
      tx,
    );
    return {
      requestId,
      recipient: { name: requester.name, role: requester.role, photoKey: requester.photoKey },
      items: items.map((i) => ({ itemId: i.id, studentName: i.student.fullName, status: i.status })),
    };
  });
  await emitPickupChanged(requestId);
  return result;
}

export async function deliverItems(staff: User, requestId: string, itemIds: string[], at: Date = now()): Promise<void> {
  requireStaffLike(staff);
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) throw new ValidationError('اختر عنصراً واحداً على الأقل');
  const req = await loadRequest(requestId);
  await assertBranchAccess(staff, req.branchId);

  await prisma.$transaction(async (tx) => {
    const cur = await lockRequest(tx, requestId);
    if (!isToday(cur, at)) throw new ValidationError(STALE);
    if (!cur.open) throw new Conflict('الطلب مغلق');
    const age = cur.verifiedAt ? at.getTime() - cur.verifiedAt.getTime() : Infinity;
    if (age < 0 || age > VERIFY_VALID_MS) throw new Conflict('يجب التحقق من المستلم قبل التسليم');
    const res = await tx.pickupItem.updateMany({
      where: { id: { in: ids }, requestId, status: 'READY' },
      data: { status: nextStatus('READY', 'DELIVER'), deliveredAt: at, deliveredById: staff.id },
    });
    if (res.count !== ids.length) throw new Conflict('بعض العناصر غير جاهزة للتسليم');
    await writeAudit(
      { schoolId: req.schoolId, actorId: staff.id, action: 'ITEM_DELIVERED', entity: 'PickupRequest', entityId: requestId, data: { itemIds: ids } },
      tx,
    );
    await closeIfDone(tx, requestId, at);
  });
  await notify([req.requesterId], 'ITEM_DELIVERED', { requestId, itemIds: ids });
  await emitPickupChanged(requestId);
}

export async function cancelRequest(actor: User, requestId: string, reasonAr?: string, at: Date = now()): Promise<void> {
  const req = await loadRequest(requestId);
  let reason: string | null = null;
  if (actor.role === 'GUARDIAN') {
    if (req.requesterId !== actor.id) throw new NotFound();
  } else {
    requireStaffLike(actor);
    await assertBranchAccess(actor, req.branchId);
    reason = reasonAr?.trim() || null;
    if (!reason) throw new ValidationError('سبب الإلغاء مطلوب');
  }

  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const res = await tx.pickupItem.updateMany({
      where: { requestId, status: { in: ACTIVE } },
      data: { status: 'CANCELLED', cancelledAt: at, cancelReason: reason },
    });
    if (res.count === 0) throw new Conflict('لا توجد عناصر نشطة في هذا الطلب');
    await closeIfDone(tx, requestId, at);
    await writeAudit(
      { schoolId: req.schoolId, actorId: actor.id, action: 'PICKUP_CANCELLED', entity: 'PickupRequest', entityId: requestId, data: { reason, cancelled: res.count } },
      tx,
    );
  });
  await notify([req.requesterId], 'PICKUP_CANCELLED', { requestId });
  await emitPickupChanged(requestId);
}

const MAX_ACCURACY_M = 500;
const MIN_LOCATION_INTERVAL_MS = 10_000;
const locationSchema = z.object({
  lat: z.number({ message: 'الموقع غير صالح' }).min(-90, 'الموقع غير صالح').max(90, 'الموقع غير صالح'),
  lng: z.number({ message: 'الموقع غير صالح' }).min(-180, 'الموقع غير صالح').max(180, 'الموقع غير صالح'),
  accuracy: z.number({ message: 'دقة الموقع غير صالحة' }).min(0, 'دقة الموقع غير صالحة'),
});

/** Only the requester may touch a request's trip state; everyone else sees NotFound. */
async function loadOwnRequest(user: User, requestId: string): Promise<PickupRequest> {
  const req = await prisma.pickupRequest.findUnique({ where: { id: requestId } });
  if (!req || req.requesterId !== user.id) throw new NotFound();
  return req;
}

/**
 * Stores the requester's last point (overwriting the previous one) and returns the ETA.
 * Points less accurate than 500 m, or sent within 10 s of the stored one, are not stored.
 * No audit row: location is private and high-frequency.
 */
export async function updateLocation(
  user: User,
  requestId: string,
  input: { lat: number; lng: number; accuracy: number },
  at: Date = now(),
): Promise<{ etaSeconds: number | null }> {
  const p = locationSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message || 'بيانات غير صالحة');
  const { lat, lng, accuracy } = p.data;
  await loadOwnRequest(user, requestId);

  const result = await prisma.$transaction(async (tx) => {
    const cur = await lockRequest(tx, requestId);
    if (!cur.open || !isToday(cur, at)) throw new Conflict(STALE);
    if (accuracy > MAX_ACCURACY_M) return { etaSeconds: cur.etaSeconds, stored: false };
    if (cur.locationAt && at.getTime() - cur.locationAt.getTime() < MIN_LOCATION_INTERVAL_MS) {
      return { etaSeconds: cur.etaSeconds, stored: false };
    }
    const [branch, school] = await Promise.all([
      tx.branch.findUniqueOrThrow({ where: { id: cur.branchId }, select: { lat: true, lng: true } }),
      tx.school.findUniqueOrThrow({ where: { id: cur.schoolId }, select: { etaSpeedKmh: true } }),
    ]);
    const eta =
      branch.lat == null || branch.lng == null
        ? null
        : etaSeconds(haversineMeters({ lat, lng }, { lat: branch.lat, lng: branch.lng }), school.etaSpeedKmh);
    await tx.pickupRequest.update({ where: { id: requestId }, data: { lat, lng, locationAt: at, etaSeconds: eta } });
    return { etaSeconds: eta, stored: true };
  });
  if (result.stored) await emitPickupChanged(requestId);
  return { etaSeconds: result.etaSeconds };
}

/** Requester says "I have arrived". Idempotent: the first arrivedAt is kept. */
export async function markArrived(user: User, requestId: string, at: Date = now()): Promise<void> {
  const req = await loadOwnRequest(user, requestId);
  const changed = await prisma.$transaction(async (tx) => {
    const cur = await lockRequest(tx, requestId);
    if (!cur.open || !isToday(cur, at)) throw new Conflict(STALE);
    if (cur.arrivedAt) return false;
    await tx.pickupRequest.update({ where: { id: requestId }, data: { arrivedAt: at } });
    await writeAudit(
      { schoolId: req.schoolId, actorId: user.id, action: 'PICKUP_ARRIVED', entity: 'PickupRequest', entityId: requestId, data: {} },
      tx,
    );
    return true;
  });
  if (changed) await emitPickupChanged(requestId);
}
