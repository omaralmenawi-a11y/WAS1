import { requirePageUser } from '@/lib/auth/guard';
import { StaffClient } from './staff-client';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageUser(['STAFF']);
  return <StaffClient gateIds={user.gateIds} />;
}
