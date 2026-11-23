# WASL Phase 2a — Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardians receive real notifications on their phones: a reminder 15 minutes before each child's dismissal, an end-of-day notice, and pickup status changes (preparing, ready, delivered, cancelled), plus an in-app notification inbox for anyone who has not enabled push.

**Architecture:** One `notify()` entry point stores an in-app `Notification` row, emits it live over Socket.IO to the user's room, and sends Web Push (VAPID, `web-push` library, no Firebase) to every subscribed device of that user. A minute ticker in `server.ts` (same pattern as the stale-request sweep) runs `runDismissalNotifications(now())`, which is idempotent through a unique `dedupeKey`, so restarts and overlapping ticks never send twice. A service worker (`public/sw.js`) shows pushes and opens the right page on tap.

**Tech Stack:** existing stack + `web-push`.

**Spec:** `docs/superpowers/specs/2026-11-23-wasl-platform-design.md` §7.5 (and §5 iPhone note).

## Global Constraints

- Arabic copy, RTL. Brand navy `#123B67`, teal `#168C91`.
- All time via `now()` from `src/lib/time.ts`; school days and times in `Asia/Riyadh` via `riyadhDay` and `dismissalFor` (holidays and non-school days already return null).
- Reminder exactly 15 minutes before the child's dismissal time that day; end-of-day notice at the dismissal time.
- Reminders and end-of-day go to every registered guardian linked to the student (`GuardianPhone.phone == User.phone`, role GUARDIAN, `active`). Delegates are not in this phase.
- Every notification also appears in the in-app inbox.
- Nothing imported by `server.ts` / `src/lib/realtime.ts` may import `next/headers` or `next/navigation` (guarded by `tests/unit/server-imports.test.ts` and `npm run smoke`).
- Push payloads carry no location, codes or phone numbers. Child first names and request number are allowed (payloads are encrypted end-to-end by Web Push).
- Missing VAPID keys never crash: push is skipped with a startup warning; inbox still works.
- **Decision recorded (deviation from spec text):** the spec names pg-boss; this plan uses an in-process minute ticker plus a DB unique key for idempotency, which gives the same guarantees (no duplicates across restarts or multiple instances) with no extra dependency.

## Review Focus

1. **Shared device / logout** — a device subscribed by parent A, then parent B logs in on it: the subscription moves to B; on logout the browser unsubscribes and the server deletes it. Test in Task 2.
2. **Restart or two overlapping ticks** — never a duplicate reminder (unique `dedupeKey`). Test in Task 4.
3. **Late tick** (server down 11:45–11:58, dismissal 12:00) — reminder still sent at 11:58 because it is before dismissal; if the server comes back after dismissal, the reminder is skipped but the end-of-day notice is sent within its 30-minute window. Test in Task 4.
4. **Dead subscription** (push service answers 404/410) — row deleted, other devices still receive, no throw. Test in Task 1.
5. **Child already on the way or delivered** — no reminder when the child has an active or delivered item today; no end-of-day notice when delivered. Test in Task 4.

---

## File Structure

```
prisma/schema.prisma                 + PushSubscription, Notification
src/lib/notify/index.ts              notify(): store + emit + push (replaces src/lib/notify.ts)
src/lib/notify/push.ts               PushSender interface, WebPushSender, setPushSender (tests)
src/lib/notify/messages.ts           pure Arabic copy builders
src/lib/notify/subscriptions.ts      subscribe / unsubscribe / listForUser
src/lib/notify/inbox.ts              listInbox / markRead / unreadCount
src/lib/notify/dismissal.ts          runDismissalNotifications(at)
src/app/api/push/{key,subscribe}/route.ts
src/app/api/notifications/route.ts, src/app/api/notifications/read/route.ts
public/sw.js                         push + notificationclick
src/components/PushToggle.tsx, src/components/NotificationBell.tsx
src/app/parent/notifications/page.tsx
scripts/gen-vapid.ts
```

---

### Task 1: Notification core — storage, live emit, Web Push delivery

