# WASL Phase 1 — Core Platform & Pickup Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working multi-school web platform where schools load their data, parents log in and see their children, request pickup, share location during the trip, and staff prepare, verify (rotating code / QR) and hand over students, with live updates on the school dashboard and the public board.

**Architecture:** One Next.js (App Router, TypeScript) app run by a custom Node server (`server.ts`) that also hosts Socket.IO. PostgreSQL via Prisma. Business logic lives in plain TypeScript modules under `src/lib/**` (unit-tested without HTTP); route handlers under `src/app/api/**` are thin wrappers that call them, so a future mobile app reuses the same API. All UI is Arabic RTL.

**Tech Stack:** Node 22, Next.js 15, React 19, TypeScript, Prisma 6 + PostgreSQL 16, Socket.IO 4, Tailwind CSS 3, `@node-rs/argon2`, `zod`, `xlsx` (SheetJS) for import, `qrcode` (render), `html5-qrcode` (scan), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-wasl-platform-design.md`

**Phase 2 (separate plan, after this one ships):** Web Push + scheduler (15-min reminder, end-of-day, status pushes), delegates with mandatory photo + approval queue, manual handover, reports + CSV export, privacy/terms pages, retention jobs, backups, real SMS/email providers, deployment (Railway test → in-Kingdom cloud). This plan leaves hooks for them (`notify()` stub, `AuditLog`, `Delegation` table) but does not build them.

## Global Constraints

- UI language Arabic, `dir="rtl"` on `<html>`, `lang="ar"`. Fonts: IBM Plex Sans Arabic (body), Readex Pro (headings).
- Brand colors: navy `#123B67`, teal `#168C91`, light grey `#F2F5F8`, white `#FFFFFF`. Tone institutional, not childish.
- Timezone for all school-day logic: `Asia/Riyadh`. Default school week: Sunday–Thursday (per-school setting).
- Phone numbers stored E.164 (`+9665XXXXXXXX`).
- Never store child geolocation. Parent location: last point only, on the `PickupRequest` row, nulled when the request closes.
- Public board shows request number, status and gate only — never names.
- Every query touching school data is scoped by `schoolId` through `src/lib/authz.ts`; no route reads school data without it.
- Passwords hashed with argon2id. Sessions: random 32-byte token in httpOnly, Secure (prod), SameSite=Lax cookie `wasl_session`; DB stores SHA-256 of token. Session lifetime 30 days for parents, 12 hours for staff/admins.
- OTP: 6 digits, valid 5 minutes, max 5 attempts, max 3 sends per identifier per 15 minutes. In `OTP_MODE=dev` the code is written to the server log and to `OtpCode.devVisible`; no message is sent.
- Pickup window (decision recorded in spec): a request can be created on a school day from 60 min before the student's dismissal time until 180 min after it (`School.pickupLeadMin=60`, `School.pickupTailMin=180`). No requests on holidays or days without a schedule.
- One active pickup item per student per day.
- Rotating pickup code: 6 digits, 60-second window, accept current and previous window.
- ETA = haversine distance ÷ `School.etaSpeedKmh` (default 30).

## Review Focus

1. **Parent with children in two schools/branches** — home lists all; a single request may only contain children of the same branch (API rejects mixed branches with a clear Arabic message). Test in Task 7.
2. **Second guardian tries to request a child already in an active request** — rejected with message naming who already requested. Test in Task 7.
3. **Staff of branch A acting on a request of branch B (same school) or another school** — 404, not 403, to avoid leaking existence. Test in Task 3 and Task 11.
4. **Code typed after it rotated** (parent showed code 50s ago) — previous window still accepted; two windows old rejected. Test in Task 7.
5. **CSV import with messy phones** (`0501234567`, `966501234567`, `+966 50 123 4567`, Arabic-Indic digits `٠٥٠١٢٣٤٥٦٧`) and duplicate student rows — all normalised; duplicates by `externalId` update instead of duplicating; invalid rows reported by row number without aborting the import. Test in Task 5.

---

## File Structure

