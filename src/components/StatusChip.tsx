import type { ItemStatus } from '@prisma/client';

export type ChipStatus = 'IN_SCHOOL' | ItemStatus;

export const STATUS_LABEL: Record<ChipStatus, string> = {
  IN_SCHOOL: 'داخل المدرسة',
  EN_ROUTE: 'في الطريق',
  PREPARING: 'قيد التجهيز',
  READY: 'جاهز للاستلام',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

const TONE: Record<ChipStatus, string> = {
  IN_SCHOOL: 'bg-slate-100 text-slate-600',
  EN_ROUTE: 'bg-sky-50 text-sky-800',
  PREPARING: 'bg-amber-50 text-amber-800',
  READY: 'bg-teal/10 text-teal',
  DELIVERED: 'bg-navy/10 text-navy',
  CANCELLED: 'bg-red-50 text-red-800',
};

export function StatusChip({ status }: { status: ChipStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const STEP: Record<ChipStatus, number> = { IN_SCHOOL: 0, EN_ROUTE: 1, PREPARING: 2, READY: 3, DELIVERED: 4, CANCELLED: 0 };

/** Five-segment progress bar like the landing mockup. */
export function StatusSteps({ status }: { status: ChipStatus }) {
  const n = STEP[status];
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <li key={i} className={`h-1.5 rounded-full ${status === 'CANCELLED' ? 'bg-red-100' : i <= n ? 'bg-teal' : 'bg-slate-200'}`} />
      ))}
    </ol>
  );
}
