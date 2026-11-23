'use client';
import { useEffect, useId, useState } from 'react';

const UNAVAILABLE = 'الكاميرا غير متاحة، أدخل الرمز يدوياً';

/** Camera QR scanner. html5-qrcode is loaded dynamically, client-side only. */
export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const id = useId().replace(/:/g, '');
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let scanner: { stop: () => Promise<unknown>; clear: () => void } | null = null;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        const s = new Html5Qrcode(id);
        scanner = s;
        let done = false;
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            if (done) return;
            done = true;
            onScan(text);
          },
          () => {},
        );
      } catch {
        if (!stopped) setError(UNAVAILABLE);
      }
    })();
    return () => {
      stopped = true;
      const s = scanner;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mt-3 rounded-xl border border-navy/10 bg-white p-3">
      {error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : (
        <div id={id} className="mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-black/5" style={{ minHeight: 120 }} />
      )}
      <button type="button" onClick={onClose} className="mt-2 min-h-[44px] w-full rounded-lg border border-navy/20 px-3 text-sm text-navy">
        إغلاق الكاميرا
      </button>
    </div>
  );
}