```
server.ts                         custom server: Next + Socket.IO
prisma/schema.prisma              all tables
prisma/seed.ts                    demo school, branch, gates, classes, students, users
src/lib/db.ts                     Prisma client singleton
src/lib/phone.ts                  normalizePhone
src/lib/time.ts                   Riyadh date helpers
src/lib/auth/password.ts          hash/verify
src/lib/auth/session.ts           create/read/destroy sessions
src/lib/auth/otp.ts               issue/verify OTP, provider adapter
src/lib/auth/accounts.ts          register/login/reset use-cases
src/lib/authz.ts                  requireUser/requireRole/scope helpers
src/lib/school/setup.ts           branches, gates, classrooms, schedules, holidays
src/lib/school/students.ts        student CRUD + guardian phones
src/lib/school/import.ts          parse + apply XLSX/CSV import
src/lib/schedule.ts               dismissal time + pickup window
src/lib/pickup/state.ts           pure state machine
src/lib/pickup/code.ts            rotating code + QR payload
src/lib/pickup/eta.ts             haversine ETA
src/lib/pickup/service.ts         create/advance/verify/deliver/cancel/location
src/lib/realtime.ts               emit helpers + room names
src/lib/audit.ts                  writeAudit
src/lib/notify.ts                 stub notify() (Phase 2 fills it)
src/app/(auth)/login|register|forgot/page.tsx
src/app/parent/page.tsx, parent/request/[id]/page.tsx, parent/history/page.tsx
src/app/staff/page.tsx
src/app/school/page.tsx (dashboard), school/students, school/setup, school/staff
src/app/admin/page.tsx
src/app/board/[token]/page.tsx
src/app/api/**                    route handlers
src/components/**                 shared UI (StatusChip, PhoneShell, etc.)
tests/unit/**, tests/integration/**, e2e/**
```

---

### Task 1: Project scaffold, database schema, test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `server.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `prisma/schema.prisma`, `src/lib/db.ts`, `vitest.config.ts`, `tests/integration/setup.ts`, `.env.example`, `Dockerfile`, `README.md`
- Move: `landing/index.html` stays as is (marketing reference; not served by the app)

**Interfaces:**
- Produces: `prisma` (from `src/lib/db.ts`); npm scripts `dev`, `build`, `start`, `test`, `test:int`, `e2e`, `db:migrate`, `db:seed`; `resetDb()` from `tests/integration/setup.ts` (truncates all tables).

- [ ] **Step 1:** Install PostgreSQL 16 locally (`apt-get install -y postgresql`), create DBs `wasl_dev` and `wasl_test`. `.env.example` lists `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`, `PICKUP_CODE_SECRET`, `OTP_MODE=dev`, `APP_URL`.
- [ ] **Step 2:** Scaffold Next.js 15 + TS + Tailwind; `server.ts` boots Next with `http.createServer` and attaches Socket.IO at path `/socket.io` (no handlers yet); `npm run dev` runs `tsx server.ts`.
- [ ] **Step 3:** Write `prisma/schema.prisma` with these models (enum and field names are interfaces for later tasks):
  - `School {id, name, weekDays Int[] default [0,1,2,3,4], pickupLeadMin Int @default(60), pickupTailMin Int @default(180), etaSpeedKmh Int @default(30), createdAt}`
  - `Branch {id, schoolId, name, boardToken String @unique}`
  - `Gate {id, branchId, name}`
  - `Classroom {id, branchId, name, grade}`
  - `ClassSchedule {id, classroomId, weekday Int, dismissal String /* "HH:MM" */}` unique(classroomId, weekday)
  - `Holiday {id, schoolId, branchId?, date DateTime @db.Date, note}`
  - `ScheduleOverride {id, branchId, classroomId?, date @db.Date, dismissal String}`
  - `Student {id, schoolId, branchId, classroomId, defaultGateId, externalId String?, fullName, active Boolean @default(true)}` unique(schoolId, externalId)
  - `GuardianPhone {id, studentId, phone, relation String?}` unique(studentId, phone)
  - `enum Role {PLATFORM_ADMIN SCHOOL_ADMIN STAFF GUARDIAN DELEGATE}`
  - `User {id, role, schoolId?, branchId?, gateIds String[], name, username String? @unique, phone String? @unique, email String? @unique, passwordHash, mustChangePassword Boolean @default(false), photoKey String?, createdAt}`
  - `Session {id, userId, tokenHash @unique, expiresAt}`
  - `OtpCode {id, identifier, purpose /* REGISTER|RESET|LINK_PHONE */, codeHash, attempts Int @default(0), expiresAt, consumedAt?, devVisible String?, createdAt}`
  - `Delegation {id, guardianId, delegateId?, name, phone, studentIds String[], status /* PENDING|APPROVED|REVOKED */, createdAt}` (Phase 2 uses it)
  - `enum ItemStatus {EN_ROUTE PREPARING READY DELIVERED CANCELLED}`
  - `PickupRequest {id, schoolId, branchId, gateId, number Int, day DateTime @db.Date, requesterId, open Boolean @default(true), lat Float?, lng Float?, locationAt DateTime?, etaSeconds Int?, arrivedAt DateTime?, verifiedAt DateTime?, verifiedById?, verifyMethod String?, createdAt, closedAt?}` unique(branchId, day, number)
  - `PickupItem {id, requestId, studentId, status ItemStatus, preparingAt?, readyAt?, deliveredAt?, deliveredById?, cancelledAt?, cancelReason?}`; partial unique index (raw SQL in migration): one row per `studentId` with status in (EN_ROUTE, PREPARING, READY)
  - `AuditLog {id, schoolId?, actorId?, action, entity, entityId, data Json, createdAt}`
