'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const cardCls = 'space-y-3 rounded-xl bg-white p-4 ring-1 ring-navy/10';
export const inputCls =
  'rounded-lg border border-navy/20 bg-white px-3 py-2 text-navy outline-none focus:border-teal focus:ring-2 focus:ring-teal/30';
export const primaryBtn = 'rounded-lg bg-navy px-4 py-2 font-medium text-white hover:bg-navy/90 disabled:opacity-60';
export const tealBtn = 'rounded-lg bg-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-teal/90 disabled:opacity-60';
export const dangerBtn = 'rounded-lg px-3 py-1.5 text-sm text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-60';

/** Calls a JSON API, refreshes server data on success, exposes the Arabic error. */
export function useApi() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function call(method: string, url: string, body?: unknown): Promise<boolean> {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'حدث خطأ غير متوقع');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('تعذر الاتصال بالخادم');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { call, error, busy };
}

export function Err({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </p>
  ) : null;
}
