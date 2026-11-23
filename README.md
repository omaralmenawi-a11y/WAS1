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
