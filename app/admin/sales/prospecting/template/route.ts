import { NextResponse } from 'next/server';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { PROSPECTING_CSV_TEMPLATE } from '@/lib/prospecting';

export async function GET() {
  await requireAdminSectionView('prospecting');
  return new NextResponse(PROSPECTING_CSV_TEMPLATE, {
    headers: {
      'Content-Disposition': 'attachment; filename="sobrew-prospecting-leads-template.csv"',
      'Content-Type': 'text/csv; charset=utf-8',
    },
  });
}