- [ ] **Step 4:** `npm run db:migrate` creates the migration (add the partial unique index by editing the generated SQL). Verify: `npx prisma migrate status` → "Database schema is up to date".
- [ ] **Step 5:** Vitest config with two projects: `unit` (`tests/unit/**`) and `integration` (`tests/integration/**`, uses `TEST_DATABASE_URL`, runs `prisma migrate deploy` once in globalSetup, `resetDb()` beforeEach). Add a smoke test `tests/integration/db.test.ts`: create a `School`, read it back.
- [ ] **Step 6:** Run `npm test && npm run test:int` → both PASS. `npm run build` → succeeds.
- [ ] **Step 7:** Root layout: `<html lang="ar" dir="rtl">`, fonts via `next/font/google`, Tailwind theme colors `navy`, `teal`, `mist`. Dockerfile: multi-stage, `node:22-slim`, runs `prisma migrate deploy && node dist/server.js`.
- [ ] **Step 8:** Commit `chore: scaffold Next.js app, Prisma schema, test harness`.

### Task 2: Phone normalisation, passwords, sessions, OTP, accounts

**Files:**
- Create: `src/lib/phone.ts`, `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/otp.ts`, `src/lib/auth/accounts.ts`, `src/app/api/auth/{otp,register,login,logout,reset}/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`, `src/app/(auth)/forgot/page.tsx`
- Test: `tests/unit/phone.test.ts`, `tests/integration/accounts.test.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(input: string): string | null` (E.164 Saudi mobile or null)
  - `hashPassword(p: string): Promise<string>`, `verifyPassword(hash: string, p: string): Promise<boolean>`
  - `createSession(userId: string, role: Role): Promise<string /*token*/>`, `getSessionUser(token: string | undefined): Promise<User | null>`, `destroySession(token: string): Promise<void>`
  - `issueOtp(identifier: string, purpose: OtpPurpose): Promise<void>` (throws `RateLimitError`), `verifyOtp(identifier, purpose, code): Promise<boolean>`
  - `registerGuardian({identifier, code, name, password}): Promise<User>` — identifier is phone or email; role `GUARDIAN`
  - `login({identifier, password}): Promise<User>` (throws `InvalidCredentials`); identifier may be phone, email, or username
  - `resetPassword({identifier, code, password}): Promise<void>`
  - Errors in `src/lib/errors.ts`: `AppError(code: string, messageAr: string, status: number)` and subclasses `RateLimitError`, `InvalidCredentials`, `NotFound`, `Conflict`, `Forbidden`, `ValidationError`. Route handlers map `AppError` → JSON `{error: code, message: messageAr}` with `status`.

- [ ] **Step 1: Failing unit tests for `normalizePhone`:**
```ts
expect(normalizePhone('0501234567')).toBe('+966501234567')
expect(normalizePhone('966501234567')).toBe('+966501234567')
expect(normalizePhone('+966 50 123 4567')).toBe('+966501234567')
expect(normalizePhone('٠٥٠١٢٣٤٥٦٧')).toBe('+966501234567')
expect(normalizePhone('501234567')).toBe('+966501234567')
expect(normalizePhone('0401234567')).toBeNull()   // not a mobile
expect(normalizePhone('12345')).toBeNull()
```
- [ ] **Step 2:** Run `npx vitest run tests/unit/phone.test.ts` → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Failing integration tests in `accounts.test.ts`:**
  - `registers guardian with phone after OTP` — `issueOtp('+966501234567','REGISTER')`, read `devVisible` from `OtpCode`, `registerGuardian` → user with role GUARDIAN, phone set; `login` with same phone + password returns same user.
  - `rejects wrong OTP and locks after 5 attempts` — 5 wrong `verifyOtp` → false; 6th with correct code → false.
  - `rate-limits OTP sends` — 4th `issueOtp` within 15 min throws `RateLimitError`.
  - `expired OTP rejected` — set `expiresAt` in past → false.
  - `login rejects wrong password` → `InvalidCredentials`.
  - `email registration works` — identifier `a@b.com`.
  - `reset password` — `resetPassword` with valid code, old password fails, new works.
  - `session lifetime` — guardian session `expiresAt` ≈ now+30d; staff ≈ now+12h; `getSessionUser` with expired token → null.
