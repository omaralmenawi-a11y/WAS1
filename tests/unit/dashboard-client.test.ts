import { describe, expect, it } from 'vitest';
import { etaCell, formatMmSs, lastUpdate } from '../../src/lib/school/dashboard-client';

describe('dashboard helpers', () => {
  it('formats mm:ss', () => {
    expect(formatMmSs(120)).toBe('02:00');
    expect(formatMmSs(65.4)).toBe('01:05');
    expect(formatMmSs(null)).toBe('—');
  });
  it('eta cell', () => {
    expect(etaCell({ arrivedAt: 'x', etaSeconds: 300 })).toBe('وصل');
    expect(etaCell({ arrivedAt: null, etaSeconds: 0 })).toBe('وصل');
    expect(etaCell({ arrivedAt: null, etaSeconds: 61 })).toBe('2 د');
    expect(etaCell({ arrivedAt: null, etaSeconds: null })).toBe('—');
  });
  it('last update', () => {
    const t = Date.parse('2026-11-23T10:00:00Z');
    expect(lastUpdate('2026-11-23T09:57:30Z', t)).toBe('آخر تحديث قبل 2 د');
    expect(lastUpdate(null, t)).toBe('—');
  });
});
