import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/guard';
import { IosInstallHint, LogoutButton } from '@/components/parent-ui';
import { PushToggle } from '@/components/PushToggle';
import { NotificationBell } from '@/components/NotificationBell';

export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(['GUARDIAN']);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-mist">
      <header className="flex items-center justify-between bg-navy px-4 py-3 text-white">
        <Link href="/parent" className="min-w-0">
          <span className="block text-xs opacity-80">مرحباً</span>
          <span className="block truncate font-heading text-base">{user.name}</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/parent/history" className="opacity-90 hover:opacity-100">السجل</Link>
          <NotificationBell />
          <LogoutButton />
        </nav>
      </header>
      <main className="flex-1 space-y-3 p-4">
        <IosInstallHint />
        <PushToggle />
        {children}
      </main>
    </div>
  );
}
