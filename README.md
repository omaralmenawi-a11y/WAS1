# WASL (وصل)

منصة عربية (RTL) لإدارة استلام الطلاب عند الانصراف المدرسي.

## المتطلبات

- Node.js 22
- PostgreSQL 16

## الإعداد المحلي

```bash
service postgresql start

# إنشاء المستخدم وقواعد البيانات (مرة واحدة)
sudo -u postgres psql <<'SQL'
CREATE ROLE wasl LOGIN SUPERUSER PASSWORD 'wasl';  -- للتطوير فقط / dev only
CREATE DATABASE wasl_dev OWNER wasl;
CREATE DATABASE wasl_test OWNER wasl;
CREATE DATABASE wasl_e2e OWNER wasl;
SQL

cp .env.example .env     # عدّل القيم: DATABASE_URL و TEST_DATABASE_URL والأسرار
npm install
npx prisma migrate deploy   # أو: npm run db:migrate أثناء التطوير
npm run db:seed             # بيانات تجريبية (آمنة للتكرار)
npm run dev                 # http://localhost:3000
```

ملاحظة: `wasl_e2e` تُعاد إنشاؤها تلقائياً في كل تشغيل لاختبار e2e.

## الحسابات التجريبية

يطبع `npm run db:seed` رابط شاشة الانصراف وهذه الحسابات (مدرسة «مدارس الأفق الأهلية (تجريبي)»، فرع الملقا):

| الدور | المستخدم | كلمة المرور |
|---|---|---|
| مدير المنصة | `root` | `Root@12345` |
| مدير المدرسة | `admin` | `Admin@12345` |
| موظف البوابة | `noura` | `Staff@12345` |
| ولي أمر | سجّل من `/register` برقم `0500000001` (له ابنان) | تختارها أنت |

يرفض الـ seed العمل مع `NODE_ENV=production` إلا مع `--force`، وعندها تبقى كل الحسابات المزروعة مطالبة بتغيير كلمة المرور عند أول دخول.

## رموز التحقق (OTP) في وضع التطوير

مع `OTP_MODE=dev` لا تُرسل رسائل. يظهر الرمز في سجل الخادم، وفي صفحة `/admin` (سجّل دخولك بحساب `root`) تحت «رموز التحقق — وضع التطوير».

في وضع الإنتاج (`NODE_ENV=production`) يرفض الخادم البدء إذا كان `PICKUP_CODE_SECRET` مفقوداً أو أقصر من 32 حرفاً أو يبدأ بـ `change-me`، أو إذا كان `OTP_MODE=dev` ما لم يُضبط `ALLOW_DEV_OTP_IN_PRODUCTION=1` (للعرض التجريبي فقط، مع تحذير في السجل).

## الاختبارات

```bash
npm test                      # وحدة
npm run test:int              # تكامل (قاعدة wasl_test)
npm run e2e -- --trace off    # رحلة الاستلام كاملة (متصفح Chromium، قاعدة wasl_e2e)
npm run smoke                 # تشغيل الخادم في وضع التطوير والإنتاج
```

يضبط اختبار e2e الوقت عبر `WASL_FAKE_NOW` (يوم أحد 11:45 بتوقيت الرياض، قبل انصراف الصف الأول بـ15 دقيقة) وساعة المتصفح. على جهاز عادي شغّل مرة واحدة `npx playwright install chromium`؛ وإن كان Chromium مثبتاً في مسار آخر فاستخدم `PW_CHROMIUM_PATH`.

- البناء: `npm run build` ثم `npm start` (يضبط `NODE_ENV=production`؛ لا يعمل `WASL_FAKE_NOW` في هذا الوضع).
- فحص الخادم (smoke): يشغّل `server.ts` في وضع التطوير ثم يبني ويشغّل `dist/server.js` في وضع الإنتاج ويتوقع 200 من `/login`. شغّله بعد أي تغيير في `server.ts` أو وحدات المقبس (`src/lib/realtime.ts` وما تستورده)، فهذه يجب ألا تستورد `next/headers` أو `next/navigation`.

## الإشعارات

يصل ولي الأمر تذكير قبل 15 دقيقة من انصراف أبنائه، وإشعار عند انتهاء الدوام، وإشعارات حالة الطلب (قيد التجهيز، جاهز للاستلام، تم التسليم، ملغى). كل إشعار يظهر في صندوق الإشعارات داخل التطبيق (`/parent/notifications`) ويعمل الصندوق حتى بدون إشعارات الدفع.

لتفعيل إشعارات الدفع (Web Push):

