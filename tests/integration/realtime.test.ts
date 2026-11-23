import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { advanceItem, createRequest } from '../../src/lib/pickup/service';
import { createSession } from '../../src/lib/auth/session';
import { attachRealtime, setIo } from '../../src/lib/realtime';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';

const T = new Date('2026-11-23T09:30:00Z');
const P1 = '+966501234567';

let httpServer: HttpServer;
let io: Server;
let url: string;
const clients: Socket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  io = new Server(httpServer, { path: '/socket.io' });
  attachRealtime(io);
  setIo(io);
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  setIo(undefined);
  await io.close();
});

function client(opts: { cookie?: string; board?: string } = {}): Promise<Socket> {
  const s = connect(url, {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: opts.cookie ? { cookie: opts.cookie } : undefined,
    query: opts.board ? { board: opts.board } : undefined,
  });
  clients.push(s);
  return new Promise((res, rej) => {
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
}

/** Resolves with the first payload for `event`, or undefined after `ms`. */
function receive<T = unknown>(s: Socket, event: string, ms = 600): Promise<T | undefined> {
  return new Promise((res) => {
    const t = setTimeout(() => res(undefined), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      res(p);
    });
  });
}
const settle = () => new Promise((r) => setTimeout(r, 100));

async function mkSchool(tag: string) {
  const s = await createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`, branchName: `فرع ${tag}`, adminName: `مدير ${tag}`, adminUsername: `admin_${tag}`, tempPassword: 'temp-pass-123',
  });
  const gate = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  return { ...s, gate, room };
}

async function world() {
  const a = await mkSchool('a');
  const b = await mkSchool('b');
  await applyImport(a.admin, a.school.id, [
    { branch: a.branch.name, externalId: 'x1', fullName: 'أحمد السري', classroom: '1/أ', gate: 'بوابة 1', phones: [P1] },
  ]);
  const student = await prisma.student.findFirstOrThrow({ where: { schoolId: a.school.id } });
  const guardian = await prisma.user.create({ data: { role: 'GUARDIAN', name: 'ولي الأمر', phone: P1, passwordHash: 'x', photoKey: 'p' } });
  const other = await prisma.user.create({ data: { role: 'GUARDIAN', name: 'ولي آخر', phone: '+966507654321', passwordHash: 'x', photoKey: 'p' } });
  const mkStaff = (branchId: string, schoolId: string) =>
    prisma.user.create({ data: { role: 'STAFF', name: 'موظف', passwordHash: 'x', branchId, schoolId, gateIds: [], username: `st_${Math.random()}` } });
  const staffA = await mkStaff(a.branch.id, a.school.id);
  const staffB = await mkStaff(b.branch.id, b.school.id);
  const cookie = async (u: { id: string; role: any }) => `wasl_session=${await createSession(u.id, u.role)}`;
  const req = await createRequest(guardian, [student.id], T);
  return { a, b, staffA, staffB, guardian, other, req, itemId: req.items[0].id, cookie };
}

describe('realtime', () => {
  it('staff of branch A gets pickup:changed with the staff view; staff of branch B does not', async () => {
    const w = await world();
    const sa = await client({ cookie: await w.cookie(w.staffA) });
    const sb = await client({ cookie: await w.cookie(w.staffB) });
    const pa = receive<any>(sa, 'pickup:changed');
    const pb = receive(sb, 'pickup:changed');
    await advanceItem(w.staffA, w.itemId, 'PREPARE', T);
    const view = await pa;
    expect(view).toMatchObject({ id: w.req.id, number: 1, branchId: w.a.branch.id, gateName: 'بوابة 1', requesterName: 'ولي الأمر' });
    expect(view.items[0]).toMatchObject({ itemId: w.itemId, studentName: 'أحمد السري', classroomName: '1/أ', status: 'PREPARING' });
    expect(await pb).toBeUndefined();
  });

  it('owner gets only their own request view; other guardian gets nothing', async () => {
    const w = await world();
    const owner = await client({ cookie: await w.cookie(w.guardian) });
    const other = await client({ cookie: await w.cookie(w.other) });
    const po = receive<any>(owner, 'pickup:changed');
    const px = receive(other, 'pickup:changed');
    await advanceItem(w.staffA, w.itemId, 'PREPARE', T);
    const view = await po;
    expect(view).toEqual({
      id: w.req.id, number: 1, gateName: 'بوابة 1', open: true, etaSeconds: null,
      items: [{ itemId: w.itemId, studentId: expect.any(String), studentName: 'أحمد السري', status: 'PREPARING' }],
    });
    expect(await px).toBeUndefined();
  });

  it('board client gets board:update with no names; board token joins nothing else', async () => {
    const w = await world();
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: w.a.branch.id } });
    const board = await client({ board: branch.boardToken });
    const boardB = await client({ board: (await prisma.branch.findUniqueOrThrow({ where: { id: w.b.branch.id } })).boardToken });
    const pb = receive<any>(board, 'board:update');
    const pChanged = receive(board, 'pickup:changed');
    const pOther = receive(boardB, 'board:update');
    await advanceItem(w.staffA, w.itemId, 'PREPARE', T);
    const entry = await pb;
    expect(entry).toEqual({ number: 1, gateName: 'بوابة 1', status: 'PREPARING' });
    const json = JSON.stringify(entry);
    for (const k of ['fullName', 'studentName', 'requesterName']) expect(json).not.toContain(k);
    expect(json).not.toContain('أحمد');
    expect(await pChanged).toBeUndefined();
    expect(await pOther).toBeUndefined();
  });

  it('READY wins on the board; unauthenticated and bad-board clients receive nothing', async () => {
    const w = await world();
    const anon = await client();
    const badBoard = await client({ board: 'nope' });
    const board = await client({ board: (await prisma.branch.findUniqueOrThrow({ where: { id: w.a.branch.id } })).boardToken });
    const first = receive<any>(board, 'board:update');
    await advanceItem(w.staffA, w.itemId, 'PREPARE', T);
    expect((await first)?.status).toBe('PREPARING');
    const p = receive<any>(board, 'board:update');
    const a1 = receive(anon, 'board:update');
    const a2 = receive(anon, 'pickup:changed');
    const a3 = receive(badBoard, 'board:update');
    await advanceItem(w.staffA, w.itemId, 'READY', T);
    expect((await p)?.status).toBe('READY');
    expect(await a1).toBeUndefined();
    expect(await a2).toBeUndefined();
    expect(await a3).toBeUndefined();
  });

  it('school admin joins a branch via join-branch only when allowed', async () => {
    const w = await world();
    const adminB = await prisma.user.create({ data: { role: 'SCHOOL_ADMIN', name: 'م', passwordHash: 'x', schoolId: w.b.school.id, username: 'ab2' } });
    const sOk = await client({ cookie: await w.cookie(w.a.admin) });
    const sBad = await client({ cookie: await w.cookie(adminB) });
    const err = receive(sBad, 'error:access');
    sOk.emit('join-branch', { branchId: w.a.branch.id });
    sBad.emit('join-branch', { branchId: w.a.branch.id });
    expect(await err).toBeDefined();
    await settle();
    const pOk = receive<any>(sOk, 'pickup:changed');
    const pBad = receive(sBad, 'pickup:changed');
    await advanceItem(w.staffA, w.itemId, 'PREPARE', T);
    expect((await pOk)?.id).toBe(w.req.id);
    expect(await pBad).toBeUndefined();
  });
});
