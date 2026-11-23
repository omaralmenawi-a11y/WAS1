import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, regenerateBoardToken, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { advanceItem, createRequest } from '../../src/lib/pickup/service';
import { getBoard } from '../../src/lib/pickup/board';
import { NotFound } from '../../src/lib/errors';
import { GET as getBoardRoute } from '../../src/app/api/board/[token]/route';
import './setup';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';

// Mon 2026-11-23 12:30 Riyadh
const T = new Date('2026-11-23T09:30:00Z');
const NAMES = ['أحمد', 'بدر', 'خالد', 'سعد'];
const phone = (n: number) => `+96655000000${n}`;

async function world() {
  const s = await createSchoolWithAdmin({
    schoolName: 'مدرسة الأمل', branchName: 'فرع الشمال', adminName: 'مدير', adminUsername: 'admin_b', tempPassword: 'temp-pass-123',
  });
  await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 2' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  await applyImport(s.admin, s.school.id, NAMES.map((n, i) => ({
    branch: s.branch.name, externalId: `e${i}`, fullName: n, classroom: '1/أ', gate: i % 2 ? 'بوابة 2' : 'بوابة 1', phones: [phone(i + 1)],
  })));
  const st = await prisma.student.findMany({ where: { schoolId: s.school.id } });
  const by = Object.fromEntries(st.map((x) => [x.fullName, x]));
  const staff = await prisma.user.create({
    data: { role: 'STAFF', name: 'موظف الباب', passwordHash: 'x', branchId: s.branch.id, schoolId: s.school.id, gateIds: [], username: 'st_b' },
  });
  const reqs: Awaited<ReturnType<typeof createRequest>>[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const g = await prisma.user.create({ data: { role: 'GUARDIAN', name: `ولي ${i}`, phone: phone(i + 1), passwordHash: 'x' } });
    reqs.push(await createRequest(g, [by[NAMES[i]].id], T));
  }
  const item = async (i: number) => (await prisma.pickupItem.findFirstOrThrow({ where: { requestId: reqs[i].id } })).id;
  return { s, reqs, staff, item, by };
}

async function token(branchId: string) {
  return (await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).boardToken;
}

describe('getBoard', () => {
  it('lists preparing and ready by number, with number and gate only', async () => {
    const { s, staff, item } = await world();
    // 0 ready, 1 preparing, 2 ready, 3 en route
    await advanceItem(staff, await item(2), 'PREPARE', T);
    await advanceItem(staff, await item(2), 'READY', T);
    await advanceItem(staff, await item(0), 'PREPARE', T);
    await advanceItem(staff, await item(0), 'READY', T);
    await advanceItem(staff, await item(1), 'PREPARE', T);
    const b = await getBoard(await token(s.branch.id), T);
    expect(Object.keys(b).sort()).toEqual(['branchName', 'preparing', 'ready']);
    expect(b.branchName).toBe('فرع الشمال');
    expect(b.ready.map((e) => e.number)).toEqual([1, 3]);
    expect(b.preparing.map((e) => e.number)).toEqual([2]);
    expect(b.ready[0]).toEqual({ number: 1, gateName: 'بوابة 1' });
    expect(b.preparing[0]).toEqual({ number: 2, gateName: 'بوابة 2' });
  });

  it('exposes no names, ids or school name', async () => {
    const { s, staff, item, reqs } = await world();
    await advanceItem(staff, await item(0), 'PREPARE', T);
    await advanceItem(staff, await item(0), 'READY', T);
    const json = JSON.stringify(await getBoard(await token(s.branch.id), T));
    for (const n of [...NAMES, 'موظف الباب', 'مدرسة الأمل', 'ولي ']) expect(json).not.toContain(n);
    expect(json).not.toContain(reqs[0].id);
    expect(json).not.toContain(s.branch.id);
    expect(json).not.toContain(s.school.id);
  });

  it('omits EN_ROUTE-only requests', async () => {
    const { s } = await world();
    const b = await getBoard(await token(s.branch.id), T);
    expect(b.preparing).toEqual([]);
    expect(b.ready).toEqual([]);
  });

  it('omits delivered/closed requests', async () => {
    const { s, reqs } = await world();
    await prisma.pickupRequest.update({ where: { id: reqs[0].id }, data: { open: false } });
    await prisma.pickupItem.updateMany({ where: { requestId: reqs[0].id }, data: { status: 'READY' } });
    const b = await getBoard(await token(s.branch.id), T);
    expect(b.ready).toEqual([]);
  });

  it("omits yesterday's open request", async () => {
    const { s, staff, item } = await world();
    await advanceItem(staff, await item(0), 'PREPARE', T);
    const tomorrow = new Date(T.getTime() + 24 * 3600 * 1000);
    expect((await getBoard(await token(s.branch.id), T)).preparing).toHaveLength(1);
    expect((await getBoard(await token(s.branch.id), tomorrow)).preparing).toEqual([]);
  });

  it('throws NotFound for an unknown token', async () => {
    await world();
    await expect(getBoard('nope', T)).rejects.toBeInstanceOf(NotFound);
  });

  it('a regenerated token invalidates the old one', async () => {
    const { s } = await world();
    const old = await token(s.branch.id);
    const fresh = await regenerateBoardToken(s.admin, s.branch.id);
    await expect(getBoard(old, T)).rejects.toBeInstanceOf(NotFound);
    await expect(getBoard(fresh.boardToken, T)).resolves.toMatchObject({ branchName: 'فرع الشمال' });
  });
});

describe('GET /api/board/[token]', () => {
  const call = (t: string) => getBoardRoute(new Request(`http://x/api/board/${t}`), { params: Promise.resolve({ token: t }) });

  it('is public, no-store and noindex', async () => {
    const { s } = await world();
    const res = await call(await token(s.branch.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const j = await res.json();
    expect(j.branchName).toBe('فرع الشمال');
  });

  it('returns 404 JSON, still no-store, for a bad token', async () => {
    await world();
    const res = await call('bad-token');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).error).toBe('NOT_FOUND');
  });
});
