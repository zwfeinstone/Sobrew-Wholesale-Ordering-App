import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('public login', () => {
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
});
