import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/guard';
import { LogoutButton } from '@/components/parent-ui';

export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/school', label: 'لوحة المتابعة' },
  { href: '/school/setup', label: 'الإعداد' },
  { href: '/school/students', label: 'الطلاب' },
  { href: '/school/staff', label: 'الموظفون' },
];

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageUser(['SCHOOL_ADMIN']);
  return (
    <div className="min-h-screen bg-mist">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <nav aria-label="التنقل" className="flex flex-wrap gap-1 text-sm">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 hover:bg-white/10">
                {l.label}
              </Link>
            ))}
          </nav>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
