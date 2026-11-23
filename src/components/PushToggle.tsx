'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { iosNeedsInstall } from './parent-ui';

type State = 'loading' | 'hidden' | 'off' | 'on' | 'denied' | 'ios' | 'busy';

function keyToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Re-assert ownership: the upsert moves a subscription left by a previous user of this device. */
export async function syncSubscription(sub: PushSubscription): Promise<void> {
  try {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
    });
  } catch {}
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function PushToggle() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  // Status lines (enabled/denied/iOS) only on the notifications page; elsewhere just the call to action.
  const onInbox = usePathname() === '/parent/notifications';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/push/key');
        const { publicKey } = res.ok ? await res.json() : { publicKey: null };
        if (!publicKey) return alive && setState('hidden');
        if (iosNeedsInstall()) return alive && setState('ios');
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return alive && setState('hidden');
        if (Notification.permission === 'denied') return alive && setState('denied');
        const sub = Notification.permission === 'granted' ? await currentSub() : null;
        if (sub) await syncSubscription(sub);
        if (alive) setState(sub ? 'on' : 'off');
      } catch {
        if (alive) setState('hidden');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setError('');
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState(perm === 'denied' ? 'denied' : 'off');
      const { publicKey } = await (await fetch('/api/push/key')).json();
      if (!publicKey) return setState('hidden');
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource }));
      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error('subscribe failed');
      setState('on');
    } catch {
      setError('تعذر تفعيل الإشعارات، حاول مرة أخرى');
      setState('off');
    }
  }

  if (state === 'loading' || state === 'hidden') return null;
  if (!onInbox && state !== 'off' && state !== 'busy') return null;
  const box = 'rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-navy/10';
  if (state === 'ios') return <p className={box} role="note">يتطلب الآيفون إضافة وصل إلى الشاشة الرئيسية أولاً</p>;
  if (state === 'denied') return <p className={box} role="note">الإشعارات محظورة من إعدادات المتصفح</p>;
  if (state === 'on') return <p className={`${box} text-teal`} role="status">الإشعارات مفعّلة على هذا الجهاز</p>;
  return (
    <div className={box}>
      <button
        type="button"
        onClick={enable}
        disabled={state === 'busy'}
        className="w-full rounded-lg bg-teal px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        تفعيل الإشعارات
      </button>
      {error && <p className="mt-2 text-red-700" role="alert">{error}</p>}
    </div>
  );
}
