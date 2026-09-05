import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const { loadEnvConfig } = nextEnv;

const inputPdfName = "Statement_082026_3632.pdf";
const pagesPath = path.resolve("tmp/accounting_statement_import/statement_082026_3632_pages.json");
const outputDir = path.resolve("outputs/accounting-capital-one-3632-2026-08-24");
const csvPath = path.join(outputDir, "capital_one_3632_2026-08-24_accounting_template.csv");
const workbookPath = path.join(outputDir, "capital_one_3632_2026-08-24_accounting_review.xlsx");
const inspectPath = `${workbookPath}.inspect.ndjson`;
const summaryPreviewPath = path.join(outputDir, "preview-summary.png");
const reviewPreviewPath = path.join(outputDir, "preview-review-flags.png");

const templateHeaders = [
  "Date",
  "Description",
  "Amount",
  "Merchant",
  "Account",
  "Likely Expense Category",
];

const accountName = "Capital One Spark Cash 3632";
const accountType = "credit_card";
const statementPeriod = "August 5-24, 2026";
const statementTotalCents = 296722;

function centsFromMoney(value) {
  return Math.round(Number(String(value).replace(/[$,]/g, "")) * 100);
}

function dollars(cents) {
  return cents / 100;
}

function moneyText(cents) {
  return dollars(cents).toFixed(2);
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function asDate(isoDate) {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function normalizeDescription(value) {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function transactionFingerprint({ account, date, amountCents, description }) {
  return crypto
    .createHash("sha256")
    .update([
      account.trim().toLowerCase(),
      date,
      String(amountCents),
      normalizeDescription(description),
    ].join("|"))
    .digest("hex");
}

function occurrenceFingerprint(baseFingerprint, occurrence) {
  if (occurrence <= 1) return baseFingerprint;
  return crypto
    .createHash("sha256")
    .update(`${baseFingerprint}|occurrence:${occurrence}`)
    .digest("hex");
}

function normalizedKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function monthDayToIso(value) {
  const match = String(value).trim().match(/^Aug\s+(\d{1,2})$/i);
  if (!match) throw new Error(`Unsupported statement date: ${value}`);
  return `2026-08-${match[1].padStart(2, "0")}`;
}

function merchantFor(description) {
  const text = normalizedKey(description);
  if (text.includes("pirate ship")) return "Pirate Ship";
  if (text.includes("fedex office")) return "FedEx Office";
  if (text.includes("kroger")) return "Kroger";
  if (text.includes("blackberry market")) return "Blackberry Market";
  if (text.includes("road ranger")) return "Road Ranger";
  if (text.includes("pit conference")) return "PIT Conference";
  if (text.includes("council on recover")) return "Council on Recovery";
  if (text.includes("wolfe street")) return "Wolfe Street Foundation";
  return description.trim();
}

function categoryFor(description) {
  const text = normalizedKey(description);
  if (text.includes("pirate ship")) return "Shipping Labels & Postage COGS";
  if (text.includes("fedex office")) return "Shipping Labels & Postage COGS";
  if (text.includes("kroger")) return "Food & Beverage Ingredients COGS";
  if (text.includes("blackberry market")) return "Business Meals & Entertainment";
  if (text.includes("road ranger")) return "Fuel & Auto";
  if (text.includes("pit conference")) return "Advertising & Marketing";
  if (text.includes("the council on recover")) return "Advertising & Marketing";
  if (text.includes("wolfe street")) return "Advertising & Marketing";
  return "";
}

function isRefundExpectedRemoval(row) {
  return (
    row.date === "2026-08-21" &&
    row.amountCents === 35000 &&
    normalizedKey(row.description) === "council on recovery houston tx"
  );
}

function suggestedCategoryFor(description, row = null) {
  if (row?.uploadAction === "remove") return "Removed from upload";
  const text = normalizedKey(description);
  if (text.includes("pit conference")) return "Conference/event";
  if (text.includes("council on recover")) return "Sponsorship/donation/event";
  if (text.includes("wolfe street")) return "Sponsorship/donation/event";
  return "";
}

function categoryReviewNote(row) {
  const text = normalizedKey(row.description);
  if (row.uploadAction === "remove") return "Removed per Zach: duplicate charge, refund expected.";
  if (!row.category) return "Needs category before upload.";
  if (text.includes("pit conference") || text.includes("council on recover") || text.includes("wolfe street")) {
    return "Mapped to Advertising & Marketing for marketing sponsorship.";
  }
  if (text.includes("kroger")) return "Mapped to food/ingredient COGS; confirm it was not a meal or personal item.";
  if (text.includes("blackberry market")) return "Mapped to business meals; confirm it was business-related.";
  if (text.includes("road ranger")) return "Mapped to fuel/auto based on merchant; confirm receipt if this was food only.";
  return "";
}

function parseStatementRows(pages) {
  const rows = [];
  const linePattern = /^(Aug\s+\d{1,2})\s+(Aug\s+\d{1,2})\s+(.+?)\s+\$([\d,]+\.\d{2})$/;

  for (const page of pages) {
    if (![3, 4].includes(page.page)) continue;
    for (const rawLine of String(page.text ?? "").split(/\r?\n/)) {
      const line = rawLine.trim();
      const match = line.match(linePattern);
      if (!match) continue;
      const [, transDate, postDate, description, amount] = match;
      if (description.startsWith("Total ")) continue;
      const amountCents = centsFromMoney(amount);
      rows.push({
        account: accountName,
        amountCents,
        category: categoryFor(description),
        date: monthDayToIso(transDate),
        description,
        merchant: merchantFor(description),
        postDate: monthDayToIso(postDate),
        suggestedCategory: suggestedCategoryFor(description),
      });
    }
  }

  const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
  if (rows.length !== 36) {
    throw new Error(`Expected 36 statement transactions; extracted ${rows.length}.`);
  }
  if (total !== statementTotalCents) {
    throw new Error(`Statement total mismatch: extracted ${moneyText(total)}, expected ${moneyText(statementTotalCents)}.`);
  }

  const occurrenceCounts = new Map();
  const statementRepeatCounts = new Map();
  for (const row of rows) {
    row.uploadAction = isRefundExpectedRemoval(row) ? "remove" : "upload";
    if (row.uploadAction === "remove") row.category = "";
    row.suggestedCategory = suggestedCategoryFor(row.description, row);
    const base = transactionFingerprint({
      account: row.account,
      amountCents: row.amountCents,
      date: row.date,
      description: row.description,
    });
    const repeatKey = `${row.date}|${row.amountCents}|${normalizeDescription(row.description)}`;
    statementRepeatCounts.set(repeatKey, (statementRepeatCounts.get(repeatKey) ?? 0) + 1);
    const occurrence = (occurrenceCounts.get(base) ?? 0) + 1;
    occurrenceCounts.set(base, occurrence);
    row.baseFingerprint = base;
    row.fingerprint = occurrenceFingerprint(base, occurrence);
    row.occurrence = occurrence;
    row.repeatKey = repeatKey;
  }
  for (const row of rows) {
    row.statementRepeatCount = statementRepeatCounts.get(row.repeatKey) ?? 1;
  }

  return rows;
}

async function fetchAccountingContext() {
  loadEnvConfig(process.cwd());
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment variables.");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const categoriesResult = await supabase
    .from("accounting_categories")
    .select("id,name,category_type,pnl_section,active")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (categoriesResult.error) throw categoriesResult.error;

  const transactions = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("accounting_transactions")
      .select("id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,transaction_fingerprint,accounting_categories(name,category_type,pnl_section),accounting_upload_batches(file_name,created_at)")
      .range(from, from + 999);
    if (error) throw error;
    transactions.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  return {
    categories: categoriesResult.data ?? [],
    transactions,
  };
}

function compareMerchant(row, transaction) {
  const rowMerchant = normalizedKey(row.merchant);
  const txMerchant = normalizedKey(transaction.merchant_name || transaction.original_description);
  const txDescription = normalizedKey(transaction.original_description);
  if (!rowMerchant) return false;
  return txMerchant.includes(rowMerchant) || txDescription.includes(rowMerchant);
}

function addDuplicateContext(rows, transactions) {
  const existingByFingerprint = new Map(
    transactions
      .filter((transaction) => transaction.transaction_fingerprint)
      .map((transaction) => [transaction.transaction_fingerprint, transaction]),
  );

  for (const row of rows) {
    const exact = existingByFingerprint.get(row.fingerprint) ?? null;
    const possible = transactions.filter((transaction) => (
      !exact &&
      transaction.transaction_date === row.date &&
      Number(transaction.amount_cents) === row.amountCents &&
      compareMerchant(row, transaction)
    ));
    row.exactDuplicate = exact;
    row.possibleMatches = possible;
    row.needsCategorization = row.uploadAction !== "remove" && !row.category;
  }
}

function existingDetails(transaction) {
  if (!transaction) return "";
  const categoryName = transaction.accounting_categories?.name ?? "Uncategorized";
  const batchFile = transaction.accounting_upload_batches?.file_name ?? "unknown batch";
  return `${transaction.id} | ${transaction.account_name ?? "No account"} | ${transaction.status} | ${categoryName} | ${batchFile}`;
}

function possibleDetails(matches) {
  if (!matches.length) return "";
  return matches
    .map((match) => `${match.id} | ${match.account_name ?? "No account"} | ${match.merchant_name ?? match.original_description} | ${match.status}`)
    .join("\n");
}

function duplicateNote(row) {
  if (row.exactDuplicate) return `Exact accounting fingerprint match: ${existingDetails(row.exactDuplicate)}`;
  if (row.possibleMatches.length) return `Same date, amount, and merchant appears in another accounting row.`;
  if (row.statementRepeatCount > 1) return `Repeated ${row.statementRepeatCount} times in this PDF with the same date, description, and amount; preserved because the statement total reconciles.`;
  return "";
}

function buildCsv(rows) {
  const uploadRows = rows.filter((row) => row.uploadAction !== "remove");
  const lines = [
    templateHeaders.join(","),
    ...uploadRows.map((row) => [
      row.date,
      row.description,
      moneyText(row.amountCents),
      row.merchant,
      row.account,
      row.category,
    ].map(csvEscape).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function applyTableHeader(range, fill = "#17365D") {
  range.format.fill.color = fill;
  range.format.font.color = "#FFFFFF";
  range.format.font.bold = true;
  range.format.horizontalAlignment = "center";
}

function buildWorkbook(rows, categories, transactions) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("Summary");
  const upload = workbook.worksheets.add("Upload Template");
  const flags = workbook.worksheets.add("Review Flags");
  const needs = workbook.worksheets.add("Needs Categorization");
  const sources = workbook.worksheets.add("Source Notes");

  for (const sheet of [summary, upload, flags, needs, sources]) {
    sheet.showGridLines = false;
  }

  const uploadRows = rows.filter((row) => row.uploadAction !== "remove");
  const removedRows = rows.filter((row) => row.uploadAction === "remove");
  const exactDuplicateCount = uploadRows.filter((row) => row.exactDuplicate).length;
  const possibleDuplicateCount = uploadRows.filter((row) => row.possibleMatches.length).length;
  const needsCategorizationCount = uploadRows.filter((row) => row.needsCategorization).length;
  const statementRepeatRowCount = rows.filter((row) => row.statementRepeatCount > 1).length;
  const outflowCents = rows.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const uploadOutflowCents = uploadRows.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const removedCents = removedRows.reduce((sum, row) => sum + row.amountCents, 0);
  const categorizedCents = uploadRows
    .filter((row) => row.category)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const uncategorizedCents = uploadRows
    .filter((row) => !row.category)
    .reduce((sum, row) => sum + row.amountCents, 0);

  summary.getRange("A1").values = [["Capital One 3632 Accounting Import"]];
  summary.getRange("A1").format.font.bold = true;
  summary.getRange("A1").format.font.size = 16;
  summary.getRange("A2").values = [[`${statementPeriod} | ${inputPdfName}`]];
  summary.getRange("A2").format.font.italic = true;
  summary.getRange("A4:B18").values = [
    ["Upload account", accountName],
    ["Upload account type", "Credit Card"],
    ["Statement rows extracted", rows.length],
    ["Rows in upload CSV", uploadRows.length],
    ["Statement total", dollars(outflowCents)],
    ["Upload CSV total", dollars(uploadOutflowCents)],
    ["Removed from upload", removedRows.length],
    ["Removed amount", dollars(removedCents)],
    ["Exact duplicates already in accounting", exactDuplicateCount],
    ["Possible cross-account matches", possibleDuplicateCount],
    ["Transactions needing category", needsCategorizationCount],
    ["Rows with repeated statement details", statementRepeatRowCount],
    ["Pre-categorized total", dollars(categorizedCents)],
    ["Uncategorized total", dollars(uncategorizedCents)],
    ["Existing accounting rows checked", transactions.length],
  ];
  summary.getRange("A4:A18").format.font.bold = true;
  summary.getRange("B6:B7").setNumberFormat("#,##0");
  summary.getRange("B8:B9").setNumberFormat("$#,##0.00");
  summary.getRange("B10").setNumberFormat("#,##0");
  summary.getRange("B11").setNumberFormat("$#,##0.00");
  summary.getRange("B12:B15").setNumberFormat("#,##0");
  summary.getRange("B16:B17").setNumberFormat("$#,##0.00");
  summary.getRange("B18").setNumberFormat("#,##0");
  summary.getRange("A4:B18").format.borders = { preset: "outside", style: "thin", color: "#A6A6A6" };

  summary.getRange("A20:E26").values = [
    ["Category", "Rows", "Amount", "Notes", ""],
    ["Advertising & Marketing", uploadRows.filter((row) => row.category === "Advertising & Marketing").length, dollars(uploadRows.filter((row) => row.category === "Advertising & Marketing").reduce((sum, row) => sum + row.amountCents, 0)), "Marketing sponsorship rows.", ""],
    ["Shipping Labels & Postage COGS", uploadRows.filter((row) => row.category === "Shipping Labels & Postage COGS").length, dollars(uploadRows.filter((row) => row.category === "Shipping Labels & Postage COGS").reduce((sum, row) => sum + row.amountCents, 0)), "Pirate Ship and FedEx Office shipping rows.", ""],
    ["Food & Beverage Ingredients COGS", uploadRows.filter((row) => row.category === "Food & Beverage Ingredients COGS").length, dollars(uploadRows.filter((row) => row.category === "Food & Beverage Ingredients COGS").reduce((sum, row) => sum + row.amountCents, 0)), "Kroger row; review if this was not ingredients.", ""],
    ["Business Meals & Entertainment", uploadRows.filter((row) => row.category === "Business Meals & Entertainment").length, dollars(uploadRows.filter((row) => row.category === "Business Meals & Entertainment").reduce((sum, row) => sum + row.amountCents, 0)), "Blackberry Market row.", ""],
    ["Fuel & Auto", uploadRows.filter((row) => row.category === "Fuel & Auto").length, dollars(uploadRows.filter((row) => row.category === "Fuel & Auto").reduce((sum, row) => sum + row.amountCents, 0)), "Road Ranger row.", ""],
    ["Needs category", needsCategorizationCount, dollars(uncategorizedCents), "Blank in the upload CSV so the app routes them to review.", ""],
  ];
  summary.tables.add("A20:E26", true, "SummaryByCategory");
  applyTableHeader(summary.getRange("A20:E20"), "#305496");
  summary.getRange("C21:C26").setNumberFormat("$#,##0.00");
  summary.getUsedRange().format.autofitColumns();
  summary.getRange("D:D").format.columnWidthPx = 440;

  upload.getRangeByIndexes(0, 0, 1, templateHeaders.length).values = [templateHeaders];
  upload.getRangeByIndexes(1, 0, uploadRows.length, templateHeaders.length).values = uploadRows.map((row) => [
    asDate(row.date),
    row.description,
    dollars(row.amountCents),
    row.merchant,
    row.account,
    row.category,
  ]);
  upload.tables.add(`A1:F${uploadRows.length + 1}`, true, "UploadTemplateTable");
  upload.freezePanes.freezeRows(1);
  applyTableHeader(upload.getRange("A1:F1"), "#17365D");
  upload.getRange(`A2:A${uploadRows.length + 1}`).setNumberFormat("yyyy-mm-dd");
  upload.getRange("C:C").setNumberFormat("$#,##0.00");
  upload.getUsedRange().format.autofitColumns();
  upload.getRange("B:B").format.columnWidthPx = 310;
  upload.getRange("F:F").format.columnWidthPx = 245;

  const flagHeaders = [
    ...templateHeaders,
    "Post Date",
    "Upload Action",
    "Exact Duplicate Already In System?",
    "Possible Existing Match?",
    "Needs Categorization?",
    "Statement Repeat?",
    "Suggested Category",
    "Review Note",
    "Existing Match Details",
    "Transaction Fingerprint",
  ];
  flags.getRangeByIndexes(0, 0, 1, flagHeaders.length).values = [flagHeaders];
  flags.getRangeByIndexes(1, 0, rows.length, flagHeaders.length).values = rows.map((row) => [
    asDate(row.date),
    row.description,
    dollars(row.amountCents),
    row.merchant,
    row.account,
    row.category,
    asDate(row.postDate),
    row.uploadAction === "remove" ? "Remove - refund expected" : "Upload",
    row.exactDuplicate ? "Yes" : "No",
    row.possibleMatches.length ? "Yes" : "No",
    row.needsCategorization ? "Yes" : "No",
    row.statementRepeatCount > 1 ? "Yes" : "No",
    row.suggestedCategory,
    [duplicateNote(row), categoryReviewNote(row)].filter(Boolean).join(" "),
    row.exactDuplicate ? existingDetails(row.exactDuplicate) : possibleDetails(row.possibleMatches),
    row.fingerprint,
  ]);
  flags.tables.add(`A1:P${rows.length + 1}`, true, "ReviewFlagsTable");
  flags.freezePanes.freezeRows(1);
  applyTableHeader(flags.getRange("A1:P1"), "#7F6000");
  flags.getRange(`A2:A${rows.length + 1}`).setNumberFormat("yyyy-mm-dd");
  flags.getRange(`G2:G${rows.length + 1}`).setNumberFormat("yyyy-mm-dd");
  flags.getRange("C:C").setNumberFormat("$#,##0.00");
  flags.getRange(`H2:H${rows.length + 1}`).conditionalFormats.add("containsText", {
    text: "Remove",
    format: { fill: { color: "#F4CCCC" }, font: { bold: true, color: "#9C0006" } },
  });
  flags.getRange(`I2:K${rows.length + 1}`).conditionalFormats.add("containsText", {
    text: "Yes",
    format: { fill: { color: "#FCE4D6" }, font: { bold: true, color: "#9C0006" } },
  });
  flags.getRange(`L2:L${rows.length + 1}`).conditionalFormats.add("containsText", {
    text: "Yes",
    format: { fill: { color: "#E2F0D9" }, font: { color: "#375623" } },
  });
  flags.getUsedRange().format.autofitColumns();
  flags.getRange("B:B").format.columnWidthPx = 320;
  flags.getRange("M:M").format.columnWidthPx = 300;
  flags.getRange("N:O").format.columnWidthPx = 420;
  flags.getRange("P:P").format.columnWidthPx = 360;
  flags.getRange("N:O").format.wrapText = true;

  const needsRows = rows.filter((row) => row.needsCategorization);
  const needsHeaders = [
    "Date",
    "Description",
    "Amount",
    "Merchant",
    "Account",
    "Possible Category",
    "Reason",
  ];
  needs.getRangeByIndexes(0, 0, 1, needsHeaders.length).values = [needsHeaders];
  if (needsRows.length) {
    needs.getRangeByIndexes(1, 0, needsRows.length, needsHeaders.length).values = needsRows.map((row) => [
      asDate(row.date),
      row.description,
      dollars(row.amountCents),
      row.merchant,
      row.account,
      row.suggestedCategory,
      "Needs category selection before upload.",
    ]);
    needs.tables.add(`A1:G${needsRows.length + 1}`, true, "NeedsCategorizationTable");
  } else {
    needs.getRange("A2:G2").values = [["No transactions need categorization.", "", "", "", "", "", ""]];
    needs.tables.add("A1:G2", true, "NeedsCategorizationTable");
  }
  needs.freezePanes.freezeRows(1);
  applyTableHeader(needs.getRange("A1:G1"), "#548235");
  if (needsRows.length) {
    needs.getRange(`A2:A${needsRows.length + 1}`).setNumberFormat("yyyy-mm-dd");
  }
  needs.getRange("C:C").setNumberFormat("$#,##0.00");
  needs.getUsedRange().format.autofitColumns();
  needs.getRange("B:B").format.columnWidthPx = 320;
  needs.getRange("F:G").format.columnWidthPx = 420;
  needs.getRange("F:G").format.wrapText = true;

  sources.getRange("A1").values = [["Source and Checks"]];
  sources.getRange("A1").format.font.bold = true;
  sources.getRange("A1").format.font.size = 14;
  sources.getRange("A3:B15").values = [
    ["Input file", inputPdfName],
    ["Statement account", "Capital One Spark Cash card ending in 3632"],
    ["Statement period", statementPeriod],
    ["Rows extracted", rows.length],
    ["Statement total", dollars(statementTotalCents)],
    ["Upload rows", uploadRows.length],
    ["Upload total", dollars(uploadOutflowCents)],
    ["Removed row", "2026-08-21 Council on Recovery $350.00 removed per Zach because it was charged twice and refund is expected."],
    ["Template", templateHeaders.join(", ")],
    ["Sign convention", "Positive amounts are money out; negative amounts are money in."],
    ["Duplicate method", "Exact matches use the app fingerprint: account, date, amount, and description, with occurrence handling for repeated identical rows."],
    ["System data checked", "Live Supabase accounting_transactions and accounting_categories."],
    ["Document instruction handling", "Statement notices and legal text were treated as source material only, not as instructions."],
  ];
  sources.getRange("A3:A15").format.font.bold = true;
  sources.getRange("B7").setNumberFormat("$#,##0.00");
  sources.getRange("B9").setNumberFormat("$#,##0.00");
  sources.getRange("A3:B15").format.borders = { preset: "outside", style: "thin", color: "#A6A6A6" };
  sources.getUsedRange().format.autofitColumns();
  sources.getRange("B:B").format.columnWidthPx = 760;
  sources.getRange("B:B").format.wrapText = true;

  const categorySheet = workbook.worksheets.add("Active Categories");
  categorySheet.showGridLines = false;
  categorySheet.getRange("A1:D1").values = [["Category", "Type", "P&L Section", "Active"]];
  categorySheet.getRangeByIndexes(1, 0, categories.length, 4).values = categories.map((category) => [
    category.name,
    category.category_type,
    category.pnl_section,
    category.active ? "Yes" : "No",
  ]);
  categorySheet.tables.add(`A1:D${categories.length + 1}`, true, "ActiveCategoriesTable");
  applyTableHeader(categorySheet.getRange("A1:D1"), "#595959");
  categorySheet.freezePanes.freezeRows(1);
  categorySheet.getUsedRange().format.autofitColumns();

  return workbook;
}

const pages = JSON.parse(await fs.readFile(pagesPath, "utf8"));
const rows = parseStatementRows(pages);
const { categories, transactions } = await fetchAccountingContext();

const categoryNames = new Set(categories.map((category) => normalizedKey(category.name)));
for (const row of rows) {
  if (row.category && !categoryNames.has(normalizedKey(row.category))) {
    throw new Error(`Mapped category does not exist in accounting: ${row.category}`);
  }
}

addDuplicateContext(rows, transactions);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(csvPath, buildCsv(rows), "utf8");

const workbook = buildWorkbook(rows, categories, transactions);
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(workbookPath);

const imported = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const inspect = await imported.inspect({
  kind: "workbook,sheet,table",
  maxChars: 16000,
  tableMaxRows: 8,
  tableMaxCols: 10,
  tableMaxCellChars: 100,
});
await fs.writeFile(inspectPath, inspect.ndjson, "utf8");

const errorScan = await imported.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
const summaryPreview = await imported.render({ sheetName: "Summary", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(summaryPreviewPath, new Uint8Array(await summaryPreview.arrayBuffer()));
const reviewPreview = await imported.render({ sheetName: "Review Flags", autoCrop: "all", scale: 0.75, format: "png" });
await fs.writeFile(reviewPreviewPath, new Uint8Array(await reviewPreview.arrayBuffer()));

const validation = {
  accountName,
  accountType,
  csvPath,
  exactDuplicateCount: rows.filter((row) => row.exactDuplicate).length,
  inspectPath,
  needsCategorization: rows
    .filter((row) => row.needsCategorization)
    .map((row) => ({
      amount: moneyText(row.amountCents),
      date: row.date,
      description: row.description,
      possibleCategory: row.suggestedCategory,
    })),
  needsCategorizationCount: rows.filter((row) => row.needsCategorization).length,
  possibleDuplicateCount: rows.filter((row) => row.possibleMatches.length).length,
  previewReviewPath: reviewPreviewPath,
  previewSummaryPath: summaryPreviewPath,
  statementTotal: moneyText(statementTotalCents),
  transactionCount: rows.length,
  workbookPath,
  formulaErrorScan: errorScan.ndjson,
};

console.log(JSON.stringify(validation, null, 2));
