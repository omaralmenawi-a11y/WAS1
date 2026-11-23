import { describe, expect, it, vi } from 'vitest';

// Regression: server.ts loads src/lib/realtime before next().prepare(). If that graph pulls in
// next/headers or next/navigation, Next's AsyncLocalStorage module is evaluated before Next sets
// globalThis.AsyncLocalStorage, caches a fake, and the first page request crashes with
// "AsyncLocalStorage accessed in runtime where it is not available".
vi.mock('next/headers', () => {
  throw new Error('next/headers must not be imported by the socket layer');
});
vi.mock('next/navigation', () => {
  throw new Error('next/navigation must not be imported by the socket layer');
});

describe('socket layer imported by server.ts', () => {
  it('does not import next/headers or next/navigation', async () => {
    const mod = await import('@/lib/realtime');
    expect(typeof mod.attachRealtime).toBe('function');
    expect(typeof mod.setIo).toBe('function');
  });
  it('pickup service (stale sweep) does not import them either', async () => {
    const mod = await import('@/lib/pickup/service');
    expect(typeof mod.closeStaleRequests).toBe('function');
  });
  it('notify modules do not import them either', async () => {
    const mod = await import('@/lib/notify');
    expect(typeof mod.notify).toBe('function');
    const push = await import('@/lib/notify/push');
    expect(typeof push.pushEnabled).toBe('function');
    const dismissal = await import('@/lib/notify/dismissal');
    expect(typeof dismissal.runDismissalNotifications).toBe('function');
  });
});
