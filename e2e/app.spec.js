// The main journeys, in a real browser against a real server.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo@2026';

async function signIn(page, username) {
  await page.goto('/#/login');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').first().fill(PASSWORD);
  await page.locator('form button.btn.dark').click();
  await expect(page.locator('.user-chip')).toBeVisible();
}

/** Everything fits: no sideways scrolling, and the bar stays inside the window. */
async function expectNoOverflow(page) {
  const { sideways, barFits } = await page.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const chip = document.querySelector('.user-chip')?.getBoundingClientRect();
    return {
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barFits: bar.right <= window.innerWidth && (!chip || !chip.width || chip.right <= bar.right + 1),
    };
  });
  expect(sideways).toBeLessThanOrEqual(0);
  expect(barFits).toBe(true);
}

test.beforeEach(({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) throw new Error(`Blocked by the policy: ${m.text()}`);
  });
  page.on('pageerror', (err) => { throw err; });
});

test('the landing page opens for a visitor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know where your bus is');
  await expect(page.getByRole('link', { name: 'Sign in or register' })).toBeVisible();
});

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Username or email').fill('admin');
  await page.getByLabel('Password').first().fill('not-the-password');
  await page.locator('form button.btn.dark').click();
  await expect(page.locator('.error').first()).toContainText('Invalid');
});

test('the transport office sees the dashboard and every page', async ({ page }) => {
  await signIn(page, 'admin');
  await expect(page.getByRole('heading', { name: 'Transport office' })).toBeVisible();
  await expect(page.getByText('System health')).toBeVisible();
  for (const path of ['map', 'trips', 'attendance', 'routes', 'fleet', 'notices', 'service', 'care', 'reports']) {
    await page.goto(`/#/${path}`);
    await page.waitForTimeout(300);
    await expectNoOverflow(page);
  }
});

test('the navbar fits at every width, and spare links move to More', async ({ page }) => {
  await signIn(page, 'admin');
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.waitForTimeout(300);
  await expectNoOverflow(page);
  await expect(page.locator('button.nav-more-btn')).toBeVisible();
  await page.locator('button.nav-more-btn').click();
  await page.locator('.nav-more-menu a').first().click();
  await expect(page.locator('.nav-track a.active')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  await expectNoOverflow(page);
  await expect(page.locator('.menu-toggle')).toBeVisible();
});

test('the upload screen shows a preview before changing anything', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/#/fleet');
  await page.getByRole('tab', { name: 'Students and year' }).click();
  const csv = 'register_no,full_name,email\nE2E001,Test Person,e2e001@students.example.edu\n';
  await page.locator('input[type=file]').first().setInputFiles({ name: 'students.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('1 new, 0 to update, 0 with problems')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm and apply' })).toBeVisible();
});

test('a student sees their home, schedule and data controls', async ({ page }) => {
  await signIn(page, 'stu001');
  await expect(page.locator('.app-greet')).toBeVisible();
  await page.goto('/#/schedule');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await page.goto('/#/settings');
  await page.getByText('Your data').click();
  await expect(page.getByRole('button', { name: 'Download my data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
  await expectNoOverflow(page);
});

test('a driver starts and ends a trip', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await signIn(page, 'drv118');
  await page.getByRole('button', { name: 'Start trip' }).click();
  await expect(page.getByRole('button', { name: 'End trip' })).toBeVisible();
  await page.getByRole('button', { name: 'End trip' }).click();
  await expect(page.getByRole('button', { name: 'Start trip' })).toBeVisible();
});

test('dark mode applies, and the sign-in card has no pale surface', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ubts.theme', 'dark'));
  await page.goto('/#/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const background = await page.locator('.auth-card').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toMatch(/255, 255, 255/);
});
