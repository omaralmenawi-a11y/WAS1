import { describe, expect, it } from 'vitest';
import { nextStatus } from '../../src/lib/pickup/state';
import { Conflict } from '../../src/lib/errors';

describe('nextStatus', () => {
  it('allows every legal transition', () => {
    expect(nextStatus('EN_ROUTE', 'PREPARE')).toBe('PREPARING');
    expect(nextStatus('PREPARING', 'READY')).toBe('READY');
    expect(nextStatus('READY', 'DELIVER')).toBe('DELIVERED');
    for (const s of ['EN_ROUTE', 'PREPARING', 'READY'] as const) expect(nextStatus(s, 'CANCEL')).toBe('CANCELLED');
  });
  it('rejects illegal moves with Conflict', () => {
    expect(() => nextStatus('DELIVERED', 'PREPARE')).toThrow(Conflict);
    expect(() => nextStatus('EN_ROUTE', 'READY')).toThrow(Conflict);
    expect(() => nextStatus('EN_ROUTE', 'DELIVER')).toThrow(Conflict);
    expect(() => nextStatus('PREPARING', 'DELIVER')).toThrow(Conflict);
    expect(() => nextStatus('DELIVERED', 'CANCEL')).toThrow(Conflict);
    expect(() => nextStatus('CANCELLED', 'CANCEL')).toThrow(Conflict);
    expect(() => nextStatus('READY', 'PREPARE')).toThrow(Conflict);
  });
});
