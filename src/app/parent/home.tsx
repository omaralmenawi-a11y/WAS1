'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ChildCard } from '@/components/ChildCard';
import { useLive, useOnReconnect } from '@/components/live';
import type { ChildView } from '@/lib/guardian/children';

export function HomeClient() {
  const router = useRouter();
  const [children, setChildren] = useState<ChildView[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/children', { cache: 'no-store' });
      if (res.status === 401) return window.location.assign('/login');
      if (!res.ok) throw new Error();
      const list: ChildView[] = await res.json();
      setChildren(list);
      setSelected((sel) => sel.filter((id) => list.some((c) => c.studentId === id && !c.activeRequestId)));
    } catch {
      setError('تعذر تحميل البيانات، حاول مرة أخرى');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLive('pickup:changed', load);
  useOnReconnect(load);

  if (!children) return <p className="py-10 text-center text-navy/60">{error || 'جارٍ التحميل...'}</p>;
  if (children.length === 0)
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-navy/10">
        <p className="font-medium">لا يوجد أبناء مرتبطون بحسابك</p>
        <p className="mt-1 text-sm text-navy/70">تأكد من أن رقم جوالك مسجل لدى المدرسة، أو تواصل مع إدارة المدرسة.</p>
      </div>
    );

  const byId = new Map(children.map((c) => [c.studentId, c]));
  const toggle = (c: ChildView) => {
    setError('');
    setNote('');
    setSelected((sel) => {
      if (sel.includes(c.studentId)) return sel.filter((x) => x !== c.studentId);
      const other = sel.some((id) => byId.get(id)?.branchId !== c.branchId);
      if (other) {
        setNote('لا يمكن جمع أبناء من فروع مختلفة في طلب واحد، تم تحديد ' + c.fullName + ' فقط');
        return [c.studentId];
      }
      return [...sel, c.studentId];
    });
  };

  const chosen = selected.map((id) => byId.get(id)!).filter(Boolean);
  const blocked = chosen.find((c) => !c.canRequest.ok);
  const selectable = children.filter((c) => !c.activeRequestId && c.status !== 'DELIVERED');
  const reason = blocked
    ? blocked.canRequest.reasonAr
    : chosen.length === 0 && selectable.length > 0 && selectable.every((c) => !c.canRequest.ok)
      ? selectable[0].canRequest.reasonAr
      : '';

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/pickups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentIds: selected }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.message || 'تعذر إنشاء الطلب');
        setBusy(false);
        return;
      }
      router.push(`/parent/request/${d.id}`);
    } catch {
      setError('تعذر الاتصال بالخادم');
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-heading text-lg">أبنائي</h1>
      {children.map((c) => (
        <ChildCard
          key={c.studentId}
          child={c}
          selected={selected.includes(c.studentId)}
          onToggle={() => toggle(c)}
          footer={
            c.activeRequestId ? (
              <Link href={`/parent/request/${c.activeRequestId}`} className="mt-3 block rounded-lg bg-navy px-4 py-2 text-center text-sm font-medium text-white">
                متابعة الطلب
              </Link>
            ) : null
          }
        />
      ))}
      {note && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {selectable.length > 0 && (
        <div className="sticky bottom-0 -mx-4 space-y-2 bg-mist/95 px-4 pb-4 pt-2 backdrop-blur">
          {reason && <p className="text-center text-sm text-navy/70">{reason}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || chosen.length === 0 || !!blocked}
            className="w-full rounded-xl bg-teal px-4 py-4 text-lg font-bold text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? 'جارٍ الإرسال...' : 'أنا في الطريق'}
          </button>
        </div>
      )}
    </>
  );
}