- [ ] **Step 4:** Run → FAIL. Implement modules. OTP provider adapter: `interface OtpSender { send(identifier: string, text: string): Promise<void> }`; `DevSender` logs and stores `devVisible`; message text `رمز التحقق في وصل: {code}`. Run → PASS.
- [ ] **Step 5:** Route handlers + pages. Register flow: identifier → «إرسال الرمز» → code + name + password (min 8 chars) → logged in → redirect by role (`GUARDIAN`→`/parent`, `STAFF`→`/staff`, `SCHOOL_ADMIN`→`/school`, `PLATFORM_ADMIN`→`/admin`). Users with `mustChangePassword` are redirected to `/account/password` until changed. Login page shows links «إنشاء حساب» and «نسيت كلمة المرور».
- [ ] **Step 6:** Commit `feat(auth): phone/email + password login with OTP verification`.

### Task 3: Authorization and tenant isolation; platform admin creates schools

**Files:**
- Create: `src/lib/authz.ts`, `src/lib/audit.ts`, `src/lib/admin/schools.ts`, `src/app/api/admin/schools/route.ts`, `src/app/admin/page.tsx`, `src/middleware.ts`
- Test: `tests/integration/authz.test.ts`

**Interfaces:**
- Produces:
  - `requireUser(req: Request): Promise<User>` (throws `Forbidden` 401)
  - `requireRole(user: User, ...roles: Role[]): void`
  - `assertSchoolAccess(user: User, schoolId: string): void` — PLATFORM_ADMIN passes; SCHOOL_ADMIN must match `user.schoolId`; STAFF must match school; otherwise throws `NotFound`
  - `assertBranchAccess(user: User, branchId: string): Promise<void>` — STAFF must match `user.branchId`; SCHOOL_ADMIN any branch of own school; else `NotFound`
  - `writeAudit({schoolId, actorId, action, entity, entityId, data}): Promise<void>`
  - `createSchoolWithAdmin({schoolName, branchName, adminName, adminUsername, tempPassword}): Promise<{school, branch, admin}>` — admin has `mustChangePassword=true`; branch gets random 24-char `boardToken`
  - CLI `npm run create-platform-admin -- --username X --password Y`

- [ ] **Step 1: Failing tests:** `school admin of A cannot access school B → NotFound`; `staff of branch A1 cannot access branch A2 of same school → NotFound`; `school admin can access every branch of own school`; `platform admin creates school + admin; admin must change password`; `audit row written on school creation`.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** `/admin` page: list schools, form «إضافة مدرسة» (school, first branch, admin name, username, temp password). In dev mode, `/admin` also lists the 20 latest `OtpCode.devVisible` with identifier and time (heading «رموز التحقق — وضع التطوير»).
- [ ] **Step 4:** `src/middleware.ts` redirects unauthenticated users on `/parent|/staff|/school|/admin` to `/login`. Commit `feat: authorization, tenant isolation, platform admin`.

### Task 4: School setup — branches, gates, classrooms, schedules, holidays, staff accounts

**Files:**
- Create: `src/lib/school/setup.ts`, `src/lib/school/staff.ts`, `src/app/api/school/{branches,gates,classrooms,schedules,holidays,overrides,staff}/route.ts` (+ `[id]/route.ts` for update/delete), `src/app/school/setup/page.tsx`, `src/app/school/staff/page.tsx`
- Test: `tests/integration/setup.test.ts`

**Interfaces:**
- Consumes: `assertSchoolAccess`, `assertBranchAccess`, `writeAudit`.
- Produces: `createBranch`, `createGate`, `createClassroom`, `setClassSchedule(classroomId, weekday: 0-6, dismissal: "HH:MM")`, `addHoliday`, `addOverride`, `createStaff({branchId, name, username, tempPassword, gateIds})`, `setUserActive` — each takes `(actor: User, input)` and returns the row.

- [ ] **Step 1: Failing tests:** schedule rejects `"25:00"` and weekday 7 (`ValidationError`); `setClassSchedule` upserts on same weekday; staff creation sets role STAFF, branchId, `mustChangePassword`; school admin of another school gets `NotFound` on every create.
- [ ] **Step 2:** Run → FAIL; implement with zod schemas; run → PASS.
- [ ] **Step 3:** `/school/setup` page: tabs «الفروع والبوابات», «الفصول والجداول» (a weekday × class grid of time inputs), «الإجازات والاستثناءات», plus school settings (week days, pickup lead/tail minutes, ETA speed). `/school/staff`: list + add staff + reset password + deactivate.
- [ ] **Step 4:** Commit `feat(school): setup of branches, gates, classes, schedules, staff`.

