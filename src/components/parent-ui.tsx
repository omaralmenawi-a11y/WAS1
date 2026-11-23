'use client';
import { useEffect, useState } from 'react';
import { logout } from './live';

export function LogoutButton() {
  return (
    <button type="button" onClick={() => logout('/login')} className="rounded-lg border border-white/30 px-3 py-1 text-sm hover:bg-white/10">
      تسجيل الخروج
    </button>
  );
}

const HINT_KEY = 'wasl_ios_hint_dismissed';

/** True on iOS Safari when the app is not installed to the home screen. */
export function iosNeedsInstall(): boolean {
  try {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    return ios && safari && !standalone;
  } catch {
    return false;
  }
}

/** iOS Safari only, not installed, dismissible. */
export function IosInstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch {}
    setShow(iosNeedsInstall() && !dismissed);
  }, []);
  if (!show) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border-s-4 border-teal bg-white p-3 text-sm shadow-sm" role="note">
      <p className="flex-1">أضف وصل إلى الشاشة الرئيسية: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».</p>
      <button
        type="button"
        aria-label="إغلاق"
        className="text-lg leading-none text-navy/50"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(HINT_KEY, '1');
          } catch {}
        }}
      >
        ×
      </button>
    </div>
  );
}
