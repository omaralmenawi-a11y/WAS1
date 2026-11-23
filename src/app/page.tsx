import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (user?.role === 'GUARDIAN') redirect('/parent');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold">وَصْل</h1>
      <p className="text-center">منصة تسليم الطلاب عند الانصراف</p>
      <Link href="/login" className="rounded bg-teal px-6 py-2 text-white">
        تسجيل الدخول
      </Link>
    </main>
  );
}