### Task 5: Students, guardian phones, import, parent's children

**Files:**
- Create: `src/lib/school/students.ts`, `src/lib/school/import.ts`, `src/lib/guardian/children.ts`, `src/app/api/school/students/route.ts`, `src/app/api/school/students/import/route.ts`, `src/app/api/me/children/route.ts`, `src/app/school/students/page.tsx`, `public/templates/students-template.xlsx`
- Test: `tests/unit/import-parse.test.ts`, `tests/integration/students.test.ts`

**Interfaces:**
- Produces:
  - `parseStudentSheet(buf: Buffer, filename: string): {rows: ImportRow[], errors: {row: number, messageAr: string}[]}` with `ImportRow = {externalId: string, fullName: string, branch: string, classroom: string, gate: string, phones: string[]}`; columns (Arabic headers, exact): `رقم الطالب`, `اسم الطالب`, `الفرع`, `الفصل`, `البوابة`, `جوال ولي الأمر 1`, `جوال ولي الأمر 2`, `جوال ولي الأمر 3`
  - `applyImport(actor: User, schoolId: string, rows: ImportRow[]): Promise<{created: number, updated: number, errors: {row, messageAr}[]}>` — unknown branch/classroom/gate names → row error; upsert by `(schoolId, externalId)`; guardian phones replaced by the file's set
  - `listChildrenForUser(user: User): Promise<ChildView[]>` with `ChildView = {studentId, fullName, schoolName, branchId, branchName, classroom, gateName, todayDismissal: string | null, status: 'IN_SCHOOL'|ItemStatus, activeRequestId: string | null}` — GUARDIAN: all active students whose `GuardianPhone.phone` equals `user.phone`, across schools

- [ ] **Step 1: Failing unit tests** (Review Focus 5): messy and Arabic-Indic phones normalised; row with invalid phone → error for that row number, other rows kept; missing name → error; duplicate `externalId` within the file → second wins with a warning.
- [ ] **Step 2: Failing integration tests:** import twice → second run `updated` not `created`; guardian registered with `+966501234567` sees two children in two different schools; guardian registered by email (no phone) sees none; removing a phone in re-import removes the child from that guardian's list.
- [ ] **Step 3:** Run → FAIL; implement; run → PASS.
- [ ] **Step 4:** `/school/students`: table with search and branch/class filters, add/edit form, «رفع ملف» with downloadable template and a result summary (created / updated / errors with row numbers). Account settings page lets an email-registered guardian add a phone via OTP purpose `LINK_PHONE`.
- [ ] **Step 5:** Commit `feat: students, import, guardian children`.

### Task 6: School-day schedule logic

**Files:**
- Create: `src/lib/time.ts`, `src/lib/schedule.ts`
- Test: `tests/unit/schedule.test.ts`

**Interfaces:**
- Produces:
  - `riyadhDay(now: Date): {date: string /*YYYY-MM-DD*/, weekday: number, minutes: number}`
  - `dismissalFor(ctx: ScheduleCtx, date: string): string | null` where `ScheduleCtx = {weekDays: number[], schedule: {weekday, dismissal}[], holidays: string[], overrides: {date, dismissal}[]}` (override wins; holiday or non-school weekday → null)
  - `pickupWindow(dismissal: string, leadMin: number, tailMin: number): {openMin: number, closeMin: number}`
  - `canRequestNow(ctx, lead, tail, now: Date): {ok: true, dismissal: string} | {ok: false, reasonAr: string}`

- [ ] **Step 1: Failing tests:** Sunday 12:15 dismissal, now 11:14 Riyadh → not ok («يبدأ طلب الاستلام الساعة 11:15»); 11:15 → ok; 15:15 → ok; 15:16 → not ok; Friday → not ok («لا يوجد دوام اليوم»); holiday → not ok; override 10:30 on that date → window 09:30–13:30; UTC→Riyadh conversion across midnight (21:30Z Saturday = Sunday 00:30 Riyadh).
- [ ] **Step 2:** Run → FAIL; implement (use `Intl.DateTimeFormat` with `timeZone: 'Asia/Riyadh'`, no extra lib); run → PASS.
- [ ] **Step 3:** Commit `feat: school-day schedule and pickup window`.

### Task 7: Pickup core — state machine, rotating code, create/advance/verify/deliver/cancel

**Files:**
- Create: `src/lib/pickup/state.ts`, `src/lib/pickup/code.ts`, `src/lib/pickup/service.ts`, `src/lib/notify.ts`
- Test: `tests/unit/state.test.ts`, `tests/unit/code.test.ts`, `tests/integration/pickup.test.ts`

