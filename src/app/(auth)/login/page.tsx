'use client';
import Link from 'next/link';
import { resetSocket } from '@/components/live';
import { useState } from 'react';
import { AuthCard, ErrorText, Field, btnCls, postJson, submit, useAction } from '@/components/auth-ui';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  return (
    <AuthCard title="تسجيل الدخول">
      <form
        className="space-y-4"
        onSubmit={submit(() =>
          run(() => postJson('/api/auth/login', { identifier, password }), (d) => {
            resetSocket();
            window.location.assign(d.redirect);
          }),
        )}
      >
        <Field label="رقم الجوال أو البريد الإلكتروني أو اسم المستخدم" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        <Field label="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <ErrorText text={error} />
        <button className={btnCls} disabled={busy}>دخول</button>
      </form>
      <div className="mt-4 flex justify-between text-sm text-teal">
        <Link href="/register">إنشاء حساب</Link>
        <Link href="/forgot">نسيت كلمة المرور</Link>
      </div>
    </AuthCard>
  );
}
