import { describe, expect, it } from 'vitest';
import { admitScan, deliverable, inStaffGates, newScanGate, resumeScan, scanFailed, syncPicked } from '../../src/lib/pickup/staff-client';

describe('syncPicked / deliverable', () => {
  it('drops an id cancelled or delivered after verification', () => {
    expect(syncPicked(['a', 'b'], ['a', 'b'], ['a'])).toEqual(['a']);
    expect(deliverable(['a', 'b'], ['a'])).toEqual(['a']);
  });
  it('adds a newly READY id', () => {
    expect(syncPicked(['a'], ['a'], ['a', 'c'])).toEqual(['a', 'c']);
  });
  it('keeps a deliberately unchecked id unchecked', () => {
    expect(syncPicked(['a'], ['a', 'b'], ['a', 'b'])).toEqual(['a']);
  });
  it('checks all READY ids on first sync', () => {
    expect(syncPicked([], [], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('inStaffGates', () => {
  it('ignores other-gate views when gateIds is non-empty', () => {
    expect(inStaffGates({ gateId: 'g2' }, ['g1'])).toBe(false);
    expect(inStaffGates({ gateId: 'g1' }, ['g1'])).toBe(true);
  });
  it('keeps all views when gateIds is empty', () => {
    expect(inStaffGates({ gateId: 'g2' }, [])).toBe(true);
  });
});

describe('scan gate (QR scanner re-arm)', () => {
  it('submits the first read, ignores the identical payload within 5 s, accepts it after', () => {
    let g = newScanGate();
    let r = admitScan(g, 'A', 1000);
    expect(r.submit).toBe(true);
    g = r.gate;
    expect(admitScan(g, 'A', 5999).submit).toBe(false);
    expect(admitScan(g, 'B', 2000).submit).toBe(true);
    r = admitScan(g, 'A', 6000);
    expect(r.submit).toBe(true);
  });
  it('pauses after a failed verification until the staff resumes', () => {
    let g = admitScan(newScanGate(), 'BAD', 0).gate;
    g = scanFailed(g);
    expect(g.paused).toBe(true);
    expect(admitScan(g, 'OTHER', 60_000).submit).toBe(false);
    expect(admitScan(g, 'BAD', 60_000).submit).toBe(false);
    g = resumeScan(g);
    expect(g.paused).toBe(false);
    // an explicit retry may submit the same payload again at once
    expect(admitScan(g, 'BAD', 1).submit).toBe(true);
  });
});
