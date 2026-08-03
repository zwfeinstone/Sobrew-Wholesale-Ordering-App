import { usd } from '@/lib/utils';
import type {
  AccountingPnlStatement,
  AccountingPnlStatementDetailSection,
  AccountingPnlStatementTransaction,
} from '@/lib/accounting-pnl-statement';

type PdfFont = 'bold' | 'regular';
type PdfColor = [number, number, number];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const TOP_Y = 738;
const BOTTOM_Y = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const COLORS = {
  border: [0.82, 0.86, 0.91] as PdfColor,
  faint: [0.96, 0.98, 0.98] as PdfColor,
  muted: [0.39, 0.45, 0.55] as PdfColor,
  text: [0.06, 0.09, 0.16] as PdfColor,
  teal: [0.04, 0.47, 0.50] as PdfColor,
};

function asciiText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfText(value: unknown) {
  return asciiText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function pdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function colorCommand(color: PdfColor, operator: 'rg' | 'RG') {
  return `${color.map(pdfNumber).join(' ')} ${operator}`;
}

function estimateTextWidth(value: string, size: number, font: PdfFont = 'regular') {
  const factor = font === 'bold' ? 0.56 : 0.52;
  return asciiText(value).length * size * factor;
}

function wrapText(value: unknown, maxWidth: number, size: number, font: PdfFont = 'regular') {
  const words = asciiText(value).split(' ').filter(Boolean);
  if (!words.length) return [''];

  const lines: string[] = [];
  let current = '';
  const maxChars = Math.max(8, Math.floor(maxWidth / (size * (font === 'bold' ? 0.56 : 0.52))));

  for (const word of words) {
    const chunks = word.length > maxChars
      ? word.match(new RegExp(`.{1,${maxChars}}`, 'g')) ?? [word]
      : [word];

    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (estimateTextWidth(candidate, size, font) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = chunk;
      }
    }
  }

  if (current) lines.push(current);
  return lines;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

class SimplePdfDocument {
  private pages: string[][] = [];
  private y = TOP_Y;

  constructor() {
    this.addPage();
  }

  get currentY() {
    return this.y;
  }

  addPage() {
    this.pages.push([]);
    this.y = TOP_Y;
  }

  moveDown(points: number) {
    this.y -= points;
  }

  ensureSpace(points: number) {
    if (this.y - points >= BOTTOM_Y) return false;
    this.addPage();
    return true;
  }

  setY(value: number) {
    this.y = value;
  }

  textAt(
    text: unknown,
    x: number,
    y: number,
    {
      align = 'left',
      color = COLORS.text,
      font = 'regular',
      size = 10,
    }: {
      align?: 'center' | 'left' | 'right';
      color?: PdfColor;
      font?: PdfFont;
      size?: number;
    } = {},
  ) {
    const safeText = asciiText(text);
    const textWidth = estimateTextWidth(safeText, size, font);
    const drawX = align === 'right' ? x - textWidth : align === 'center' ? x - textWidth / 2 : x;
    const fontRef = font === 'bold' ? 'F2' : 'F1';
    this.push(
      `q ${colorCommand(color, 'rg')} BT /${fontRef} ${pdfNumber(size)} Tf 1 0 0 1 ${pdfNumber(drawX)} ${pdfNumber(y)} Tm (${escapePdfText(safeText)}) Tj ET Q`,
    );
  }

  textLine(
    text: unknown,
    {
      color = COLORS.text,
      font = 'regular',
      size = 10,
      x = MARGIN_X,
    }: {
      color?: PdfColor;
      font?: PdfFont;
      size?: number;
      x?: number;
    } = {},
  ) {
    this.ensureSpace(size + 8);
    this.textAt(text, x, this.y, { color, font, size });
    this.y -= size + 6;
  }

  textBlock(
    text: unknown,
    {
      color = COLORS.text,
      font = 'regular',
      lineHeight = 13,
      maxWidth = CONTENT_WIDTH,
      size = 10,
      x = MARGIN_X,
    }: {
      color?: PdfColor;
      font?: PdfFont;
      lineHeight?: number;
      maxWidth?: number;
      size?: number;
      x?: number;
    } = {},
  ) {
    const lines = wrapText(text, maxWidth, size, font);
    this.ensureSpace(lines.length * lineHeight + 4);
    for (const line of lines) {
      this.textAt(line, x, this.y, { color, font, size });
      this.y -= lineHeight;
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color = COLORS.border, width = 0.6) {
    this.push(
      `q ${colorCommand(color, 'RG')} ${pdfNumber(width)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S Q`,
    );
  }

  rect(x: number, y: number, width: number, height: number, color = COLORS.faint) {
    this.push(
      `q ${colorCommand(color, 'rg')} ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re f Q`,
    );
  }

  toUint8Array() {
    const pagesWithFooters = this.pages.map((commands, index) => {
      const footer = [
        `q ${colorCommand(COLORS.border, 'RG')} 0.5 w ${MARGIN_X} 36 m ${PAGE_WIDTH - MARGIN_X} 36 l S Q`,
        `q ${colorCommand(COLORS.muted, 'rg')} BT /F1 8 Tf 1 0 0 1 ${MARGIN_X} 24 Tm (Sobrew detailed P&L statement) Tj ET Q`,
        `q ${colorCommand(COLORS.muted, 'rg')} BT /F1 8 Tf 1 0 0 1 ${PAGE_WIDTH - MARGIN_X - 54} 24 Tm (Page ${index + 1} of ${this.pages.length}) Tj ET Q`,
      ];
      return [...commands, ...footer].join('\n');
    });

    const objects: string[] = [];
    const pageCount = pagesWithFooters.length;
    const pageObjectStart = 5;
    const contentObjectStart = pageObjectStart + pageCount;
    const pageObjectIds = pagesWithFooters.map((_, index) => pageObjectStart + index);

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    pagesWithFooters.forEach((content, index) => {
      const pageId = pageObjectStart + index;
      const contentId = contentObjectStart + index;
      objects[pageId] = [
        '<< /Type /Page',
        '/Parent 2 0 R',
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>',
        `/Contents ${contentId} 0 R`,
        '>>',
      ].join(' ');
      objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = byteLength(pdf);
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefOffset = byteLength(pdf);
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += '0000000000 65535 f \n';
    for (let id = 1; id < objects.length; id += 1) {
      pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new TextEncoder().encode(pdf);
  }

  private push(command: string) {
    this.pages[this.pages.length - 1].push(command);
  }
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function formatGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(value);
}

function money(value: number) {
  return usd(Math.abs(Math.round(value)));
}

function signedMoney(value: number) {
  const rounded = Math.round(value);
  return rounded < 0 ? `(${money(rounded)})` : money(rounded);
}

function expenseMoney(value: number) {
  const rounded = Math.round(value);
  return rounded < 0 ? money(rounded) : `(${money(rounded)})`;
}

function sectionAmount(sectionId: AccountingPnlStatementDetailSection['id'], value: number) {
  if (sectionId === 'cogs' || sectionId === 'operating_expenses' || sectionId === 'other_expenses') {
    return expenseMoney(value);
  }
  return signedMoney(value);
}

function heading(doc: SimplePdfDocument, label: string) {
  doc.ensureSpace(38);
  doc.moveDown(4);
  doc.textAt(label, MARGIN_X, doc.currentY, { color: COLORS.teal, font: 'bold', size: 12 });
  doc.moveDown(13);
  doc.line(MARGIN_X, doc.currentY, PAGE_WIDTH - MARGIN_X, doc.currentY, COLORS.border, 0.8);
  doc.moveDown(14);
}

function financialRow(
  doc: SimplePdfDocument,
  label: string,
  amount: string,
  {
    bold = false,
    shaded = false,
  }: {
    bold?: boolean;
    shaded?: boolean;
  } = {},
) {
  doc.ensureSpace(24);
  if (shaded) doc.rect(MARGIN_X - 4, doc.currentY - 6, CONTENT_WIDTH + 8, 19, COLORS.faint);
  doc.textAt(label, MARGIN_X, doc.currentY, { font: bold ? 'bold' : 'regular', size: bold ? 10.5 : 10 });
  doc.textAt(amount, PAGE_WIDTH - MARGIN_X, doc.currentY, { align: 'right', font: bold ? 'bold' : 'regular', size: bold ? 10.5 : 10 });
  doc.moveDown(18);
}

function renderSummary(doc: SimplePdfDocument, statement: AccountingPnlStatement) {
  heading(doc, 'Summary');
  financialRow(doc, 'Revenue', signedMoney(statement.basePnl.revenueCents), { bold: true, shaded: true });
  financialRow(doc, 'Adjusted COGS', expenseMoney(statement.adjustedPnl.cogsCents));
  financialRow(doc, 'Gross Profit', signedMoney(statement.adjustedPnl.grossProfitCents), { bold: true });
  financialRow(doc, 'Adjusted Operating Expenses', expenseMoney(statement.adjustedPnl.operatingExpenseCents));
  financialRow(doc, 'Operating Income', signedMoney(statement.adjustedPnl.operatingIncomeCents), { bold: true });
  financialRow(doc, 'Other Income', signedMoney(statement.basePnl.otherIncomeCents));
  financialRow(doc, 'Other Expense', expenseMoney(statement.basePnl.otherExpenseCents));
  financialRow(doc, 'Net Income', signedMoney(statement.adjustedPnl.netIncomeCents), { bold: true, shaded: true });
}

function renderCoreStatement(doc: SimplePdfDocument, statement: AccountingPnlStatement) {
  heading(doc, 'Profit And Loss Statement');
  financialRow(doc, 'Wholesale Sales', signedMoney(statement.wholesaleSalesCents));
  financialRow(doc, 'Retail Sales', signedMoney(statement.retailSalesCents));
  financialRow(doc, 'Total Revenue', signedMoney(statement.basePnl.revenueCents), { bold: true, shaded: true });
  financialRow(doc, 'Uploaded COGS', expenseMoney(statement.basePnl.cardCogsCents));
  financialRow(doc, 'Labor COGS Adjustment', expenseMoney(statement.laborCogsCents));
  financialRow(doc, 'Adjusted COGS', expenseMoney(statement.adjustedPnl.cogsCents), { bold: true });
  financialRow(doc, 'Adjusted Gross Profit', signedMoney(statement.adjustedPnl.grossProfitCents), { bold: true, shaded: true });
  financialRow(doc, 'Uploaded Operating Expenses', expenseMoney(statement.basePnl.cardOperatingExpenseCents));
  financialRow(doc, 'Less: Labor COGS Moved Out Of OpEx', signedMoney(statement.laborReclassCents));
  financialRow(doc, 'Adjusted Operating Expenses', expenseMoney(statement.adjustedPnl.operatingExpenseCents), { bold: true });
  financialRow(doc, 'Operating Income', signedMoney(statement.adjustedPnl.operatingIncomeCents), { bold: true, shaded: true });
  financialRow(doc, 'Other Income', signedMoney(statement.basePnl.otherIncomeCents));
  financialRow(doc, 'Other Expense', expenseMoney(statement.basePnl.otherExpenseCents));
  financialRow(doc, 'Net Income', signedMoney(statement.adjustedPnl.netIncomeCents), { bold: true, shaded: true });
}

function renderOperatingNotes(doc: SimplePdfDocument, statement: AccountingPnlStatement) {
  heading(doc, 'Labor And Review Notes');
  doc.textBlock(
    `Labor COGS source: ${statement.laborCogsSourceLabel}. ${money(statement.laborReclassCents)} was moved out of Payroll/Owner Pay operating expense so net income is not double-counted.`,
    { color: COLORS.muted, lineHeight: 13, size: 9.5 },
  );
  doc.moveDown(8);
  financialRow(doc, 'Imported Rows Needing Review', String(statement.needsReviewCount));
  financialRow(doc, 'AI Flagged Rows', String(statement.aiFlaggedCount));
  financialRow(doc, 'Total Labor Tagged', signedMoney(statement.payrollLaborSummary.totalLaborCents));
  financialRow(doc, 'Production Labor COGS', expenseMoney(statement.laborCogsCents));
  financialRow(doc, 'Sales/Admin/Owner/Other Labor', expenseMoney(statement.salesAdminOtherLaborCents));

  if (statement.payrollLaborSummary.byWorkType.length) {
    doc.moveDown(4);
    statement.payrollLaborSummary.byWorkType.forEach((row) => {
      financialRow(doc, row.label, expenseMoney(row.amountCents));
    });
  }
}

function renderCategoryBreakdown(doc: SimplePdfDocument, statement: AccountingPnlStatement) {
  if (!statement.categoryBreakdown.length) return;
  heading(doc, 'Category Detail');

  for (const section of statement.categoryBreakdown) {
    doc.ensureSpace(34);
    doc.textAt(section.label, MARGIN_X, doc.currentY, { color: COLORS.muted, font: 'bold', size: 9 });
    doc.moveDown(14);
    section.rows.forEach((row) => {
      financialRow(doc, row.label, sectionAmount(section.id, row.totalCents));
    });
    doc.moveDown(4);
  }
}

function tableHeader(doc: SimplePdfDocument) {
  doc.ensureSpace(22);
  doc.rect(MARGIN_X - 4, doc.currentY - 6, CONTENT_WIDTH + 8, 18, COLORS.faint);
  doc.textAt('Date', MARGIN_X, doc.currentY, { color: COLORS.muted, font: 'bold', size: 8.5 });
  doc.textAt('Description', MARGIN_X + 74, doc.currentY, { color: COLORS.muted, font: 'bold', size: 8.5 });
  doc.textAt('Account', MARGIN_X + 324, doc.currentY, { color: COLORS.muted, font: 'bold', size: 8.5 });
  doc.textAt('Amount', PAGE_WIDTH - MARGIN_X, doc.currentY, { align: 'right', color: COLORS.muted, font: 'bold', size: 8.5 });
  doc.moveDown(18);
}

function renderTransactionRow(
  doc: SimplePdfDocument,
  transaction: AccountingPnlStatementTransaction,
  sectionId: AccountingPnlStatementDetailSection['id'],
) {
  const descriptionLines = wrapText(transaction.description, 236, 8.5);
  const accountLines = wrapText(transaction.accountName || 'Manual', 104, 8.5);
  const lineCount = Math.max(descriptionLines.length, accountLines.length, 1);
  const rowHeight = lineCount * 10 + 8;
  doc.ensureSpace(rowHeight);

  const top = doc.currentY;
  doc.textAt(formatDate(transaction.date), MARGIN_X, top, { color: COLORS.muted, size: 8.5 });
  descriptionLines.forEach((line, index) => {
    doc.textAt(line, MARGIN_X + 74, top - index * 10, { size: 8.5 });
  });
  accountLines.forEach((line, index) => {
    doc.textAt(line, MARGIN_X + 324, top - index * 10, { color: COLORS.muted, size: 8.5 });
  });
  doc.textAt(sectionAmount(sectionId, transaction.amountCents), PAGE_WIDTH - MARGIN_X, top, { align: 'right', size: 8.5 });
  doc.moveDown(rowHeight);
  doc.line(MARGIN_X, doc.currentY + 4, PAGE_WIDTH - MARGIN_X, doc.currentY + 4, COLORS.border, 0.4);
}

function renderTransactionDetail(doc: SimplePdfDocument, statement: AccountingPnlStatement) {
  if (!statement.detailSections.some((section) => section.rows.some((row) => row.transactions.length))) return;
  heading(doc, 'Transaction Detail');

  for (const section of statement.detailSections) {
    for (const row of section.rows) {
      if (!row.transactions.length) continue;
      doc.ensureSpace(48);
      doc.textAt(section.label, MARGIN_X, doc.currentY, { color: COLORS.muted, font: 'bold', size: 8.5 });
      doc.textAt(row.label, MARGIN_X, doc.currentY - 13, { font: 'bold', size: 10 });
      doc.textAt(sectionAmount(section.id, row.totalCents), PAGE_WIDTH - MARGIN_X, doc.currentY - 13, { align: 'right', font: 'bold', size: 10 });
      doc.moveDown(32);
      tableHeader(doc);
      row.transactions.forEach((transaction) => {
        if (doc.ensureSpace(24)) tableHeader(doc);
        renderTransactionRow(doc, transaction, section.id);
      });
      doc.moveDown(10);
    }
  }
}

export function createAccountingPnlPdf({
  generatedAt = new Date(),
  period,
  statement,
}: {
  generatedAt?: Date;
  period: { end: string; start: string };
  statement: AccountingPnlStatement;
}) {
  const doc = new SimplePdfDocument();
  doc.textAt('Sobrew', MARGIN_X, doc.currentY, { color: COLORS.teal, font: 'bold', size: 11 });
  doc.moveDown(22);
  doc.textAt('Detailed Profit And Loss Statement', MARGIN_X, doc.currentY, { font: 'bold', size: 20 });
  doc.moveDown(22);
  doc.textAt(`${formatDate(period.start)} to ${formatDate(period.end)}`, MARGIN_X, doc.currentY, { color: COLORS.muted, size: 10.5 });
  doc.textAt(`Generated ${formatGeneratedAt(generatedAt)}`, PAGE_WIDTH - MARGIN_X, doc.currentY, { align: 'right', color: COLORS.muted, size: 8.5 });
  doc.moveDown(20);
  doc.line(MARGIN_X, doc.currentY, PAGE_WIDTH - MARGIN_X, doc.currentY, COLORS.border, 0.8);
  doc.moveDown(18);

  renderSummary(doc, statement);
  renderCoreStatement(doc, statement);
  renderOperatingNotes(doc, statement);
  renderCategoryBreakdown(doc, statement);
  renderTransactionDetail(doc, statement);

  if (!statement.detailSections.length) {
    heading(doc, 'Transaction Detail');
    doc.textBlock('No categorized accounting activity was found for this period.', { color: COLORS.muted, size: 10 });
  }

  return doc.toUint8Array();
}