**Files:**
- Create: `src/lib/notify/index.ts`, `src/lib/notify/push.ts`, `scripts/gen-vapid.ts`
- Delete: `src/lib/notify.ts` (update its importers to `@/lib/notify`)
- Modify: `prisma/schema.prisma` (+ migration), `src/lib/env-check.ts`, `.env.example`, `src/lib/realtime.ts` (export `emitToUser`)
- Test: `tests/integration/notify.test.ts`, `tests/unit/env-check.test.ts`

**Interfaces:**
- Produces:
  - `model PushSubscription {id, userId, endpoint String @unique, p256dh, auth, userAgent String?, createdAt, lastSuccessAt DateTime?}`
  - `model Notification {id, userId, kind String, title String, body String, url String, dedupeKey String? @unique, createdAt, readAt DateTime?}` with index (userId, createdAt)
  - `type NotificationPayload = { kind: string; title: string; body: string; url: string }`
  - `notify(userIds: string[], payload: NotificationPayload, opts?: { dedupeKey?: (userId: string) => string }): Promise<{ created: number; pushed: number }>`. For each user: insert the Notification (skip silently on P2002 of `dedupeKey`), then `emitToUser(userId, 'notification:new', {id, kind, title, body, url, createdAt})`, then send push to every subscription of that user. Never throws (errors logged).
  - `interface PushSender { send(sub: {endpoint, p256dh, auth}, payload: string): Promise<'ok' | 'gone' | 'error'> }`; `WebPushSender` built from env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:`), maps HTTP 404/410 to `'gone'`; `setPushSender(s: PushSender | null)` for tests; `pushEnabled(): boolean`.
  - Push JSON payload: `{title, body, url, tag: kind}`.
  - `emitToUser(userId: string, event: string, data: unknown): void` in realtime.ts (no-op when io unset).
  - `scripts/gen-vapid.ts` prints the three env lines; npm script `vapid`.
  - `checkProductionEnv`: warning (not error) when VAPID keys are missing in production: «Web Push disabled: VAPID keys missing».

- [ ] **Step 1: Failing tests** in `notify.test.ts` with a fake PushSender:
  - `stores one inbox row per user and pushes to each of their subscriptions` (user with 2 subs → `pushed === 2`, rows === 1)
  - `same dedupeKey twice creates and pushes once`
  - `gone subscription is deleted, others still receive` (Review Focus 4)
  - `sender error does not throw and does not delete the subscription`
  - `no push sender configured → still stores inbox row, pushed === 0`
  - `successful push sets lastSuccessAt`
  - env-check unit test: missing VAPID in production → warning present, no error.
- [ ] **Step 2:** Run `npx vitest run tests/integration/notify.test.ts tests/unit/env-check.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Pushes to one user's devices run in parallel with a 10 s timeout each.
- [ ] **Step 4:** Run → PASS; `npm test && npm run test:int` → PASS.
- [ ] **Step 5:** Commit `feat(notify): inbox storage, live emit and web push delivery`.

### Task 2: Device subscription, service worker, parent UI

**Files:**
- Create: `src/lib/notify/subscriptions.ts`, `src/lib/notify/inbox.ts`, `src/app/api/push/key/route.ts`, `src/app/api/push/subscribe/route.ts`, `src/app/api/notifications/route.ts`, `src/app/api/notifications/read/route.ts`, `public/sw.js`, `src/components/PushToggle.tsx`, `src/components/NotificationBell.tsx`, `src/app/parent/notifications/page.tsx`
- Modify: parent layout/header (bell + toggle), `src/components/live.tsx` `logout()` (unsubscribe this device first), `src/app/api/auth/logout/route.ts` (accept optional `endpoint` and delete it)
- Test: `tests/integration/subscriptions.test.ts`, `tests/integration/inbox.test.ts`

