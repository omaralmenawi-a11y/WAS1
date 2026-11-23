import type { ItemStatus } from '@prisma/client';
import { Conflict } from '../errors';

export type ItemAction = 'PREPARE' | 'READY' | 'DELIVER' | 'CANCEL';

const MOVES: Record<ItemAction, Partial<Record<ItemStatus, ItemStatus>>> = {
  PREPARE: { EN_ROUTE: 'PREPARING' },
  READY: { PREPARING: 'READY' },
  DELIVER: { READY: 'DELIVERED' },
  CANCEL: { EN_ROUTE: 'CANCELLED', PREPARING: 'CANCELLED', READY: 'CANCELLED' },
};

export function nextStatus(from: ItemStatus, action: ItemAction): ItemStatus {
  const to = MOVES[action][from];
  if (!to) throw new Conflict('لا يمكن تنفيذ هذا الإجراء في الحالة الحالية');
  return to;
}
