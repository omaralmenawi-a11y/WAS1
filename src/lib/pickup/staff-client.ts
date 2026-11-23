// Pure helpers for the staff page. No React or Next imports.

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
