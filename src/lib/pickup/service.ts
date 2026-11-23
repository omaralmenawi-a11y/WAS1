import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type ItemStatus, type PickupItem, type PickupRequest, type Role, type User } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertBranchAccess } from '../authz';
import { Conflict, Forbidden, NotFound, RateLimitError, ValidationError } from '../errors';
import { buildScheduleCtxs, listChildrenForUser, SCHEDULE_INCLUDE } from '../guardian/children';
import { notify, notifyInBackground } from '../notify';
import { msgCancelled, msgDelivered, msgPreparing, msgReady } from '../notify/messages';
import { linkedGuardianIds } from '../notify/recipients';
import { emitPickupChanged } from '../realtime';
import { canRequestNow } from '../schedule';
import { formatRiyadhTime, now, riyadhDay } from '../time';
import { checkPickupCode, parseQr } from './code';
import { etaSeconds, haversineMeters } from './eta';
import { nextStatus } from './state';

type Tx = Prisma.TransactionClient;

const ACTIVE: ItemStatus[] = ['EN_ROUTE', 'PREPARING', 'READY'];
// Pickup mutations: platform admins have read-only access (lists, dashboard).
const STAFF_ROLES: Role[] = ['STAFF', 'SCHOOL_ADMIN'];
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

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
const statusUrl = (requestId: string) => `/parent/request/${requestId}`;

/** Request number, gate name and items (with student first names) for message building (PickupRequest has no gate relation, so the gate is a second lookup). */
async function loadNotifyCtx(requestId: string) {
  const r = await prisma.pickupRequest.findUnique({
    where: { id: requestId },
    select: {
      number: true,
      requesterId: true,
      gateId: true,
      items: { select: { id: true, status: true, studentId: true, cancelReason: true, student: { select: { fullName: true } } }, orderBy: { id: 'asc' } },
    },
  });
  if (!r) return null;
  const gate = await prisma.gate.findUnique({ where: { id: r.gateId }, select: { name: true } });
  return { number: r.number, requesterId: r.requesterId, gate: gate?.name ?? '', items: r.items.map((i) => ({ ...i, name: firstName(i.student.fullName) })) };
}

/** Post-commit, never awaited, never throws: a slow or failing notification must not delay or fail the mutation. */
const safely = (fn: () => Promise<unknown>): void => notifyInBackground(fn);

/** PREPARING / READY are per item: each names only the child of the item just advanced (N4). */
async function notifyProgress(requestId: string, itemId: string, kind: 'PREPARING' | 'READY'): Promise<void> {
  const ctx = await loadNotifyCtx(requestId);
  if (!ctx) return;
  const item = ctx.items.find((i) => i.id === itemId);
  if (!item) return;
  const args = { names: [item.name], number: ctx.number, gate: ctx.gate };
  const m = kind === 'PREPARING' ? msgPreparing(args) : msgReady(args);
  await notify([ctx.requesterId], { kind, ...m, url: statusUrl(requestId), tag: `${kind}:${itemId}` }, { dedupeKey: (u) => `${kind}:${itemId}:${u}` });
}

async function notifyDelivered(requestId: string, itemIds: string[], at: Date): Promise<void> {
  const ctx = await loadNotifyCtx(requestId);
  if (!ctx) return;
  const items = ctx.items.filter((i) => itemIds.includes(i.id));
  const m = msgDelivered({ names: items.map((i) => i.name), time: formatRiyadhTime(at), gate: ctx.gate });
  const others = await linkedGuardianIds(items.map((i) => i.studentId));
  await notify([ctx.requesterId, ...others], { kind: 'DELIVERED', ...m, url: statusUrl(requestId), tag: `DELIVERED:${requestId}` });
}

