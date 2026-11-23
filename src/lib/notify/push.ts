import * as webpush from 'web-push';
import { VAPID_SUBJECT_RE } from '../env-check';

// Must not import next/headers or next/navigation: reachable from server.ts (see tests/unit/server-imports.test.ts).

export interface PushSender {
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<'ok' | 'gone' | 'error'>;
}

export class WebPushSender implements PushSender {
  constructor(publicKey: string, private privateKey: string, private subject: string) {
    this.publicKey = publicKey;
  }
  private publicKey: string;

  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<'ok' | 'gone' | 'error'> {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
        timeout: 10_000,
      });
      return 'ok';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.error('web push failed', status ?? e);
      return 'error';
    }
  }
}

let override: PushSender | null | undefined; // undefined = use env
let envSender: PushSender | null | undefined;

function fromEnv(): PushSender | null {
  if (envSender !== undefined) return envSender;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  envSender = pub && priv && subject && VAPID_SUBJECT_RE.test(subject) ? new WebPushSender(pub, priv, subject) : null;
  return envSender;
}

/** Tests: inject a sender (or null for "none"). */
export function setPushSender(s: PushSender | null): void {
  override = s;
  envSender = undefined;
}

export function getPushSender(): PushSender | null {
  return override ?? (override === null ? null : fromEnv());
}

export function pushEnabled(): boolean {
  return getPushSender() !== null;
}
