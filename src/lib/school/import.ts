import type { User } from '@prisma/client';
import * as XLSX from 'xlsx';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertSchoolAccess } from '../authz';
import { ValidationError } from '../errors';
import { normalizePhone } from '../phone';
import { requireManager } from './setup';

export type ImportRow = { externalId: string; fullName: string; branch: string; classroom: string; gate: string; phones: string[] };
export type RowMessage = { row: number; messageAr: string };

export const IMPORT_HEADERS = {
  externalId: 'رقم الطالب',
  fullName: 'اسم الطالب',
  branch: 'الفرع',
  classroom: 'الفصل',
  gate: 'البوابة',
  phones: ['جوال ولي الأمر 1', 'جوال ولي الأمر 2', 'جوال ولي الأمر 3'],
} as const;

export const MAX_IMPORT_ROWS = 5000;

const cell = (v: unknown) => String(v ?? '').trim();

/** Parses an .xlsx / .csv upload. Row numbers are spreadsheet rows (header = 1). */
export function parseStudentSheet(
  buf: Buffer,
  filename: string,
): { rows: ImportRow[]; rowNumbers: number[]; errors: RowMessage[]; warnings: RowMessage[] } {
  const rows: ImportRow[] = [];
  const rowNumbers: number[] = []; // spreadsheet row of each entry in rows
  const errors: RowMessage[] = [];
  const warnings: RowMessage[] = [];
  const fail = (messageAr: string) => ({ rows, rowNumbers, errors: [{ row: 1, messageAr }], warnings });

  const ext = filename.toLowerCase().split('.').pop();
  let grid: unknown[][];
  try {
    let wb: XLSX.WorkBook;
    if (ext === 'csv') {
      wb = XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true });
    } else if (ext === 'xlsx') {
      wb = XLSX.read(buf, { type: 'buffer' });
    } else {
      return fail('نوع الملف غير مدعوم، استخدم xlsx أو csv');
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return fail('الملف فارغ');
    grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
  } catch {
    return fail('تعذر قراءة الملف');
  }
  if (grid.length === 0) return fail('الملف فارغ');
  if (grid.length - 1 > MAX_IMPORT_ROWS) return fail(`عدد الصفوف يتجاوز الحد الأقصى (${MAX_IMPORT_ROWS})`);

  const header = grid[0].map(cell);
  const col = (h: string) => header.indexOf(h);
  const idx = {
    externalId: col(IMPORT_HEADERS.externalId),
    fullName: col(IMPORT_HEADERS.fullName),
    branch: col(IMPORT_HEADERS.branch),
    classroom: col(IMPORT_HEADERS.classroom),
    gate: col(IMPORT_HEADERS.gate),
  };
  const phoneIdx = IMPORT_HEADERS.phones.map(col);
  const missing = [
    ...(Object.entries(idx) as [keyof typeof idx, number][]).filter(([, i]) => i < 0).map(([k]) => IMPORT_HEADERS[k]),
    ...IMPORT_HEADERS.phones.filter((_, i) => phoneIdx[i] < 0).slice(0, 1).filter(() => phoneIdx.every((i) => i < 0)),
  ];
  if (missing.length) return fail(`أعمدة مفقودة: ${missing.join('، ')}`);

  const seen = new Map<string, number>(); // externalId -> index in rows
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const rowNo = r + 1;
    const get = (i: number) => cell(line[i]);
    const externalId = get(idx.externalId);
    const fullName = get(idx.fullName);
    const branch = get(idx.branch);
    const classroom = get(idx.classroom);
    const gate = get(idx.gate);
    if (line.every((c) => cell(c) === '')) continue;
    const required: [string, string][] = [
      [externalId, IMPORT_HEADERS.externalId],
      [fullName, IMPORT_HEADERS.fullName],
      [branch, IMPORT_HEADERS.branch],
      [classroom, IMPORT_HEADERS.classroom],
      [gate, IMPORT_HEADERS.gate],
    ];
    const empty = required.find(([v]) => !v);
    if (empty) {
      errors.push({ row: rowNo, messageAr: `الحقل «${empty[1]}» مطلوب` });
      continue;
    }
    const phones: string[] = [];
    let bad = false;
    for (const i of phoneIdx) {
      if (i < 0) continue;
      const raw = get(i);
      if (!raw) continue;
      const p = normalizePhone(raw);
      if (!p) {
        errors.push({ row: rowNo, messageAr: `رقم الجوال غير صالح: ${raw}` });
        bad = true;
        break;
      }
      if (!phones.includes(p)) phones.push(p);
    }
    if (bad) continue;
    const item: ImportRow = { externalId, fullName, branch, classroom, gate, phones };
    const prev = seen.get(externalId);
    if (prev !== undefined) {
      rows[prev] = item;
      rowNumbers[prev] = rowNo;
      warnings.push({ row: rowNo, messageAr: `رقم الطالب ${externalId} مكرر، تم اعتماد الصف الأخير` });
    } else {
      seen.set(externalId, rows.length);
      rows.push(item);
      rowNumbers.push(rowNo);
    }
  }
  return { rows, rowNumbers, errors, warnings };
}

