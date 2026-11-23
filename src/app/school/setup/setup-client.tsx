'use client';
import { useState } from 'react';
import {
  Err, WEEKDAYS_AR, cardCls, dangerBtn, inputCls, primaryBtn, tealBtn, useApi,
} from '@/components/school-ui';

type Gate = { id: string; name: string };
type Classroom = { id: string; name: string; grade: string; schedules: Record<number, string> };
type Branch = { id: string; name: string; gates: Gate[]; classrooms: Classroom[] };
type Data = {
  settings: { weekDays: number[]; pickupLeadMin: number; pickupTailMin: number; etaSpeedKmh: number };
  branches: Branch[];
  holidays: { id: string; date: string; note: string; branchId: string | null }[];
  overrides: { id: string; date: string; branchId: string; classroomId: string | null; dismissal: string }[];
};

const TABS = ['الفروع والبوابات', 'الفصول والجداول', 'الإجازات والاستثناءات', 'إعدادات المدرسة'] as const;

export function SetupClient({ data }: { data: Data }) {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === i ? 'bg-navy text-white' : 'bg-white text-navy ring-1 ring-navy/10'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <BranchesTab data={data} />}
      {tab === 1 && <ClassesTab data={data} />}
      {tab === 2 && <HolidaysTab data={data} />}
      {tab === 3 && <SettingsTab data={data} />}
    </div>
  );
}

function BranchesTab({ data }: { data: Data }) {
  const { call, error, busy } = useApi();
  const [branchName, setBranchName] = useState('');
  const [gateNames, setGateNames] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4">
      <Err text={error} />
      {data.branches.map((b) => (
        <section key={b.id} className={cardCls}>
          <h2 className="text-lg font-semibold text-teal">{b.name}</h2>
          <ul className="divide-y divide-navy/10">
            {b.gates.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2">
                <span>{g.name}</span>
                <button disabled={busy} className={dangerBtn} onClick={() => confirm('حذف البوابة؟') && call('DELETE', `/api/school/gates/${g.id}`)}>
                  حذف
                </button>
              </li>
            ))}
            {b.gates.length === 0 && <li className="py-2 text-sm text-navy/60">لا توجد بوابات.</li>}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call('POST', '/api/school/gates', { branchId: b.id, name: gateNames[b.id] ?? '' })) setGateNames({ ...gateNames, [b.id]: '' });
            }}
          >
            <input className={`${inputCls} flex-1`} placeholder="اسم البوابة" required value={gateNames[b.id] ?? ''} onChange={(e) => setGateNames({ ...gateNames, [b.id]: e.target.value })} />
            <button disabled={busy} className={tealBtn}>إضافة بوابة</button>
          </form>
        </section>
      ))}
      <form
        className={`${cardCls} flex gap-2`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call('POST', '/api/school/branches', { name: branchName })) setBranchName('');
        }}
      >
        <input className={`${inputCls} flex-1`} placeholder="اسم فرع جديد" required value={branchName} onChange={(e) => setBranchName(e.target.value)} />
        <button disabled={busy} className={primaryBtn}>إضافة فرع</button>
      </form>
    </div>
  );
}

