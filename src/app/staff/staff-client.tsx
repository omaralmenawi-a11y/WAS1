'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLive, useOnReconnect } from '@/components/live';
import { StatusChip } from '@/components/StatusChip';
import type { StaffRequestView } from '@/lib/pickup/views';
import { deliverable, sortStaffViews, inStaffGates, syncPicked } from '@/lib/pickup/staff-client';

const QrScanner = dynamic(() => import('@/components/QrScanner').then((m) => m.QrScanner), { ssr: false });

type Verified = {
  requestId: string;
  recipient: { name: string; role: string; photoKey: string | null };
  items: { itemId: string; studentName: string; status: string }[];
};

const btn = 'min-h-[44px] rounded-lg px-4 text-sm font-medium disabled:opacity-50';
const primary = `${btn} bg-navy text-white`;
const secondary = `${btn} border border-navy/20 bg-white text-navy`;
const ok = `${btn} bg-teal text-white`;

function etaText(r: StaffRequestView): string | null {
  if (r.arrivedAt || r.etaSeconds === 0) return 'وصل';
  if (r.etaSeconds == null) return null;
  return `يصل خلال ${Math.max(1, Math.ceil(r.etaSeconds / 60))} د`;
}

function roleLabel(role: string) {
  return role === 'GUARDIAN' ? 'ولي أمر' : role === 'DELEGATE' ? 'مفوّض' : role;
}

