// Pure formatting helpers for the dashboard page.
import type { StaffRequestView } from '../pickup/views';

export function formatMmSs(sec: number | null): string {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function etaCell(r: Pick<StaffRequestView, 'arrivedAt' | 'etaSeconds'>): string {
  if (r.arrivedAt || r.etaSeconds === 0) return 'وصل';
  if (r.etaSeconds == null) return '—';
  return `${Math.max(1, Math.ceil(r.etaSeconds / 60))} د`;
}

export function lastUpdate(locationAt: string | null, nowMs: number): string {
  if (!locationAt) return '—';
  const min = Math.max(0, Math.floor((nowMs - new Date(locationAt).getTime()) / 60_000));
  return `آخر تحديث قبل ${min} د`;
}
