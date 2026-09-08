import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createAccountingPnlPdf } from '@/lib/accounting-pnl-pdf';
import { buildAccountingPnlStatement } from '@/lib/accounting-pnl-statement';
import { loadAccountingPnlInputs } from '@/lib/accounting-data';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfCurrentYear() {
  return `${todayInput().slice(0, 4)}-01-01`;
}

function addOneDay(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateInputParam(value: string | null, fallback: string) {
  const trimmed = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fallback;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : trimmed;
}

function pdfFilename(start: string, end: string) {
  return `sobrew-detailed-profit-and-loss-${start}-to-${end}.pdf`;
}

export async function GET(request: NextRequest) {
  await requireAdminSectionView('accounting');

  const start = dateInputParam(request.nextUrl.searchParams.get('start'), firstDayOfCurrentYear());
  const end = dateInputParam(request.nextUrl.searchParams.get('end'), todayInput());
  if (end < start) {
    return new NextResponse('End date must be on or after start date.', { status: 400 });
  }

  const endExclusive = addOneDay(end);
  const inputs = await loadAccountingPnlInputs({
    supabase: await createClient(),
    payrollSupabase: getSupabaseAdmin(),
    start,
    end,
    endExclusive,
  });
  if (inputs.error || !inputs.data) {
    console.error('[accounting-pnl] statement data failed', inputs.error);
    return new NextResponse('Unable to load all P&L data. Please try again.', { status: 500 });
  }

  const statement = buildAccountingPnlStatement(inputs.data);
  const pdf = createAccountingPnlPdf({
    period: { end, start },
    statement,
  });

  return new NextResponse(pdf, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${pdfFilename(start, end)}"`,
      'Content-Type': 'application/pdf',
    },
  });
}
