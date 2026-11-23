import { describe, expect, it } from 'vitest';
import { msgCancelled, msgDelivered, msgEndOfDay, msgPreparing, msgReady, msgReminder } from '@/lib/notify/messages';
import { formatRiyadhTime } from '@/lib/time';

describe('notification messages', () => {
  it('preparing', () => {
    expect(msgPreparing({ names: ['أحمد'], number: 7, gate: 'بوابة 1' })).toEqual({ title: 'جاري تجهيز أحمد', body: 'الطلب 7 · بوابة 1' });
    expect(msgPreparing({ names: ['أحمد', 'بدر'], number: 7, gate: 'بوابة 1' }).title).toBe('جاري تجهيز أحمد و بدر');
  });
  it('ready: singular and plural', () => {
    expect(msgReady({ names: ['أحمد'], number: 7, gate: 'بوابة 1' })).toEqual({
      title: 'أحمد جاهز للاستلام',
      body: 'توجّه إلى بوابة 1 واعرض رمز الاستلام. الطلب 7',
    });
    expect(msgReady({ names: ['أحمد', 'بدر'], number: 7, gate: 'بوابة 1' }).title).toBe('أحمد و بدر جاهزون للاستلام');
  });
  it('delivered', () => {
    expect(msgDelivered({ names: ['أحمد', 'بدر'], time: '12:35', gate: 'بوابة 1' })).toEqual({
      title: 'تم تسليم أحمد و بدر',
      body: 'الساعة 12:35 · بوابة 1',
    });
  });
  it('cancelled with and without reason', () => {
    expect(msgCancelled({ number: 3, reason: 'سبب' })).toEqual({ title: 'أُلغي طلب الاستلام 3', body: 'سبب' });
    expect(msgCancelled({ number: 3 })).toEqual({ title: 'أُلغي طلب الاستلام 3', body: 'تم إلغاء الطلب' });
    expect(msgCancelled({ number: 3, reason: null }).body).toBe('تم إلغاء الطلب');
  });
  it('reminder and end of day', () => {
    expect(msgReminder({ names: ['أحمد'], time: '12:30' })).toEqual({ title: 'تذكير بالانصراف', body: 'انصراف أحمد الساعة 12:30، بعد 15 دقيقة.' });
    expect(msgEndOfDay({ names: ['أحمد', 'بدر'], gate: 'بوابة 1' })).toEqual({ title: 'انتهى الدوام', body: 'انتهى دوام أحمد و بدر. بوابة 1.' });
  });
  it('formatRiyadhTime is HH:MM in Riyadh', () => {
    expect(formatRiyadhTime(new Date('2026-11-23T09:35:00Z'))).toBe('12:35');
    expect(formatRiyadhTime(new Date('2026-11-23T21:05:00Z'))).toBe('00:05');
  });
});
