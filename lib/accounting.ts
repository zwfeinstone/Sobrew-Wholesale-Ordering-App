import { createHash } from 'crypto';
import { AI_BUSINESS_OVERVIEW_DEFAULT_MODEL, extractOpenAiResponseText } from '@/lib/ai-business-overview';

export const AI_ACCOUNTING_REVIEW_PROMPT_VERSION = 'ai-accounting-review-v1';

export const ACCOUNTING_ACCOUNT_TYPES = [
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'bank', label: 'Bank Account' },
  { value: 'manual', label: 'Manual' },
  { value: 'other', label: 'Other' },
] as const;

export const ACCOUNTING_TRANSACTION_STATUSES = [
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'categorized', label: 'Categorized' },
  { value: 'excluded', label: 'Excluded' },
] as const;

export type AccountingAccountType = (typeof ACCOUNTING_ACCOUNT_TYPES)[number]['value'];
export type AccountingTransactionStatus = (typeof ACCOUNTING_TRANSACTION_STATUSES)[number]['value'];
export type AccountingPnlSection = 'revenue' | 'cogs' | 'operating_expenses' | 'other_income' | 'other_expenses' | 'none';

export type ParsedAccountingTransaction = {
  accountName: string | null;
  accountType: AccountingAccountType;
  amountCents: number;
  categoryName?: string | null;
  merchantName: string | null;
  originalDescription: string;
  transactionDate: string;
};

export type AccountingAmountSignMode = 'auto' | 'money_out_positive' | 'money_out_negative';

export type AccountingCategoryRow = {
  category_type: string;
  id: string;
  name: string;
  pnl_section: AccountingPnlSection;
};

export type AccountingTransactionRow = {
  accounting_categories?: AccountingCategoryRow | AccountingCategoryRow[] | null;
  amount_cents: number | string;
  category_id: string | null;
  status: AccountingTransactionStatus | string;
  transaction_date: string;
};

export type AccountingPnlTotals = {
  cardCogsCents: number;
  cardOperatingExpenseCents: number;
  grossProfitCents: number;
  netIncomeCents: number;
  operatingIncomeCents: number;
  otherExpenseCents: number;
  otherIncomeCents: number;
  revenueCents: number;
};

export type AiAccountingReviewCandidate = {
  accountName: string | null;
  amountCents: number;
  categoryName: string | null;
  description: string;
  existingStatus: string;
  id: string;
  merchantName: string | null;
  transactionDate: string;
};

export type AiAccountingReviewFlag = {
  categorySuggestion?: string | null;
  confidence: number;
  flagType: 'possible_duplicate' | 'missing_category' | 'possible_transfer' | 'refund_or_credit' | 'unusual_amount' | 'vendor_review' | 'other';
  reason: string;
  recommendedAction: 'categorize' | 'exclude' | 'split' | 'verify_vendor' | 'review';
  transactionId: string;
};

export type AiAccountingReviewResult = {
  flags: AiAccountingReviewFlag[];
};

const CSV_HEADER_ALIASES = {
  accountName: ['account', 'accountname', 'account_name', 'card', 'cardname'],
  amount: ['amount', 'transactionamount', 'transaction_amount'],
  category: ['category', 'accountingcategory', 'accounting_category', 'expensecategory', 'expense_category', 'likelyexpensecategory', 'likely_expense_category'],
  credit: ['credit', 'deposit', 'moneyin', 'money_in'],
  date: ['date', 'transactiondate', 'transaction_date', 'posteddate', 'posted_date'],
  debit: ['debit', 'withdrawal', 'charge', 'moneyout', 'money_out'],
  description: ['description', 'name', 'memo', 'details', 'originaldescription', 'original_description'],
  merchant: ['merchant', 'merchantname', 'merchant_name', 'payee', 'vendor'],
};

