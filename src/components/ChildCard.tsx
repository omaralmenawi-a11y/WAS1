import type { ChildView } from '@/lib/guardian/children';
import { StatusChip, StatusSteps } from './StatusChip';

export function ChildCard({
  child,
  selected,
  onToggle,
  disabled,
  footer,
}: {
  child: ChildView;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const selectable = !child.activeRequestId && child.status !== 'DELIVERED';
  return (
    <div className={`rounded-xl bg-white p-4 shadow-sm ring-1 ${selected ? 'ring-2 ring-teal' : 'ring-navy/10'}`}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 accent-teal"
            checked={selected}
            disabled={disabled}
            onChange={onToggle}
            aria-label={`اختيار ${child.fullName}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-base font-bold text-navy">{child.fullName}</h3>
            <StatusChip status={child.status} />
          </div>
          <p className="mt-0.5 text-sm text-navy/70">
            {child.schoolName} · {child.branchName}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-mist px-2 py-1.5">
              <dt className="text-navy/60">الفصل</dt>
              <dd className="font-medium">{child.classroom}</dd>
            </div>
            <div className="rounded-lg bg-mist px-2 py-1.5">
              <dt className="text-navy/60">الانصراف</dt>
              <dd className="font-medium" dir="ltr" style={{ textAlign: 'right' }}>{child.todayDismissal ?? '—'}</dd>
            </div>
            <div className="rounded-lg bg-mist px-2 py-1.5">
              <dt className="text-navy/60">البوابة</dt>
              <dd className="font-medium">{child.gateName || '—'}</dd>
            </div>
          </dl>
          <StatusSteps status={child.status} />
          {footer}
        </div>
      </div>
    </div>
  );
}
