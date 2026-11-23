// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const made: { opts: any; disconnect: ReturnType<typeof vi.fn> }[] = [];
vi.mock('socket.io-client', () => ({
  io: (opts: any) => {
    const s = { opts, disconnect: vi.fn() };
    made.push(s);
    return s;
  },
}));

beforeEach(() => {
  made.length = 0;
  vi.resetModules();
  (globalThis as any).window = {};
});

describe('live sockets', () => {
  it('getSocket is a singleton; resetSocket disconnects it and the next call reconnects', async () => {
    const { getSocket, resetSocket } = await import('../../src/components/live');
    const a = getSocket();
    expect(getSocket()).toBe(a);
    resetSocket();
    expect((a as any).disconnect).toHaveBeenCalledTimes(1);
    expect(getSocket()).not.toBe(a);
    expect(made).toHaveLength(2);
  });

  it('board sockets are separate, keyed by token, and never returned by getSocket', async () => {
    const { getSocket, getBoardSocket, resetSocket } = await import('../../src/components/live');
    const u = getSocket();
    const b1 = getBoardSocket('t1');
    expect(b1).not.toBe(u);
    expect(getBoardSocket('t1')).toBe(b1);
    expect(getBoardSocket('t2')).not.toBe(b1);
    expect((b1 as any).opts.query).toEqual({ board: 't1' });
    expect((u as any).opts.query).toBeUndefined();
    resetSocket();
    expect((b1 as any).disconnect).not.toHaveBeenCalled();
    expect(getSocket()).not.toBe(b1);
  });
});
