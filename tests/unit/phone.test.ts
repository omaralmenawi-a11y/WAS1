import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/lib/phone';

describe('normalizePhone', () => {
  it('normalises Saudi mobile formats to E.164', () => {
    expect(normalizePhone('0501234567')).toBe('+966501234567');
    expect(normalizePhone('966501234567')).toBe('+966501234567');
    expect(normalizePhone('+966 50 123 4567')).toBe('+966501234567');
    expect(normalizePhone('٠٥٠١٢٣٤٥٦٧')).toBe('+966501234567');
    expect(normalizePhone('501234567')).toBe('+966501234567');
  });
  it('rejects non-mobile or malformed numbers', () => {
    expect(normalizePhone('0401234567')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });
});
