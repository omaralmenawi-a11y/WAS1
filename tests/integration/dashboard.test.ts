import type { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createBranch, createClassroom, createGate, regenerateBoardToken, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { advanceItem, createRequest } from '../../src/lib/pickup/service';
import { getDashboard, listBranchAudit } from '../../src/lib/school/dashboard';
import { Forbidden, NotFound } from '../../src/lib/errors';
import { createSession } from '../../src/lib/auth/session';
import { GET as getDash } from '../../src/app/api/school/dashboard/route';
import { GET as getAudit } from '../../src/app/api/school/audit/route';
import { POST as postToken } from '../../src/app/api/school/branches/[id]/board-token/route';
import './setup';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';

// Mon 2026-11-23 12:30 Riyadh
const T = new Date('2026-11-23T09:30:00Z');
const phone = (n: number) => `+96655000000${n}`;

async function mkSchool(tag: string) {
  const s = await createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`, branchName: `فرع ${tag}`, adminName: `مدير ${tag}`, adminUsername: `admin_${tag}`, tempPassword: 'temp-pass-123',
  });
  await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  return s;
}
const guardian = (n: number) => prisma.user.create({ data: { role: 'GUARDIAN', name: `ولي ${n}`, phone: phone(n), passwordHash: 'x' } });

async function students(s: Awaited<ReturnType<typeof mkSchool>>, names: string[]) {
  await applyImport(s.admin, s.school.id, names.map((n, i) => ({
    branch: s.branch.name, externalId: `e${i}`, fullName: n, classroom: '1/أ', gate: 'بوابة 1', phones: [phone(i + 1)],
  })));
  const st = await prisma.student.findMany({ where: { schoolId: s.school.id } });
  return Object.fromEntries(st.map((x) => [x.fullName, x]));
}

async function world() {
  const s = await mkSchool('a');
  const by = await students(s, ['أحمد', 'بدر', 'خالد', 'سعد', 'عمر', 'فهد']);
  const g = await Promise.all([1, 2, 3, 4, 5, 6].map(guardian));
  const names = ['أحمد', 'بدر', 'خالد', 'سعد', 'عمر', 'فهد'];
  const reqs: Awaited<ReturnType<typeof createRequest>>[] = [];
  for (let i = 0; i < 6; i++) reqs.push(await createRequest(g[i], [by[names[i]].id], T));
  const item = async (i: number) => (await prisma.pickupItem.findFirstOrThrow({ where: { requestId: reqs[i].id } })).id;
  // 0,1,2 delivered with waits 60/120/180; 3 ready; 4 preparing; 5 en route
  const ready = new Date('2026-11-23T09:40:00Z');
  for (const [i, wait] of [[0, 60], [1, 120], [2, 180]] as const) {
    await prisma.pickupItem.update({
      where: { id: await item(i) },
      data: { status: 'DELIVERED', readyAt: ready, deliveredAt: new Date(ready.getTime() + wait * 1000) },
    });
    await prisma.pickupRequest.update({ where: { id: reqs[i].id }, data: { open: false } });
  }
  const staff = await prisma.user.create({
    data: { role: 'STAFF', name: 'موظف', passwordHash: 'x', branchId: s.branch.id, schoolId: s.school.id, gateIds: [], username: 'st_x' },
  });
  await advanceItem(staff, await item(3), 'PREPARE', T);
  await advanceItem(staff, await item(3), 'READY', T);
  await advanceItem(staff, await item(4), 'PREPARE', T);
  return { s, reqs, staff };
}

describe('getDashboard', () => {
  it('computes counts and average wait for today', async () => {
    const { s } = await world();
    const d = await getDashboard(s.admin, s.branch.id, T);
    expect(d.counts).toEqual({ open: 3, enRoute: 1, preparing: 1, ready: 1, deliveredToday: 3 });
    expect(d.avgWaitSecToday).toBe(120);
    expect(d.requests).toHaveLength(3);
    expect(d.requests[0].items[0].status).toBe('READY');
    expect(d.branch.boardToken).toBeTruthy();
    expect(d.recent.length).toBeGreaterThan(0);
    expect(d.recent.length).toBeLessThanOrEqual(20);
  });

  it('has null average and zero counts when nothing happened', async () => {
    const s = await mkSchool('e');
    const d = await getDashboard(s.admin, s.branch.id, T);
    expect(d.counts).toEqual({ open: 0, enRoute: 0, preparing: 0, ready: 0, deliveredToday: 0 });
    expect(d.avgWaitSecToday).toBeNull();
  });

  it("excludes another branch's data, requests and audit", async () => {
    const { s, reqs } = await world();
    const b2 = await createBranch(s.admin, { name: 'فرع ثان' });
    const d2 = await getDashboard(s.admin, b2.id, T);
    expect(d2.counts.open).toBe(0);
    expect(d2.counts.deliveredToday).toBe(0);
    expect(d2.avgWaitSecToday).toBeNull();
    expect(d2.requests).toEqual([]);
    expect(d2.recent).toEqual([]);
    const d1 = await getDashboard(s.admin, s.branch.id, T);
    expect(d1.requests.map((r) => r.id)).not.toContain(reqs[0].id);
    // setup audit (branch created etc.) never shows in the feed
    expect(d1.recent.every((e) => e.action !== 'BRANCH_CREATED')).toBe(true);
  });

  it('does not count yesterday or later days', async () => {
    const { s } = await world();
    const d = await getDashboard(s.admin, s.branch.id, new Date(T.getTime() + 24 * 3600_000));
    expect(d.counts.deliveredToday).toBe(0);
    expect(d.avgWaitSecToday).toBeNull();
  });

  it('forbids staff and hides other schools', async () => {
    const { s, staff } = await world();
    await expect(getDashboard(staff, s.branch.id, T)).rejects.toBeInstanceOf(Forbidden);
    const o = await mkSchool('o');
    await expect(getDashboard(o.admin, s.branch.id, T)).rejects.toBeInstanceOf(NotFound);
    await expect(listBranchAudit(o.admin, s.branch.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('regenerateBoardToken', () => {
  it('changes the token and audits it', async () => {
    const s = await mkSchool('t');
    const before = (await prisma.branch.findUniqueOrThrow({ where: { id: s.branch.id } })).boardToken;
    const r = await regenerateBoardToken(s.admin, s.branch.id);
    expect(r.boardToken).not.toBe(before);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: s.branch.id } })).boardToken).toBe(r.boardToken);
    const row = await prisma.auditLog.findFirst({ where: { action: 'BOARD_TOKEN_REGENERATED', entityId: s.branch.id } });
    expect(row?.actorId).toBe(s.admin.id);
    expect(row?.schoolId).toBe(s.school.id);
  });

  it('is denied to staff and other schools', async () => {
    const { s, staff } = await world();
    await expect(regenerateBoardToken(staff, s.branch.id)).rejects.toBeInstanceOf(Forbidden);
    const o = await mkSchool('o2');
    await expect(regenerateBoardToken(o.admin, s.branch.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('routes', () => {
  async function cookieFor(u: { id: string; role: Role }) {
    return { cookie: `wasl_session=${await createSession(u.id, u.role)}` };
  }
  it('GET dashboard / audit (limit capped) and POST board-token', async () => {
    const { s } = await world();
    const h = await cookieFor(s.admin);
    const d = await getDash(new Request(`http://x/api/school/dashboard?branchId=${s.branch.id}`, { headers: h }));
    expect(d.status).toBe(200);
    expect((await d.json()).counts.deliveredToday).toBeGreaterThanOrEqual(0);

    const a = await getAudit(new Request(`http://x/api/school/audit?branchId=${s.branch.id}&limit=1000`, { headers: h }));
    expect(a.status).toBe(200);
    const ev = await a.json();
    expect(ev.length).toBeLessThanOrEqual(100);
    expect(ev[0]).toHaveProperty('text');
    const one = await (await getAudit(new Request(`http://x/api/school/audit?branchId=${s.branch.id}&limit=1`, { headers: h }))).json();
    expect(one).toHaveLength(1);

    expect((await getDash(new Request('http://x/api/school/dashboard', { headers: h }))).status).toBe(400);
    expect((await getDash(new Request(`http://x/api/school/dashboard?branchId=${s.branch.id}`))).status).toBe(401);

    const p = await postToken(new Request('http://x', { method: 'POST', headers: h }), { params: Promise.resolve({ id: s.branch.id }) });
    expect(p.status).toBe(200);
    expect((await p.json()).boardToken).toBeTruthy();
  });
});
