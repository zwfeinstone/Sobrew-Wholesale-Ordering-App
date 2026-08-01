import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountingBulkSelectionControls from '@/components/accounting-bulk-selection-controls';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  ACCOUNTING_ACCOUNT_TYPES,
  AI_ACCOUNTING_REVIEW_PROMPT_VERSION,
  accountingAccountTypeLabel,
  accountingStatusLabel,
  accountingTransactionFingerprint,
  buildAccountingPnlTotals,
  buildSuggestedAccountingMatches,
  centsFromAccountingInput,
  generateAiAccountingReview,
  isAccountingAccountType,
  normalizeAccountingNumber,
  parseAccountingCsv,
  type AiAccountingReviewCandidate,
  type AccountingAccountType,
  type AccountingCategoryRow,
  type ParsedAccountingTransaction,
} from '@/lib/accounting';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const REVIEW_PAGE_SIZE = 12;
const PNL_TRANSACTION_LIMIT = 5000;
const BULK_ACCOUNTING_REVIEW_FORM_ID = 'bulk-accounting-review-form';
const ACCOUNTING_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'upload', label: 'Upload' },
  { id: 'review', label: 'Review Transactions' },
  { id: 'pnl', label: 'P&L' },
  { id: 'categories', label: 'Categories' },
  { id: 'imports', label: 'Imports' },
] as const;

type AccountingView = (typeof ACCOUNTING_VIEWS)[number]['id'];

type SearchParams = Record<string, string | string[] | undefined>;

const PNL_DETAIL_SECTIONS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cogs', label: 'COGS' },
  { id: 'operating_expenses', label: 'Operating Expenses' },
  { id: 'other_income', label: 'Other Income' },
  { id: 'other_expenses', label: 'Other Expenses' },
] as const;

function accountingHref(toast: string) {
  return `/admin/accounting?toast=${toast}`;
}

function accountingViewParam(value: string | string[] | undefined): AccountingView {
  return ACCOUNTING_VIEWS.some((view) => view.id === value) ? value as AccountingView : 'overview';
}

