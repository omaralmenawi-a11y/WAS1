import { prisma } from '../db';
import { NotFound } from '../errors';
import { now, riyadhDay } from '../time';
import { loadRequestForViews, toBoardEntry } from './views';

export type BoardTile = { number: number; gateName: string };
export type BoardData = { branchName: string; preparing: BoardTile[]; ready: BoardTile[] };

/** Public payload for the dismissal board: request number and gate only, never names or ids. */
export async function getBoard(token: string, at: Date = now()): Promise<BoardData> {
  const branch = token ? await prisma.branch.findUnique({ where: { boardToken: token }, select: { id: true, name: true } }) : null;
  if (!branch) throw new NotFound('رابط الشاشة غير صالح');
  const day = new Date(`${riyadhDay(at).date}T00:00:00Z`);
  const open = await prisma.pickupRequest.findMany({ where: { branchId: branch.id, day, open: true }, select: { id: true } });
  const loaded = await Promise.all(open.map((r) => loadRequestForViews(r.id)));
  const preparing: BoardTile[] = [];
  const ready: BoardTile[] = [];
  for (const r of loaded) {
    if (!r) continue;
    const e = toBoardEntry(r);
    if (e.status === 'READY') ready.push({ number: e.number, gateName: e.gateName });
    else if (e.status === 'PREPARING') preparing.push({ number: e.number, gateName: e.gateName });
  }
  const byNumber = (a: BoardTile, b: BoardTile) => a.number - b.number;
  return { branchName: branch.name, preparing: preparing.sort(byNumber), ready: ready.sort(byNumber) };
}
