import { describe, expect, it } from 'vitest';
import { describeAudit } from '../../src/lib/school/audit-text';

describe('describeAudit', () => {
  it('describes pickup actions in Arabic', () => {
    expect(describeAudit({ action: 'PICKUP_CREATED', data: { number: 7, studentIds: ['a', 'b'] } })).toBe('طلب استلام جديد رقم 7 (2 طلاب)');
    expect(describeAudit({ action: 'PICKUP_CREATED', data: { number: 3, studentIds: ['a'] } })).toBe('طلب استلام جديد رقم 3 (1 طالب)');
    expect(describeAudit({ action: 'ITEM_READY', data: {} })).toBe('أصبح طالب جاهزاً للاستلام');
    expect(describeAudit({ action: 'ITEM_DELIVERED', data: { itemIds: ['a', 'b'] } })).toBe('تم تسليم 2 طلاب');
    expect(describeAudit({ action: 'ITEM_DELIVERED', data: { itemIds: ['a'] } })).toBe('تم تسليم طالب');
    expect(describeAudit({ action: 'RECIPIENT_VERIFIED', data: { method: 'QR' } })).toContain('QR');
    expect(describeAudit({ action: 'PICKUP_CANCELLED', data: { reason: 'سبب' } })).toBe('أُلغي طلب استلام: سبب');
    expect(describeAudit({ action: 'BOARD_TOKEN_REGENERATED' })).toBe('تم تجديد رابط شاشة الانصراف');
  });
  it('tolerates missing or odd data and unknown actions', () => {
    expect(describeAudit({ action: 'PICKUP_CREATED', data: null })).toBe('طلب استلام جديد');
    expect(describeAudit({ action: 'PICKUP_CANCELLED', data: 'x' })).toBe('أُلغي طلب استلام');
    expect(describeAudit({ action: 'WHATEVER', data: {} })).toBe('نشاط');
  });
});