export function StaffClient({ gateIds }: { gateIds: string[] }) {
  const [list, setList] = useState<StaffRequestView[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const [verified, setVerified] = useState<Verified | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff/requests?q=${encodeURIComponent(qRef.current.trim())}`, { cache: 'no-store' });
      if (res.status === 401) return window.location.assign('/login');
      if (!res.ok) throw new Error();
      setList(await res.json());
      setError('');
    } catch {
      setError('تعذر تحميل الطلبات، حاول مرة أخرى');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  useLive<StaffRequestView>('pickup:changed', (v) => {
    setList((cur) => {
      if (!cur) return cur;
      const rest = cur.filter((r) => r.id !== v.id);
      if (!v.open || !inStaffGates(v, gateIds)) return rest;
      const term = qRef.current.trim();
      const matches = !term || String(v.number) === term || v.items.some((i) => i.studentName.toLowerCase().includes(term.toLowerCase()));
      return sortStaffViews(matches ? [...rest, v] : rest);
    });
    setVerified((cur) => (cur && cur.requestId === v.id && !v.open ? null : cur));
  });
  useOnReconnect(load);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="الطلبات">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث باسم الطالب أو رقم الطلب"
          aria-label="بحث"
          className="mb-3 min-h-[44px] w-full rounded-lg border border-navy/20 bg-white px-3"
        />
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        {list === null ? (
          <p className="py-10 text-center text-navy/60">جارٍ التحميل...</p>
        ) : list.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-navy/60 ring-1 ring-navy/10">
            {q ? 'لا يوجد طلب يطابق البحث.' : 'لا توجد طلبات نشطة حالياً.'}
          </p>
        ) : (
          <ul className="grid gap-3">
            {list.map((r) => (
              <RequestCard key={r.id} r={r} onChanged={load} />
            ))}
          </ul>
        )}
      </section>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <VerifyPanel list={list ?? []} verified={verified} setVerified={setVerified} />
      </aside>
    </div>
  );
}

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'حدث خطأ غير متوقع، حاول مرة أخرى');
  return data;
}

function RequestCard({ r, onChanged }: { r: StaffRequestView; onChanged: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const eta = etaText(r);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-navy/10">
      <div className="flex items-start gap-3">
        <span dir="ltr" className="rounded-lg bg-mist px-3 py-1.5 font-heading text-lg font-semibold text-navy">{r.number}</span>
        <div className="min-w-0 flex-1 text-sm text-navy/70">
          <div>{r.gateName} · {r.requesterName}</div>
          {eta && <div className="font-medium text-navy">{eta}</div>}
        </div>
      </div>
      <ul className="mt-3 divide-y divide-navy/10">
        {r.items.map((i) => (
          <li key={i.itemId} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{i.studentName}</div>
              <div className="text-xs text-navy/60">{i.classroomName}</div>
            </div>
            <StatusChip status={i.status} />
            {i.status === 'EN_ROUTE' && (
              <button type="button" className={primary} disabled={busy} onClick={() => run(() => call(`/api/staff/items/${i.itemId}`, 'PATCH', { action: 'PREPARE' }))}>
                بدء التجهيز
              </button>
            )}
            {i.status === 'PREPARING' && (
              <button type="button" className={ok} disabled={busy} onClick={() => run(() => call(`/api/staff/items/${i.itemId}`, 'PATCH', { action: 'READY' }))}>
                تأكيد الجاهزية
              </button>
            )}
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-2">
        {cancelling ? (
          <div className="flex flex-wrap gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-navy/20 px-3" />
            <button type="button" className={`${btn} bg-red-700 text-white`} disabled={busy || !reason.trim()} onClick={() => run(() => call(`/api/staff/requests/${r.id}/cancel`, 'POST', { reasonAr: reason }))}>
              تأكيد الإلغاء
            </button>
            <button type="button" className={secondary} onClick={() => setCancelling(false)}>تراجع</button>
          </div>
        ) : (
          <button type="button" className="min-h-[44px] text-sm text-red-700 underline" onClick={() => setCancelling(true)}>إلغاء الطلب</button>
        )}
      </div>
    </li>
  );
}

function VerifyPanel({ list, verified, setVerified }: { list: StaffRequestView[]; verified: Verified | null; setVerified: (v: Verified | null) => void }) {
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // Keep the readiness of the verified request live from the list.
  const live = verified ? list.find((r) => r.id === verified.requestId) : null;
  const items = verified ? verified.items.map((i) => ({ ...i, status: live?.items.find((x) => x.itemId === i.itemId)?.status ?? i.status })) : [];
  const ready = items.filter((i) => i.status === 'READY');

  const readyKey = ready.map((i) => i.itemId).join(',');
  const prevReady = useRef<string[]>([]);
  useEffect(() => {
    const ids = readyKey ? readyKey.split(',') : [];
    const prev = prevReady.current; // capture now: the updater below runs after the ref is reassigned
    prevReady.current = ids;
    setPicked((p) => syncPicked(p, prev, ids));
  }, [readyKey]);
  useEffect(() => {
    if (!verified) prevReady.current = [];
  }, [verified]);

  async function verify(body: Record<string, string>) {
    setBusy(true);
    setErr('');
    try {
      setVerified(await call('/api/staff/verify', 'POST', body));
      setCode('');
      setScanning(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deliver() {
    if (!verified) return;
    setBusy(true);
    setErr('');
    try {
      await call('/api/staff/deliver', 'POST', { requestId: verified.requestId, itemIds: deliverable(picked, ready.map((i) => i.itemId)) });
      setVerified(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-navy/10">
      <h2 className="font-heading text-base text-navy">التحقق من المستلم</h2>
      {!verified ? (
        <>
          <select value={requestId} onChange={(e) => setRequestId(e.target.value)} aria-label="الطلب" className="mt-3 min-h-[44px] w-full rounded-lg border border-navy/20 bg-white px-3 text-sm">
            <option value="">كل الطلبات</option>
            {list.map((r) => (
              <option key={r.id} value={r.id}>طلب {r.number} · {r.items.map((i) => i.studentName).join('، ')}</option>
            ))}
          </select>
          <div className="mt-2 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              dir="ltr"
              placeholder="الرمز (6 أرقام)"
              aria-label="رمز الاستلام"
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-navy/20 px-3 text-center font-heading tracking-[0.3em]"
            />
            <button type="button" className={primary} disabled={busy || code.length !== 6} onClick={() => verify({ code, ...(requestId ? { requestId } : {}) })}>
              تحقق
            </button>
          </div>
          <button type="button" className={`${secondary} mt-2 w-full`} onClick={() => setScanning((s) => !s)}>
            مسح QR
          </button>
          {scanning && <QrScanner onScan={(t) => verify({ qr: t })} onClose={() => setScanning(false)} />}
        </>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-mist text-navy/50" aria-label={verified.recipient.photoKey ? 'صورة المستلم' : 'لا توجد صورة'}>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6z" /></svg>
            </div>
            <div>
              <div className="font-medium">{verified.recipient.name}</div>
              <div className="text-sm text-teal">{roleLabel(verified.recipient.role)}</div>
            </div>
          </div>
          {ready.length === 0 ? (
            <p className="mt-3 text-sm text-navy/70">لا يوجد أبناء جاهزون للتسليم بعد.</p>
          ) : (
            <ul className="mt-3 grid gap-1">
              {ready.map((i) => (
                <li key={i.itemId}>
                  <label className="flex min-h-[44px] items-center gap-3 rounded-lg px-2 hover:bg-mist">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-teal"
                      checked={picked.includes(i.itemId)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.itemId] : p.filter((x) => x !== i.itemId)))}
                    />
                    {i.studentName}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" className={`${ok} flex-1`} disabled={busy || picked.length === 0} onClick={deliver}>تأكيد التسليم</button>
            <button type="button" className={secondary} onClick={() => { setVerified(null); setErr(''); }}>إلغاء</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