/** Upserts valid rows by (schoolId, externalId); bad rows are reported and skipped. */
export async function applyImport(
  actor: User,
  schoolId: string,
  rows: ImportRow[],
  rowNumbers?: number[],
): Promise<{ created: number; updated: number; errors: RowMessage[] }> {
  requireManager(actor);
  assertSchoolAccess(actor, schoolId);
  if (!(await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) {
    throw new ValidationError('المدرسة غير موجودة');
  }
  if (rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`عدد الصفوف يتجاوز الحد الأقصى (${MAX_IMPORT_ROWS})`);

  const branches = await prisma.branch.findMany({
    where: { schoolId },
    include: { classrooms: { orderBy: { id: 'asc' } }, gates: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  const errors: RowMessage[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = rowNumbers?.[i] ?? i + 2;
    const branch = branches.find((b) => b.name === r.branch.trim());
    if (!branch) {
      errors.push({ row: rowNo, messageAr: `الفرع «${r.branch}» غير موجود` });
      continue;
    }
    const room = branch.classrooms.find((c) => c.name === r.classroom.trim());
    if (!room) {
      errors.push({ row: rowNo, messageAr: `الفصل «${r.classroom}» غير موجود في الفرع` });
      continue;
    }
    const gate = branch.gates.find((g) => g.name === r.gate.trim());
    if (!gate) {
      errors.push({ row: rowNo, messageAr: `البوابة «${r.gate}» غير موجودة في الفرع` });
      continue;
    }
    const phones = r.phones.map((p) => normalizePhone(p));
    if (phones.some((p) => !p)) {
      errors.push({ row: rowNo, messageAr: 'رقم جوال غير صالح' });
      continue;
    }
    const uniquePhones = [...new Set(phones as string[])];
    const externalId = r.externalId.trim();
    const fullName = r.fullName.trim();
    if (!externalId || !fullName) {
      errors.push({ row: rowNo, messageAr: 'رقم الطالب والاسم مطلوبان' });
      continue;
    }
    try {
      const isNew = await prisma.$transaction(async (tx) => {
        const existing = await tx.student.findUnique({ where: { schoolId_externalId: { schoolId, externalId } }, select: { id: true } });
        const data = { fullName, branchId: branch.id, classroomId: room.id, defaultGateId: gate.id };
        const s = existing
          ? await tx.student.update({ where: { id: existing.id }, data })
          : await tx.student.create({ data: { ...data, schoolId, externalId } });
        await tx.guardianPhone.deleteMany({ where: { studentId: s.id } });
        if (uniquePhones.length) await tx.guardianPhone.createMany({ data: uniquePhones.map((phone) => ({ studentId: s.id, phone })) });
        return !existing;
      });
      if (isNew) created++;
      else updated++;
    } catch {
      errors.push({ row: rowNo, messageAr: 'تعذر حفظ الصف' });
    }
  }

  await writeAudit({
    schoolId,
    actorId: actor.id,
    action: 'STUDENTS_IMPORTED',
    entity: 'School',
    entityId: schoolId,
    data: { created, updated, errors: errors.length, rows: rows.length },
  });
  return { created, updated, errors };
}
