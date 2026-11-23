'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

type CodeData = { code: string; qr: string; expiresInSec: number };

/** Rotating pickup code + QR. Refetches every 30 s and when the code expires. */
export function CodeCard({ requestId, gateName, number }: { requestId: string; gateName: string; number: number }) {
  const [data, setData] = useState<CodeData | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pickups/${requestId}/code`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const d: CodeData = await res.json();
      setData(d);
      setErr(false);
      setQrUrl(await QRCode.toDataURL(d.qr, { margin: 1, width: 240, errorCorrectionLevel: 'M' }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, Math.min(30, Math.max(1, d.expiresInSec + 0.5)) * 1000);
    } catch {
      setErr(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 5000);
    }
  }, [requestId]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-2 ring-teal" aria-label="رمز الاستلام">
      <p className="text-sm text-navy/80">اعرض الرمز على الموظف عند {gateName}</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-28 w-28 flex-none items-center justify-center rounded-lg bg-white ring-1 ring-navy/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qrUrl ? <img src={qrUrl} alt="رمز QR للاستلام" className="h-28 w-28" /> : <span className="text-xs text-navy/50">...</span>}
        </div>
        <div>
          <small className="text-xs text-navy/60">رمز الاستلام</small>
          <div className="font-mono text-3xl font-semibold tracking-[0.2em] text-navy" dir="ltr" aria-live="off">
            {data?.code ?? '······'}
          </div>
          <small className="text-xs text-navy/60">الطلب {number}</small>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">تعذر تحديث الرمز، نعيد المحاولة...</p>}
    </section>
  );
}
