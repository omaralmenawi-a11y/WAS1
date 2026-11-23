// Pure: maps an audit row to an Arabic sentence. No server imports (usable anywhere).

export type AuditLike = { action: string; data?: unknown };

export const PICKUP_AUDIT_ACTIONS = [
  'PICKUP_CREATED',
  'ITEM_PREPARING',
  'ITEM_READY',
  'RECIPIENT_VERIFIED',
  'ITEM_DELIVERED',
  'PICKUP_CANCELLED',
  'PICKUP_AUTO_CLOSED',
  'GATE_CHANGED',
  'PICKUP_ARRIVED',
] as const;

const obj = (d: unknown): Record<string, unknown> => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {});

export function describeAudit(row: AuditLike): string {
  const d = obj(row.data);
  switch (row.action) {
    case 'PICKUP_CREATED': {
      const n = typeof d.number === 'number' ? ` رقم ${d.number}` : '';
      const c = Array.isArray(d.studentIds) ? d.studentIds.length : 0;
      return `طلب استلام جديد${n}${c > 0 ? ` (${c} ${c === 1 ? 'طالب' : 'طلاب'})` : ''}`;
    }
    case 'ITEM_PREPARING':
      return 'بدأ تجهيز طالب للاستلام';
    case 'ITEM_READY':
      return 'أصبح طالب جاهزاً للاستلام';
    case 'RECIPIENT_VERIFIED':
      return d.method === 'QR' ? 'تم التحقق من المستلم عبر رمز QR' : 'تم التحقق من المستلم عبر الرمز';
    case 'ITEM_DELIVERED': {
      const c = Array.isArray(d.itemIds) ? d.itemIds.length : 0;
      return c > 1 ? `تم تسليم ${c} طلاب` : 'تم تسليم طالب';
    }
    case 'PICKUP_CANCELLED':
      return typeof d.reason === 'string' && d.reason ? `أُلغي طلب استلام: ${d.reason}` : 'أُلغي طلب استلام';
    case 'PICKUP_AUTO_CLOSED':
      return 'أُغلق طلب استلام تلقائياً بانتهاء اليوم الدراسي';
    case 'GATE_CHANGED':
      return 'تم تغيير بوابة الاستلام';
    case 'PICKUP_ARRIVED':
      return 'أعلن المستلم وصوله';
    case 'BOARD_TOKEN_REGENERATED':
      return 'تم تجديد رابط شاشة الانصراف';
    default:
      return 'نشاط';
  }
}