/** Names only the items cancelled by this action (N5), and this action's reason. */
async function notifyCancelled(requestId: string, itemIds: string[], reason: string | null): Promise<void> {
  const ctx = await loadNotifyCtx(requestId);
  if (!ctx) return;
  const cancelled = ctx.items.filter((i) => itemIds.includes(i.id));
  const others = await linkedGuardianIds(cancelled.map((i) => i.studentId));
  await notify([ctx.requesterId, ...others], { kind: 'CANCELLED', ...msgCancelled({ number: ctx.number, reason }), url: statusUrl(requestId), tag: `CANCELLED:${requestId}` });
}

export const REVOKED_REASON = 'أُلغي من المدرسة: تغيّرت صلاحية الاستلام';
const NOT_AUTHORISED = 'لم يعد المستلم مخوّلاً باستلام هذا الطالب';

/** Active items of a (locked) request whose student is inactive or no longer linked to the requester's phone. */
async function unlinkedItemIds(tx: Tx, req: PickupRequest): Promise<string[]> {
  const [requester, items] = await Promise.all([
    tx.user.findUnique({ where: { id: req.requesterId }, select: { phone: true } }),
    tx.pickupItem.findMany({
      where: { requestId: req.id, status: { in: ACTIVE } },
      select: { id: true, student: { select: { active: true, phones: { select: { phone: true } } } } },
    }),
  ]);
  const phone = requester?.phone;
  return items.filter((i) => !i.student.active || !phone || !i.student.phones.some((p) => p.phone === phone)).map((i) => i.id);
}

/** What one revocation actually cancelled in a request; collect these and pass them to announceRevoked after commit. */
export type RevokedBatch = { requestId: string; itemIds: string[]; studentIds: string[] };

/** Cancels revoked items of a locked request, closes it when nothing is left, audits. Returns the items it really cancelled. */
async function cancelRevoked(tx: Tx, req: PickupRequest, itemIds: string[], actorId: string | null, at: Date): Promise<RevokedBatch> {
  const rows = await tx.pickupItem.findMany({
    where: { id: { in: itemIds }, requestId: req.id, status: { in: ACTIVE } },
    select: { id: true, studentId: true },
  });
  const ids = rows.map((r) => r.id);
  await tx.pickupItem.updateMany({
    where: { id: { in: ids }, requestId: req.id, status: { in: ACTIVE } },
    data: { status: 'CANCELLED', cancelledAt: at, cancelReason: REVOKED_REASON },
  });
  await closeIfDone(tx, req.id, at);
  await writeAudit(
    { schoolId: req.schoolId, actorId, action: 'PICKUP_CANCELLED', entity: 'PickupRequest', entityId: req.id, data: { reason: REVOKED_REASON, cancelled: ids.length, itemIds: ids, branchId: req.branchId } },
    tx,
  );
  return { requestId: req.id, itemIds: ids, studentIds: [...new Set(rows.map((r) => r.studentId))] };
}

/**
 * Call inside the transaction that changed students' phones or active flag: cancels their active items
 * whose requester is no longer linked. Returns what it cancelled per request; pass the collected batches to announceRevoked once after commit.
 */
export async function revokeUnlinkedItems(tx: Tx, studentIds: string[], actorId: string | null, at: Date = now()): Promise<RevokedBatch[]> {
  if (studentIds.length === 0) return [];
  const rows = await tx.pickupItem.findMany({
    where: { studentId: { in: studentIds }, status: { in: ACTIVE } },
    select: { requestId: true },
    distinct: ['requestId'],
    orderBy: { requestId: 'asc' },
  });
  const touched: RevokedBatch[] = [];
  for (const { requestId } of rows) {
    const req = await lockRequest(tx, requestId);
    const ids = await unlinkedItemIds(tx, req);
    if (ids.length === 0) continue;
    touched.push(await cancelRevoked(tx, req, ids, actorId, at));
  }
  return touched;
}

