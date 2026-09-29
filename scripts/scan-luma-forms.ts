/**
 * Luma form field scanning script
 *
 * Fetches events from Google Sheets, filters to Luma URLs,
 * scans each event's registration form fields via the Luma API,
 * and upserts the results into the luma_form_fields table.
 *
 * Usage:
 *   npx tsx scripts/scan-luma-forms.ts [options]
 *
 * Options:
 *   --conference <name>   Only scan events from the named conference
 *   --force               Re-scan slugs already in the cache
 *   --dry-run             Scan but don't write to Supabase
 *
 * Env vars:
 *   NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase service role key
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FALLBACK_TABS } from '../src/lib/conferences';
import { getActiveConferences, conferenceToTab } from '../src/lib/conferences';
import { fetchEvents } from '../src/lib/fetch-events';
import type { TabConfig } from '../src/lib/conferences';
import type { ConferenceConfig, ETHDenverEvent } from '../src/lib/types';
import { isLumaUrl, getLumaSlug } from '../src/lib/luma';
import { scanLumaFormFields } from '../src/lib/luma-form-scanner';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  conference: string | null;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    conference: null,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--conference':
        result.conference = args[++i] || null;
        break;
      case '--force':
        result.force = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      default:
        console.warn(`Unknown argument: ${args[i]}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Supabase setup
// ---------------------------------------------------------------------------

function createSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Fetch conference tabs
// ---------------------------------------------------------------------------

async function fetchConferenceTabs(supabase: SupabaseClient): Promise<TabConfig[]> {
  try {
    const { data, error } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', 'conferences')
      .single();

    if (error || !data?.value) {
      console.log('No conferences config in Supabase, using FALLBACK_TABS');
      return FALLBACK_TABS;
    }

    const allConfs = data.value as ConferenceConfig[];
    const active = getActiveConferences(allConfs);
    const tabs = active.map(conferenceToTab);
    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch (err) {
    console.log('Failed to fetch from Supabase:', err);
    return FALLBACK_TABS;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  console.log('=== Luma Form Scanner ===');
  console.log(`  Conference filter: ${args.conference || 'all'}`);
  console.log(`  Force re-scan: ${args.force}`);
  console.log(`  Dry run: ${args.dryRun}`);
  console.log('');

  const supabase = createSupabaseClient();

  // Fetch tabs
  const allTabs = await fetchConferenceTabs(supabase);
  let tabs = allTabs;

  if (args.conference) {
    tabs = allTabs.filter(
      (t) =>
        t.name.toLowerCase().includes(args.conference!.toLowerCase()) ||
        t.slug.toLowerCase() === args.conference!.toLowerCase()
    );
    if (tabs.length === 0) {
      console.error(`No conference matching "${args.conference}". Available: ${allTabs.map((t) => t.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Using ${tabs.length} conference tab(s): ${tabs.map((t) => t.name).join(', ')}`);

  // Fetch events
  console.log('Fetching events from Google Sheets...');
  const allEvents = await fetchEvents(undefined, tabs);
  console.log(`  Total events: ${allEvents.length}`);

  // Filter to Luma events with valid slugs
  const lumaEvents: { event: ETHDenverEvent; slug: string }[] = [];
  for (const event of allEvents) {
    if (!event.link || !isLumaUrl(event.link)) continue;
    const slug = getLumaSlug(event.link);
    if (slug) lumaEvents.push({ event, slug });
  }
  console.log(`  Luma events: ${lumaEvents.length}`);

  // Deduplicate by slug
  const uniqueSlugs = new Map<string, ETHDenverEvent>();
  for (const { event, slug } of lumaEvents) {
    if (!uniqueSlugs.has(slug)) uniqueSlugs.set(slug, event);
  }
  console.log(`  Unique slugs: ${uniqueSlugs.size}`);

  // Check existing scans (skip unless --force)
  let slugsToScan = Array.from(uniqueSlugs.keys());

  if (!args.force) {
    const { data: existing } = await supabase
      .from('luma_form_fields')
      .select('luma_slug')
      .in('luma_slug', slugsToScan);

    const scannedSlugs = new Set((existing || []).map((r: { luma_slug: string }) => r.luma_slug));
    slugsToScan = slugsToScan.filter((s) => !scannedSlugs.has(s));
    console.log(`  Already scanned: ${scannedSlugs.size}`);
  }

  console.log(`  To scan: ${slugsToScan.length}`);
  console.log('');

  if (slugsToScan.length === 0) {
    console.log('Nothing to scan. Use --force to re-scan.');
    return;
  }

  let totalScanned = 0;
  let totalWithQuestions = 0;
  let totalErrors = 0;

  for (let i = 0; i < slugsToScan.length; i++) {
    const slug = slugsToScan[i];
    const event = uniqueSlugs.get(slug)!;
    const progress = `[${i + 1}/${slugsToScan.length}]`;

    console.log(`${progress} ${event.name}`);
    console.log(`  Slug: ${slug}`);

    try {
      const result = await scanLumaFormFields(slug);
      totalScanned++;

      if (result.questions.length > 0) {
        totalWithQuestions++;
        console.log(`  Found ${result.questions.length} registration question(s):`);
        for (const q of result.questions) {
          console.log(`    - ${q.label} (${q.question_type}${q.is_required ? ', required' : ''})`);
        }
      } else {
        console.log('  No custom registration questions');
      }

      // Upsert to Supabase
      if (!args.dryRun) {
        const { error } = await supabase
          .from('luma_form_fields')
          .upsert({
            luma_slug: slug,
            event_api_id: result.eventApiId,
            event_name: result.eventName,
            name_requirement: result.nameRequirement,
            questions: result.questions,
            scanned_at: new Date().toISOString(),
          }, { onConflict: 'luma_slug' });

        if (error) {
          console.error(`  Supabase upsert error: ${error.message}`);
        }
      }
    } catch (err) {
      totalErrors++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  Error: ${message}`);
    }

    // Rate limit: 500ms between requests
    if (i < slugsToScan.length - 1) {
      await delay(500);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Total scanned: ${totalScanned}`);
  console.log(`  With questions: ${totalWithQuestions}`);
  console.log(`  Errors: ${totalErrors}`);
  if (args.dryRun) {
    console.log('  (Dry run -- no data written to Supabase)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