const AI_ACCOUNTING_REVIEW_PROMPT = `
You are Sobrew's accounting review assistant.

Review uploaded bank and credit-card transactions and flag only rows that deserve human attention before month-end books are trusted.

Important accounting rules:
- Positive amounts are money out. Negative amounts are money in.
- Credit card payments, account transfers, owner draws, refunds, and deposits should generally be excluded from P&L expense unless the data says otherwise.
- Cash App, Zelle, and Venmo payments are often payroll, owner-pay, reimbursement, or transfer rows that can duplicate something already recorded elsewhere.
- Do not invent vendors, receipts, categories, or facts. Use only the supplied JSON.
- Prefer fewer, higher-confidence flags over noisy guesses.

Flag rows for:
- possible duplicate expense
- missing or suspicious category
- possible transfer or credit card payment
- refund/credit needing treatment
- unusual amount/vendor/date pattern
- anything that could make the P&L materially wrong

Return only valid JSON in this exact shape:
{
  "flags": [
    {
      "transactionId": "uuid",
      "flagType": "possible_duplicate | missing_category | possible_transfer | refund_or_credit | unusual_amount | vendor_review | other",
      "confidence": 0-100,
      "reason": "short owner-friendly explanation",
      "recommendedAction": "categorize | exclude | split | verify_vendor | review",
      "categorySuggestion": "optional category name or null"
    }
  ]
}
`.trim();

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function normalizeAccountingNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function accountingStatusLabel(value: string | null | undefined) {
  return ACCOUNTING_TRANSACTION_STATUSES.find((status) => status.value === value)?.label ?? 'Unknown';
}

export function accountingAccountTypeLabel(value: string | null | undefined) {
  return ACCOUNTING_ACCOUNT_TYPES.find((type) => type.value === value)?.label ?? 'Other';
}

export function isAccountingAccountType(value: string): value is AccountingAccountType {
  return ACCOUNTING_ACCOUNT_TYPES.some((type) => type.value === value);
}

export function parseMoneyToCents(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const isParenthesized = raw.startsWith('(') && raw.endsWith(')');
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[()]/g, '');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  const signed = isParenthesized ? -Math.abs(parsed) : parsed;
  return Math.round(signed * 100);
}

export function centsFromAccountingInput(value: string) {
  return parseMoneyToCents(value);
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }

  cells.push(cell.trim());
  return cells;
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseCsvDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, month, day, rawYear] = slashMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

const OUTFLOW_DESCRIPTION_PATTERN = /\b(ach debit|atm|charge|checkcard|debit|fee|freight|inventory|office depot|purchase|shipping|supplies|uline|withdrawal)\b/;
const INFLOW_DESCRIPTION_PATTERN = /\b(cash back|cashback|deposit|payout|refund|return|reversal)\b/;

function inferAccountingAmountSignMode({
  accountType,
  rows,
}: {
  accountType: AccountingAccountType;
  rows: Array<{ rawAmountCents: number; text: string }>;
}): Exclude<AccountingAmountSignMode, 'auto'> {
  let moneyOutPositiveScore = 0;
  let moneyOutNegativeScore = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    if (row.rawAmountCents > 0) positiveCount += 1;
    if (row.rawAmountCents < 0) negativeCount += 1;

    const text = normalizedText(row.text);
    const looksOutflow = OUTFLOW_DESCRIPTION_PATTERN.test(text);
    const looksInflow = INFLOW_DESCRIPTION_PATTERN.test(text);
    if (looksOutflow === looksInflow) continue;

    if (looksOutflow) {
      if (row.rawAmountCents > 0) moneyOutPositiveScore += 1;
      if (row.rawAmountCents < 0) moneyOutNegativeScore += 1;
    }

    if (looksInflow) {
      if (row.rawAmountCents < 0) moneyOutPositiveScore += 1;
      if (row.rawAmountCents > 0) moneyOutNegativeScore += 1;
    }
  }

  if (Math.abs(moneyOutPositiveScore - moneyOutNegativeScore) >= 2) {
    return moneyOutPositiveScore > moneyOutNegativeScore ? 'money_out_positive' : 'money_out_negative';
  }

  if (positiveCount > 0 && negativeCount === 0) return 'money_out_positive';
  if (negativeCount > 0 && positiveCount === 0) return 'money_out_negative';

  if (positiveCount - negativeCount >= 3 && positiveCount >= negativeCount * 1.75) return 'money_out_positive';
  if (negativeCount - positiveCount >= 3 && negativeCount >= positiveCount * 1.75) return 'money_out_negative';

  return accountType === 'bank' || accountType === 'debit_card' ? 'money_out_negative' : 'money_out_positive';
}

export function accountingTransactionFingerprint({
  accountName,
  amountCents,
  originalDescription,
  transactionDate,
}: {
  accountName: string | null;
  amountCents: number;
  originalDescription: string;
  transactionDate: string;
}) {
  return createHash('sha256')
    .update([
      accountName?.trim().toLowerCase() ?? '',
      transactionDate,
      String(amountCents),
      originalDescription.trim().toLowerCase().replace(/\s+/g, ' '),
    ].join('|'))
    .digest('hex');
}

