import { test, expect } from '@playwright/test';

/**
 * Test for the "Igloo APAC" row duplication bug.
 *
 * Bug: Every time the user switches between conference tabs
 * (ETH Denver 2026 <-> Consensus Hong Kong 2026), an extra "Igloo APAC"
 * row appears at the top of the event table. Rows accumulate with each switch.
 *
 * Suspected cause: setState inside useMemo in ItineraryPanel.tsx (lines 130-136).
 * PR #11 removed ItineraryPanel from the main page.
 *
 * This test verifies the bug is fixed by switching tabs multiple times
 * and asserting row counts remain stable.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3099';

test.describe('Row Duplication Bug', () => {
  test.setTimeout(120_000); // 2 minutes - events load from Google Sheets

  test('switching conference tabs does not create duplicate Igloo rows', async ({ page }) => {
    // Navigate to the main page
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait for the table to appear (events loaded)
    const table = page.locator('table');
    await table.waitFor({ state: 'visible', timeout: 30_000 });

    // Helper: count rows containing "Igloo" in the visible table
    async function countIglooRows(): Promise<number> {
      // Wait a moment for any re-renders to settle
      await page.waitForTimeout(500);
      const rows = page.locator('table tbody tr');
      const count = await rows.count();
      let iglooCount = 0;
      for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent();
        if (text && text.includes('Igloo')) {
          iglooCount++;
        }
      }
      return iglooCount;
    }

    // Helper: get total visible row count
    async function getTotalRowCount(): Promise<number> {
      await page.waitForTimeout(500);
      return page.locator('table tbody tr').count();
    }

    // Helper: dump first 5 rows for debugging
    async function dumpFirstRows(n: number = 5): Promise<void> {
      const rows = page.locator('table tbody tr');
      const count = await rows.count();
      for (let i = 0; i < Math.min(n, count); i++) {
        const text = await rows.nth(i).textContent();
        const key = await rows.nth(i).getAttribute('data-key');
        console.log(`  Row ${i}: key=${key} text="${text?.substring(0, 100)}"`);
      }
    }

    // Helper: find all Igloo rows with details
    async function findIglooRows(): Promise<void> {
      const rows = page.locator('table tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent();
        if (text && text.includes('Igloo')) {
          console.log(`  IGLOO at row ${i}: "${text?.substring(0, 150)}"`);
        }
      }
    }

    // --- Initial state: ETH Denver 2026 (default) ---
    console.log('=== Initial state: ETH Denver 2026 ===');
    const initialIgloo = await countIglooRows();
    const initialTotal = await getTotalRowCount();
    console.log(`  Igloo rows: ${initialIgloo}, Total rows: ${initialTotal}`);
    await findIglooRows();

    // "Igloo APAC" should NOT appear for ETH Denver
    const ethDenverIglooBaseline = initialIgloo;

    // --- Switch to Consensus Hong Kong 2026 ---
    console.log('\n=== Switching to Consensus Hong Kong 2026 ===');
    const consensusBtn = page.locator('button', { hasText: 'Consensus Hong Kong 2026' });
    await consensusBtn.click();
    await page.waitForTimeout(2000); // Let table re-render

    const consensusIgloo = await countIglooRows();
    const consensusTotal = await getTotalRowCount();
    console.log(`  Igloo rows: ${consensusIgloo}, Total rows: ${consensusTotal}`);
    await findIglooRows();
    const consensusIglooBaseline = consensusIgloo;

    // --- Switch back to ETH Denver 2026 ---
    console.log('\n=== Switching back to ETH Denver 2026 ===');
    const ethDenverBtn = page.locator('button', { hasText: 'ETH Denver 2026' });
    await ethDenverBtn.click();
    await page.waitForTimeout(2000);

    const ethDenverIgloo2 = await countIglooRows();
    const ethDenverTotal2 = await getTotalRowCount();
    console.log(`  Igloo rows: ${ethDenverIgloo2}, Total rows: ${ethDenverTotal2}`);
    console.log('  First 5 rows:');
    await dumpFirstRows(5);
    console.log('  Igloo rows found:');
    await findIglooRows();

    // Also check the event count text
    const countText = await page.locator('text=/\\d+ of \\d+ events/').textContent();
    console.log(`  Event count text: "${countText}"`);

    // After one round trip, counts should be the same as initial
    expect(ethDenverIgloo2).toBe(ethDenverIglooBaseline);
    expect(ethDenverTotal2).toBe(initialTotal);

    // --- Now switch 5 more times (10 total tab switches) ---
    const iglooHistory: { conference: string; igloo: number; total: number }[] = [];

    for (let i = 0; i < 5; i++) {
      // Switch to Consensus HK
      await consensusBtn.click();
      await page.waitForTimeout(1000);
      const cIgloo = await countIglooRows();
      const cTotal = await getTotalRowCount();
      console.log(`Round ${i + 1} → Consensus HK: Igloo=${cIgloo}, Total=${cTotal}`);
      iglooHistory.push({ conference: 'Consensus HK', igloo: cIgloo, total: cTotal });

      expect(cIgloo).toBeLessThanOrEqual(consensusIglooBaseline);
      expect(cTotal).toBeLessThanOrEqual(consensusTotal);

      // Switch to ETH Denver
      await ethDenverBtn.click();
      await page.waitForTimeout(1000);
      const eIgloo = await countIglooRows();
      const eTotal = await getTotalRowCount();
      console.log(`Round ${i + 1} → ETH Denver:   Igloo=${eIgloo}, Total=${eTotal}`);
      iglooHistory.push({ conference: 'ETH Denver', igloo: eIgloo, total: eTotal });

      expect(eIgloo).toBeLessThanOrEqual(ethDenverIglooBaseline);
      expect(eTotal).toBeLessThanOrEqual(initialTotal);
    }

    // Final summary
    console.log('\n=== Test Summary ===');
    console.log(`ETH Denver baseline:    Igloo=${ethDenverIglooBaseline}, Total=${initialTotal}`);
    console.log(`Consensus HK baseline:  Igloo=${consensusIglooBaseline}, Total=${consensusTotal}`);

    const maxEthIgloo = Math.max(
      ethDenverIglooBaseline,
      ...iglooHistory.filter(h => h.conference === 'ETH Denver').map(h => h.igloo)
    );
    const maxConsensusIgloo = Math.max(
      consensusIglooBaseline,
      ...iglooHistory.filter(h => h.conference === 'Consensus HK').map(h => h.igloo)
    );

    expect(maxEthIgloo).toBe(ethDenverIglooBaseline);
    expect(maxConsensusIgloo).toBe(consensusIglooBaseline);
  });

  test('total event count remains stable across tab switches', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const table = page.locator('table');
    await table.waitFor({ state: 'visible', timeout: 30_000 });

    // Read the "X of Y events" counter
    async function getEventCounts(): Promise<{ filtered: number; total: number }> {
      await page.waitForTimeout(500);
      const countText = await page.locator('text=/\\d+ of \\d+ events/').textContent();
      if (!countText) return { filtered: 0, total: 0 };
      const match = countText.match(/(\d+) of (\d+) events/);
      if (!match) return { filtered: 0, total: 0 };
      return { filtered: parseInt(match[1]), total: parseInt(match[2]) };
    }

    // Get initial counts for ETH Denver
    const ethDenverCounts = await getEventCounts();
    console.log(`ETH Denver: ${ethDenverCounts.filtered} of ${ethDenverCounts.total}`);

    // Switch to Consensus HK
    await page.locator('button', { hasText: 'Consensus Hong Kong 2026' }).click();
    await page.waitForTimeout(1500);
    const consensusCounts = await getEventCounts();
    console.log(`Consensus HK: ${consensusCounts.filtered} of ${consensusCounts.total}`);

    // Switch back and forth 5 times and verify counts are stable
    for (let i = 0; i < 5; i++) {
      await page.locator('button', { hasText: 'ETH Denver 2026' }).click();
      await page.waitForTimeout(1000);
      const ethCounts = await getEventCounts();
      expect(ethCounts.total).toBe(ethDenverCounts.total);
      expect(ethCounts.filtered).toBe(ethDenverCounts.filtered);

      await page.locator('button', { hasText: 'Consensus Hong Kong 2026' }).click();
      await page.waitForTimeout(1000);
      const conCounts = await getEventCounts();
      expect(conCounts.total).toBe(consensusCounts.total);
      expect(conCounts.filtered).toBe(consensusCounts.filtered);
    }

    console.log('PASS: Event counts remain stable across conference switches.');
  });
});