**Interfaces:**
- Consumes: `notify`, `PushSubscription`, `Notification` (Task 1).
- Produces:
  - `subscribe(user, {endpoint, keys: {p256dh, auth}, userAgent?})` — upsert by endpoint; an endpoint already owned by another user is reassigned to this user (Review Focus 1). Validates endpoint is `https://` and keys non-empty (ValidationError).
  - `unsubscribe(user, endpoint)` — deletes only if owned by user; idempotent.
  - `listInbox(user, {limit = 30, before?: string})`, `unreadCount(user)`, `markRead(user, ids: string[] | 'all')` — only the user's own rows.
  - Routes: `GET /api/push/key` → `{publicKey | null}`; `POST/DELETE /api/push/subscribe`; `GET /api/notifications?before=`; `POST /api/notifications/read {ids|'all'}`. All require a logged-in GUARDIAN (inbox routes: any logged-in user).
  - `public/sw.js`: on `push` → `showNotification(title, {body, icon: '/icons/icon-192.png', badge, tag, data: {url}, dir: 'rtl', lang: 'ar'})`; on `notificationclick` → focus an open client on that url or `clients.openWindow(url)`.
  - `PushToggle`: states «تفعيل الإشعارات» / «الإشعارات مفعّلة على هذا الجهاز» / «الإشعارات محظورة من إعدادات المتصفح» / «يتطلب الآيفون إضافة وصل إلى الشاشة الرئيسية أولاً» (iOS Safari not standalone) / hidden when `publicKey` is null. Registers `/sw.js`, subscribes with `applicationServerKey`, POSTs it.
  - `NotificationBell`: unread count badge, live via `useLive('notification:new')`, links to `/parent/notifications` (list, «تحديد الكل كمقروء»).

- [ ] **Step 1: Failing tests:** `subscribe twice same endpoint keeps one row`; `endpoint of user A subscribed by user B moves to B`; `non-https endpoint → ValidationError`; `unsubscribe of another user's endpoint does nothing`; `inbox lists only own rows newest first, markRead('all') zeroes unreadCount, markRead of another user's id has no effect`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement lib + routes. **Step 4:** Run → PASS.
- [ ] **Step 5:** UI + service worker. Manual check on `npm run dev` with Playwright (chromium, `context.grantPermissions(['notifications'])`): toggle reaches «الإشعارات مفعّلة على هذا الجهاز» and a row appears in `PushSubscription`; a `notify()` call from a scratch script shows the bell count rising live. One screenshot of the parent header and the notifications page at 390px.
- [ ] **Step 6:** Commit `feat(notify): device subscription, service worker, inbox UI`.

### Task 3: Pickup status notifications

**Files:**
- Create: `src/lib/notify/messages.ts`
- Modify: `src/lib/pickup/service.ts` (replace the four existing `notify(...)` stubs; add PREPARING)
- Test: `tests/unit/messages.test.ts`, `tests/integration/pickup-notify.test.ts`

**Interfaces:**
- Consumes: `notify` (Task 1).
- Produces (pure, in `messages.ts`; `names` joined with « و », gate name as stored):
  - `msgPreparing({names, number, gate})` → title «جاري تجهيز {names}», body «الطلب {number} · {gate}»
  - `msgReady({names, number, gate})` → title «{names} جاهز للاستلام» (or «جاهزون للاستلام» for more than one), body «توجّه إلى {gate} واعرض رمز الاستلام. الطلب {number}»
  - `msgDelivered({names, time, gate})` → title «تم تسليم {names}», body «الساعة {time} · {gate}»
  - `msgCancelled({number, reason?})` → title «أُلغي طلب الاستلام {number}», body reason or «تم إلغاء الطلب»
  - `msgReminder({names, time})` → title «تذكير بالانصراف», body «انصراف {names} الساعة {time}، بعد 15 دقيقة.»
  - `msgEndOfDay({names, gate})` → title «انتهى الدوام», body «انتهى دوام {names}. {gate}.»
  - `url` for status messages: `/parent/request/{requestId}`; for reminder/end-of-day: `/parent`.
- Recipient rules (decision): PREPARING and READY → requester only. DELIVERED and CANCELLED → requester plus every other registered guardian linked to the affected students. PREPARING/READY are sent once per request per status (batch siblings advanced together into one message: dedupeKey `{kind}:{requestId}:{userId}` for PREPARING and READY).
- All notify calls stay after commit, outside transactions, and never block or fail the mutation.

- [ ] **Step 1: Failing tests:** unit tests for every builder with one and two names (exact strings above); integration: advance PREPARE → requester gets one «جاري تجهيز» row; advancing the sibling too does not create a second PREPARING row; READY likewise; deliver → requester and the other linked guardian each get «تم تسليم», an unrelated guardian gets nothing; staff cancel with reason → body is the reason; a failing push sender does not fail `deliverItems`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full `npm test && npm run test:int`.
- [ ] **Step 5:** Commit `feat(notify): pickup status notifications`.

