'use client';
import { useEffect } from 'react';
import { syncSubscription } from './PushToggle';

let done = false;

/** Once per page load: if this device already has a push subscription, claim it for the logged-in user. */
export function PushSync() {
  useEffect(() => {
    if (done) return;
    done = true;
    (async () => {
      try {
        if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) await syncSubscription(sub);
      } catch {}
    })();
  }, []);
  return null;
}
