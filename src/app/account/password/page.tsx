'use client';
import { useState } from 'react';
import { AuthCard, ErrorText, Field, btnCls, postJson, submit, useAction } from '@/components/auth-ui';

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  return (
    <AuthCard title="تغيير كلمة المرور">
      <form
        className="space-y-4"
        onSubmit={submit(() =>
          run(() => postJson('/api/auth/password', { current, password }), (d) => {
            window.location.href = d.redirect;
          }),
        )}
      >
        <Field label="كلمة المرور الحالية" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <Field label="كلمة المرور الجديدة (٨ أحرف على الأقل)" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <ErrorText text={error} />
        <button className={btnCls} disabled={busy}>حفظ</button>
      </form>
    </AuthCard>
  );
}
