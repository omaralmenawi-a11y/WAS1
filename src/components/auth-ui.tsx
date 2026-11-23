'use client';
import { useState, type FormEvent, type ReactNode } from 'react';

export const inputCls =
  'w-full rounded-lg border border-navy/20 bg-white px-3 py-2.5 text-navy outline-none focus:border-teal focus:ring-2 focus:ring-teal/30';
export const btnCls =
  'w-full rounded-lg bg-navy px-4 py-2.5 font-medium text-white hover:bg-navy/90 disabled:opacity-60';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-navy/10">
        <h1 className="mb-1 text-2xl font-bold text-navy">وَصْل</h1>
        <h2 className="mb-5 text-lg text-teal">{title}</h2>
        {children}
      </div>
    </main>
  );
}

export function Field({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <input className={inputCls} {...p} />
    </label>
  );
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<{ ok: boolean; data: any }>, onOk: (d: any) => void) {
    setError('');
    setBusy(true);
    try {
      const { ok, data } = await fn();
      if (ok) onOk(data);
      else setError(data.message ?? 'حدث خطأ غير متوقع');
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run, setError };
}

export function submit(fn: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    fn();
  };
}

export function ErrorText({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </p>
  ) : null;
}
