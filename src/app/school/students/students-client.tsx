'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Err, cardCls, dangerBtn, inputCls, primaryBtn, tealBtn, useApi } from '@/components/school-ui';

type Branch = { id: string; name: string; gates: { id: string; name: string }[]; classrooms: { id: string; name: string }[] };
type Student = {
  id: string; externalId: string; fullName: string; branchId: string; branchName: string;
  classroomId: string; classroomName: string; gateId: string; phones: string[]; active: boolean;
};
type Msg = { row: number; messageAr: string };
type Summary = { created: number; updated: number; errors: Msg[]; warnings: Msg[] };

const empty = (b?: Branch) => ({ id: '', externalId: '', fullName: '', branchId: b?.id ?? '', classroomId: b?.classrooms[0]?.id ?? '', gateId: b?.gates[0]?.id ?? '', phones: '' });

type Filter = { search: string; branchId: string; classroomId: string };
type Paging = { page: number; pageSize: number; total: number };

/** Search, filters and paging run on the server: they live in the URL and the page re-renders one page of 50. */
export function StudentsClient({ branches, students, filter, paging }: { branches: Branch[]; students: Student[]; filter: Filter; paging: Paging }) {
  const { call, error, busy } = useApi();
  const router = useRouter();
  const [search, setSearch] = useState(filter.search);
  const fBranch = filter.branchId;
  const fClass = filter.classroomId;
  const pages = Math.max(1, Math.ceil(paging.total / paging.pageSize));
  const [f, setF] = useState(empty(branches[0]));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upErr, setUpErr] = useState('');
  const [upBusy, setUpBusy] = useState(false);

  const branch = branches.find((b) => b.id === f.branchId);
  const filterClasses = branches.find((b) => b.id === fBranch)?.classrooms ?? branches.flatMap((b) => b.classrooms);
  const shown = students;

  function go(next: Partial<Filter> & { page?: number }) {
    const f = { ...filter, search: search.trim(), ...next };
    const qs = new URLSearchParams();
    if (f.search) qs.set('search', f.search);
    if (f.branchId) qs.set('branchId', f.branchId);
    if (f.classroomId) qs.set('classroomId', f.classroomId);
    if (next.page && next.page > 1) qs.set('page', String(next.page));
    const s = qs.toString();
    router.replace(s ? `?${s}` : '?', { scroll: false });
  }
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (search.trim() === filter.search) return;
    const t = setTimeout(() => goRef.current({ search: search.trim() }), 300);
    return () => clearTimeout(t);
  }, [search, filter.search]);

  const setBranch = (id: string) => {
    const b = branches.find((x) => x.id === id);
    setF({ ...f, branchId: id, classroomId: b?.classrooms[0]?.id ?? '', gateId: b?.gates[0]?.id ?? '' });
  };
  const phones = () => f.phones.split(/[\n,،;]+/).map((p) => p.trim()).filter(Boolean);

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { branchId: f.branchId, classroomId: f.classroomId, gateId: f.gateId, fullName: f.fullName, externalId: f.externalId || null, phones: phones() };
    const ok = f.id ? await call('PATCH', `/api/school/students/${f.id}`, body) : await call('POST', '/api/school/students', body);
    if (ok) setF(empty(branch));
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return;
    setUpErr('');
    setSummary(null);
    setUpBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/school/students/import', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setUpErr(data.message ?? 'حدث خطأ غير متوقع');
      else {
        setSummary(data);
        form.reset();
        router.refresh();
      }
    } catch {
      setUpErr('تعذر الاتصال بالخادم');
    } finally {
      setUpBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-teal">رفع ملف</h2>
        <p className="text-sm text-navy/70">
          ملف xlsx أو csv بالأعمدة المعتمدة. الطلاب غير الموجودين في الملف لا يتأثرون.{' '}
          <a className="text-teal underline" href="/templates/students-template.xlsx" download>تحميل القالب</a>
        </p>
        <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
          <input name="file" type="file" accept=".xlsx,.csv" required className="text-sm" />
          <button disabled={upBusy} className={primaryBtn}>{upBusy ? 'جارٍ الرفع...' : 'رفع ملف'}</button>
        </form>
        <Err text={upErr} />
        {summary && (
          <div className="space-y-2 rounded-lg bg-mist p-3 text-sm" role="status">
            <p>
              تمت الإضافة: <b>{summary.created}</b> — تم التحديث: <b>{summary.updated}</b> — أخطاء: <b>{summary.errors.length}</b>
            </p>
            {summary.errors.length > 0 && (
              <ul className="list-disc space-y-0.5 ps-5 text-red-700">
                {summary.errors.map((x, i) => (
                  <li key={i}>الصف {x.row}: {x.messageAr}</li>
                ))}
              </ul>
            )}
            {summary.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 ps-5 text-navy/70">
                {summary.warnings.map((x, i) => (
                  <li key={i}>الصف {x.row}: {x.messageAr}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <form className={cardCls} onSubmit={save}>
        <h2 className="text-lg font-semibold text-teal">{f.id ? 'تعديل طالب' : 'إضافة طالب'}</h2>
        <Err text={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="اسم الطالب" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          <input className={inputCls} dir="ltr" placeholder="رقم الطالب (اختياري)" value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} />
          <select className={inputCls} value={f.branchId} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={inputCls} value={f.classroomId} onChange={(e) => setF({ ...f, classroomId: e.target.value })} required aria-label="الفصل">
            {(branch?.classrooms ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={inputCls} value={f.gateId} onChange={(e) => setF({ ...f, gateId: e.target.value })} required aria-label="البوابة">
            {(branch?.gates ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <textarea className={inputCls} dir="ltr" rows={2} placeholder="جوالات أولياء الأمر (واحد في كل سطر)" value={f.phones} onChange={(e) => setF({ ...f, phones: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button disabled={busy} className={primaryBtn}>{f.id ? 'حفظ التعديل' : 'إضافة طالب'}</button>
          {f.id && <button type="button" className={tealBtn} onClick={() => setF(empty(branch))}>إلغاء</button>}
        </div>
      </form>

      <section className={cardCls}>
        <div className="flex flex-wrap gap-3">
          <input className={`${inputCls} grow`} placeholder="بحث بالاسم أو رقم الطالب أو جوال ولي الأمر" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={inputCls} value={fBranch} onChange={(e) => go({ branchId: e.target.value, classroomId: '' })} aria-label="تصفية بالفرع">
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={inputCls} value={fClass} onChange={(e) => go({ classroomId: e.target.value })} aria-label="تصفية بالفصل">
            <option value="">كل الفصول</option>
            {filterClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 text-start text-navy/70">
                <th className="py-2 text-start">الرقم</th><th className="text-start">الاسم</th><th className="text-start">الفرع</th>
                <th className="text-start">الفصل</th><th className="text-start">الجوالات</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10">
              {shown.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                  <td className="py-2"><bdi dir="ltr">{s.externalId}</bdi></td>
                  <td>{s.fullName}{!s.active && <span className="ms-2 rounded bg-navy/10 px-2 py-0.5 text-xs">غير نشط</span>}</td>
                  <td>{s.branchName}</td>
                  <td>{s.classroomName}</td>
                  <td>{s.phones.map((p) => <bdi key={p} dir="ltr" className="me-2 inline-block">{p}</bdi>)}</td>
                  <td className="whitespace-nowrap">
                    <button className={`${tealBtn} me-2`} onClick={() => setF({ id: s.id, externalId: s.externalId, fullName: s.fullName, branchId: s.branchId, classroomId: s.classroomId, gateId: s.gateId, phones: s.phones.join('\n') })}>تعديل</button>
                    <button disabled={busy} className={s.active ? dangerBtn : tealBtn} onClick={() => call('PATCH', `/api/school/students/${s.id}`, { active: !s.active })}>
                      {s.active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="py-3 text-navy/60">لا يوجد طلاب.</td></tr>}
            </tbody>
          </table>
        </div>
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-navy/70" aria-label="صفحات الطلاب">
          <span>عدد الطلاب: {paging.total} — صفحة {paging.page} من {pages}</span>
          <span className="flex gap-2">
            <button type="button" className={tealBtn} disabled={paging.page <= 1} onClick={() => go({ page: paging.page - 1 })}>السابق</button>
            <button type="button" className={tealBtn} disabled={paging.page >= pages} onClick={() => go({ page: paging.page + 1 })}>التالي</button>
          </span>
        </nav>
      </section>
    </div>
  );
}
