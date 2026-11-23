import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseStudentSheet } from '../../src/lib/school/import';

const H = ['رقم الطالب', 'اسم الطالب', 'الفرع', 'الفصل', 'البوابة', 'جوال ولي الأمر 1', 'جوال ولي الأمر 2', 'جوال ولي الأمر 3'];
const csv = (rows: string[][], bom = false) => Buffer.from((bom ? '﻿' : '') + rows.map((r) => r.join(',')).join('\n'), 'utf8');
const xlsx = (rows: string[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describe('parseStudentSheet', () => {
  it('normalises messy and Arabic-Indic phones (csv with BOM)', () => {
    const r = parseStudentSheet(
      csv([H, ['1', 'أحمد', 'فرع', '1/أ', 'بوابة 1', '٠٥٠١٢٣٤٥٦٧', '+966 50-123-4568', '966501234569']], true),
      'a.csv',
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { externalId: '1', fullName: 'أحمد', branch: 'فرع', classroom: '1/أ', gate: 'بوابة 1', phones: ['+966501234567', '+966501234568', '+966501234569'] },
    ]);
  });

  it('reads xlsx, trims headers, ignores empty phone cells', () => {
    const r = parseStudentSheet(xlsx([H.map((h) => ` ${h} `), ['7', 'سارة', 'فرع', '2/ب', 'بوابة 2', '0501234567', '', '']]), 'a.xlsx');
    expect(r.errors).toEqual([]);
    expect(r.rows[0].phones).toEqual(['+966501234567']);
  });

  it('invalid phone errors that row number only; other rows kept', () => {
    const r = parseStudentSheet(
      csv([H, ['1', 'أ', 'ف', 'ص', 'ب', '0501234567', '', ''], ['2', 'ب', 'ف', 'ص', 'ب', '12345', '', ''], ['3', 'ج', 'ف', 'ص', 'ب', '0501234569', '', '']]),
      'a.csv',
    );
    expect(r.rows.map((x) => x.externalId)).toEqual(['1', '3']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(3);
  });

  it('missing name errors that row', () => {
    const r = parseStudentSheet(csv([H, ['1', '', 'ف', 'ص', 'ب', '0501234567', '', '']]), 'a.csv');
    expect(r.rows).toEqual([]);
    expect(r.errors[0].row).toBe(2);
  });

  it('duplicate externalId: second wins with a warning', () => {
    const r = parseStudentSheet(
      csv([H, ['1', 'الأول', 'ف', 'ص', 'ب', '0501234567', '', ''], ['1', 'الثاني', 'ف', 'ص', 'ب', '0501234568', '', '']]),
      'a.csv',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fullName).toBe('الثاني');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].row).toBe(3);
  });

  it('reports the true spreadsheet row after blank lines', () => {
    const r = parseStudentSheet(
      csv([H, ['1', 'أ', 'ف', 'ص', 'ب', '0501234567', '', ''], [',,,,,,,'.split(',').join(',')].map((x) => x.split(',')).flat(), ['3', 'ج', 'ف', 'ص', 'ب', '123', '', '']]),
      'a.csv',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.row)).toEqual([4]);
  });

  it('missing header column is reported', () => {
    const r = parseStudentSheet(csv([H.slice(0, 4), ['1', 'أ', 'ف', 'ص']]), 'a.csv');
    expect(r.rows).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects unsupported extension', () => {
    const r = parseStudentSheet(Buffer.from('x'), 'a.pdf');
    expect(r.errors).toHaveLength(1);
  });
});
