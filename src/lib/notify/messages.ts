// Pure Arabic copy builders for notifications. No imports: safe for server.ts's module graph.

export type Msg = { title: string; body: string };

const join = (names: string[]) => names.join(' و ');

export const msgPreparing = (p: { names: string[]; number: number; gate: string }): Msg => ({
  title: `جاري تجهيز ${join(p.names)}`,
  body: `الطلب ${p.number} · ${p.gate}`,
});

export const msgReady = (p: { names: string[]; number: number; gate: string }): Msg => ({
  title: `${join(p.names)} ${p.names.length > 1 ? 'جاهزون' : 'جاهز'} للاستلام`,
  body: `توجّه إلى ${p.gate} واعرض رمز الاستلام. الطلب ${p.number}`,
});

export const msgDelivered = (p: { names: string[]; time: string; gate: string }): Msg => ({
  title: `تم تسليم ${join(p.names)}`,
  body: `الساعة ${p.time} · ${p.gate}`,
});

export const msgCancelled = (p: { number: number; reason?: string | null }): Msg => ({
  title: `أُلغي طلب الاستلام ${p.number}`,
  body: p.reason || 'تم إلغاء الطلب',
});

export const msgReminder = (p: { names: string[]; time: string }): Msg => ({
  title: 'تذكير بالانصراف',
  body: `انصراف ${join(p.names)} الساعة ${p.time}، بعد 15 دقيقة.`,
});

export const msgEndOfDay = (p: { names: string[]; gate: string }): Msg => ({
  title: 'انتهى الدوام',
  body: `انتهى دوام ${join(p.names)}. ${p.gate}.`,
});
