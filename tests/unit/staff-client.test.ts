import { describe, expect, it } from 'vitest';
import { deliverable, inStaffGates, syncPicked } from '../../src/lib/pickup/staff-client';

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
