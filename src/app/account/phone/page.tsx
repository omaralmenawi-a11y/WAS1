import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/guard';
import { HOME_BY_ROLE } from '@/lib/auth/home';
import { PhoneForm } from './phone-form';

export const dynamic = 'force-dynamic';

export default async function PhonePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'GUARDIAN') redirect(HOME_BY_ROLE[user.role]);
  return <PhoneForm current={user.phone} />;
}
