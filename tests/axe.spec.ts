import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3102';

// Every theme the app ships; colour contrast is asserted like any other rule.
const THEMES = ['dark', 'paper', 'light', 'light-blue', 'sxsw', 'sxsw2', 'gdc', 'ethcc'];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const counts = results.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', ');
  const total = results.violations.reduce((n, v) => n + v.nodes.length, 0);
  console.log(`AXE ${label}: ${results.violations.length} rules / ${total} nodes: ${counts || 'none'}`);
  return results.violations;
}

for (const vp of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`axe ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const theme of THEMES) for (const view of ['List', 'Table', 'Gallery', 'Map']) {
      test(`${theme} / ${view} view has no axe violations`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('sheeets-onboarding-done', '1');
          localStorage.setItem('plan-theme-choice', t);
        }, theme);
        await page.goto(`${BASE_URL}/breakpoint2026`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: `${view} view` }).click();
        await page.waitForTimeout(1000);
        expect(await page.locator('html').getAttribute('data-theme')).toBe(theme);
        if (process.env.THEME_SHOTS) await page.screenshot({ path: `test-results/theme-shots/${theme}-${vp.name}-${view}.png` });
        const violations = await scan(page, `${theme}/${vp.name}/${view}`);
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      });
    }
  });
}
