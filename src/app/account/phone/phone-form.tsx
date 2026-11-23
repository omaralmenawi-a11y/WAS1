'use client';
import { useState } from 'react';
import { AuthCard, ErrorText, Field, btnCls, postJson, submit, useAction } from '@/components/auth-ui';

export function PhoneForm({ current }: { current: string | null }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState<string | null>(current);
  const { error, busy, run } = useAction();

  if (done) {
    return (
      <AuthCard title="رقم الجوال">
        <p className="text-sm">رقم الجوال المرتبط بحسابك: <bdi dir="ltr" className="font-medium">{done}</bdi></p>
        <p className="mt-2 text-sm text-navy/70">يظهر أبناؤك المسجلون بهذا الرقم في قائمتك.</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="ربط رقم الجوال">
      <p className="mb-4 text-sm text-navy/70">أضف رقم جوالك ليظهر أبناؤك المسجلون في المدرسة بهذا الرقم.</p>
      <form
        className="space-y-4"
        onSubmit={submit(() =>
          sent
            ? run(() => postJson('/api/account/phone', { phone, code }), (d) => setDone(d.phone))
            : run(() => postJson('/api/account/phone', { phone }), () => setSent(true)),
        )}
      >
        <Field label="رقم الجوال" type="tel" dir="ltr" placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} required />
        {sent && <Field label="رمز التحقق" inputMode="numeric" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />}
        <ErrorText text={error} />
        <button className={btnCls} disabled={busy}>{sent ? 'تأكيد' : 'إرسال الرمز'}</button>
      </form>
    </AuthCard>
  );
}
