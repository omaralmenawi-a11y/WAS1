import { test, expect, type Browser, type Page } from '@playwright/test';

const FAKE_NOW = new Date(process.env.WASL_FAKE_NOW!);
const GUARDIAN_PHONE = '0500000001';
const GUARDIAN_PASSWORD = 'Parent@12345';
const SIBLINGS = ['سامر تجريبي الأول', 'ليان تجريبية الثانية'];
const NORTH_RIYADH = { latitude: 24.82, longitude: 46.63 };

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('رقم الجوال أو البريد الإلكتروني أو اسم المستخدم').fill(username);
  await page.getByLabel('كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
}

async function newPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FAKE_NOW); // browser clock agrees with the server's WASL_FAKE_NOW
  return page;
}

test('full pickup journey: register, request, prepare, ready, code, deliver', async ({ browser, baseURL }) => {
  // Root in its own context: reads the dev OTP from /admin.
  const root = await newPage(browser);
  await login(root, 'root', 'Root@12345');
  await root.waitForURL('**/admin');

  // Guardian registers.
  const guardian = await newPage(browser, { geolocation: NORTH_RIYADH, permissions: ['geolocation'] });
  await guardian.goto('/register');
  await guardian.getByLabel('رقم الجوال أو البريد الإلكتروني').fill(GUARDIAN_PHONE);
  await guardian.getByRole('button', { name: 'إرسال الرمز' }).click();
  await guardian.getByLabel('رمز التحقق').waitFor();

  await root.goto('/admin');
  const row = root.locator('li', { hasText: '+966500000001' }).first();
  await expect(row).toBeVisible();
  const code = (await row.locator('span.font-mono').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);

  await guardian.getByLabel('رمز التحقق').fill(code);
  await guardian.getByLabel('الاسم الكامل').fill('ولي أمر تجريبي');
  await guardian.getByLabel('كلمة المرور (٨ أحرف على الأقل)').fill(GUARDIAN_PASSWORD);
  await guardian.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await guardian.waitForURL('**/parent');

  // Two siblings linked by phone.
  for (const n of SIBLINGS) await expect(guardian.getByRole('heading', { name: n })).toBeVisible();
  await expect(guardian.getByRole('checkbox')).toHaveCount(2);
  for (const n of SIBLINGS) await guardian.getByLabel(`اختيار ${n}`).check();

  // Staff opens the queue before the request is made (no reload afterwards).
  const staff = await newPage(browser);
  await login(staff, 'noura', 'Staff@12345');
  await staff.waitForURL('**/staff');
  await expect(staff.getByText(SIBLINGS[0])).toHaveCount(0);

  await guardian.getByRole('button', { name: 'أنا في الطريق' }).click();
  await guardian.waitForURL('**/parent/request/*');
  await guardian.getByRole('button', { name: 'موافق' }).click(); // location consent
  await expect(guardian.getByText('مشاركة موقعك نشطة')).toBeVisible();
  const number = (await guardian.getByRole('heading', { level: 1 }).innerText()).match(/\d+/)![0];

  // Staff sees it within 3 s, live.
  for (const n of SIBLINGS) await expect(staff.getByText(n).first()).toBeVisible({ timeout: 3000 });
  await expect(staff.getByRole('button', { name: 'بدء التجهيز' })).toHaveCount(2);

  // Prepare then ready, for both.
  for (let i = 0; i < 2; i++) {
    await staff.getByRole('button', { name: 'بدء التجهيز' }).first().click();
    await expect(staff.getByRole('button', { name: 'بدء التجهيز' })).toHaveCount(1 - i);
  }
  for (let i = 0; i < 2; i++) {
    await staff.getByRole('button', { name: 'تأكيد الجاهزية' }).first().click();
    await expect(staff.getByRole('button', { name: 'تأكيد الجاهزية' })).toHaveCount(1 - i);
  }

  // Board shows the number (never names).
  const board = await newPage(browser);
  const token = await boardToken();
  await board.goto(`${baseURL}/board/${token}`);
  await expect(board.getByText(number, { exact: true }).first()).toBeVisible();
  await expect(board.getByText(SIBLINGS[0])).toHaveCount(0);

  // Guardian sees the pickup code.
  await expect(guardian.getByText('جاهز للاستلام').first()).toBeVisible();
  const codeBox = guardian.locator('section[aria-label="رمز الاستلام"] .font-mono');
  await expect(codeBox).toHaveText(/^\d{6}$/);
  const pickupCode = (await codeBox.innerText()).trim();

  // Staff types the request number with the code (R8), verifies and delivers.
  await staff.getByLabel('رقم الطلب').fill(number);
  await staff.getByLabel('رمز الاستلام').fill(pickupCode);
  await staff.getByRole('button', { name: 'تحقق' }).click();
  await expect(staff.getByRole('button', { name: 'تأكيد التسليم' })).toBeEnabled();
  await staff.getByRole('button', { name: 'تأكيد التسليم' }).click();

  // Guardian sees delivered; the board no longer shows the number.
  await expect(guardian.getByText(/تم التسليم الساعة/)).toBeVisible();
  await expect(board.getByText(number, { exact: true })).toHaveCount(0, { timeout: 10_000 });

  // School dashboard: deliveredToday counts delivered items (two siblings = 2).
  const admin = await newPage(browser);
  await login(admin, 'admin', 'Admin@12345');
  await admin.waitForURL('**/school');
  const tile = admin.getByText('تم التسليم اليوم', { exact: true }).locator('..');
  await expect(tile).toContainText('2');
});

/** Board token of the demo branch (read from the seeded database through the admin API-free route: Prisma). */
async function boardToken(): Promise<string> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL_RESOLVED! } } });
  try {
    const b = await prisma.branch.findFirstOrThrow({ where: { name: 'فرع الملقا' } });
    return b.boardToken;
  } finally {
    await prisma.$disconnect();
  }
}