export function accountingTransactionFingerprintForOccurrence(baseFingerprint: string, occurrence: number) {
  if (occurrence <= 1) return baseFingerprint;
  return createHash('sha256')
    .update(`${baseFingerprint}|occurrence:${occurrence}`)
    .digest('hex');
}

export function parseAccountingCsv({
  accountName,
  accountType,
  amountSign = 'auto',
  content,
}: {
  accountName?: string | null;
  accountType: AccountingAccountType;
  amountSign?: AccountingAmountSignMode;
  content: string;
}) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const dateIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.date);
  const descriptionIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.description);
  const merchantIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.merchant);
  const amountIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.amount);
  const categoryIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.category);
  const debitIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.debit);
  const creditIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.credit);
  const accountIndex = findHeaderIndex(headers, CSV_HEADER_ALIASES.accountName);

  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error('CSV must include date, description, and amount columns.');
  }

  const rawAmountRows = lines.slice(1).flatMap((line) => {
    const cells = splitCsvLine(line);
    const transactionDate = parseCsvDate(cells[dateIndex] ?? '');
    const originalDescription = String(cells[descriptionIndex] ?? '').trim();
    const rawAmountCents = amountIndex >= 0 ? parseMoneyToCents(cells[amountIndex]) : 0;
    if (!transactionDate || !originalDescription || !rawAmountCents) return [];
    return [{
      rawAmountCents,
      text: [
        originalDescription,
        merchantIndex >= 0 ? cells[merchantIndex] : '',
      ].join(' '),
    }];
  });
  const resolvedAmountSign = amountSign === 'auto'
    ? inferAccountingAmountSignMode({ accountType, rows: rawAmountRows })
    : amountSign;

  return lines.slice(1).flatMap((line): ParsedAccountingTransaction[] => {
    const cells = splitCsvLine(line);
    const transactionDate = parseCsvDate(cells[dateIndex] ?? '');
    const originalDescription = String(cells[descriptionIndex] ?? '').trim();
    if (!transactionDate || !originalDescription) return [];

    const debitCents = debitIndex >= 0 ? Math.abs(parseMoneyToCents(cells[debitIndex])) : 0;
    const creditCents = creditIndex >= 0 ? Math.abs(parseMoneyToCents(cells[creditIndex])) : 0;
    const rawAmountCents = amountIndex >= 0 ? parseMoneyToCents(cells[amountIndex]) : debitCents - creditCents;
    const amountCents = amountIndex >= 0 && resolvedAmountSign === 'money_out_negative' ? rawAmountCents * -1 : rawAmountCents;
    if (!amountCents) return [];

    const parsedAccountName = String(accountIndex >= 0 ? cells[accountIndex] : accountName ?? '').trim();
    const parsedCategoryName = String(categoryIndex >= 0 ? cells[categoryIndex] : '').trim();

    return [{
      accountName: parsedAccountName || accountName?.trim() || null,
      accountType,
      amountCents,
      ...(categoryIndex >= 0 ? { categoryName: parsedCategoryName || null } : {}),
      merchantName: merchantIndex >= 0 ? String(cells[merchantIndex] ?? '').trim() || null : null,
      originalDescription,
      transactionDate,
    }];
  });
}

function normalizedText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function categoryForTransaction(transaction: AccountingTransactionRow) {
  return relatedOne(transaction.accounting_categories);
}

function clampConfidence(value: unknown) {
  const parsed = normalizeAccountingNumber(value);
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function isAiFlagType(value: string): value is AiAccountingReviewFlag['flagType'] {
  return ['possible_duplicate', 'missing_category', 'possible_transfer', 'refund_or_credit', 'unusual_amount', 'vendor_review', 'other'].includes(value);
}

function isAiRecommendedAction(value: string): value is AiAccountingReviewFlag['recommendedAction'] {
  return ['categorize', 'exclude', 'split', 'verify_vendor', 'review'].includes(value);
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) return trimmed;
  return trimmed.slice(first, last + 1);
}

