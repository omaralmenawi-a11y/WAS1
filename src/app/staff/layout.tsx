import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/guard';
import { LogoutButton } from '@/components/parent-ui';

export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(['STAFF']);
  const branch = user.branchId ? await prisma.branch.findUnique({ where: { id: user.branchId }, select: { name: true } }) : null;
  return (
    <div className="min-h-screen bg-mist">
      <header className="flex items-center justify-between gap-3 bg-navy px-4 py-3 text-white">
        <div className="min-w-0">
          <span className="block truncate font-heading text-base">{user.name}</span>
          <span className="block truncate text-xs opacity-80">{branch?.name ?? ''}</span>
        </div>
        <LogoutButton />
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
