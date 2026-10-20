import { NextResponse } from 'next/server';
import { getConferenceTabs } from '@/lib/get-conferences';
import { dataSheetUrl } from '@/lib/data-sheet-url';

export const dynamic = 'force-dynamic';

/** /data -> the Google Sheet tab of the soonest active conference. */
export async function GET() {
  let tabs: Awaited<ReturnType<typeof getConferenceTabs>> = [];
  try {
    tabs = await getConferenceTabs();
  } catch {
    // fall through to the bare sheet
  }
  return NextResponse.redirect(dataSheetUrl(tabs), 307);
}
