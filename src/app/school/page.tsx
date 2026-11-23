import Link from 'next/link';

export default function SchoolHome() {
  const cls = 'block rounded-xl bg-white p-5 ring-1 ring-navy/10 hover:ring-teal';
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-navy">لوحة المدرسة</h1>
      <Link className={cls} href="/school/setup">إعداد المدرسة: الفروع والفصول والجداول</Link>
      <Link className={cls} href="/school/staff">حسابات الموظفين</Link>
    </main>
  );
}