### Task 4: Dismissal reminder and end-of-day notice

**Files:**
- Create: `src/lib/notify/dismissal.ts`
- Modify: `server.ts` (minute ticker with in-flight guard, `unref`, errors logged)
- Test: `tests/integration/dismissal-notify.test.ts`

**Interfaces:**
- Consumes: `buildScheduleCtxs`, `SCHEDULE_INCLUDE` (src/lib/guardian/children.ts), `dismissalFor`, `riyadhDay`, `now`, `msgReminder`, `msgEndOfDay`, `notify`.
- Produces: `runDismissalNotifications(at: Date = now()): Promise<{ reminders: number; endOfDay: number }>`.
  - For every active student of every school whose dismissal today is `D` (minutes):
    - Reminder when `D − 15 ≤ minutes(at) < D`.
    - End-of-day when `D ≤ minutes(at) < D + 30`.
  - Skip reminder if the student has an EN_ROUTE/PREPARING/READY or DELIVERED item today; skip end-of-day if DELIVERED today (Review Focus 5).
  - Recipients: registered active GUARDIAN users whose phone matches a `GuardianPhone` of the student.
  - One notification per guardian per (kind, dismissal time): siblings with the same dismissal are combined into one message; `dedupeKey` = `{kind}:{date}:{HH:MM}:{userId}` (kind `REMINDER` or `END_OF_DAY`).
  - Query only students whose window can be open now (load schedules once per school per tick; acceptable for ≤ 10 schools × 1500 students).
- `server.ts`: run once after listen, then every 60 s; skip a tick while the previous one is still running.

- [ ] **Step 1: Failing tests** (fixed `at` values, Riyadh = UTC+3, dismissal 12:15 Sunday):
  - 11:59 → no reminder; 12:00 → reminder «انصراف سارة الساعة 12:15، بعد 15 دقيقة.»; second run at 12:01 → no new rows (Review Focus 2).
  - Two siblings same dismissal, same guardian → one reminder naming both.
  - Two guardians on one student → each gets one.
  - Server back at 12:10 having missed 12:00 → reminder sent; back at 12:20 → no reminder, end-of-day sent (Review Focus 3).
  - 12:15 → end-of-day «انتهى دوام سارة. بوابة 1.»; 12:45 → none.
  - Child with an EN_ROUTE item → no reminder; DELIVERED → no reminder and no end-of-day (Review Focus 5).
  - Holiday or Friday → nothing. Inactive student or guardian not registered → nothing.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + ticker. **Step 4:** Run → PASS; `npm test && npm run test:int && npm run smoke`.
- [ ] **Step 5:** Commit `feat(notify): dismissal reminder and end-of-day notice`.

### Task 5: End-to-end check and docs

**Files:**
- Modify: `e2e/pickup.spec.ts` (or add `e2e/notifications.spec.ts`), `README.md`, `.env.example`, `prisma/seed.ts` (seed works unchanged)

- [ ] **Step 1:** E2E (`--trace off`): with `WASL_FAKE_NOW` at 15 minutes before the seeded siblings' dismissal, a registered guardian sees the bell count become 1 within 70 s without reloading and the notifications page shows «تذكير بالانصراف»; after the staff marks READY in the existing journey, the guardian's inbox gains «جاهز للاستلام». (Real push delivery cannot be exercised headless; it is covered by Task 1's sender tests.) If the minute ticker makes the test slow, expose `NOTIFY_TICK_MS` env (default 60000) and set it to 2000 in the e2e server only.
- [ ] **Step 2:** README (Arabic then English): generating VAPID keys (`npm run vapid`), the three env vars, HTTPS requirement for push in production, the iPhone requirement (iOS 16.4+, add to home screen first), and that the inbox works without push.
- [ ] **Step 3:** Full gate: `npm test && npm run test:int && npm run build && npm run e2e -- --trace off && npm run smoke` → all pass.
- [ ] **Step 4:** Commit `test: notifications end-to-end; docs`.
