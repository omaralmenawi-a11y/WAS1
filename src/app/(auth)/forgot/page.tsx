'use client';
import Link from 'next/link';
import { resetSocket } from '@/components/live';
import { useState } from 'react';
import { AuthCard, ErrorText, Field, btnCls, postJson, submit, useAction } from '@/components/auth-ui';

export default function ForgotPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  return (
    <AuthCard title="استعادة كلمة المرور">
      <form
        className="space-y-4"
        onSubmit={submit(() =>
          sent
            ? run(() => postJson('/api/auth/reset', { identifier, code, password }), () => {
                resetSocket();
                window.location.assign('/login');
              })
            : run(() => postJson('/api/auth/otp', { identifier, purpose: 'RESET' }), () => setSent(true)),
        )}
      >
        <Field label="رقم الجوال أو البريد الإلكتروني" value={identifier} onChange={(e) => setIdentifier(e.target.value)} readOnly={sent} required />
        {sent && (
          <>
            <Field label="رمز التحقق" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
            <Field label="كلمة المرور الجديدة (٨ أحرف على الأقل)" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </>
        )}
        <ErrorText text={error} />
        <button className={btnCls} disabled={busy}>{sent ? 'تعيين كلمة المرور' : 'إرسال الرمز'}</button>
      </form>
      <p className="mt-4 text-sm text-teal"><Link href="/login">العودة لتسجيل الدخول</Link></p>
    </AuthCard>
  );
}