function ClassesTab({ data }: { data: Data }) {
  const { call, error, busy } = useApi();
  const days = [...data.settings.weekDays].sort((a, b) => a - b);
  const [f, setF] = useState({ branchId: data.branches[0]?.id ?? '', name: '', grade: '' });
  async function saveCell(classroomId: string, weekday: number, old: string | undefined, value: string) {
    if (value === (old ?? '')) return;
    if (value === '') await call('DELETE', '/api/school/schedules', { classroomId, weekday });
    else await call('POST', '/api/school/schedules', { classroomId, weekday, dismissal: value });
  }
  return (
    <div className="space-y-4">
      <Err text={error} />
      {data.branches.map((b) => (
        <section key={b.id} className={`${cardCls} overflow-x-auto`}>
          <h2 className="text-lg font-semibold text-teal">{b.name}</h2>
          {b.classrooms.length === 0 ? (
            <p className="text-sm text-navy/60">لا توجد فصول.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-navy/70">
                  <th className="p-2 text-start">الفصل</th>
                  {days.map((d) => (
                    <th key={d} className="p-2 text-start">{WEEKDAYS_AR[d]}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {b.classrooms.map((c) => (
                  <tr key={c.id} className="border-t border-navy/10">
                    <td className="p-2">{c.name} <span className="text-navy/50">({c.grade})</span></td>
                    {days.map((d) => (
                      <td key={d} className="p-1">
                        <input
                          type="time"
                          dir="ltr"
                          aria-label={`${c.name} ${WEEKDAYS_AR[d]}`}
                          className={`${inputCls} w-28`}
                          defaultValue={c.schedules[d] ?? ''}
                          onBlur={(e) => saveCell(c.id, d, c.schedules[d], e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <button disabled={busy} className={dangerBtn} onClick={() => confirm('حذف الفصل؟') && call('DELETE', `/api/school/classrooms/${c.id}`)}>
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <form
        className={`${cardCls} flex flex-wrap gap-2`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call('POST', '/api/school/classrooms', f)) setF({ ...f, name: '', grade: '' });
        }}
      >
        <select className={inputCls} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
          {data.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input className={`${inputCls} flex-1`} placeholder="اسم الفصل" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={`${inputCls} flex-1`} placeholder="الصف الدراسي" required value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} />
        <button disabled={busy} className={primaryBtn}>إضافة فصل</button>
      </form>
    </div>
  );
}

function HolidaysTab({ data }: { data: Data }) {
  const { call, error, busy } = useApi();
  const [h, setH] = useState({ date: '', note: '', branchId: '' });
  const [o, setO] = useState({ branchId: data.branches[0]?.id ?? '', classroomId: '', date: '', dismissal: '' });
  const branchName = (id: string | null) => data.branches.find((b) => b.id === id)?.name ?? 'كل الفروع';
  const classes = data.branches.find((b) => b.id === o.branchId)?.classrooms ?? [];
  const className = (id: string | null) => data.branches.flatMap((b) => b.classrooms).find((c) => c.id === id)?.name ?? 'كل الفصول';
  return (
    <div className="space-y-4">
      <Err text={error} />
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-teal">الإجازات</h2>
        <ul className="divide-y divide-navy/10">
          {data.holidays.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2">
              <span><bdi dir="ltr">{x.date}</bdi> — {x.note} <span className="text-navy/50">({branchName(x.branchId)})</span></span>
              <button disabled={busy} className={dangerBtn} onClick={() => call('DELETE', `/api/school/holidays/${x.id}`)}>حذف</button>
            </li>
          ))}
          {data.holidays.length === 0 && <li className="py-2 text-sm text-navy/60">لا توجد إجازات.</li>}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call('POST', '/api/school/holidays', h)) setH({ date: '', note: '', branchId: '' });
          }}
        >
          <input type="date" dir="ltr" required className={inputCls} value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
          <input className={`${inputCls} flex-1`} placeholder="الملاحظة" required value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} />
          <select className={inputCls} value={h.branchId} onChange={(e) => setH({ ...h, branchId: e.target.value })}>
            <option value="">كل الفروع</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button disabled={busy} className={primaryBtn}>إضافة إجازة</button>
        </form>
      </section>
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-teal">استثناءات وقت الانصراف</h2>
        <ul className="divide-y divide-navy/10">
          {data.overrides.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <bdi dir="ltr">{x.date}</bdi> — <bdi dir="ltr">{x.dismissal}</bdi>{' '}
                <span className="text-navy/50">({branchName(x.branchId)} / {className(x.classroomId)})</span>
              </span>
              <button disabled={busy} className={dangerBtn} onClick={() => call('DELETE', `/api/school/overrides/${x.id}`)}>حذف</button>
            </li>
          ))}
          {data.overrides.length === 0 && <li className="py-2 text-sm text-navy/60">لا توجد استثناءات.</li>}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call('POST', '/api/school/overrides', o)) setO({ ...o, date: '', dismissal: '' });
          }}
        >
          <select className={inputCls} value={o.branchId} onChange={(e) => setO({ ...o, branchId: e.target.value, classroomId: '' })}>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select className={inputCls} value={o.classroomId} onChange={(e) => setO({ ...o, classroomId: e.target.value })}>
            <option value="">كل الفصول</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input type="date" dir="ltr" required className={inputCls} value={o.date} onChange={(e) => setO({ ...o, date: e.target.value })} />
          <input type="time" dir="ltr" required className={inputCls} value={o.dismissal} onChange={(e) => setO({ ...o, dismissal: e.target.value })} />
          <button disabled={busy} className={primaryBtn}>إضافة استثناء</button>
        </form>
      </section>
    </div>
  );
}

function SettingsTab({ data }: { data: Data }) {
  const { call, error, busy } = useApi();
  const [s, setS] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  const num = (k: 'pickupLeadMin' | 'pickupTailMin' | 'etaSpeedKmh') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: Number(e.target.value) });
  const toggle = (d: number) =>
    setS({ ...s, weekDays: s.weekDays.includes(d) ? s.weekDays.filter((x) => x !== d) : [...s.weekDays, d] });
  return (
    <form
      className={cardCls}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(await call('PUT', '/api/school/settings', s));
      }}
    >
      <Err text={error} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">أيام الدراسة</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS_AR.map((n, d) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.weekDays.includes(d)} onChange={() => toggle(d)} /> {n}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1 text-sm">
        <span>بدء استقبال طلبات الاستلام قبل الانصراف (دقيقة، 0–240)</span>
        <input type="number" min={0} max={240} className={`${inputCls} w-full`} value={s.pickupLeadMin} onChange={num('pickupLeadMin')} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>استمرار الاستقبال بعد الانصراف (دقيقة، 0–480)</span>
        <input type="number" min={0} max={480} className={`${inputCls} w-full`} value={s.pickupTailMin} onChange={num('pickupTailMin')} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>السرعة المعتمدة لحساب وقت الوصول (كم/س، 5–120)</span>
        <input type="number" min={5} max={120} className={`${inputCls} w-full`} value={s.etaSpeedKmh} onChange={num('etaSpeedKmh')} />
      </label>
      <button disabled={busy} className={primaryBtn}>حفظ الإعدادات</button>
      {saved && <p className="text-sm text-teal">تم الحفظ</p>}
    </form>
  );
}
