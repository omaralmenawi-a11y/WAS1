'use client';
import { useState } from 'react';
import { ErrorText, Field, btnCls, postJson, submit, useAction } from '@/components/auth-ui';

export function AddSchoolForm() {
  const [f, setF] = useState({ schoolName: '', branchName: '', adminName: '', adminUsername: '', tempPassword: '' });
  const { error, busy, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-teal">إضافة مدرسة</h2>
      <form
        className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-navy/10"
        onSubmit={submit(() => run(() => postJson('/api/admin/schools', f), () => window.location.reload()))}
      >
        <Field label="اسم المدرسة" value={f.schoolName} onChange={set('schoolName')} required />
        <Field label="اسم الفرع الأول" value={f.branchName} onChange={set('branchName')} required />
        <Field label="اسم مدير المدرسة" value={f.adminName} onChange={set('adminName')} required />
        <Field label="اسم المستخدم" dir="ltr" value={f.adminUsername} onChange={set('adminUsername')} required />
        <Field label="كلمة المرور المؤقتة (٨ أحرف على الأقل)" dir="ltr" minLength={8} value={f.tempPassword} onChange={set('tempPassword')} required />
        <ErrorText text={error} />
        <button className={btnCls} disabled={busy}>إضافة مدرسة</button>
      </form>
    </section>
  );
}
