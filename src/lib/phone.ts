const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Returns a Saudi mobile in E.164 (+9665XXXXXXXX) or null. */
export function normalizePhone(input: string): string | null {
  let s = input
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (s.startsWith('966')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return /^5\d{8}$/.test(s) ? `+966${s}` : null;
}