/**
 * After commit: tell the guardians still linked to the revoked students, and live views, about revocations.
 * Batches are merged per request (one notice per request, even when several students were revoked in separate
 * transactions). A requester who lost the link is not notified; one who is still linked is.
 * Stale auto-closes send nothing.
 */
export async function announceRevoked(batches: RevokedBatch[]): Promise<void> {
  const merged = new Map<string, Set<string>>();
  for (const b of batches) {
    const set = merged.get(b.requestId) ?? new Set<string>();
    b.studentIds.forEach((id) => set.add(id));
    merged.set(b.requestId, set);
  }
  for (const [requestId, studentIds] of merged) {
    await emitPickupChanged(requestId);
    safely(async () => {
      const ctx = await loadNotifyCtx(requestId);
      if (!ctx) return;
      const recipients = await linkedGuardianIds([...studentIds]);
      if (recipients.length === 0) return;
      await notify(recipients, { kind: 'CANCELLED', ...msgCancelled({ number: ctx.number, reason: REVOKED_REASON }), url: statusUrl(requestId), tag: `CANCELLED:${requestId}` });
    });
  }
}

const DAY_ENDED = 'انتهى اليوم الدراسي';

/** Cancels the active items of an open request of an earlier day and closes it (clears location). */
async function autoCloseStale(tx: Tx, requestId: string, actorId: string | null, at: Date): Promise<boolean> {
  const cur = await lockRequest(tx, requestId);
  if (!cur.open || cur.day >= dayDate(at)) return false;
  await tx.pickupItem.updateMany({
    where: { requestId, status: { in: ACTIVE } },
    data: { status: 'CANCELLED', cancelledAt: at, cancelReason: DAY_ENDED },
  });
  await closeIfDone(tx, requestId, at);
  await writeAudit({ schoolId: cur.schoolId, actorId, action: 'PICKUP_AUTO_CLOSED', entity: 'PickupRequest', entityId: requestId, data: { branchId: cur.branchId } }, tx);
  return true;
}

/** Sweep (server start + every 10 min): closes every open request of an earlier Riyadh day. Returns how many. */
export async function closeStaleRequests(at: Date = now()): Promise<number> {
  const stale = await prisma.pickupRequest.findMany({ where: { open: true, day: { lt: dayDate(at) } }, select: { id: true }, orderBy: { id: 'asc' } });
  let n = 0;
  for (const { id } of stale) {
    const closed = await prisma.$transaction((tx) => autoCloseStale(tx, id, null, at));
    if (!closed) continue;
    n++;
    await emitPickupChanged(id);
  }
  return n;
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

  let autoClosed: string[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const request = await prisma.$transaction(async (tx) => {
        const stale = await tx.pickupRequest.findMany({
          where: { open: true, day: { lt: day }, items: { some: { studentId: { in: ids }, status: { in: ACTIVE } } } },
          select: { id: true, schoolId: true, branchId: true },
          orderBy: { id: 'asc' },
        });
        autoClosed = [];
        for (const st of stale) if (await autoCloseStale(tx, st.id, user.id, at)) autoClosed.push(st.id);
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
          { schoolId: created.schoolId, actorId: user.id, action: 'PICKUP_CREATED', entity: 'PickupRequest', entityId: created.id, data: { number: created.number, studentIds: ids, branchId: created.branchId } },
          tx,
        );
        return created;
      });
      for (const id of autoClosed) await emitPickupChanged(id);
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
      { schoolId: item.request.schoolId, actorId: staff.id, action: action === 'PREPARE' ? 'ITEM_PREPARING' : 'ITEM_READY', entity: 'PickupItem', entityId: itemId, data: { requestId: item.requestId, branchId: item.request.branchId } },
      tx,
    );
    return tx.pickupItem.findUniqueOrThrow({ where: { id: itemId } });
  });
  await emitPickupChanged(item.requestId);
  if (to === 'PREPARING' || to === 'READY') safely(() => notifyProgress(item.requestId, itemId, to));
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
      { schoolId: req.schoolId, actorId: staff.id, action: 'GATE_CHANGED', entity: 'PickupRequest', entityId: requestId, data: { from: req.gateId, to: gateId, at: at.toISOString(), branchId: req.branchId } },
      tx,
    );
  });
  await emitPickupChanged(requestId);
}