**Interfaces:**
- Consumes: `canRequestNow`, `listChildrenForUser`, `assertBranchAccess`, `writeAudit`.
- Produces:
  - `nextStatus(from: ItemStatus, action: 'PREPARE'|'READY'|'DELIVER'|'CANCEL'): ItemStatus` (throws `Conflict` on illegal move). Legal: EN_ROUTE→PREPARING→READY→DELIVERED; EN_ROUTE|PREPARING|READY→CANCELLED.
  - `pickupCode(requestId: string, at: Date, secret = env.PICKUP_CODE_SECRET): string` — HMAC-SHA256(secret, `${requestId}:${floor(epochSec/60)}`) → first 4 bytes as uint32 mod 1_000_000, zero-padded to 6
  - `checkPickupCode(requestId, code, at): boolean` — current or previous window
  - `qrPayload(requestId: string, at: Date): string` = `WASL1:${requestId}:${pickupCode(...)}`; `parseQr(s): {requestId, code} | null`
  - `createRequest(user: User, studentIds: string[], now = new Date()): Promise<PickupRequest & {items: PickupItem[]}>` — all students must be visible to user and in one branch (else `ValidationError` «لا يمكن جمع أبناء من فروع مختلفة في طلب واحد»); each must pass `canRequestNow`; any student with an active item → `Conflict` «يوجد طلب نشط لـ{student} من {requesterName}»; gate = default gate of the youngest (lowest `Classroom.grade`) student; `number` = max(number for branch+day)+1 starting at 1 (in a transaction, retry on unique violation)
  - `advanceItem(staff: User, itemId: string, action: 'PREPARE'|'READY'): Promise<PickupItem>`
  - `changeGate(staff: User, requestId: string, gateId: string): Promise<void>`
  - `verifyRecipient(staff: User, input: {requestId?: string, code: string} | {qr: string}, now = new Date()): Promise<{requestId, recipient: {name, role, photoKey}, items: {itemId, studentName, status}[]}>` — by code alone (no requestId) search open requests of staff's branch whose current/previous code matches; sets `verifiedAt/verifiedById/verifyMethod ('CODE'|'QR')`; wrong code → `ValidationError` «الرمز غير صحيح»
  - `deliverItems(staff: User, requestId: string, itemIds: string[]): Promise<void>` — requires `verifiedAt` within last 10 minutes, items must be READY; when no items remain active: `open=false`, `closedAt`, `lat/lng/locationAt/etaSeconds=null`
  - `cancelRequest(actor: User, requestId: string, reasonAr?: string): Promise<void>` — guardian (own request, no reason needed) or staff/admin (reason required); clears location
  - `notify(userIds: string[], event: string, data: object): Promise<void>` — Phase 1 stub: no-op that records nothing (Phase 2 implements push)
  - All mutations call `writeAudit` and `emitPickupChanged(requestId)` (Task 9; until then import a no-op from `src/lib/realtime.ts`).

- [ ] **Step 1: Failing unit tests:** every legal transition; `DELIVERED→PREPARING` throws; code is 6 digits; same window same code; previous window accepted; two windows old rejected (Review Focus 4); different requestIds give different codes; `parseQr(qrPayload(...))` round-trips; garbage → null.
- [ ] **Step 2: Failing integration tests:** create for two siblings same branch → one request, two items, number 1; next request same day → number 2; next day → 1; siblings in different branches → ValidationError (Review Focus 1); second guardian on same child → Conflict naming first requester (Review Focus 2); outside window → ValidationError with Arabic reason; staff of other branch calling `advanceItem` → NotFound (Review Focus 3); deliver before verify → Conflict; verify wrong code → ValidationError; full flow PREPARE→READY→verify→deliver closes request and nulls location; guardian cancel clears location; staff cancel without reason → ValidationError.
- [ ] **Step 3:** Run → FAIL; implement; run → PASS.
- [ ] **Step 4:** Commit `feat(pickup): request lifecycle, rotating codes, verification`.

### Task 8: Location updates, ETA, "arrived"

**Files:**
- Create: `src/lib/pickup/eta.ts`, add `updateLocation` and `markArrived` to `src/lib/pickup/service.ts`, `src/app/api/pickups/[id]/location/route.ts`, `src/app/api/pickups/[id]/arrived/route.ts`; add `lat Float?, lng Float?` to `Branch` (set in setup page)
- Test: `tests/unit/eta.test.ts`, extend `tests/integration/pickup.test.ts`

