import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/guard';
import { listOwnRequests } from '@/lib/pickup/own';

export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export default async function HistoryPage() {
  const user = await requirePageUser(['GUARDIAN']);
  const rows = await listOwnRequests(user, { open: false, limit: 30 });
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg">السجل</h1>
        <Link href="/parent" className="text-sm text-teal">الرئيسية</Link>
      </div>
      {rows.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-navy/70 shadow-sm ring-1 ring-navy/10">لا توجد طلبات سابقة</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-navy/10">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{dateFmt.format(new Date(`${r.day}T12:00:00Z`))}</span>
              <span className="text-navy/60">الطلب {r.number}</span>
            </div>
            <p className="mt-1 font-bold">{r.childNames.join('، ')}</p>
            <p className="mt-1 text-sm text-navy/70">
              {r.deliveredAt ? (
                <>
                  تم التسليم الساعة <span dir="ltr">{timeFmt.format(new Date(r.deliveredAt))}</span>
                  {r.deliveredByName ? ` · ${r.deliveredByName}` : ''}
                </>
              ) : (
                'ملغى'
              )}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
