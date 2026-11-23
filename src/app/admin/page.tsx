import { prisma } from '@/lib/db';
import { AddSchoolForm } from './add-school-form';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const schools = await prisma.school.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { branches: true } } },
  });
  const dev = process.env.OTP_MODE === 'dev';
  const codes = dev
    ? await prisma.otpCode.findMany({
        where: { devVisible: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : [];
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-navy">لوحة مدير المنصة</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-teal">المدارس</h2>
        {schools.length === 0 ? (
          <p className="text-navy/70">لا توجد مدارس بعد.</p>
        ) : (
          <ul className="divide-y divide-navy/10 rounded-xl bg-white ring-1 ring-navy/10">
            {schools.map((s) => (
              <li key={s.id} className="flex justify-between px-4 py-3">
                <span>{s.name}</span>
                <span className="text-sm text-navy/60">{s._count.branches} فرع</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddSchoolForm />
      {dev && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-teal">رموز التحقق — وضع التطوير</h2>
          <ul className="divide-y divide-navy/10 rounded-xl bg-white ring-1 ring-navy/10">
            {codes.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span dir="ltr">{c.identifier}</span>
                <span dir="ltr" className="font-mono">{c.devVisible}</span>
                <time dir="ltr" className="text-navy/60">{c.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