function positivePageParam(value: string | string[] | undefined) {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function accountingViewHref({
  end,
  page,
  start,
  view,
}: {
  end: string;
  page?: number;
  start: string;
  view: AccountingView;
}) {
  const params = new URLSearchParams();
  params.set('view', view);
  params.set('start', start);
  params.set('end', end);
  if (page && page > 1) params.set('page', String(page));
  return `/admin/accounting?${params.toString()}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfCurrentMonth() {
  return `${todayInput().slice(0, 8)}01`;
}

function addOneDay(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function money(value: unknown) {
  return usd(Math.round(normalizeAccountingNumber(value)));
}

function normalizeDateRange(searchParams?: SearchParams) {
  const start = typeof searchParams?.start === 'string' ? searchParams.start : firstDayOfCurrentMonth();
  const end = typeof searchParams?.end === 'string' ? searchParams.end : todayInput();
  return { end, endExclusive: addOneDay(end), start };
}

function categoryLabel(category: AccountingCategoryRow | AccountingCategoryRow[] | null | undefined) {
  const row = Array.isArray(category) ? category[0] : category;
  return row?.name ?? 'Uncategorized';
}

function categoryAmountForPnlSection(transaction: any, category: AccountingCategoryRow) {
  const amountCents = normalizeAccountingNumber(transaction.amount_cents);
  if (category.pnl_section === 'revenue' || category.pnl_section === 'other_income') {
    return -amountCents;
  }
  if (category.pnl_section === 'cogs' || category.pnl_section === 'operating_expenses' || category.pnl_section === 'other_expenses') {
    return amountCents;
  }
  return 0;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function accountingCategoryImportKey(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function transactionTone(status: string) {
  if (status === 'needs_review') return 'bg-amber-50 text-amber-800 ring-amber-100';
  if (status === 'matched_inventory') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'matched_non_inventory_expense') return 'bg-sky-50 text-sky-700 ring-sky-100';
  if (status === 'excluded') return 'bg-slate-100 text-slate-700 ring-slate-200';
  return 'bg-teal-50 text-teal-700 ring-teal-100';
}

function aiReviewTone(status: string | null | undefined) {
  if (status === 'flagged') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (status === 'clean') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'error') return 'bg-amber-50 text-amber-800 ring-amber-100';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function aiReviewLabel(status: string | null | undefined) {
  if (status === 'flagged') return 'AI Flagged';
  if (status === 'clean') return 'AI Clean';
  if (status === 'error') return 'AI Error';
  return 'Not AI Reviewed';
}

function aiFlagActionLabel(value: string | null | undefined) {
  if (value === 'approve_inventory_match') return 'Approve inventory match';
  if (value === 'categorize') return 'Categorize';
  if (value === 'exclude') return 'Exclude';
  if (value === 'split') return 'Split';
  if (value === 'verify_vendor') return 'Verify vendor';
  return 'Review';
}

function suggestedMatchLabel(targetType: string | null | undefined) {
  if (targetType === 'inventory_receipt') return 'Possible inventory receipt';
  if (targetType === 'non_inventory_expense') return 'Possible existing expense';
  if (targetType === 'payroll') return 'Possible payroll payment';
  return 'Potential duplicate payment';
}

async function serverOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const { loadEnvConfig } = await import('@next/env');
      loadEnvConfig(process.cwd());
    } catch {
      // Keep the UI error friendly; do not expose local env loading details.
    }
  }

  return process.env.OPENAI_API_KEY;
}

function aiReviewErrorMessage(code: string | string[] | undefined) {
  if (code === 'missing_key') return 'AI review is not configured yet. Add the server-only OpenAI key and try again.';
  if (code === 'no_transactions') return 'No transactions in this range need AI review.';
  if (code === 'generation_failed') return 'AI review could not run right now. Please try again in a few minutes.';
  if (code === 'save_failed') return 'AI review ran, but the flags could not be saved.';
  return null;
}

function AccountingNav({
  activeView,
  end,
  start,
}: {
  activeView: AccountingView;
  end: string;
  start: string;
}) {
  return (
    <section className="card">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        {ACCOUNTING_VIEWS.map((view) => (
          <Link
            key={view.id}
            href={accountingViewHref({ end, start, view: view.id })}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
              activeView === view.id
                ? 'border-teal-200 bg-teal-50 text-teal-900'
                : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200 hover:text-teal-800'
            }`}
          >
            {view.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

async function createSuggestionsForTransactions({
  parsedByFingerprint,
  rows,
  supabase,
}: {
  parsedByFingerprint: Map<string, ParsedAccountingTransaction>;
  rows: any[];
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  if (!rows.length) return;

  const { data: receipts } = await supabase
    .from('inventory_receipts')
    .select('id,supplier,quantity,item_unit_cost_cents,freight_cents,other_cost_cents,received_at,reversed_at,inventory_items(name,sku)')
    .is('reversed_at', null)
    .order('received_at', { ascending: false })
    .limit(500);

  const { data: expenses } = await supabase
    .from('non_inventory_expenses')
    .select('id,expense_type,vendor,amount_cents,spent_at')
    .order('spent_at', { ascending: false })
    .limit(500);

  const matchRows = rows.flatMap((row) => {
    const parsed = parsedByFingerprint.get(row.transaction_fingerprint);
    if (!parsed) return [];
    return buildSuggestedAccountingMatches({
      expenses: (expenses ?? []) as any[],
      receipts: (receipts ?? []) as any[],
      transaction: parsed,
    }).map((suggestion) => ({
      transaction_id: row.id,
      target_type: suggestion.targetType,
      target_id: suggestion.targetId,
      confidence: suggestion.confidence,
      match_status: 'suggested',
      reason: suggestion.reason,
    }));
  });

  if (matchRows.length) {
    await supabase.from('accounting_transaction_matches').insert(matchRows);
  }
}

async function uploadAccountingCsv(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const file = formData.get('file');
  const rawAccountType = String(formData.get('account_type') ?? 'other');
  const accountType: AccountingAccountType = isAccountingAccountType(rawAccountType) ? rawAccountType : 'other';
  const rawAmountSign = String(formData.get('amount_sign') ?? 'auto');
  const amountSign = rawAmountSign === 'money_out_positive' || rawAmountSign === 'money_out_negative' ? rawAmountSign : 'auto';
  const accountName = String(formData.get('account_name') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!file || typeof file === 'string' || typeof (file as File).text !== 'function') {
    redirect(accountingHref('upload_error'));
  }

  let parsed: ParsedAccountingTransaction[];
  try {
    parsed = parseAccountingCsv({
      accountName,
      accountType,
      amountSign,
      content: await (file as File).text(),
    });
  } catch {
    redirect(accountingHref('upload_error'));
  }

  if (!parsed.length) redirect(accountingHref('upload_empty'));

  const current = await requireAdminSectionView('accounting');
  const { data: categories } = await supabase
    .from('accounting_categories')
    .select('id,name,category_type,pnl_section')
    .eq('active', true);
  const categoryByName = new Map(
    ((categories ?? []) as AccountingCategoryRow[]).map((category) => [accountingCategoryImportKey(category.name), category]),
  );
  const outflowCents = parsed.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const inflowCents = parsed.reduce((sum, row) => sum + Math.max(0, -row.amountCents), 0);

  const { data: batch, error: batchError } = await supabase
    .from('accounting_upload_batches')
    .insert({
      source_type: 'csv',
      account_name: accountName,
      account_type: accountType,
      file_name: (file as File).name || null,
      uploaded_by: current.profile.id,
      transaction_count: parsed.length,
      total_outflow_cents: outflowCents,
      total_inflow_cents: inflowCents,
      notes,
    })
    .select('id')
    .single();

  if (batchError || !batch) redirect(accountingHref('upload_error'));

  const parsedByFingerprint = new Map<string, ParsedAccountingTransaction>();
  const rows = parsed.map((transaction) => {
    const fingerprint = accountingTransactionFingerprint(transaction);
    const category = categoryByName.get(accountingCategoryImportKey(transaction.categoryName)) ?? null;
    parsedByFingerprint.set(fingerprint, transaction);
    return {
      upload_batch_id: batch.id,
      source_type: 'csv',
      account_name: transaction.accountName,
      account_type: transaction.accountType,
      transaction_date: transaction.transactionDate,
      merchant_name: transaction.merchantName,
      original_description: transaction.originalDescription,
      amount_cents: transaction.amountCents,
      category_id: category?.id ?? null,
      status: category
        ? category.category_type === 'excluded' ? 'excluded' : 'categorized'
        : 'needs_review',
      transaction_fingerprint: fingerprint,
    };
  });

  const { data: inserted, error } = await supabase
    .from('accounting_transactions')
    .upsert(rows, { ignoreDuplicates: true, onConflict: 'transaction_fingerprint' })
    .select('id,transaction_fingerprint');

  if (error) redirect(accountingHref('upload_error'));

  await createSuggestionsForTransactions({
    parsedByFingerprint,
    rows: inserted ?? [],
    supabase,
  });

  redirect(accountingHref(inserted?.length ? 'upload_saved' : 'upload_duplicates'));
}

async function addManualTransaction(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const rawAccountType = String(formData.get('account_type') ?? 'manual');
  const accountType: AccountingAccountType = isAccountingAccountType(rawAccountType) ? rawAccountType : 'manual';
  const transaction: ParsedAccountingTransaction = {
    accountName: String(formData.get('account_name') ?? '').trim() || null,
    accountType,
    amountCents: centsFromAccountingInput(String(formData.get('amount') ?? '0')),
    merchantName: String(formData.get('merchant_name') ?? '').trim() || null,
    originalDescription: String(formData.get('description') ?? '').trim(),
    transactionDate: String(formData.get('transaction_date') ?? '') || todayInput(),
  };

  if (!transaction.amountCents || !transaction.originalDescription || !transaction.transactionDate) {
    redirect(accountingHref('manual_error'));
  }

  const current = await requireAdminSectionView('accounting');
  const { data: batch } = await supabase
    .from('accounting_upload_batches')
    .insert({
      source_type: 'manual',
      account_name: transaction.accountName,
      account_type: accountType,
      uploaded_by: current.profile.id,
      transaction_count: 1,
      total_outflow_cents: Math.max(0, transaction.amountCents),
      total_inflow_cents: Math.max(0, -transaction.amountCents),
    })
    .select('id')
    .single();

  const fingerprint = accountingTransactionFingerprint(transaction);
  const { data: inserted, error } = await supabase
    .from('accounting_transactions')
    .upsert([{
      upload_batch_id: batch?.id ?? null,
      source_type: 'manual',
      account_name: transaction.accountName,
      account_type: accountType,
      transaction_date: transaction.transactionDate,
      merchant_name: transaction.merchantName,
      original_description: transaction.originalDescription,
      amount_cents: transaction.amountCents,
      transaction_fingerprint: fingerprint,
    }], { ignoreDuplicates: true, onConflict: 'transaction_fingerprint' })
    .select('id,transaction_fingerprint');

  if (error) redirect(accountingHref('manual_error'));

  await createSuggestionsForTransactions({
    parsedByFingerprint: new Map([[fingerprint, transaction]]),
    rows: inserted ?? [],
    supabase,
  });

  redirect(accountingHref(inserted?.length ? 'manual_saved' : 'upload_duplicates'));
}

async function addAccountingCategory(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const name = String(formData.get('name') ?? '').trim();
  const categoryType = String(formData.get('category_type') ?? 'operating_expense');
  const pnlSection = String(formData.get('pnl_section') ?? 'operating_expenses');
  if (!name) redirect(accountingHref('category_error'));

  const { error } = await supabase.from('accounting_categories').insert({
    name,
    category_type: categoryType,
    pnl_section: pnlSection,
    is_system: false,
    display_order: 700,
  });

  redirect(accountingHref(error ? 'category_error' : 'category_saved'));
}

async function updateAccountingTransaction(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const supabase = await createClient();
  const transactionId = String(formData.get('transaction_id') ?? '').trim();
  const actionType = String(formData.get('action_type') ?? '');
  if (!transactionId) redirect(accountingHref('review_error'));

  if (actionType === 'categorize') {
    const categoryId = String(formData.get('category_id') ?? '').trim();
    if (!categoryId) redirect(accountingHref('review_error'));
    const { error } = await supabase
      .from('accounting_transactions')
      .update({
        category_id: categoryId,
        status: 'categorized',
        review_notes: String(formData.get('review_notes') ?? '').trim() || null,
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);
    redirect(accountingHref(error ? 'review_error' : 'transaction_saved'));
  }

  if (actionType === 'exclude') {
    const { error } = await supabase
      .from('accounting_transactions')
      .update({
        status: 'excluded',
        review_notes: String(formData.get('review_notes') ?? '').trim() || 'Excluded from accounting reports',
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);
    redirect(accountingHref(error ? 'review_error' : 'transaction_excluded'));
  }

  if (actionType === 'approve_match') {
    const matchId = String(formData.get('match_id') ?? '').trim();
    const targetType = String(formData.get('target_type') ?? '');
    if (!matchId) redirect(accountingHref('review_error'));

    const status = targetType === 'inventory_receipt'
      ? 'matched_inventory'
      : targetType === 'non_inventory_expense'
        ? 'matched_non_inventory_expense'
        : 'excluded';
    const { error: matchError } = await supabase
      .from('accounting_transaction_matches')
      .update({
        match_status: 'approved',
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .eq('transaction_id', transactionId);

    const transactionUpdate: Record<string, unknown> = {
      status,
      reviewed_by: current.profile.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (status === 'excluded') {
      transactionUpdate.review_notes = 'Approved as a likely duplicate payment or transfer';
    }

    const { error: transactionError } = await supabase
      .from('accounting_transactions')
      .update(transactionUpdate)
      .eq('id', transactionId);

    redirect(accountingHref(matchError || transactionError ? 'review_error' : 'match_approved'));
  }

  if (actionType === 'reject_match') {
    const matchId = String(formData.get('match_id') ?? '').trim();
    if (!matchId) redirect(accountingHref('review_error'));
    const { error } = await supabase
      .from('accounting_transaction_matches')
      .update({
        match_status: 'rejected',
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .eq('transaction_id', transactionId);
    redirect(accountingHref(error ? 'review_error' : 'match_rejected'));
  }

  redirect(accountingHref('review_error'));
}

async function bulkUpdateAccountingTransactions(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const supabase = await createClient();
  const transactionIds = formData
    .getAll('transaction_id')
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, REVIEW_PAGE_SIZE);
  const markAs = String(formData.get('mark_as') ?? '').trim();
  const note = String(formData.get('review_notes') ?? '').trim();

  if (!transactionIds.length || !markAs) redirect(accountingHref('review_error'));

  const reviewedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    reviewed_by: current.profile.id,
    reviewed_at: reviewedAt,
    updated_at: reviewedAt,
  };

  if (markAs === '__needs_review__') {
    update.category_id = null;
    update.status = 'needs_review';
    if (note) update.review_notes = note;
  } else if (markAs === '__exclude__') {
    update.category_id = null;
    update.status = 'excluded';
    update.review_notes = note || 'Bulk excluded from accounting reports';
  } else {
    const { data: category } = await supabase
      .from('accounting_categories')
      .select('id,category_type')
      .eq('id', markAs)
      .eq('active', true)
      .single();

    if (!category) redirect(accountingHref('review_error'));

    update.category_id = category.id;
    update.status = category.category_type === 'excluded' ? 'excluded' : 'categorized';
    if (note) update.review_notes = note;
  }

  const { error } = await supabase
    .from('accounting_transactions')
    .update(update)
    .in('id', transactionIds);

  redirect(accountingHref(error ? 'review_error' : 'transaction_saved'));
}

async function runAiAccountingReview(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const apiKey = await serverOpenAiApiKey();
  const start = String(formData.get('start') ?? '') || firstDayOfCurrentMonth();
  const end = String(formData.get('end') ?? '') || todayInput();
  const endExclusive = addOneDay(end);

  if (!apiKey) redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=missing_key`);

  const supabase = await createClient();
  const [{ data: transactions }, { data: categories }] = await Promise.all([
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,account_name,merchant_name,original_description,amount_cents,status,category_id,accounting_categories(name),accounting_transaction_matches(target_type,confidence,match_status,reason)')
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .in('status', ['needs_review', 'categorized'])
      .order('transaction_date', { ascending: false })
      .limit(50),
    supabase
      .from('accounting_categories')
      .select('name')
      .eq('active', true)
      .order('display_order', { ascending: true }),
  ]);

  const candidates = ((transactions ?? []) as any[]).map((transaction): AiAccountingReviewCandidate => ({
    accountName: transaction.account_name ?? null,
    amountCents: Math.round(normalizeAccountingNumber(transaction.amount_cents)),
    categoryName: categoryLabel(transaction.accounting_categories),
    description: transaction.original_description,
    existingStatus: transaction.status,
    id: transaction.id,
    merchantName: transaction.merchant_name ?? null,
    suggestedMatches: ((transaction.accounting_transaction_matches ?? []) as any[])
      .filter((match) => match.match_status === 'suggested')
      .map((match) => ({
        confidence: Math.round(normalizeAccountingNumber(match.confidence)),
        reason: match.reason ?? null,
        targetType: match.target_type,
      })),
    transactionDate: transaction.transaction_date,
  }));

  if (!candidates.length) redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=no_transactions`);

  const categoryNames = ((categories ?? []) as Array<{ name: string | null }>).map((category) => category.name).filter((name): name is string => Boolean(name));
  let generated;
  const model = process.env.AI_ACCOUNTING_REVIEW_MODEL || process.env.AI_QA_MODEL || 'gpt-5.5';
  try {
    generated = await generateAiAccountingReview({
      apiKey,
      candidates,
      categoryNames,
      model,
    });
  } catch {
    redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=generation_failed`);
  }

  const flagsByTransactionId = new Map<string, typeof generated.flags>();
  for (const flag of generated.flags) {
    flagsByTransactionId.set(flag.transactionId, [...(flagsByTransactionId.get(flag.transactionId) ?? []), flag]);
  }

  const reviewedAt = new Date().toISOString();
  const updates = await Promise.all(candidates.map((candidate) => {
    const flags = flagsByTransactionId.get(candidate.id) ?? [];
    return supabase
      .from('accounting_transactions')
      .update({
        ai_review_flags: flags,
        ai_review_model: generated.model,
        ai_review_prompt_version: AI_ACCOUNTING_REVIEW_PROMPT_VERSION,
        ai_review_status: flags.length ? 'flagged' : 'clean',
        ai_review_summary: flags.length
          ? flags.map((flag) => `${flag.flagType}: ${flag.reason}`).join('\n')
          : 'AI review found no exception flags.',
        ai_reviewed_at: reviewedAt,
        reviewed_by: current.profile.id,
        updated_at: reviewedAt,
      })
      .eq('id', candidate.id);
  }));

  if (updates.some((result) => result.error)) {
    redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=save_failed`);
  }

  redirect(`/admin/accounting?start=${start}&end=${end}&toast=ai_review_saved`);
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireAdminSectionView('accounting');
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const activeView = accountingViewParam(searchParams?.view);
  const reviewPage = positivePageParam(searchParams?.page);
  const reviewFrom = (reviewPage - 1) * REVIEW_PAGE_SIZE;
  const reviewTo = reviewFrom + REVIEW_PAGE_SIZE - 1;
  const { end, endExclusive, start } = normalizeDateRange(searchParams);

  const [
    categoriesResult,
    transactionsResult,
    pnlTransactionsResult,
    batchesResult,
  ] = await Promise.all([
    supabase.from('accounting_categories').select('id,name,category_type,pnl_section,active').eq('active', true).order('display_order', { ascending: true }).order('name', { ascending: true }),
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,ai_review_status,ai_review_summary,ai_review_flags,ai_review_model,ai_reviewed_at,review_notes,category_id,accounting_categories(id,name,category_type,pnl_section),accounting_transaction_matches(id,target_type,target_id,confidence,match_status,reason)', { count: 'exact' })
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .order('transaction_date', { ascending: false })
      .range(reviewFrom, reviewTo),
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,amount_cents,status,ai_review_status,category_id,accounting_categories(id,name,category_type,pnl_section)')
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .order('transaction_date', { ascending: false })
      .limit(PNL_TRANSACTION_LIMIT),
    supabase.from('accounting_upload_batches').select('id,source_type,account_name,account_type,file_name,transaction_count,total_outflow_cents,total_inflow_cents,created_at').order('created_at', { ascending: false }).limit(6),
  ]);

  const categories = (categoriesResult.data ?? []) as AccountingCategoryRow[];
  const transactions = (transactionsResult.data ?? []) as any[];
  const transactionTotal = transactionsResult.count ?? transactions.length;
  const hasPreviousReviewPage = reviewPage > 1;
  const hasNextReviewPage = reviewFrom + transactions.length < transactionTotal;
  const pnlTransactions = (pnlTransactionsResult.data ?? []) as any[];
  const batches = batchesResult.data ?? [];
  const pnl = buildAccountingPnlTotals({
    transactions: pnlTransactions as any[],
  });

  const needsReviewCount = pnlTransactions.filter((transaction) => transaction.status === 'needs_review').length;
  const aiFlaggedCount = pnlTransactions.filter((transaction) => transaction.ai_review_status === 'flagged').length;
  const matchedInventoryCents = pnlTransactions
    .filter((transaction) => transaction.status === 'matched_inventory')
    .reduce((sum, transaction) => sum + Math.max(0, normalizeAccountingNumber(transaction.amount_cents)), 0);
  const pnlCategoryBreakdown = PNL_DETAIL_SECTIONS.map((section) => ({
    ...section,
    rows: categories
      .filter((category) => category.pnl_section === section.id)
      .map((category) => ({
        category,
        totalCents: pnlTransactions
          .filter((transaction) => transaction.category_id === category.id && transaction.status === 'categorized')
          .reduce((sum, transaction) => sum + categoryAmountForPnlSection(transaction, category), 0),
      }))
      .filter((row) => row.totalCents > 0)
      .sort((left, right) => right.totalCents - left.totalCents),
  })).filter((section) => section.rows.length > 0);

  return (
    <div className="space-y-6">
      {toast === 'upload_saved' ? <StatusToast message="Transactions uploaded." tone="success" /> : null}
      {toast === 'upload_duplicates' ? <StatusToast message="Those transactions were already in accounting." tone="success" /> : null}
      {toast === 'upload_empty' ? <StatusToast message="No usable transactions found in that file." tone="error" /> : null}
      {toast === 'upload_error' ? <StatusToast message="Unable to upload that file." tone="error" /> : null}
      {toast === 'manual_saved' ? <StatusToast message="Manual transaction added." tone="success" /> : null}
      {toast === 'manual_error' ? <StatusToast message="Unable to add that transaction." tone="error" /> : null}
      {toast === 'category_saved' ? <StatusToast message="Accounting category added." tone="success" /> : null}
      {toast === 'category_error' ? <StatusToast message="Unable to add that category." tone="error" /> : null}
      {toast === 'transaction_saved' ? <StatusToast message="Transaction categorized." tone="success" /> : null}
      {toast === 'transaction_excluded' ? <StatusToast message="Transaction excluded from reports." tone="success" /> : null}
      {toast === 'match_approved' ? <StatusToast message="Match approved. This transaction will not double-count as a separate expense." tone="success" /> : null}
      {toast === 'match_rejected' ? <StatusToast message="Suggested match rejected." tone="success" /> : null}
      {toast === 'ai_review_saved' ? <StatusToast message="AI review complete. Flagged transactions are marked in the review queue." tone="success" /> : null}
      {toast === 'review_error' ? <StatusToast message="Unable to update that transaction." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only admins with accounting access can make changes." tone="error" /> : null}
      {aiReviewErrorMessage(searchParams?.ai_error) ? <StatusToast message={aiReviewErrorMessage(searchParams?.ai_error) ?? ''} tone="error" /> : null}

      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Accounting</span>
            <h1 className="page-title mt-4">Accounting workspace</h1>
            <p className="page-subtitle mt-3 max-w-3xl">Upload bank and card activity, review possible duplicates, and track the numbers that feed your P&amp;L.</p>
          </div>
          <form className="grid gap-3 rounded-xl border border-slate-200 bg-white/60 p-3 sm:grid-cols-[1fr_1fr_auto]" action="/admin/accounting">
            <input name="view" type="hidden" value={activeView} />
            <input className="input" name="start" type="date" defaultValue={start} />
            <input className="input" name="end" type="date" defaultValue={end} />
            <button className="btn-primary" type="submit">Update</button>
          </form>
          <form action={runAiAccountingReview} className="rounded-xl border border-slate-200 bg-white/60 p-3">
            <input name="start" type="hidden" value={start} />
            <input name="end" type="hidden" value={end} />
            <PendingSubmitButton className="btn-primary w-full" label="Run AI review" pendingLabel="Reviewing..." />
          </form>
        </div>
      </section>

      <AccountingNav activeView={activeView} end={end} start={start} />

      {activeView === 'overview' ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.revenueCents)}</p>
          <p className="mt-1 text-sm text-slate-500">Uploaded revenue</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Gross Profit</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.grossProfitCents)}</p>
          <p className="mt-1 text-sm text-slate-500">After uploaded COGS</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Net Income</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.netIncomeCents)}</p>
          <p className="mt-1 text-sm text-slate-500">Starter P&amp;L</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Review Queue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{needsReviewCount}</p>
          <p className="mt-1 text-sm text-slate-500">Transactions in range</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">AI Flags</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{aiFlaggedCount}</p>
          <p className="mt-1 text-sm text-slate-500">Rows needing attention</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Inventory Reconciled</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(matchedInventoryCents)}</p>
          <p className="mt-1 text-sm text-slate-500">Excluded from duplicate expense</p>
        </div>
      </section> : null}

      {activeView === 'upload' ? <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <form action={uploadAccountingCsv} className="card space-y-4">
          <div>
            <span className="eyebrow">Upload</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Import card or bank activity</h2>
            <p className="mt-2 text-sm text-slate-500">
              <a className="font-semibold text-teal-700 hover:text-teal-800" href="/accounting-transactions-template.csv" download>
                Download CSV template
              </a>
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input" name="account_name" placeholder="Sobrew debit, Amex, Chase Visa" />
            <select className="input" name="account_type" defaultValue="credit_card">
              {ACCOUNTING_ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <input name="amount_sign" type="hidden" value="auto" />
          <p className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            Purchase signs are detected automatically from the file.
          </p>
          <input className="input" name="file" type="file" accept=".csv,text/csv" required />
          <textarea className="input min-h-20" name="notes" placeholder="Batch notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Upload transactions" pendingLabel="Uploading..." />
        </form>

        <form action={addManualTransaction} className="card space-y-4">
          <div>
            <span className="eyebrow">Manual</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Add one transaction</h2>
          </div>
          <input className="input" name="transaction_date" type="date" defaultValue={todayInput()} />
          <input className="input" name="description" required placeholder="Description" />
          <input className="input" name="merchant_name" placeholder="Merchant" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="amount" required type="number" step="0.01" placeholder="Amount" />
            <select className="input" name="account_type" defaultValue="manual">
              {ACCOUNTING_ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <input className="input" name="account_name" placeholder="Account name" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Add transaction" pendingLabel="Adding..." />
        </form>
      </section> : null}

      {activeView === 'pnl' ? <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="card space-y-4">
          <div>
            <span className="eyebrow">P&amp;L</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Profit and loss foundation</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-2 font-medium text-slate-700">Uploaded revenue</td><td className="py-2 text-right font-semibold">{money(pnl.revenueCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Uploaded COGS</td><td className="py-2 text-right font-semibold">({money(pnl.cardCogsCents)})</td></tr>
                <tr><td className="py-2 font-semibold text-slate-950">Gross profit</td><td className="py-2 text-right font-semibold text-slate-950">{money(pnl.grossProfitCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Uploaded operating expenses</td><td className="py-2 text-right font-semibold">({money(pnl.cardOperatingExpenseCents)})</td></tr>
                <tr><td className="py-2 font-semibold text-slate-950">Operating income</td><td className="py-2 text-right font-semibold text-slate-950">{money(pnl.operatingIncomeCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Other income</td><td className="py-2 text-right font-semibold">{money(pnl.otherIncomeCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Other expense</td><td className="py-2 text-right font-semibold">({money(pnl.otherExpenseCents)})</td></tr>
                <tr><td className="py-2 text-base font-semibold text-slate-950">Net income</td><td className="py-2 text-right text-base font-semibold text-slate-950">{money(pnl.netIncomeCents)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Controls</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Uploaded activity</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Imported Rows</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{transactionTotal}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs Review</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{needsReviewCount}</p>
            </div>
          </div>
          <div className="space-y-4">
            {pnlCategoryBreakdown.map((section) => (
              <div key={section.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section.label}</p>
                {section.rows.map((row) => (
                  <div key={row.category.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{row.category.name}</span>
                    <span className="font-semibold text-slate-950">{money(row.totalCents)}</span>
                  </div>
                ))}
              </div>
            ))}
            {!pnlCategoryBreakdown.length ? <p className="text-sm text-slate-500">No categorized accounting activity in this range yet.</p> : null}
          </div>
        </div>
      </section> : null}

      {activeView === 'categories' ? <section className="card space-y-4">
        <div>
          <span className="eyebrow">Categories</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Manage accounting categories</h2>
        </div>
          <form action={addAccountingCategory} className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input className="input" name="name" required placeholder="New category" />
            <select className="input" name="category_type" defaultValue="operating_expense">
              <option value="operating_expense">Operating Expense</option>
              <option value="cogs">COGS</option>
              <option value="asset">Asset</option>
              <option value="other_income">Other Income</option>
              <option value="other_expense">Other Expense</option>
              <option value="excluded">Excluded</option>
            </select>
            <select className="input" name="pnl_section" defaultValue="operating_expenses">
              <option value="operating_expenses">Operating Expenses</option>
              <option value="cogs">COGS</option>
              <option value="other_income">Other Income</option>
              <option value="other_expenses">Other Expenses</option>
              <option value="none">No P&amp;L</option>
            </select>
            <PendingSubmitButton className="btn-secondary" label="Add" pendingLabel="Adding..." />
          </form>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <div key={category.id} className="rounded-xl border border-slate-200 bg-white/60 p-3">
                <p className="font-semibold text-slate-950">{category.name}</p>
                <p className="mt-1 text-sm text-slate-500">{category.category_type.replace(/_/g, ' ')} - {category.pnl_section.replace(/_/g, ' ')}</p>
              </div>
            ))}
            {!categories.length ? <p className="text-sm text-slate-500">No categories yet.</p> : null}
          </div>
      </section> : null}

      {activeView === 'review' ? <section className="card space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Review</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Transactions</h2>
            <p className="mt-2 text-sm text-slate-500">
              Showing {transactionTotal ? reviewFrom + 1 : 0}-{reviewFrom + transactions.length} of {transactionTotal} transactions.
            </p>
          </div>
          <Link className="btn-secondary w-full sm:w-auto" href="/admin/receiving">Open receiving</Link>
        </div>
        {transactions.length ? (
          <form id={BULK_ACCOUNTING_REVIEW_FORM_ID} action={bulkUpdateAccountingTransactions} className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_auto] lg:items-end">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-950">Bulk review</p>
              <AccountingBulkSelectionControls formId={BULK_ACCOUNTING_REVIEW_FORM_ID} pageCount={transactions.length} />
            </div>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Mark selected as
              <select className="input" name="mark_as" required defaultValue="">
                <option value="" disabled>Select category or status</option>
                <option value="__exclude__">Excluded from P&amp;L</option>
                <option value="__needs_review__">Needs Review</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Notes
              <input className="input" name="review_notes" placeholder="Optional bulk note" />
            </label>
            <PendingSubmitButton className="btn-primary" label="Apply" pendingLabel="Applying..." />
          </form>
        ) : null}
        <div className="space-y-3">
          {transactions.map((transaction) => {
            const matches = (transaction.accounting_transaction_matches ?? []).filter((match: any) => match.match_status === 'suggested');
            const aiFlags = Array.isArray(transaction.ai_review_flags) ? transaction.ai_review_flags : [];
            return (
              <div key={transaction.id} className="rounded-xl border border-slate-200 bg-white/65 p-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80">
                        <span className="sr-only">Select transaction</span>
                        <input
                          className="h-4 w-4 accent-teal-700"
                          data-accounting-transaction-select="true"
                          form={BULK_ACCOUNTING_REVIEW_FORM_ID}
                          name="transaction_id"
                          type="checkbox"
                          value={transaction.id}
                        />
                      </label>
                      <p className="font-semibold text-slate-950">{transaction.merchant_name || transaction.original_description}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${transactionTone(transaction.status)}`}>{accountingStatusLabel(transaction.status)}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${aiReviewTone(transaction.ai_review_status)}`}>{aiReviewLabel(transaction.ai_review_status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{formatDate(transaction.transaction_date)} - {accountingAccountTypeLabel(transaction.account_type)}{transaction.account_name ? ` - ${transaction.account_name}` : ''}</p>
                    {transaction.merchant_name ? <p className="mt-1 text-sm text-slate-500">{transaction.original_description}</p> : null}
                    <p className="mt-2 text-sm font-medium text-slate-700">Category: {categoryLabel(transaction.accounting_categories)}</p>
                    {transaction.ai_reviewed_at ? <p className="mt-1 text-xs text-slate-500">AI reviewed {formatDate(transaction.ai_reviewed_at)}{transaction.ai_review_model ? ` with ${transaction.ai_review_model}` : ''}</p> : null}
                  </div>
                  <p className={`text-2xl font-semibold ${normalizeAccountingNumber(transaction.amount_cents) < 0 ? 'text-emerald-700' : 'text-slate-950'}`}>
                    {money(transaction.amount_cents)}
                  </p>
                </div>

                {aiFlags.length ? (
                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                    {aiFlags.map((flag: any, index: number) => (
                      <div key={`${transaction.id}-ai-${index}`} className="rounded-xl border border-rose-100 bg-rose-50/70 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-rose-950">{aiFlagActionLabel(flag.recommendedAction)} - {Math.round(normalizeAccountingNumber(flag.confidence))}% confidence</p>
                            <p className="mt-1 text-sm text-rose-900">{flag.reason}</p>
                          </div>
                          <span className="w-fit rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">{String(flag.flagType ?? 'review').replace(/_/g, ' ')}</span>
                        </div>
                        {flag.categorySuggestion ? <p className="mt-2 text-xs font-medium text-rose-800">Suggested category: {flag.categorySuggestion}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : transaction.ai_review_status === 'clean' ? (
                  <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm font-medium text-emerald-800">AI review found no exception flags.</p>
                ) : null}

                {matches.length ? (
                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                    {matches.map((match: any) => (
                      <form key={match.id} action={updateAccountingTransaction} className="grid gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <input name="transaction_id" type="hidden" value={transaction.id} />
                        <input name="match_id" type="hidden" value={match.id} />
                        <input name="target_type" type="hidden" value={match.target_type} />
                        <div>
                          <p className="text-sm font-semibold text-amber-950">{suggestedMatchLabel(match.target_type)} - {Math.round(normalizeAccountingNumber(match.confidence))}%</p>
                          <p className="mt-1 text-xs text-amber-800">{match.reason}</p>
                        </div>
                        <button className="btn-primary" name="action_type" type="submit" value="approve_match">Approve</button>
                        <button className="btn-secondary" name="action_type" type="submit" value="reject_match">Reject</button>
                      </form>
                    ))}
                  </div>
                ) : null}

                <form action={updateAccountingTransaction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_minmax(220px,0.8fr)_auto_auto] lg:items-end">
                  <input name="transaction_id" type="hidden" value={transaction.id} />
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Category
                    <select className="input" name="category_id" defaultValue={transaction.category_id ?? ''}>
                      <option value="" disabled>Select category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Notes
                    <input className="input" name="review_notes" defaultValue={transaction.review_notes ?? ''} placeholder="Review note" />
                  </label>
                  <button className="btn-primary" name="action_type" type="submit" value="categorize">Save</button>
                  <button className="btn-secondary" name="action_type" type="submit" value="exclude">Exclude</button>
                </form>
              </div>
            );
          })}
          {!transactions.length ? <p className="text-sm text-slate-500">No accounting transactions in this range yet.</p> : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            className={`btn-secondary ${hasPreviousReviewPage ? '' : 'pointer-events-none opacity-50'}`}
            href={accountingViewHref({ end, page: reviewPage - 1, start, view: 'review' })}
            aria-disabled={!hasPreviousReviewPage}
          >
            Previous
          </Link>
          <p className="text-sm font-medium text-slate-500">Page {reviewPage}</p>
          <Link
            className={`btn-secondary ${hasNextReviewPage ? '' : 'pointer-events-none opacity-50'}`}
            href={accountingViewHref({ end, page: reviewPage + 1, start, view: 'review' })}
            aria-disabled={!hasNextReviewPage}
          >
            Next
          </Link>
        </div>
      </section> : null}

      {activeView === 'imports' ? <section className="card space-y-4">
        <div>
          <span className="eyebrow">Imports</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Recent batches</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((batch: any) => (
            <div key={batch.id} className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="font-semibold text-slate-950">{batch.file_name || batch.account_name || 'Manual batch'}</p>
              <p className="mt-1 text-sm text-slate-500">{formatDate(batch.created_at)} - {accountingAccountTypeLabel(batch.account_type)}</p>
              <p className="mt-2 text-sm text-slate-700">{batch.transaction_count} rows - {money(batch.total_outflow_cents)} out / {money(batch.total_inflow_cents)} in</p>
            </div>
          ))}
          {!batches.length ? <p className="text-sm text-slate-500">No uploads yet.</p> : null}
        </div>
      </section> : null}
    </div>
  );
}
