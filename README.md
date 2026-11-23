# WAS1
بيانات وصل

## التشغيل المحلي

```bash
service postgresql start          # PostgreSQL 16
cp .env.example .env              # ثم عدّل القيم
npm install
npm run db:migrate
npm run dev                       # http://localhost:3000
```

- الاختبارات: `npm test` (وحدة) و`npm run test:int` (تكامل، قاعدة `wasl_test`).
- البناء: `npm run build` ثم `npm start`.
- فحص الخادم (smoke): `npm run smoke` يشغّل `server.ts` في وضع التطوير ثم يبني ويشغّل `dist/server.js` في وضع الإنتاج على منفذ عشوائي، ويتوقع 200 من `/login`. شغّله بعد أي تغيير في `server.ts` أو في وحدات المقبس (`src/lib/realtime.ts` وما تستورده)، فهذه يجب ألا تستورد `next/headers` أو `next/navigation`.

## Security

- **Accepted risk: `xlsx` 0.18.5.** The npm registry build of SheetJS has known ReDoS and prototype-pollution advisories, and the official 0.20.x build is not reachable from our network (cdn.sheetjs.com blocked). It only parses student-import uploads, which are restricted to school admins and platform admins, capped at 5MB and 5000 rows. Revisit by installing the official SheetJS build when the network allows.
