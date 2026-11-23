import * as XLSX from 'xlsx';
import { IMPORT_HEADERS } from '../src/lib/school/import';

const headers = [
  IMPORT_HEADERS.externalId,
  IMPORT_HEADERS.fullName,
  IMPORT_HEADERS.branch,
  IMPORT_HEADERS.classroom,
  IMPORT_HEADERS.gate,
  ...IMPORT_HEADERS.phones,
];
const example = ['1001', 'محمد أحمد العتيبي', 'الفرع الرئيسي', '1/أ', 'البوابة 1', '0501234567', '0507654321', ''];
const ws = XLSX.utils.aoa_to_sheet([headers, example]);
ws['!cols'] = headers.map(() => ({ wch: 22 }));
const wb = XLSX.utils.book_new();
wb.Workbook = { Views: [{ RTL: true }] };
XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
XLSX.writeFile(wb, 'public/templates/students-template.xlsx');
console.log('wrote public/templates/students-template.xlsx');
