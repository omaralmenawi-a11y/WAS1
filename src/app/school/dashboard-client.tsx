'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJoinBranch, useLive, useOnReconnect } from '@/components/live';
import { StatusChip } from '@/components/StatusChip';
import { Err, dangerBtn, tealBtn } from '@/components/school-ui';
import type { StaffRequestView } from '@/lib/pickup/views';
import { sortStaffViews, topStatus } from '@/lib/pickup/staff-client';
import type { Dashboard } from '@/lib/school/dashboard';
import { etaCell, formatMmSs, lastUpdate } from '@/lib/school/dashboard-client';

const KEY = 'wasl_school_branch';

function readSaved(branches: { id: string }[]): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && branches.some((b) => b.id === v)) return v;
  } catch {}
  return branches[0].id;
}

export function DashboardClient({ branches }: { branches: { id: string; name: string }[] }) {
  const [branchId, setBranchId] = useState(branches[0].id);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(() => Date.now());
  const branchRef = useRef(branchId);
  branchRef.current = branchId;

  useEffect(() => setBranchId(readSaved(branches)), [branches]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const id = branchRef.current;
    try {
      const res = await fetch(`/api/school/dashboard?branchId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (res.status === 401) return window.location.assign('/login');
      if (!res.ok) throw new Error();
      const d: Dashboard = await res.json();
      if (branchRef.current !== id) return;
      setData(d);
      setError('');
    } catch {
      setError('تعذر تحميل البيانات، حاول مرة أخرى');
    }
  }, []);

  useEffect(() => {
    setData(null);
    load();
  }, [branchId, load]);

  useJoinBranch(branchId);
  useOnReconnect(load);

  // Debounced refetch of counts / feed after realtime events.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLive<StaffRequestView>('pickup:changed', (v) => {
    if (v.branchId !== branchRef.current) return;
    setData((cur) => {
      if (!cur) return cur;
      const rest = cur.requests.filter((r) => r.id !== v.id);
      return { ...cur, requests: v.open ? sortStaffViews([...rest, v]) : rest };
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 1000);
  });

  function pick(id: string) {
    setBranchId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }

  const c = data?.counts;
  const tiles: [string, string][] = [
    ['طلبات نشطة', c ? String(c.open) : '—'],
    ['في الطريق', c ? String(c.enRoute) : '—'],
    ['قيد التجهيز', c ? String(c.preparing) : '—'],
    ['جاهز', c ? String(c.ready) : '—'],
    ['تم التسليم اليوم', c ? String(c.deliveredToday) : '—'],
    ['متوسط الانتظار', data ? formatMmSs(data.avgWaitSecToday) : '—'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="branch" className="text-sm text-navy/70">الفرع</label>
        <select
          id="branch"
          value={branchId}
          onChange={(e) => pick(e.target.value)}
          className="min-h-[44px] rounded-lg border border-navy/20 bg-white px-3 text-navy outline-none focus:border-teal"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <Err text={error} />

      <section aria-label="المؤشرات" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white p-4 ring-1 ring-navy/10">
            <div className="text-xs text-navy/60">{label}</div>
            <div className="mt-1 font-heading text-3xl font-bold text-navy"><bdi>{value}</bdi></div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="الطلبات الحالية" className="min-w-0 rounded-xl bg-white ring-1 ring-navy/10">
          <h2 className="px-4 pt-4 font-heading text-lg text-navy">الطلبات الحالية</h2>
          {data && data.requests.length === 0 ? (
            <p className="p-4 text-navy/60">لا توجد طلبات نشطة الآن.</p>
          ) : (
            <div className="overflow-x-auto p-2">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-start text-navy/60">
                    {['الرقم', 'الطلاب', 'الصفوف', 'البوابة', 'الوصول', 'آخر تحديث', 'الحالة'].map((h) => (
                      <th key={h} className="px-2 py-2 text-start font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.requests ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-navy/10 align-top">
                      <td className="px-2 py-2 font-heading font-bold text-navy">{r.number}</td>
                      <td className="px-2 py-2">{r.items.map((i) => i.studentName).join('، ')}</td>
                      <td className="px-2 py-2">{[...new Set(r.items.map((i) => i.classroomName))].join('، ')}</td>
                      <td className="px-2 py-2">{r.gateName}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{etaCell(r)}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-navy/60">{lastUpdate(r.locationAt, tick)}</td>
                      <td className="px-2 py-2"><StatusChip status={topStatus(r)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <BoardLink branchId={branchId} token={data?.branch.boardToken ?? null} onChanged={load} />
          <section aria-label="آخر الأحداث" className="rounded-xl bg-white p-4 ring-1 ring-navy/10">
            <h2 className="font-heading text-lg text-navy">آخر الأحداث</h2>
            {data && data.recent.length === 0 ? (
              <p className="mt-2 text-sm text-navy/60">لا توجد أحداث بعد.</p>
            ) : (
              <ul className="mt-2 max-h-96 divide-y divide-navy/10 overflow-y-auto text-sm">
                {(data?.recent ?? []).map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="text-navy">{e.text}</div>
                    <time className="text-xs text-navy/50" dateTime={e.at}>
                      {new Date(e.at).toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BoardLink({ branchId, token, onChanged }: { branchId: string; token: string | null; onChanged: () => void }) {
  const [origin, setOrigin] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => { setConfirming(false); setMsg(''); setErr(''); }, [branchId]);
  const url = token ? `${origin}/board/${token}` : '';

  async function copy() {
    setErr('');
    try {
      await navigator.clipboard.writeText(url);
      setMsg('تم نسخ الرابط');
    } catch {
      urlRef.current?.focus();
      urlRef.current?.select();
      setMsg('حدد الرابط ثم انسخه يدوياً');
    }
  }

  async function regenerate() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch(`/api/school/branches/${encodeURIComponent(branchId)}/board-token`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setConfirming(false);
      setMsg('تم تجديد الرابط. الرابط القديم لم يعد يعمل');
      onChanged();
    } catch {
      setErr('تعذر تجديد الرابط، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="شاشة الانصراف" className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-navy/10">
      <h2 className="font-heading text-lg text-navy">فتح شاشة الانصراف</h2>
      <input
        ref={urlRef}
        readOnly
        value={url}
        dir="ltr"
        aria-label="رابط شاشة الانصراف"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-navy/20 bg-mist px-3 py-2 text-xs text-navy"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} disabled={!token} className={tealBtn}>نسخ الرابط</button>
        {token && (
          <a href={url} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-sm text-navy ring-1 ring-navy/20 hover:bg-mist">فتح</a>
        )}
        {!confirming && (
          <button type="button" onClick={() => setConfirming(true)} disabled={!token} className={dangerBtn}>تجديد الرابط</button>
        )}
      </div>
      {confirming && (
        <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>سيتوقف الرابط الحالي عن العمل وستحتاج إلى فتح الرابط الجديد على الشاشة.</p>
          <div className="flex gap-2">
            <button type="button" onClick={regenerate} disabled={busy} className={dangerBtn}>تأكيد التجديد</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-navy ring-1 ring-navy/20 hover:bg-white">إلغاء</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="text-sm text-teal">{msg}</p>}
      <Err text={err} />
    </section>
  );
}
