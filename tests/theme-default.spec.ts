import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3102';

// First-paint theme: the inline <head> script must set data-theme before hydration.
async function themeBeforeHydration(page: import('@playwright/test').Page, url: string) {
  await page.addInitScript(() => {
    (window as unknown as { __themes: string[] }).__themes = [];
    const rec = () => (window as unknown as { __themes: string[] }).__themes.push(document.documentElement.getAttribute('data-theme') ?? '');
    // Sample on every frame from the first one and at DOMContentLoaded: any frame showing the
    // wrong theme would be a visible flash.
    document.addEventListener('DOMContentLoaded', rec);
    const tick = () => { rec(); if ((window as unknown as { __themes: string[] }).__themes.length < 30) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);
}

test.describe('theme default and prefers-color-scheme', () => {
  test('dark OS preference picks dark with no flash through light-blue', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    const seen = await themeBeforeHydration(page, `${BASE_URL}/breakpoint2026`);
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === 'dark')).toBe(true);
    await ctx.close();
  });

  test('light OS preference keeps the light-blue default', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    const seen = await themeBeforeHydration(page, `${BASE_URL}/breakpoint2026`);
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light-blue');
    expect(seen.every((t) => t === 'light-blue')).toBe(true);
    await ctx.close();
  });

  test('stored override wins over OS preference', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('user-theme-override', 'paper'));
    const seen = await themeBeforeHydration(page, `${BASE_URL}/breakpoint2026`);
    expect(await page.locator('html').getAttribute('data-theme')).toBe('paper');
    expect(seen.every((t) => t === 'paper')).toBe(true);
    await ctx.close();
  });

  test('server-rendered HTML attribute matches the CSS-visible default (light-blue)', async ({ request }) => {
    const html = await (await request.get(`${BASE_URL}/breakpoint2026`)).text();
    expect(html).toMatch(/<html[^>]*data-theme="light-blue"/);
  });
});
