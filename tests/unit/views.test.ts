import { describe, expect, it } from 'vitest';
import { toBoardEntry, type RequestForViews } from '../../src/lib/pickup/views';

const mk = (open: boolean, statuses: string[]) =>
  ({ id: 'r', number: 7, open, gate: { name: 'g' }, items: statuses.map((status) => ({ status })) }) as unknown as RequestForViews;

describe('toBoardEntry', () => {
  it('READY beats PREPARING; en-route-only and closed are GONE', () => {
    expect(toBoardEntry(mk(true, ['PREPARING', 'READY'])).status).toBe('READY');
    expect(toBoardEntry(mk(true, ['EN_ROUTE', 'PREPARING'])).status).toBe('PREPARING');
    expect(toBoardEntry(mk(true, ['EN_ROUTE'])).status).toBe('GONE');
    expect(toBoardEntry(mk(false, ['READY'])).status).toBe('GONE');
    expect(toBoardEntry(mk(true, ['READY']))).toEqual({ number: 7, gateName: 'g', status: 'READY' });
  });
});
