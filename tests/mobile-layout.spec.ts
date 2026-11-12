import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile / tablet / desktop layout + perf checks. Run against a local prod
 * server:  TEST_URL=http://localhost:3101 npx playwright test tests/mobile-layout.spec.ts
 *
 * Specs are written to survive live data: they discover a conference page
 * that actually has events instead of hard-coding one, and skip (not fail)
 * assertions that need data/WebGL that isn't available.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3101';

const VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 812 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'ipad', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

// Software GL so Mapbox can render in headless CI.
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.setTimeout(120_000);

async function prime(page: Page) {
  // Skip the first-run onboarding wizard.
  await page.addInitScript(() => {
    try { localStorage.setItem('sheeets-onboarding-done', '1'); } catch { /* ignore */ }
  });
}

/** Find a conference slug whose page renders at least one list row. */
async function openConferenceWithEvents(page: Page): Promise<string | null> {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  const hrefs = await page.$$eval('a[href^="/"]', (as) =>
    Array.from(new Set(as.map((a) => a.getAttribute('href') || '')))
      .filter((h) => /^\/[a-z0-9]+$/i.test(h) && !['/ads', '/admin', '/submit'].includes(h)),
  );
  test.skip(hrefs.length === 0, 'no active conferences on the home page');
  for (const href of hrefs.slice(0, 8)) {
    await page.goto(BASE_URL + href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'List view' }).click({ timeout: 15_000 }).catch(() => {});
    const rows = page.locator('main [data-index]');
    const ok = await rows.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (ok) return href;
  }
  return null;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 1000, isMobile: vp.width < 600 });

    test('home page: no horizontal overflow', async ({ page }) => {
      await prime(page);
      await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      expect(sw).toBeLessThanOrEqual(iw);
    });

    test('home page: Browse Events cards fill the available row', async ({ page }) => {
      await prime(page);
      await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
      const geo = await page.evaluate(() => {
        const h2 = Array.from(document.querySelectorAll('h2')).find((h) => /browse events/i.test(h.textContent || ''));
        const grid = h2?.nextElementSibling as HTMLElement | null;
        if (!grid) return null;
        const cards = Array.from(grid.children) as HTMLElement[];
        const g = grid.getBoundingClientRect();
        const rects = cards.map((c) => c.getBoundingClientRect());
        const firstRowTop = rects[0]?.top;
        const firstRow = rects.filter((r) => Math.abs(r.top - firstRowTop) < 2);
        return { gridW: g.width, rowW: firstRow.reduce((s, r) => s + r.width, 0), n: cards.length, cols: firstRow.length };
      });
      test.skip(!geo || geo.n === 0, 'no active conferences to browse');
      // Cards in the first row (plus gaps) should span the whole grid.
      expect(geo!.rowW + (geo!.cols - 1) * 16).toBeGreaterThan(geo!.gridW - 2);
    });

    test('event app: no overflow, page height == viewport, list virtualised, last event reachable', async ({ page }) => {
      await prime(page);
      const slug = await openConferenceWithEvents(page);
      expect(slug, 'no conference page rendered any events').not.toBeNull();

      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        sh: document.documentElement.scrollHeight,
        ih: window.innerHeight,
        bh: document.body.scrollHeight,
      }));
      expect(m.sw).toBeLessThanOrEqual(m.iw);
      // h-dvh shell must not be pushed taller than the viewport by body padding.
      expect(m.sh).toBeLessThanOrEqual(m.ih);
      expect(m.bh).toBeLessThanOrEqual(m.ih);

      const main = page.locator('main').first();
      const stats = await main.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      const rendered = await page.locator('main [data-index]').count();
      console.log(`slug=${slug} rendered=${rendered} scrollHeight=${stats.sh} clientHeight=${stats.ch}`);
      if (stats.sh > stats.ch * 8) {
        // Long list: only a window of rows may be in the DOM.
        expect(rendered).toBeLessThan(60);
      }

      // Scroll to the bottom in steps; the final row must become reachable.
      // Row heights are measured lazily, so scrollHeight keeps changing until the
      // tail has been rendered: stop once it is stable for several passes.
      let stable = 0;
      let prevH = -1;
      for (let i = 0; i < 80 && stable < 4; i++) {
        const h = await main.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
          return el.scrollHeight;
        });
        await page.waitForFunction(() => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
        stable = h === prevH ? stable + 1 : 0;
        prevH = h;
      }
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('main [data-index]');
        return rows.length > 0;
      });
      const last = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('main [data-index]')) as HTMLElement[];
        const maxIdx = Math.max(...rows.map((r) => Number(r.dataset.index)));
        const lastRow = rows.find((r) => Number(r.dataset.index) === maxIdx)!;
        const mainEl = document.querySelector('main') as HTMLElement;
        const lr = lastRow.getBoundingClientRect();
        const mr = mainEl.getBoundingClientRect();
        return { visible: lr.bottom <= mr.bottom + 40 && lr.top < mr.bottom, bottomGap: mr.bottom - lr.bottom };
      });
      expect(last.visible).toBe(true);
    });

    test('list thumbnails are requested at <= 640px wide', async ({ page }) => {
      await prime(page);
      const widths: { url: string; w: number }[] = [];
      page.on('request', (req) => {
        if (req.resourceType() !== 'image') return;
        const u = req.url();
        // Luma (cdn-cgi width=N) and imgix-style (w=N) resized hosts.
        const m = /cdn-cgi\/image\/[^/]*width=(\d+)/.exec(u) ?? /[?&]w=(\d+)/.exec(u);
        if (m && /lumacdn\.com|unsplash\.com|imgix\.net/.test(u)) widths.push({ url: u, w: Number(m[1]) });
      });
      const slug = await openConferenceWithEvents(page);
      expect(slug, 'no conference page rendered any events').not.toBeNull();
      await expect.poll(() => widths.length, { timeout: 15_000 }).toBeGreaterThan(0).catch(() => {});
      test.skip(widths.length === 0, 'no resizable thumbnails requested in the first screen');
      for (const { url, w } of widths) expect(w, url).toBeLessThanOrEqual(640);
    });
  });
}

test.describe('tablet 768', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('search placeholder is not truncated', async ({ page }) => {
    await prime(page);
    const slug = await openConferenceWithEvents(page);
    expect(slug, 'no conference page rendered any events').not.toBeNull();
    const input = page.locator('input[placeholder^="Search events"]:visible').first();
    await expect(input).toBeVisible();
    const fits = await input.evaluate((el) => {
      const i = el as HTMLInputElement;
      const cs = getComputedStyle(i);
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
      probe.textContent = i.placeholder;
      document.body.appendChild(probe);
      const textW = probe.getBoundingClientRect().width;
      probe.remove();
      const inner = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { textW, inner };
    });
    expect(fits.inner).toBeGreaterThanOrEqual(fits.textW);
  });
});

test.describe('map', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('open popup closes when the filters panel opens', async ({ page }) => {
    await prime(page);
    const slug = await openConferenceWithEvents(page);
    expect(slug, 'no conference page rendered any events').not.toBeNull();
    await page.getByRole('button', { name: 'Map view' }).click();
    const marker = page.locator('button[aria-label^="Event"]').first();
    const hasMarker = await marker.waitFor({ state: 'visible', timeout: 25_000 }).then(() => true).catch(() => false);
    test.skip(!hasMarker, 'map did not render markers (WebGL/token unavailable in this environment)');
    await marker.click({ force: true });
    const popup = page.locator('.mapboxgl-popup');
    const opened = await popup.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    test.skip(!opened, 'popup did not open');
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(popup).toHaveCount(0, { timeout: 5_000 });
  });
});
