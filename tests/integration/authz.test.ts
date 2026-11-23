import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSession } from '../../src/lib/auth/session';
import { hashPassword } from '../../src/lib/auth/password';
import { assertBranchAccess, assertSchoolAccess, requireRole, requireUser } from '../../src/lib/authz';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { login } from '../../src/lib/auth/accounts';
import { Conflict, Forbidden, NotFound, Unauthorized } from '../../src/lib/errors';

async function mkSchool(tag: string) {
  return createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`,
    branchName: `فرع ${tag}`,
    adminName: `مدير ${tag}`,
    adminUsername: `admin_${tag}`,
    tempPassword: 'temp-pass-123',
  });
}

describe('authz', () => {
  it('school admin of A cannot access school B → NotFound', async () => {
    const a = await mkSchool('a');
    const b = await mkSchool('b');
    expect(() => assertSchoolAccess(a.admin, a.school.id)).not.toThrow();
    expect(() => assertSchoolAccess(a.admin, b.school.id)).toThrow(NotFound);
    await expect(assertBranchAccess(a.admin, b.branch.id)).rejects.toThrow(NotFound);
  });

  it('staff of branch A1 cannot access branch A2 of same school → NotFound', async () => {
    const a = await mkSchool('a');
    const a2 = await prisma.branch.create({ data: { schoolId: a.school.id, name: 'A2', boardToken: 'x'.repeat(24) } });
    const staff = await prisma.user.create({
      data: { role: 'STAFF', schoolId: a.school.id, branchId: a.branch.id, name: 's', username: 'staff1', passwordHash: await hashPassword('password123') },
    });
    await expect(assertBranchAccess(staff, a.branch.id)).resolves.toBeUndefined();
    await expect(assertBranchAccess(staff, a2.id)).rejects.toThrow(NotFound);
    expect(() => assertSchoolAccess(staff, a.school.id)).not.toThrow();
  });

  it('school admin can access every branch of own school', async () => {
    const a = await mkSchool('a');
    const a2 = await prisma.branch.create({ data: { schoolId: a.school.id, name: 'A2', boardToken: 'y'.repeat(24) } });
    await expect(assertBranchAccess(a.admin, a.branch.id)).resolves.toBeUndefined();
    await expect(assertBranchAccess(a.admin, a2.id)).resolves.toBeUndefined();
    await expect(assertBranchAccess(a.admin, 'nope')).rejects.toThrow(NotFound);
  });

  it('platform admin creates school + admin; admin must change password', async () => {
    const r = await mkSchool('a');
    expect(r.admin.role).toBe('SCHOOL_ADMIN');
    expect(r.admin.mustChangePassword).toBe(true);
    expect(r.admin.schoolId).toBe(r.school.id);
    expect(r.branch.boardToken).toHaveLength(24);
    await expect(mkSchool('a')).rejects.toThrow(Conflict);
    expect(await prisma.school.count()).toBe(1);
  });

  it('audit row written on school creation', async () => {
    const r = await mkSchool('a');
    const rows = await prisma.auditLog.findMany({ where: { action: 'SCHOOL_CREATED' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].schoolId).toBe(r.school.id);
    expect(rows[0].entityId).toBe(r.school.id);
  });

  it('requireUser reads cookie; 401 without; requireRole forbids', async () => {
    const a = await mkSchool('a');
    const token = await createSession(a.admin.id, a.admin.role);
    const ok = new Request('http://x/', { headers: { cookie: `foo=1; wasl_session=${token}` } });
    expect((await requireUser(ok)).id).toBe(a.admin.id);
    await expect(requireUser(new Request('http://x/'))).rejects.toThrow(Unauthorized);
    expect(() => requireRole(a.admin, 'PLATFORM_ADMIN')).toThrow(Forbidden);
    expect(() => requireRole(a.admin, 'SCHOOL_ADMIN', 'STAFF')).not.toThrow();
  });

  it('username login is case-insensitive', async () => {
    const r = await createSchoolWithAdmin({
      schoolName: 'م', branchName: 'ف', adminName: 'م', adminUsername: 'Admin', tempPassword: 'temp-pass-123',
    });
    expect(r.admin.username).toBe('admin');
    expect((await login({ identifier: 'ADMIN', password: 'temp-pass-123' })).id).toBe(r.admin.id);
    expect((await login({ identifier: 'admin', password: 'temp-pass-123' })).id).toBe(r.admin.id);
  });
});
