/**
 * Batch RSVP processor script
 *
 * Processes pending batch_rsvp_jobs by:
 *   1. Loading the Luma embed page via Playwright
 *   2. Solving the Cloudflare Turnstile challenge
 *   3. Extracting the token
 *   4. Calling submitLumaRegistration with the token
 *   5. Updating job status in Supabase
 *
 * Usage:
 *   npx tsx scripts/process-batch-rsvp.ts [options]
 *
 * Options:
 *   --limit <n>     Max jobs to process (default: 50)
 *   --dry-run       Process but don't submit or update status
 *
 * Env vars:
 *   NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase service role key
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { submitLumaRegistration } from '../src/lib/luma-registration';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  limit: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    limit: 50,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        result.limit = Math.max(1, parseInt(args[++i] || '50', 10));
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
// Rate limiting
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Turnstile token extraction via Playwright
// ---------------------------------------------------------------------------

async function extractTurnstileToken(lumaSlug: string): Promise<string> {
  // Dynamic import so Playwright is only required when actually running
  const { chromium } = await import('@playwright/test');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const embedUrl = `https://lu.ma/embed/event/${lumaSlug}/simple`;
    await page.goto(embedUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the Turnstile iframe to appear and be solved
    // The token is stored in a hidden input or as a response from the Turnstile widget
    await page.waitForTimeout(5000); // Allow time for Turnstile to solve

    // Try to find the Turnstile response token
    const token = await page.evaluate(() => {
      // Turnstile typically stores its response in a specific element
      const turnstileInput = document.querySelector<HTMLInputElement>(
        'input[name="cf-turnstile-response"]'
      );
      if (turnstileInput?.value) return turnstileInput.value;

      // Try the global turnstile object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (w.turnstile) {
        const widgets = w.turnstile.getResponse?.();
        if (widgets) return widgets;
      }

      return null;
    });

    if (!token) {
      throw new Error('Could not extract Turnstile token');
    }

    return token;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Process a single job
// ---------------------------------------------------------------------------

async function processJob(
  supabase: SupabaseClient,
  job: {
    id: number;
    luma_slug: string;
    event_name: string | null;
    event_api_id: string;
    profile_snapshot: Record<string, string>;
    custom_answers: Record<string, string>;
  },
  dryRun: boolean,
): Promise<'success' | 'failed'> {
  const profile = job.profile_snapshot;

  console.log(`  Extracting Turnstile token for ${job.luma_slug}...`);

  if (dryRun) {
    console.log('  [DRY RUN] Would submit registration');
    return 'success';
  }

  try {
    // Mark as submitting
    await supabase
      .from('batch_rsvp_jobs')
      .update({ status: 'submitting', updated_at: new Date().toISOString() })
      .eq('id', job.id);

    // Extract Turnstile token
    const turnstileToken = await extractTurnstileToken(job.luma_slug);

    // Build registration answers from custom_answers
    // custom_answers is stored as { question_id: value_string }
    const registrationAnswers = Object.entries(job.custom_answers).map(
      ([questionId, value]) => ({
        question_id: questionId,
        value,
        label: '',
        question_type: 'text',
      })
    );

    // Submit registration
    const result = await submitLumaRegistration({
      name: `${profile.firstName} ${profile.lastName}`,
      first_name: profile.firstName,
      last_name: profile.lastName,
      email: profile.email,
      event_api_id: job.event_api_id,
      registration_answers: registrationAnswers,
      phone_number: profile.phone || undefined,
      turnstile_token: turnstileToken,
    });

    if (result.success) {
      await supabase
        .from('batch_rsvp_jobs')
        .update({
          status: 'success',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Also create an RSVP record so the UI shows confirmed status
      await supabase
        .from('rsvps')
        .upsert({
          user_id: (await supabase.from('batch_rsvp_jobs').select('user_id').eq('id', job.id).single()).data?.user_id,
          event_id: (await supabase.from('batch_rsvp_jobs').select('event_id').eq('id', job.id).single()).data?.event_id,
          status: 'confirmed',
          method: 'batch',
        }, { onConflict: 'user_id,event_id' });

      return 'success';
    } else {
      await supabase
        .from('batch_rsvp_jobs')
        .update({
          status: 'failed',
          error_message: result.error || 'Unknown error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return 'failed';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('batch_rsvp_jobs')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  console.log('=== Batch RSVP Processor ===');
  console.log(`  Limit: ${args.limit}`);
  console.log(`  Dry run: ${args.dryRun}`);
  console.log('');

  const supabase = createSupabaseClient();

  // Fetch pending jobs
  const { data: jobs, error } = await supabase
    .from('batch_rsvp_jobs')
    .select('id, luma_slug, event_name, event_api_id, profile_snapshot, custom_answers')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(args.limit);

  if (error) {
    console.error('Failed to fetch pending jobs:', error.message);
    process.exit(1);
  }

  if (!jobs || jobs.length === 0) {
    console.log('No pending jobs to process.');
    return;
  }

  console.log(`Found ${jobs.length} pending job(s)`);
  console.log('');

  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const progress = `[${i + 1}/${jobs.length}]`;

    console.log(`${progress} ${job.event_name || job.luma_slug}`);

    const status = await processJob(supabase, job, args.dryRun);

    if (status === 'success') {
      totalSuccess++;
      console.log('  Result: SUCCESS');
    } else {
      totalFailed++;
      console.log('  Result: FAILED');
    }

    // 2s delay between submissions
    if (i < jobs.length - 1) {
      await delay(2000);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Processed: ${jobs.length}`);
  console.log(`  Success: ${totalSuccess}`);
  console.log(`  Failed: ${totalFailed}`);
  if (args.dryRun) {
    console.log('  (Dry run -- no submissions made)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