**Interfaces:**
- Produces: `haversineMeters(a: {lat,lng}, b: {lat,lng}): number`; `etaSeconds(meters: number, speedKmh: number): number` (rounded up); `updateLocation(user, requestId, {lat, lng, accuracy}): Promise<{etaSeconds: number | null}>` — only requester, only while open; ignores points with accuracy > 500 m (keeps previous); overwrites last point; if branch has no coordinates ETA = null; `markArrived(user, requestId)`.

- [ ] **Step 1: Failing tests:** Riyadh (24.7136, 46.6753) → (24.7743, 46.7386) ≈ 9.2 km ± 0.2; 9 km at 30 km/h → 1080 s; location after close → Conflict; another user → NotFound; only one stored point (second update replaces first); accuracy 800 m ignored.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Commit `feat(pickup): live location and ETA during active trip`.

### Task 9: Realtime

**Files:**
- Create: `src/lib/realtime.ts`; modify `server.ts`
- Test: `tests/integration/realtime.test.ts`

**Interfaces:**
- Produces:
  - rooms: `branch:{branchId}` (staff + school admin), `user:{userId}`, `board:{branchId}`
  - `emitPickupChanged(requestId: string): Promise<void>` — loads request + items; sends `pickup:changed` with full staff view to `branch:`; owner view (status, number, gate, eta, no other families' data) to `user:{requesterId}`; `board:update` with `{number, gate, status: 'PREPARING'|'READY'|'GONE'}` to `board:`
  - Socket handshake: cookie `wasl_session` → join `user:` and, for STAFF/SCHOOL_ADMIN, the allowed `branch:` rooms (school admin chooses branch via `join-branch` event, checked with `assertBranchAccess`); `?board=TOKEN` → join `board:` of that branch only
  - Client hook `useLive(event, handler)` in `src/components/live.tsx`; on reconnect the page refetches its data

- [ ] **Step 1: Failing test** (start server on random port, two `socket.io-client`s): staff client of branch A receives `pickup:changed` after `advanceItem`; staff of branch B does not; board client receives `board:update` without any `fullName` key anywhere in the payload; unauthenticated client gets only nothing.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Commit `feat: realtime updates over Socket.IO`.

### Task 10: Parent UI

**Files:**
- Create: `src/app/parent/page.tsx`, `src/app/parent/request/[id]/page.tsx`, `src/app/parent/history/page.tsx`, `src/app/api/pickups/route.ts` (POST create, GET mine), `src/app/api/pickups/[id]/route.ts` (GET, DELETE=cancel), `src/app/api/pickups/[id]/code/route.ts`, `src/components/{StatusChip,ChildCard,CodeCard}.tsx`, `public/manifest.webmanifest`, icons
- Test: covered by e2e in Task 14

**Interfaces:**
- Consumes: `listChildrenForUser`, `createRequest`, `cancelRequest`, `updateLocation`, `markArrived`, `pickupCode`, `qrPayload`, `useLive`.
- Produces: `GET /api/pickups/[id]/code` → `{code, qr, expiresInSec}` for the requester only (`NotFound` otherwise).

- [ ] **Step 1:** Home: card per child (name, school/branch, class, today's dismissal, gate, `StatusChip`); checkbox selection + main button «أنا في الطريق» (disabled with reason from `canRequestNow` when outside window). Status labels exactly: داخل المدرسة / في الطريق / قيد التجهيز / جاهز للاستلام / تم التسليم / ملغى.
- [ ] **Step 2:** Request page: number, gate, per-child status, «مشاركة موقعك نشطة» indicator with last-sent time; `navigator.geolocation.watchPosition` posting at most every 15 s; consent sheet before first use («يُشارك موقعك مع المدرسة خلال هذه الرحلة فقط ويتوقف عند التسليم»); permission denial shows «تم إرسال الطلب بدون مشاركة الموقع» and continues. Buttons «وصلت» and «إلغاء الطلب». When any item is READY: `CodeCard` shows 6-digit code + QR (rendered client-side with `qrcode`), refetched every 30 s and on expiry. On close: stops watching, shows «تم التسليم الساعة HH:MM».
- [ ] **Step 3:** History: last 30 closed requests (date, children, delivered time, staff name).
- [ ] **Step 4:** PWA manifest (name «وصل», theme `#123B67`) + «أضف وصل إلى الشاشة الرئيسية» hint for iOS Safari.
- [ ] **Step 5:** Manual check against seed data; commit `feat(parent): home, active request, code, history`.

### Task 11: Staff UI

**Files:**
- Create: `src/app/staff/page.tsx`, `src/app/api/staff/requests/route.ts`, `src/app/api/staff/items/[id]/route.ts` (PATCH action), `src/app/api/staff/verify/route.ts`, `src/app/api/staff/deliver/route.ts`, `src/app/api/staff/requests/[id]/gate/route.ts`, `src/components/QrScanner.tsx`
- Test: `tests/integration/staff-api.test.ts`

**Interfaces:**
- Consumes: `advanceItem`, `verifyRecipient`, `deliverItems`, `changeGate`, `cancelRequest`, `useLive`.
- Produces: `GET /api/staff/requests?q=` → open requests of staff's branch (and staff's gates if `gateIds` non-empty), ordered READY, PREPARING, EN_ROUTE by `etaSeconds` asc nulls last.

- [ ] **Step 1: Failing API tests:** list filtered by branch and gates; search by student name substring and by request number; cross-branch item id → 404 (Review Focus 3).
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Page (tablet-first): search box; request cards (number, children, class, gate, ETA / «وصل», chip); per item buttons «بدء التجهيز» then «تأكيد الجاهزية»; verification panel with code input and «مسح QR» (camera via `html5-qrcode`); after verification shows recipient name + role (+ photo when present, Phase 2) and checkboxes of READY children, then «تأكيد التسليم». Errors shown inline in Arabic from `AppError.message`.
- [ ] **Step 4:** Commit `feat(staff): dismissal staff interface`.

### Task 12: School dashboard

**Files:**
- Create: `src/app/school/page.tsx`, `src/app/api/school/dashboard/route.ts`, `src/app/api/school/audit/route.ts`
- Test: `tests/integration/dashboard.test.ts`

**Interfaces:**
- Produces: `getDashboard(actor, branchId, now): Promise<{counts: {open, enRoute, preparing, ready, deliveredToday}, avgWaitSecToday: number | null, requests: StaffRequestView[], recent: AuditLog[]}>` — `avgWaitSecToday` = mean(deliveredAt − readyAt) over today's delivered items.

- [ ] **Step 1: Failing test:** counts and average computed from fixture of 3 delivered items (waits 60, 120, 180 → 120); other branch's data excluded.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Page: branch selector, stat tiles, live table (number, student, class, gate, ETA/last location update «قبل X د», status), event feed (last 20 audit rows in Arabic), link «فتح شاشة الانصراف» showing the board URL with copy button and «تجديد الرابط» (regenerates `boardToken`).
- [ ] **Step 4:** Commit `feat(school): live dashboard`.

### Task 13: Public dismissal board

**Files:**
- Create: `src/app/board/[token]/page.tsx`, `src/app/api/board/[token]/route.ts`
- Test: `tests/integration/board.test.ts`

**Interfaces:**
- Produces: `getBoard(token): Promise<{branchName, preparing: {number, gate}[], ready: {number, gate}[]}>`; invalid token → 404.

- [ ] **Step 1: Failing test:** payload contains no student names or ids (assert JSON string has none of the seeded names); unknown token → 404; regenerated token invalidates old.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Full-screen dark page (navy background), two columns «قيد التجهيز» / «جاهز للاستلام — توجّه إلى البوابة», large numbers, new READY tiles highlight for 5 s; wake lock requested; live via `board:` room.
- [ ] **Step 4:** Commit `feat: public dismissal board`.

### Task 14: Seed, end-to-end journey, run docs

**Files:**
- Create: `prisma/seed.ts`, `e2e/pickup.spec.ts`, `playwright.config.ts`; update `README.md` (Arabic + English run instructions)

- [ ] **Step 1:** Seed: school «مدارس الأفق الأهلية», branch «فرع الملقا» with coordinates, gates «بوابة 1/2», 4 classrooms with Sun–Thu schedules, 12 students, guardian phone `+966500000001` on two siblings, staff `noura` / `Staff@12345`, school admin `admin` / `Admin@12345`, platform admin `root` / `Root@12345` (all except guardian `mustChangePassword=false` in seed only). Mark seed data as demo in names of nothing real.
- [ ] **Step 2: E2E test** (`--trace off`), with clock fixed inside the window via Playwright `page.clock`: guardian registers with `0500000001` (reads OTP from `/admin` dev list as root in a second context), sees two children, selects both, «أنا في الطريق» (geolocation permission granted with fake coords) → staff page shows the request within 3 s without reload → staff «بدء التجهيز», «تأكيد الجاهزية» for both → guardian sees code → staff types it → «تأكيد التسليم» → guardian sees «تم التسليم» → board shows nothing for that number → dashboard deliveredToday = 1.
- [ ] **Step 3:** Run `npm run e2e -- --trace off` → PASS. Run full `npm test && npm run test:int && npm run build` → PASS.
- [ ] **Step 4:** README: prerequisites, `.env`, migrate, seed, run, demo accounts, where OTP codes appear in dev mode.
- [ ] **Step 5:** Commit `test: end-to-end pickup journey; docs`.
