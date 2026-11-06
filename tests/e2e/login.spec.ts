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
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeFocused();

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

test.describe('public password recovery', () => {
  test('opens an accessible reset-request form from sign-in', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveAttribute('type', 'email');
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex.*nofollow/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    const { violations } = await new AxeBuilder({ page }).include('main').analyze();
    expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);

    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('shows a generic request confirmation without identifying an account', async ({ page }) => {
    await page.goto('/forgot-password?sent=1');

    await expect(page.getByRole('status')).toHaveText('If an account exists for that email, you’ll receive a password reset link. Check your inbox and spam folder.');
    await expect(page.getByRole('button', { name: 'Send reset link' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Try another email' }).click();
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('keeps request errors visible and offers another attempt', async ({ page }) => {
    await page.goto('/forgot-password?error=email');
    await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');

    await page.goto('/forgot-password?error=rate_limit');
    await expect(page.getByRole('alert')).toContainText('wait a few minutes');
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  });

  test('offers a new link for invalid or expired recovery URLs', async ({ page }) => {
    await page.goto('/reset-password?error=invalid_link');

    await expect(page.getByRole('alert')).toContainText('invalid or has expired');
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex.*nofollow/);
    await page.getByRole('link', { name: 'Request a new reset link', exact: true }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    await page.goto('/reset-password?token_hash=invalid');
    await expect(page.getByRole('alert')).toContainText('invalid or has expired');
    await expect(page.getByRole('button', { name: 'Continue to reset password' })).toHaveCount(0);
  });

  test('requires confirmation before using a recovery token and cleans its URL', async ({ page }) => {
    const exampleToken = 'a'.repeat(64);
    await page.goto(`/reset-password?token_hash=${exampleToken}`);

    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole('button', { name: 'Continue to reset password' })).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(exampleToken);
    expect(await page.evaluate(() => document.cookie)).not.toContain(exampleToken);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });

  test('confirms a completed reset on the sign-in page', async ({ page }) => {
    await page.goto('/login?success=password_reset');

    await expect(page.getByRole('status')).toHaveText('Your password has been reset. Sign in with your new password.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
