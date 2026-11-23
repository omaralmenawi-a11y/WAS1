/**
 * Demo seed: one fictional school with a branch, gates, classrooms, schedules, students and demo accounts.
 * Goes through the real lib functions so hashing/normalisation match production code paths.
 * Idempotent (exits 0 if the demo school exists). Refuses to run in production without --force.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { createPlatformAdmin, createSchoolWithAdmin } from '../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule, updateBranch } from '../src/lib/school/setup';
import { createStaff } from '../src/lib/school/staff';
import { applyImport, type ImportRow } from '../src/lib/school/import';

export const DEMO_SCHOOL = 'مدارس الأفق الأهلية (تجريبي)';
const BRANCH = 'فرع الملقا';
const GUARDIAN_PHONE = '+966500000001';
// North Riyadh (Al-Malqa), demo coordinates.
const LAT = 24.8071;
const LNG = 46.6226;
const SCHOOL_DAYS = [0, 1, 2, 3, 4]; // Sun-Thu

const CLASSROOMS = [
  { name: 'الأول أ', grade: 'الصف الأول', dismissal: '12:00' },
  { name: 'الثاني أ', grade: 'الصف الثاني', dismissal: '12:30' },
  { name: 'الرابع أ', grade: 'الصف الرابع', dismissal: '13:00' },
  { name: 'السادس أ', grade: 'الصف السادس', dismissal: '13:30' },
];

// [externalId, name, classroom, gate, guardian phones]
const STUDENTS: [string, string, string, string, string[]][] = [
  ['D001', 'سامر تجريبي الأول', 'الأول أ', 'بوابة 1', [GUARDIAN_PHONE]],
  ['D002', 'ريما تجريبية الأولى', 'الأول أ', 'بوابة 1', ['0500000011']],
  ['D003', 'ليان تجريبية الثانية', 'الثاني أ', 'بوابة 1', [GUARDIAN_PHONE]],
  ['D004', 'عمر تجريبي الثاني', 'الثاني أ', 'بوابة 1', ['0500000012']],
  ['D005', 'نواف تجريبي الثالث', 'الثاني أ', 'بوابة 2', ['0500000013']],
  ['D006', 'جود تجريبية الرابعة', 'الرابع أ', 'بوابة 2', ['0500000014']],
  ['D007', 'فهد تجريبي الخامس', 'الرابع أ', 'بوابة 2', ['0500000015']],
  ['D008', 'هنا تجريبية السادسة', 'الرابع أ', 'بوابة 1', ['0500000016']],
  ['D009', 'زياد تجريبي السابع', 'السادس أ', 'بوابة 2', ['0500000017']],
  ['D010', 'مها تجريبية الثامنة', 'السادس أ', 'بوابة 2', ['0500000018']],
  ['D011', 'يزن تجريبي التاسع', 'السادس أ', 'بوابة 1', ['0500000019']],
  ['D012', 'دانة تجريبية العاشرة', 'السادس أ', 'بوابة 2', ['0500000020']],
];

async function main() {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.argv.includes('--force')) {
    console.error('Refusing to seed demo data with NODE_ENV=production. Pass --force to override.');
    process.exit(1);
  }
  if (production) {
    console.warn('WARNING: seeding demo data in production (--force). The demo passwords below are public;');
    console.warn('WARNING: every seeded account keeps mustChangePassword=true and must set a new password at first sign-in.');
  }
  /** Outside production the demo accounts are ready to use; in production every one must change its public password. */
  const ready = (id: string) => prisma.user.update({ where: { id }, data: { mustChangePassword: production } });
  if (await prisma.school.findFirst({ where: { name: DEMO_SCHOOL } })) {
    console.log('Demo school already exists; nothing to do.');
    return;
  }
  for (const u of ['admin', 'noura', 'root']) {
    if (await prisma.user.findUnique({ where: { username: u } })) {
      console.error(`Username "${u}" already exists outside the demo school; aborting.`);
      process.exit(1);
    }
  }

  const { school, branch, admin } = await createSchoolWithAdmin({
    schoolName: DEMO_SCHOOL,
    branchName: BRANCH,
    adminName: 'مدير المدرسة (تجريبي)',
    adminUsername: 'admin',
    tempPassword: 'Admin@12345',
  });
  await ready(admin.id);
  const actor = admin;

  await updateBranch(actor, { id: branch.id, name: BRANCH, lat: LAT, lng: LNG });
  const gates = [];
  for (const n of ['بوابة 1', 'بوابة 2']) gates.push(await createGate(actor, { branchId: branch.id, name: n }));
  for (const c of CLASSROOMS) {
    const room = await createClassroom(actor, { branchId: branch.id, name: c.name, grade: c.grade });
    for (const weekday of SCHOOL_DAYS) await setClassSchedule(actor, { classroomId: room.id, weekday, dismissal: c.dismissal });
  }

  const rows: ImportRow[] = STUDENTS.map(([externalId, fullName, classroom, gate, phones]) => ({
    externalId, fullName, branch: BRANCH, classroom, gate, phones,
  }));
  const res = await applyImport(actor, school.id, rows);
  if (res.errors.length) throw new Error('Student import failed: ' + JSON.stringify(res.errors));

  const staff = await createStaff(actor, {
    branchId: branch.id,
    name: 'نورة (موظفة تجريبية)',
    username: 'noura',
    tempPassword: 'Staff@12345',
    gateIds: gates.map((g) => g.id),
  });
  await ready(staff.id);

  const root = await createPlatformAdmin('root', 'Root@12345');
  await ready(root.id);

  const base = process.env.APP_URL ?? 'http://localhost:3000';
  console.log(`Seeded "${DEMO_SCHOOL}" (${res.created} students).`);
  console.log(`Board:   ${base}/board/${branch.boardToken}`);
  console.log('Accounts:');
  console.log('  platform admin  root   / Root@12345');
  console.log('  school admin    admin  / Admin@12345');
  console.log('  staff           noura  / Staff@12345');
  console.log(`  guardian        register at /register with 0500000001 (OTP shown on /admin in dev); two siblings linked`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
