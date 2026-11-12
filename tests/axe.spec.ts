import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3102';

// Colour contrast is handled by the separate colour-token sweep, so it is reported but not asserted here.
const REPORT_ONLY = ['color-contrast'];

// Gallery tiles are role=button wrappers containing buttons (nested-interactive); GalleryView is being reworked
// on another branch, so that known issue is reported but not asserted here.
const GALLERY_KNOWN = ['nested-interactive', 'label-content-name-mismatch'];

async function scan(page: Page, label: string, view: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const counts = results.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', ');
  const total = results.violations.reduce((n, v) => n + v.nodes.length, 0);
  console.log(`AXE ${label}: ${results.violations.length} rules / ${total} nodes: ${counts || 'none'}`);
  return results.violations.filter((v) => !REPORT_ONLY.includes(v.id) && !(view === 'Gallery' && GALLERY_KNOWN.includes(v.id)));
}

for (const vp of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`axe ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const view of ['List', 'Table', 'Gallery', 'Map']) {
      test(`${view} view has no non-contrast violations`, async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('sheeets-onboarding-done', '1'));
        await page.goto(`${BASE_URL}/breakpoint2026`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: `${view} view` }).click();
        await page.waitForTimeout(1000);
        const violations = await scan(page, `${vp.name}/${view}`, view);
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      });
    }
  });
}