1. ولّد المفاتيح: `npm run vapid`.
2. ضع القيم في `.env`: `VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY` و`VAPID_SUBJECT` (مثل `mailto:admin@example.com`). بدونها يُتخطى الدفع مع تحذير عند التشغيل ولا يتعطل الخادم.
3. في الإنتاج يلزم HTTPS، فالمتصفحات ترفض الدفع على HTTP (ما عدا `localhost`).
4. على iPhone يلزم iOS 16.4 أو أحدث، وعلى المستخدم أولاً «إضافة إلى الشاشة الرئيسية» ثم فتح التطبيق منها وتفعيل الإشعارات.

يفحص الخادم مواعيد الانصراف كل دقيقة؛ ويمكن تغيير الفاصل للاختبار بالمتغير `NOTIFY_TICK_MS` (بالمللي ثانية).

## المرحلة الثانية (Phase 2)

- المفوّضون مع الصورة
- التسليم اليدوي
- التقارير
- صفحات الخصوصية
- مهام الاحتفاظ بالبيانات
- النشر

---

# WASL (English)

Arabic RTL school-dismissal pickup platform.

## Prerequisites

Node.js 22 and PostgreSQL 16.

## Local setup

```bash
service postgresql start
sudo -u postgres psql <<'SQL'
CREATE ROLE wasl LOGIN SUPERUSER PASSWORD 'wasl';  -- dev only
CREATE DATABASE wasl_dev OWNER wasl;
CREATE DATABASE wasl_test OWNER wasl;
CREATE DATABASE wasl_e2e OWNER wasl;
SQL
cp .env.example .env        # edit DATABASE_URL, TEST_DATABASE_URL, secrets
npm install
npx prisma migrate deploy   # or npm run db:migrate while developing
npm run db:seed             # demo data, idempotent
npm run dev                 # http://localhost:3000
```

`wasl_e2e` is dropped and recreated on every e2e run.

## Demo accounts

`npm run db:seed` prints the public board URL and creates (school "مدارس الأفق الأهلية (تجريبي)", branch Al-Malqa): platform admin `root` / `Root@12345`, school admin `admin` / `Admin@12345`, staff `noura` / `Staff@12345`. The demo guardian registers at `/register` with `0500000001` (two linked children). The seed refuses to run under `NODE_ENV=production` unless `--force` is passed; then every seeded account must change its password at first sign-in.

## OTP codes in dev

With `OTP_MODE=dev` nothing is sent. Codes are written to the server log and listed on `/admin` (sign in as `root`) under the dev OTP section.

With `NODE_ENV=production` the server refuses to start when `PICKUP_CODE_SECRET` is missing, shorter than 32 characters or starts with `change-me`, or when `OTP_MODE=dev` unless `ALLOW_DEV_OTP_IN_PRODUCTION=1` is set (demo only; a warning is logged).

## Tests

```bash
npm test                      # unit
npm run test:int              # integration (wasl_test)
npm run e2e -- --trace off    # full pickup journey (Chromium, wasl_e2e)
npm run smoke                 # boots dev and production servers
```

The e2e run fixes the server clock with `WASL_FAKE_NOW` (next Sunday 11:45 Riyadh, 15 minutes before the first seeded dismissal) with a 2 s notification tick and the browser clock to match. On a normal machine run `npx playwright install chromium` once; set `PW_CHROMIUM_PATH` if Chromium is installed elsewhere. `npm start` sets `NODE_ENV=production` (fake time is ignored there). Run `npm run smoke` after touching `server.ts` or the socket modules (`src/lib/realtime.ts` and its imports must not import `next/headers` or `next/navigation`).

## Notifications

Guardians get a reminder 15 minutes before their children's dismissal, an end-of-day notice at dismissal time, and pickup status notices (preparing, ready, delivered, cancelled). Every notification also appears in the in-app inbox (`/parent/notifications`), which works without push.

To enable Web Push:

1. Generate keys: `npm run vapid`.
2. Put the three values in `.env`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:admin@example.com`). Without them push is skipped with a startup warning; the server does not crash.
3. Production needs HTTPS: browsers refuse push over plain HTTP (except `localhost`).
4. iPhone needs iOS 16.4 or later, and the user must first add the app to the Home Screen, open it from there, then enable notifications.

The server checks dismissal times every minute; set `NOTIFY_TICK_MS` (milliseconds) to change the interval, e.g. for tests.

## Phase 2

Delegates with photo, manual handover, reports, privacy pages, retention jobs, deployment.

## Security

- **Accepted risk: `xlsx` 0.18.5.** The npm registry build of SheetJS has known ReDoS and prototype-pollution advisories, and the official 0.20.x build is not reachable from our network (cdn.sheetjs.com blocked). It only parses student-import uploads, which are restricted to school admins and platform admins, capped at 5MB and 5000 rows. Revisit by installing the official SheetJS build when the network allows.
