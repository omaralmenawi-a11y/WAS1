import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));

const { WebPushSender } = await import('../../src/lib/notify/push');

const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'p', auth: 'a' };
const sender = new WebPushSender('pub', 'priv', 'mailto:a@b.c');

beforeEach(() => {
  sendNotification.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('WebPushSender', () => {
  it('ok when web-push resolves, passing keys and VAPID details', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    expect(await sender.send(sub, '{}')).toBe('ok');
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      '{}',
      expect.objectContaining({ vapidDetails: { subject: 'mailto:a@b.c', publicKey: 'pub', privateKey: 'priv' } }),
    );
  });

  it.each([404, 410])('maps %i to gone', async (statusCode) => {
    sendNotification.mockRejectedValue(Object.assign(new Error('x'), { statusCode }));
    expect(await sender.send(sub, '{}')).toBe('gone');
  });

  it.each([400, 401, 403, 413, 429, 500, 503])('maps %i to error', async (statusCode) => {
    sendNotification.mockRejectedValue(Object.assign(new Error('x'), { statusCode }));
    expect(await sender.send(sub, '{}')).toBe('error');
  });

  it('maps a network failure (no status) to error', async () => {
    sendNotification.mockRejectedValue(new Error('ECONNRESET'));
    expect(await sender.send(sub, '{}')).toBe('error');
  });
});
