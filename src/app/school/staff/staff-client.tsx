'use client';
import { useState } from 'react';
import { Err, cardCls, dangerBtn, inputCls, primaryBtn, tealBtn, useApi } from '@/components/school-ui';

type Branch = { id: string; name: string; gates: { id: string; name: string }[] };
type Staff = { id: string; name: string; username: string; branchId: string | null; gateIds: string[]; active: boolean };

export function StaffClient({ branches, staff }: { branches: Branch[]; staff: Staff[] }) {
  const { call, error, busy } = useApi();
  const [f, setF] = useState({ branchId: branches[0]?.id ?? '', name: '', username: '', tempPassword: '', gateIds: [] as string[] });
  const gates = branches.find((b) => b.id === f.branchId)?.gates ?? [];
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '';
  return (
    <div className="space-y-6">
      <Err text={error} />
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-teal">الموظفون</h2>
        <ul className="divide-y divide-navy/10">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {s.name} <bdi dir="ltr" className="text-navy/60">{s.username}</bdi>{' '}
                <span className="text-sm text-navy/50">{branchName(s.branchId)}</span>
                {!s.active && <span className="ms-2 rounded bg-navy/10 px-2 py-0.5 text-xs">معطّل</span>}
              </span>
              <span className="flex gap-2">
                <button
                  disabled={busy}
                  className={tealBtn}
                  onClick={() => {
                    const p = prompt('كلمة المرور المؤقتة الجديدة (٨ أحرف على الأقل)');
                    if (p) call('PATCH', `/api/school/staff/${s.id}`, { tempPassword: p });
                  }}
                >
                  إعادة تعيين كلمة المرور
                </button>
                <button
                  disabled={busy}
                  className={s.active ? dangerBtn : tealBtn}
                  onClick={() => call('PATCH', `/api/school/staff/${s.id}`, { active: !s.active })}
                >
                  {s.active ? 'تعطيل' : 'تفعيل'}
                </button>
              </span>
            </li>
          ))}
          {staff.length === 0 && <li className="py-2 text-sm text-navy/60">لا يوجد موظفون.</li>}
        </ul>
      </section>
      <form
        className={cardCls}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call('POST', '/api/school/staff', f)) setF({ ...f, name: '', username: '', tempPassword: '', gateIds: [] });
        }}
      >
        <h2 className="text-lg font-semibold text-teal">إضافة موظف</h2>
        <select className={`${inputCls} w-full`} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value, gateIds: [] })}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input className={`${inputCls} w-full`} placeholder="الاسم" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={`${inputCls} w-full`} dir="ltr" placeholder="اسم المستخدم" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input className={`${inputCls} w-full`} dir="ltr" placeholder="كلمة المرور المؤقتة (٨ أحرف على الأقل)" minLength={8} required value={f.tempPassword} onChange={(e) => setF({ ...f, tempPassword: e.target.value })} />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">البوابات المسؤول عنها</legend>
          <div className="flex flex-wrap gap-3">
            {gates.map((g) => (
              <label key={g.id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={f.gateIds.includes(g.id)}
                  onChange={() => setF({ ...f, gateIds: f.gateIds.includes(g.id) ? f.gateIds.filter((x) => x !== g.id) : [...f.gateIds, g.id] })}
                />{' '}
                {g.name}
              </label>
            ))}
            {gates.length === 0 && <span className="text-sm text-navy/60">لا توجد بوابات في هذا الفرع.</span>}
          </div>
        </fieldset>
        <button disabled={busy} className={primaryBtn}>إضافة موظف</button>
      </form>
    </div>
  );
}
