import { describe, expect, it } from 'vitest';
import { parseCookie } from '@/lib/cookies';

describe('parseCookie', () => {
  it('reads a named cookie', () => {
    expect(parseCookie('a=1; wasl_session=abc%20d; b=2', 'wasl_session')).toBe('abc d');
  });
  it('returns undefined when missing or header empty', () => {
    expect(parseCookie('a=1', 'wasl_session')).toBeUndefined();
    expect(parseCookie(undefined, 'x')).toBeUndefined();
    expect(parseCookie(null, 'x')).toBeUndefined();
  });
  it('does not match a name prefix', () => {
    expect(parseCookie('xwasl_session=1', 'wasl_session')).toBeUndefined();
  });
  it('returns undefined on malformed encoding instead of throwing', () => {
    expect(parseCookie('wasl_session=%E0%A4%A', 'wasl_session')).toBeUndefined();
  });
});
