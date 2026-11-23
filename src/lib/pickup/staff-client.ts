// Pure helpers for the staff page. No React or Next imports.
import type { StaffRequestView } from './views';

function rank(v: StaffRequestView): number {
  if (v.items.some((i) => i.status === 'READY')) return 0;
  if (v.items.some((i) => i.status === 'PREPARING')) return 1;
  return 2;
}

/** Most actionable first: READY, then PREPARING, then by ETA, then number. */
export function sortStaffViews(list: StaffRequestView[]): StaffRequestView[] {
  const eta = (v: StaffRequestView) => v.etaSeconds ?? Number.POSITIVE_INFINITY;
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? eta(a) - eta(b) || 0 : 0) || a.number - b.number);
}

/** Highest item state of a request, for chips and counts. */
export function topStatus(v: StaffRequestView): 'READY' | 'PREPARING' | 'EN_ROUTE' {
  const r = rank(v);
  return r === 0 ? 'READY' : r === 1 ? 'PREPARING' : 'EN_ROUTE';
}

/** Keep still-READY picks and add children that became READY since `prevReady`. */
export function syncPicked(picked: string[], prevReady: string[], ready: string[]): string[] {
  const now = new Set(ready);
  const prev = new Set(prevReady);
  const kept = picked.filter((id) => now.has(id));
  const added = ready.filter((id) => !prev.has(id) && !kept.includes(id));
  return [...kept, ...added];
}

/** Ids to submit: picked ids that are READY right now. */
export function deliverable(picked: string[], ready: string[]): string[] {
  const now = new Set(ready);
  return picked.filter((id) => now.has(id));
}

/** Staff with assigned gates only see those gates; an empty list means all gates. */
export function inStaffGates(view: { gateId: string }, gateIds: string[]): boolean {
  return gateIds.length === 0 || gateIds.includes(view.gateId);
}

/** QR scanner re-arm state: the camera decodes ~10 times a second, so one bad QR must not flood verification. */
export type ScanGate = { paused: boolean; lastText: string | null; lastAt: number };
export const SCAN_REPEAT_MS = 5000;

export function newScanGate(): ScanGate {
  return { paused: false, lastText: null, lastAt: 0 };
}

/** Whether a decoded text should be submitted: never while paused, nor an identical payload within 5 s. */
export function admitScan(g: ScanGate, text: string, at: number): { gate: ScanGate; submit: boolean } {
  if (g.paused) return { gate: g, submit: false };
  if (g.lastText === text && at - g.lastAt < SCAN_REPEAT_MS) return { gate: g, submit: false };
  return { gate: { paused: false, lastText: text, lastAt: at }, submit: true };
}

/** After a failed verification scanning stays paused until the staff taps «مسح مرة أخرى». */
export function scanFailed(g: ScanGate): ScanGate {
  return { ...g, paused: true };
}

export function resumeScan(_g: ScanGate): ScanGate {
  return newScanGate();
}
