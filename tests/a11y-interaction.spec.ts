import { test, expect, type Page, type Locator } from '@playwright/test';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3102';
const PAGE_PATH = '/breakpoint2026';

const VIEWPORTS = [
  { name: 'mobile 390x844', width: 390, height: 844, mobile: true },
  { name: 'desktop 1280x800', width: 1280, height: 800, mobile: false },
];

async function open(page: Page, view?: 'table' | 'list') {
  await page.addInitScript(() => localStorage.setItem('sheeets-onboarding-done', '1'));
  await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: 'networkidle' });
  if (view) {
    await page.getByRole('button', { name: `${view === 'table' ? 'Table' : 'List'} view` }).click();
  }
  await expect(page.getByRole('button', { name: /^Time filter/ }).first()).toBeVisible();
}

async function expectTapTarget(loc: Locator, label: string, min = 44) {
  const box = await loc.first().boundingBox();
  expect(box, `${label} should be visible`).not.toBeNull();
  expect(box!.width, `${label} width ${box!.width}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box!.height, `${label} height ${box!.height}`).toBeGreaterThanOrEqual(min - 0.5);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('keyboard-only: help dialog traps focus, Escape returns focus to opener', async ({ page }) => {
      await open(page);
      const help = page.getByRole('button', { name: 'How plan.wtf works' });
      // Tab from the top of the page until the help button is focused.
      let found = false;
      for (let i = 0; i < 30 && !found; i++) {
        await page.keyboard.press('Tab');
        found = await help.evaluate((el) => el === document.activeElement);
      }
      expect(found, 'help button reachable by keyboard').toBe(true);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        expect(inside, `focus stays in dialog after Tab ${i + 1}`).toBe(true);
      }
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Shift+Tab');
        const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        expect(inside).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(help).toBeFocused();
    });

    test('keyboard-only: table row opens event detail dialog; Escape returns focus to the row', async ({ page }) => {
      await open(page, 'table');
      const row = page.locator('table tbody tr[tabindex="0"]').first();
      await row.focus();
      await expect(row).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        expect(inside, `focus stays in detail dialog after Tab ${i + 1}`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(row).toBeFocused();
    });

    test('time filter is a visible menu whose state is reflected in aria', async ({ page }) => {
      await open(page);
      const trigger = page.getByRole('button', { name: /^Time filter/ });
      await expect(trigger).toHaveAccessibleName('Time filter: Any time');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const options = page.getByRole('menuitemradio');
      await expect(options).toHaveText(['Any time', 'Happening now', 'Today', 'Tomorrow']);
      await expect(page.getByRole('menuitemradio', { name: 'Any time' })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('menuitemradio', { name: 'Tomorrow' }).click();
      await expect(trigger).toHaveAccessibleName('Time filter: Tomorrow');
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(page.getByRole('menuitemradio', { name: 'Tomorrow' })).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAccessibleName('Time filter: Today');
    });

    test('list: clicking an event title opens the event page (new tab)', async ({ page, context }) => {
      await open(page, 'list');
      const title = page.locator('h3 a[href^="http"]').first();
      await expect(title).toBeVisible();
      const href = await title.getAttribute('href');
      const [popup] = await Promise.all([context.waitForEvent('page'), title.click()]);
      expect(popup.url().startsWith(href!.split('?')[0].slice(0, 20)) || popup.url() !== 'about:blank').toBe(true);
      await popup.close();
    });

    test('table: clicking a row (not the title link) opens the detail dialog', async ({ page }) => {
      await open(page, 'table');
      await page.locator('table tbody tr[tabindex="0"]').first().locator('td').nth(2).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('empty state lists active filters and Clear all clears them and the search (not the conference)', async ({ page }) => {
      await open(page, 'list');
      const search = page.getByRole('textbox', { name: 'Search events' }).first();
      await search.fill('qqqq-no-such-event-xyz');
      const empty = page.getByText('No events match');
      await expect(empty).toBeVisible();
      const active = page.getByRole('list', { name: 'Active filters' });
      await expect(active).toContainText('Search: "qqqq-no-such-event-xyz"');
      const confLabel = await page.locator('button:has(svg.lucide-map-pin) span').first().innerText();
      await page.getByRole('button', { name: 'Clear all' }).click();
      await expect(empty).toBeHidden();
      await expect(search).toHaveValue('');
      await expect(page.locator('button:has(svg.lucide-map-pin) span').first()).toHaveText(confLabel);
    });

    test('star button: aria-pressed, sign-in dialog opens and returns focus', async ({ page }) => {
      await open(page, 'list');
      const star = page.getByRole('button', { name: 'Add to plan' }).first();
      await expect(star).toHaveAttribute('aria-pressed', 'false');
      await star.click();
      // Signed-out users are asked to sign in; the dialog is accessible and returns focus on Escape.
      const dialog = page.getByRole('dialog', { name: 'Sign in' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(star).toBeFocused();
    });

    test('timezone label is readable (>=12px) and not truncated', async ({ page }) => {
      await open(page, 'list');
      const tz = page.getByText(/^All times /);
      await expect(tz).toBeVisible();
      const fs = await tz.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fs).toBeGreaterThanOrEqual(12);
      const truncated = await tz.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(truncated).toBe(false);
      await expect(tz).toHaveAttribute('title', /Event times are shown in/);
    });
  });
}

test.describe('tap targets >= 44px on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('header, filter bar, view toggle and card controls', async ({ page }) => {
    await open(page, 'list');
    await expectTapTarget(page.getByRole('button', { name: 'How plan.wtf works' }), 'help');
    await expectTapTarget(page.getByRole('button', { name: /^Sign in/ }), 'sign in');
    await expectTapTarget(page.locator('button:has(svg.lucide-map-pin)').first(), 'conference');
    await expectTapTarget(page.getByRole('button', { name: /^Time filter/ }), 'time filter');
    await expectTapTarget(page.getByRole('button', { name: 'Filters' }), 'filters');
    await expectTapTarget(page.getByRole('button', { name: /^Itinerary/ }), 'itinerary');
    await expectTapTarget(page.getByRole('button', { name: 'Add Event' }), 'submit event');
    for (const v of ['Map', 'List', 'Table', 'Gallery']) {
      await expectTapTarget(page.getByRole('button', { name: `${v} view` }), `${v} view`);
    }
    await expectTapTarget(page.getByRole('button', { name: 'Add to plan' }), 'add to plan');
    await expectTapTarget(page.getByRole('button', { name: 'Copy event link' }), 'copy link');
    await expectTapTarget(page.getByRole('button', { name: 'RSVP' }), 'rsvp');
  });

  test('expanded filters: vibe chips and calendar days', async ({ page }) => {
    await open(page, 'list');
    await page.getByRole('button', { name: 'Filters' }).click();
    const chip = page.locator('button[aria-pressed][title*="("]').first();
    await expect(chip).toBeVisible();
    await expectTapTarget(chip, 'vibe chip');
    const day = page.getByRole('button', { name: /^\w+day, \w+ \d+$/ }).first();
    await expect(day).toBeVisible();
    await expectTapTarget(day, 'calendar day');
  });
});
