import { requirePageUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageUser(['PLATFORM_ADMIN']);
  return <>{children}</>;
}