export function parseAiAccountingReviewResponse(text: string): AiAccountingReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    throw new Error('invalid_ai_accounting_review_json');
  }

  const flagsRaw = parsed && typeof parsed === 'object' && 'flags' in parsed
    ? (parsed as { flags?: unknown }).flags
    : null;
  if (!Array.isArray(flagsRaw)) return { flags: [] };

  const flags = flagsRaw.flatMap((flag): AiAccountingReviewFlag[] => {
    if (!flag || typeof flag !== 'object') return [];
    const row = flag as Record<string, unknown>;
    const transactionId = String(row.transactionId ?? '').trim();
    const reason = String(row.reason ?? '').trim();
    const rawFlagType = String(row.flagType ?? 'other').trim();
    const rawRecommendedAction = String(row.recommendedAction ?? 'review').trim();
    if (!transactionId || !reason) return [];

    return [{
      categorySuggestion: typeof row.categorySuggestion === 'string' ? row.categorySuggestion.trim() || null : null,
      confidence: clampConfidence(row.confidence),
      flagType: isAiFlagType(rawFlagType) ? rawFlagType : 'other',
      reason,
      recommendedAction: isAiRecommendedAction(rawRecommendedAction) ? rawRecommendedAction : 'review',
      transactionId,
    }];
  });

  return { flags };
}

export function buildAiAccountingReviewPrompt({
  candidates,
  categoryNames,
}: {
  candidates: AiAccountingReviewCandidate[];
  categoryNames: string[];
}) {
  return {
    input: [
      {
        role: 'developer' as const,
        content: [{ type: 'input_text' as const, text: AI_ACCOUNTING_REVIEW_PROMPT }],
      },
      {
        role: 'user' as const,
        content: [{
          type: 'input_text' as const,
          text: JSON.stringify({
            categories_available: categoryNames,
            prompt_version: AI_ACCOUNTING_REVIEW_PROMPT_VERSION,
            transactions: candidates,
          }),
        }],
      },
    ],
  };
}

export async function generateAiAccountingReview({
  apiKey,
  candidates,
  categoryNames,
  fetchImpl = fetch,
  model = AI_BUSINESS_OVERVIEW_DEFAULT_MODEL,
}: {
  apiKey: string | undefined;
  candidates: AiAccountingReviewCandidate[];
  categoryNames: string[];
  fetchImpl?: typeof fetch;
  model?: string;
}): Promise<{ flags: AiAccountingReviewFlag[]; model: string }> {
  if (!apiKey) throw new Error('missing_openai_api_key');
  if (!candidates.length) return { flags: [], model };

  const prompt = buildAiAccountingReviewPrompt({ candidates, categoryNames });
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    body: JSON.stringify({
      input: prompt.input,
      model,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) throw new Error('openai_request_failed');

  const payload = await response.json();
  const text = extractOpenAiResponseText(payload);
  if (!text) throw new Error('empty_openai_response');

  return { ...parseAiAccountingReviewResponse(text), model };
}

export function buildAccountingPnlTotals({
  transactions,
}: {
  transactions: AccountingTransactionRow[];
}): AccountingPnlTotals {
  let cardCogsCents = 0;
  let cardOperatingExpenseCents = 0;
  let otherExpenseCents = 0;
  let otherIncomeCents = 0;
  let revenueCents = 0;

  for (const transaction of transactions) {
    const category = categoryForTransaction(transaction);
    if (!category) continue;
    const amountCents = normalizeAccountingNumber(transaction.amount_cents);
    if (transaction.status === 'excluded') continue;

    if (category.pnl_section === 'cogs') cardCogsCents += amountCents;
    if (category.pnl_section === 'operating_expenses') cardOperatingExpenseCents += amountCents;
    if (category.pnl_section === 'other_expenses') otherExpenseCents += amountCents;
    if (category.pnl_section === 'revenue') revenueCents += -amountCents;
    if (category.pnl_section === 'other_income') otherIncomeCents += -amountCents;
  }

  const totalCogsCents = cardCogsCents;
  const totalOperatingExpenseCents = cardOperatingExpenseCents;
  const grossProfitCents = revenueCents - totalCogsCents;
  const operatingIncomeCents = grossProfitCents - totalOperatingExpenseCents;
  const netIncomeCents = operatingIncomeCents + otherIncomeCents - otherExpenseCents;

  return {
    cardCogsCents,
    cardOperatingExpenseCents,
    grossProfitCents,
    netIncomeCents,
    operatingIncomeCents,
    otherExpenseCents,
    otherIncomeCents,
    revenueCents,
  };
}
