'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeCard } from '@/components/CodeCard';
import { StatusChip } from '@/components/StatusChip';
import { useLive, useOnReconnect } from '@/components/live';
import type { OwnerRequestView } from '@/lib/pickup/views';

type View = OwnerRequestView & { arrivedAt?: string | null; deliveredAt?: string | null };
type Consent = 'unknown' | 'granted' | 'declined' | 'denied';

const SEND_EVERY_MS = 15_000;
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const consentKey = (id: string) => `wasl_loc_consent_${id}`;

function readConsent(id: string): Consent {
  try {
    const v = sessionStorage.getItem(consentKey(id));
    return v === '1' ? 'granted' : v === '0' ? 'declined' : 'unknown';
  } catch {
    return 'unknown';
  }
}
function saveConsent(id: string, ok: boolean) {
  try {
    sessionStorage.setItem(consentKey(id), ok ? '1' : '0');
  } catch {}
}

export function RequestClient({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [consent, setConsent] = useState<Consent>('unknown');
  const [consentReady, setConsentReady] = useState(false);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pickups/${id}`, { cache: 'no-store' });
      if (res.status === 401) return window.location.assign('/login');
      if (res.status === 404) return setMissing(true);
      if (!res.ok) throw new Error();
      setView(await res.json());
    } catch {
      setError('تعذر تحميل الطلب، حاول مرة أخرى');
    }
  }, [id]);

  useEffect(() => {
    setConsent(readConsent(id));
    setConsentReady(true);
    load();
  }, [id, load]);
  useLive<OwnerRequestView>('pickup:changed', (p) => {
    if (p.id !== id) return;
    setView((v) => ({ ...(v ?? {}), ...p }));
    if (!p.open) load();
  });
  useOnReconnect(load);

  const open = view?.open ?? false;
  const watching = open && consent === 'granted';

  // Location sharing: at most one POST per 15 s, stops on close / unmount / denial.
  const lastSentAt = useRef(0);
  useEffect(() => {
    if (!watching || !('geolocation' in navigator)) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        const t = Date.now();
        if (t - lastSentAt.current < SEND_EVERY_MS) return;
        lastSentAt.current = t;
        fetch(`/api/pickups/${id}/location`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        })
          .then((r) => {
            if (r.ok) setLastSent(new Date());
          })
          .catch(() => {});
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setConsent('denied');
      },
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [watching, id]);

  async function act(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message || 'تعذر تنفيذ الإجراء');
        return false;
      }
      return true;
    } catch {
      setError('تعذر الاتصال بالخادم');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (missing)
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-navy/10">
        <p>الطلب غير موجود</p>
        <Link href="/parent" className="mt-2 inline-block text-teal">العودة للرئيسية</Link>
      </div>
    );
  if (!view) return <p className="py-10 text-center text-navy/60">{error || 'جارٍ التحميل...'}</p>;

  const anyReady = view.items.some((i) => i.status === 'READY');
  const delivered = view.items.some((i) => i.status === 'DELIVERED');
  const etaMin = view.etaSeconds != null ? Math.max(1, Math.round(view.etaSeconds / 60)) : null;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg">الطلب {view.number}</h1>
        <Link href="/parent" className="text-sm text-teal">الرئيسية</Link>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-navy/10">
        <p className="text-sm text-navy/70">البوابة: <b className="text-navy">{view.gateName}</b></p>
        <ul className="mt-3 divide-y divide-navy/10">
          {view.items.map((i) => (
            <li key={i.itemId} className="flex items-center justify-between gap-2 py-2">
              <span className="truncate font-medium">{i.studentName}</span>
              <StatusChip status={i.status} />
            </li>
          ))}
        </ul>
        {open && etaMin != null && <p className="mt-2 text-sm text-navy/70">الوصول المتوقع خلال حوالي {etaMin} دقيقة</p>}
      </section>

      {!open && (
        <p className="rounded-xl bg-white p-4 text-center font-medium shadow-sm ring-1 ring-navy/10" role="status">
          {delivered && view.deliveredAt ? (
            <>تم التسليم الساعة <span dir="ltr">{timeFmt.format(new Date(view.deliveredAt))}</span></>
          ) : (
            'تم إلغاء الطلب'
          )}
        </p>
      )}

      {open && anyReady && <CodeCard requestId={id} gateName={view.gateName} number={view.number} />}

      {open && consent === 'granted' && (
        <p className="flex items-center gap-2 text-sm text-sky-800">
          <span className="h-2 w-2 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden />
          مشاركة موقعك نشطة{lastSent && <span className="text-navy/60"> · آخر إرسال <span dir="ltr">{timeFmt.format(lastSent)}</span></span>}
        </p>
      )}
      {open && (consent === 'denied' || consent === 'declined') && (
        <p className="rounded-lg bg-white p-3 text-sm text-navy/80 ring-1 ring-navy/10">تم إرسال الطلب بدون مشاركة الموقع</p>
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      {open && (
        <div className="space-y-2">
          {view.arrivedAt ? (
            <p className="rounded-xl bg-teal/10 p-3 text-center text-sm font-medium text-teal">تم إبلاغ المدرسة بوصولك</p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await act(`/api/pickups/${id}/arrived`, { method: 'POST' })) load();
              }}
              className="w-full rounded-xl bg-teal px-4 py-4 text-lg font-bold text-white disabled:opacity-60"
            >
              وصلت
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('هل تريد إلغاء الطلب؟')) return;
              if (await act(`/api/pickups/${id}`, { method: 'DELETE' })) router.push('/parent');
            }}
            className="w-full rounded-xl border border-navy/20 bg-white px-4 py-3 font-medium text-navy disabled:opacity-60"
          >
            إلغاء الطلب
          </button>
        </div>
      )}

      {open && consentReady && consent === 'unknown' && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-navy/50" role="dialog" aria-modal="true" aria-labelledby="consent-t">
          <div className="w-full max-w-md space-y-4 rounded-t-2xl bg-white p-5">
            <h2 id="consent-t" className="font-heading text-lg">مشاركة الموقع</h2>
            <p className="text-sm leading-relaxed">يُشارك موقعك مع المدرسة خلال هذه الرحلة فقط ويتوقف عند التسليم</p>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full rounded-xl bg-teal px-4 py-3 font-bold text-white"
                onClick={() => {
                  saveConsent(id, true);
                  setConsent('granted');
                }}
              >
                موافق
              </button>
              <button
                type="button"
                className="w-full rounded-xl border border-navy/20 px-4 py-3 font-medium"
                onClick={() => {
                  saveConsent(id, false);
                  setConsent('declined');
                }}
              >
                متابعة بدون مشاركة الموقع
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