/** Code entry needs the request number too (R8): a 6-digit code alone could match another family. */
type VerifyInput = { requestNumber: number; code: string; branchId?: string } | { qr: string };
export type VerifyResult = {
  requestId: string;
  recipient: { name: string; role: Role; photoKey: string | null };
  items: { itemId: string; studentName: string; status: ItemStatus }[];
};

const WRONG_CODE = 'الرمز غير صحيح';
const REPEAT_WINDOW_MS = 60_000;

export async function verifyRecipient(staff: User, input: VerifyInput, at: Date = now()): Promise<VerifyResult> {
  requireStaffLike(staff);

  const failures = await prisma.verifyAttempt.count({
    where: { staffId: staff.id, ok: false, createdAt: { gt: new Date(at.getTime() - VERIFY_FAIL_WINDOW_MS), lte: at } },
  });
  if (failures >= VERIFY_FAIL_LIMIT) throw new RateLimitError();
  const payload = 'qr' in input ? `QR:${input.qr}` : `NUM:${input.requestNumber}:${input.code}`;
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const fail = async (): Promise<never> => {
    // A camera re-reading the same bad QR (or a double tap) within 60 s counts as one failure.
    const repeat = await prisma.verifyAttempt.findFirst({
      where: { staffId: staff.id, ok: false, payloadHash, createdAt: { gt: new Date(at.getTime() - REPEAT_WINDOW_MS), lte: at } },
      select: { id: true },
    });
    if (!repeat) await prisma.verifyAttempt.create({ data: { staffId: staff.id, ok: false, payloadHash, createdAt: at } });
    throw new ValidationError(WRONG_CODE);
  };

  let requestId: string;
  let method: 'CODE' | 'QR';
  if ('qr' in input) {
    const parsed = parseQr(input.qr);
    if (!parsed) return fail();
    method = 'QR';
    const req = await prisma.pickupRequest.findUnique({ where: { id: parsed.requestId } });
    if (!req) return fail();
    await assertBranchAccess(staff, req.branchId);
    if (!isToday(req, at)) throw new ValidationError(STALE);
    if (!req.open || !checkPickupCode(req.id, parsed.code, at)) return fail();
    requestId = req.id;
  } else {
    method = 'CODE';
    if (!Number.isInteger(input.requestNumber) || input.requestNumber < 1 || input.requestNumber > 2_000_000_000) {
      throw new ValidationError('أدخل رقم الطلب');
    }
    const branchId = staff.role === 'STAFF' ? staff.branchId : input.branchId;
    if (!branchId) throw new ValidationError('حدد الفرع');
    await assertBranchAccess(staff, branchId);
    const req = await prisma.pickupRequest.findUnique({
      where: { branchId_day_number: { branchId, day: dayDate(at), number: input.requestNumber } },
    });
    if (!req || !req.open || !checkPickupCode(req.id, input.code, at)) return fail();
    requestId = req.id;
  }

  let revoked: RevokedBatch | null = null;
  const result = await prisma.$transaction(async (tx) => {
    revoked = null;
    const locked = await lockRequest(tx, requestId);
    if (!locked.open) throw new ValidationError(WRONG_CODE);
    const unlinked = await unlinkedItemIds(tx, locked);
    if (unlinked.length) {
      revoked = await cancelRevoked(tx, locked, unlinked, staff.id, at);
      // Commit the cancellation, then reject when no child is left to hand over.
      if ((await tx.pickupItem.count({ where: { requestId, status: { in: ACTIVE } } })) === 0) return null;
    }
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
      { schoolId: req.schoolId, actorId: staff.id, action: 'RECIPIENT_VERIFIED', entity: 'PickupRequest', entityId: requestId, data: { method, branchId: req.branchId } },
      tx,
    );
    return {
      requestId,
      recipient: { name: requester.name, role: requester.role, photoKey: requester.photoKey },
      items: items.map((i) => ({ itemId: i.id, studentName: i.student.fullName, status: i.status })),
    };
  });
  if (revoked) await announceRevoked([revoked]);
  else await emitPickupChanged(requestId);
  if (!result) throw new ValidationError(NOT_AUTHORISED);
  return result;
}

