import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('public login', () => {
  test('serves the login page from the root URL without redirecting', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page).toHaveTitle(/Sobrew Coffee Wholesale Ordering Portal/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('keeps sign-in first, keyboard accessible, and free of serious accessibility violations', async ({ page }) => {
    await page.goto('/login');

    const email = page.getByLabel('Email address');
    const password = page.getByLabel('Password');
    const submit = page.getByRole('button', { name: /sign in/i });
    const mission = page.getByRole('heading', { name: 'Coffee that moves recovery forward.' });

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(mission).toBeVisible();

    const formBox = await email.boundingBox();
    const missionBox = await mission.boundingBox();
    expect(formBox).not.toBeNull();
    expect(missionBox).not.toBeNull();
    if ((page.viewportSize()?.width ?? 0) < 768) {
      expect(formBox!.y).toBeLessThan(missionBox!.y);
    }

    await email.focus();
    await expect(email).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);

    const { violations } = await new AxeBuilder({ page }).include('main').analyze();
    expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  });

  test('shows critical sign-in errors as persistent alerts', async ({ page }) => {
    await page.goto('/login?error=1');
    await expect(page.locator('.login-alert[role="alert"]')).toContainText("couldn't sign you in");
  });

  test('preserves scroll for server-action-style same-page saves', async ({ page }) => {
    await page.goto('/login');

    await page.evaluate(() => {
      const topSpacer = document.createElement('div');
      topSpacer.style.height = '1800px';

      const form = document.createElement('form');
      form.id = 'scroll-smoke-form';

      const button = document.createElement('button');
      button.type = 'submit';
      button.textContent = 'Smoke save';

      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = '1200px';

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        window.scrollTo(0, 0);
        window.history.pushState({}, '', '/login?scroll_smoke=1');
      });

      form.append(button);
      document.body.append(topSpacer, form, bottomSpacer);
    });

    const button = page.locator('#scroll-smoke-form button');
    await button.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(1_000);

    await button.click();
    await expect(page).toHaveURL(/\/login\?scroll_smoke=1$/);
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBeGreaterThan(1_000);
    expect(Math.abs(after - before)).toBeLessThan(500);
  });
});
