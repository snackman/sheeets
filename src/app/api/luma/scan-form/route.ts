import { NextRequest, NextResponse } from 'next/server';
import { parseBody, ScanFormFieldsSchema } from '@/lib/api-validation';
import { scanLumaFormFields, type ScannedFormResult } from '@/lib/luma-form-scanner';

interface ScanResult {
  slug: string;
  result?: ScannedFormResult;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { data, error } = await parseBody(request, ScanFormFieldsSchema);
    if (error) return error;

    const { slugs } = data;

    const results: ScanResult[] = await Promise.all(
      slugs.map(async (slug): Promise<ScanResult> => {
        try {
          const result = await scanLumaFormFields(slug);
          return { slug, result };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { slug, error: message };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Luma scan-form error:', err);
    return NextResponse.json(
      { error: 'Failed to scan form fields' },
      { status: 500 }
    );
  }
}