export async function deliverItems(staff: User, requestId: string, itemIds: string[], at: Date = now()): Promise<void> {
  requireStaffLike(staff);
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) throw new ValidationError('اختر عنصراً واحداً على الأقل');
  const req = await loadRequest(requestId);
  await assertBranchAccess(staff, req.branchId);

  let revoked: RevokedBatch | null = null;
  const delivered = await prisma.$transaction(async (tx) => {
    revoked = null;
    const cur = await lockRequest(tx, requestId);
    if (!isToday(cur, at)) throw new ValidationError(STALE);
    if (!cur.open) throw new Conflict('الطلب مغلق');
    const age = cur.verifiedAt ? at.getTime() - cur.verifiedAt.getTime() : Infinity;
    if (age < 0 || age > VERIFY_VALID_MS) throw new Conflict('يجب التحقق من المستلم قبل التسليم');
    const unlinked = await unlinkedItemIds(tx, cur);
    if (unlinked.length) {
      revoked = await cancelRevoked(tx, cur, unlinked, staff.id, at);
      // Commit the cancellation; refuse the whole hand-over so staff re-checks who is at the gate.
      if (ids.some((id) => unlinked.includes(id))) return false;
    }
    const res = await tx.pickupItem.updateMany({
      where: { id: { in: ids }, requestId, status: 'READY' },
      data: { status: nextStatus('READY', 'DELIVER'), deliveredAt: at, deliveredById: staff.id },
    });
    if (res.count !== ids.length) throw new Conflict('بعض العناصر غير جاهزة للتسليم');
    await writeAudit(
      { schoolId: req.schoolId, actorId: staff.id, action: 'ITEM_DELIVERED', entity: 'PickupRequest', entityId: requestId, data: { itemIds: ids, branchId: req.branchId } },
      tx,
    );
    await closeIfDone(tx, requestId, at);
    return true;
  });
  if (revoked) await announceRevoked([revoked]);
  if (!delivered) throw new Conflict(NOT_AUTHORISED);
  await emitPickupChanged(requestId);
  safely(() => notifyDelivered(requestId, ids, at));
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

  let cancelledIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    cancelledIds = (await tx.pickupItem.findMany({ where: { requestId, status: { in: ACTIVE } }, select: { id: true } })).map((i) => i.id);
    const res = await tx.pickupItem.updateMany({
      where: { requestId, status: { in: ACTIVE } },
      data: { status: 'CANCELLED', cancelledAt: at, cancelReason: reason },
    });
    if (res.count === 0) throw new Conflict('لا توجد عناصر نشطة في هذا الطلب');
    await closeIfDone(tx, requestId, at);
    await writeAudit(
      { schoolId: req.schoolId, actorId: actor.id, action: 'PICKUP_CANCELLED', entity: 'PickupRequest', entityId: requestId, data: { reason, cancelled: res.count, branchId: req.branchId } },
      tx,
    );
  });
  await emitPickupChanged(requestId);
  safely(() => notifyCancelled(requestId, cancelledIds, reason));
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
      { schoolId: req.schoolId, actorId: user.id, action: 'PICKUP_ARRIVED', entity: 'PickupRequest', entityId: requestId, data: { branchId: req.branchId } },
      tx,
    );
    return true;
  });
  if (changed) await emitPickupChanged(requestId);
}
