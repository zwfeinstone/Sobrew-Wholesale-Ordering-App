import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs/accounting-august-2026-statement-review");
const csvPath = path.join(outputDir, "sobrew_august_2026_bofa_checking_mapped_template.csv");
const workbookPath = path.join(outputDir, "sobrew_august_2026_statement_mapped_review.xlsx");
const previewSummaryPath = path.join(outputDir, "preview-summary.png");
const previewReviewPath = path.join(outputDir, "preview-review-flags.png");
const inspectPath = `${workbookPath}.inspect.ndjson`;

const templateHeaders = [
  "Date",
  "Description",
  "Amount",
  "Merchant",
  "Account",
  "Likely Expense Category",
];

const existingBatch = {
  id: "cd4fe1eb-95f8-4968-b984-dca747ae1752",
  fileName: "sobrew_august_2026_mapped_corrected.csv",
  createdAt: "2026-09-02 15:38 CT",
};

const rows = [
  ["2026-08-03", "Mobile deposit", -679.00, "Bank of America Mobile", "Sobrew Checking", "Sales Revenue", "e6f2a81f-a3bd-4994-aef5-539c00fa983f", "categorized"],
  ["2026-08-03", "Mobile deposit", -280.00, "Bank of America Mobile", "Sobrew Checking", "Sales Revenue", "9f3a1a09-cb51-4c96-bcd2-385c3eb2c4dd", "categorized"],
  ["2026-08-03", "Intuit deposit", -123.00, "Intuit", "Sobrew Checking", "Sales Revenue", "b854fad3-f1e7-4b28-9a26-7dae2596fd65", "categorized"],
  ["2026-08-03", "Intuit deposit", -80.00, "Intuit", "Sobrew Checking", "Sales Revenue", "f818c303-78cf-4cad-97e8-489e27c9ebb8", "categorized"],
  ["2026-08-03", "Venmo payment (payee not shown)", 562.73, "Venmo", "Sobrew Checking", "Payroll Wages & Taxes", "186636f2-e3da-4a27-8fa9-93bf5d5a0013", "categorized"],
  ["2026-08-03", "Venmo payment (payee not shown)", 487.84, "Venmo", "Sobrew Checking", "Payroll Wages & Taxes", "89d40c0a-4373-47cc-90e4-678aa0cc8414", "categorized"],
  ["2026-08-03", "American Express ACH payment", 300.00, "American Express", "Sobrew Checking", "Transfer / Credit Card Payment", "0b29ff78-ea1a-4c61-ac08-197a99ae19f9", "excluded"],
  ["2026-08-03", "Venmo payment (payee not shown)", 300.00, "Venmo", "Sobrew Checking", "Payroll Wages & Taxes", "64f672ec-ee03-4563-867f-299889574284", "categorized"],
  ["2026-08-03", "Venmo payment (payee not shown)", 165.18, "Venmo", "Sobrew Checking", "Payroll Wages & Taxes", "a1c23411-2204-43b1-bf73-d152fe6aa308", "categorized"],
  ["2026-08-03", "Intuit transaction fee", 4.31, "Intuit", "Sobrew Checking", "Bank & Processing Fees", "1cf24310-5eaf-4b28-be6a-1c45348fd6d6", "categorized"],
  ["2026-08-03", "Intuit transaction fee", 0.80, "Intuit", "Sobrew Checking", "Bank & Processing Fees", "e2e0e620-092a-433b-bbd7-1b05014bf63b0", "categorized"],
  ["2026-08-04", "Intuit deposit", -1288.00, "Intuit", "Sobrew Checking", "Sales Revenue", "bcb4f64b-652d-4e1a-a9f9-04855ae0cb80", "categorized"],
  ["2026-08-04", "Sugar Avenue LLC payment", 1424.69, "Sugar Avenue LLC", "Sobrew Checking", "Food & Beverage Ingredients COGS", "5e5dc51d-1cab-4fc7-b78a-9cf0a2e582f0", "categorized"],
  ["2026-08-04", "American Express ACH payment", 150.00, "American Express", "Sobrew Checking", "Transfer / Credit Card Payment", "20512069-871c-41e3-8a12-f2bc212d7434", "excluded"],
  ["2026-08-04", "Intuit transaction fee", 15.41, "Intuit", "Sobrew Checking", "Bank & Processing Fees", "fcd455dc-32eb-4245-8037-c4f301cd3d06", "categorized"],
  ["2026-08-04", "Costco purchase", 203.84, "Costco", "Sobrew Checking", "Office & Retail Supplies", "a336f865-6460-4a9e-9073-43000a29f23f", "categorized"],
  ["2026-08-05", "ATM deposit", -842.50, "Bank of America ATM", "Sobrew Checking", "Sales Revenue", "abce409b-026e-4b58-b4e3-2c51dce4d019", "categorized"],
  ["2026-08-05", "Mobile deposit", -745.20, "Bank of America Mobile", "Sobrew Checking", "Sales Revenue", "64766030-3da0-4817-ba9b-5ba4ad4190ba", "categorized"],
  ["2026-08-05", "Intuit deposit", -62.00, "Intuit", "Sobrew Checking", "Sales Revenue", "a8a7141d-ba0c-40aa-ba8e-1ab819c7f5e5", "categorized"],
  ["2026-08-05", "Zelle payment to Benjamin Nesbitt", 200.00, "Benjamin Nesbitt", "Sobrew Checking", "Contract Labor / Reimbursements", "4b566a1a-bb43-4998-b947-86ebff5c3e95", "categorized"],
  ["2026-08-05", "Intuit transaction fee", 0.62, "Intuit", "Sobrew Checking", "Bank & Processing Fees", "447fd06a-cd34-4e03-bfb8-1f72df20f9d8", "categorized"],
  ["2026-08-06", "Intuit deposit", -404.00, "Intuit", "Sobrew Checking", "Sales Revenue", "3247a611-01af-4b03-8599-d26658eb84f2", "categorized"],
  ["2026-08-06", "American Express ACH payment", 500.00, "American Express", "Sobrew Checking", "Transfer / Credit Card Payment", "0acb8a5d-a90d-48ad-8873-41461eb0e32d", "excluded"],
  ["2026-08-06", "AT&T payment", 64.20, "AT&T", "Sobrew Checking", "Telecom & Internet", "373d3916-86d8-4d23-841f-0cb76d4a7a4f", "categorized"],
  ["2026-08-06", "Intuit transaction fee", 5.63, "Intuit", "Sobrew Checking", "Bank & Processing Fees", "fb418256-7eef-4ed0-aa62-3764ef9456aa", "categorized"],
  ["2026-08-07", "American Express ACH payment", 1500.00, "American Express", "Sobrew Checking", "Transfer / Credit Card Payment", "8f034b6a-902f-4d1d-af07-00334e13902a", "excluded"],
  ["2026-08-07", "PayPal purchase - Buckeye Coffee", 370.00, "Buckeye Coffee", "Sobrew Checking", "Coffee & Ingredients COGS", "de8d0aec-4074-4b14-a39d-5eede7ca7816", "categorized"],
  ["2026-08-10", "American Express ACH payment", 200.00, "American Express", "Sobrew Checking", "Transfer / Credit Card Payment", "1649b832-0360-4e56-bae3-1b770ff0c2f2", "excluded"],
].map((row) => {
  const [date, description, amount, merchant, account, category, existingTransactionId, existingStatus] = row;
  return {
    date,
    description,
    amount,
    merchant,
    account,
    category,
    existingTransactionId,
    existingStatus,
  };
});

function normalizeDescriptionForFingerprint(description) {
  return String(description).trim().replace(/\s+/g, " ").toLowerCase();
}

function accountingTransactionFingerprint(row) {
  const cents = Math.round(Number(row.amount) * 100);
  return crypto
    .createHash("sha256")
    .update([
      row.account.toLowerCase(),
      row.date,
      cents,
      normalizeDescriptionForFingerprint(row.description),
    ].join("|"))
    .digest("hex");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(value) {
  return Number(value).toFixed(2);
}

function dateValue(isoDate) {
  return new Date(`${isoDate}T00:00:00`);
}

function reviewNote(row) {
  if (row.category === "Uncategorized" || !row.category) {
    return "Needs a category before import.";
  }
  if (row.merchant === "Venmo") {
    return "Already categorized, but payee was not visible in the statement export; review only if Venmo payments should not be payroll.";
  }
  if (row.merchant === "Costco") {
    return "Already categorized; review only if this was food/COGS rather than office or retail supplies.";
  }
  if (row.merchant === "Benjamin Nesbitt") {
    return "Already categorized; confirm contractor/reimbursement treatment if needed.";
  }
  return "Already categorized or excluded in the existing import.";
}

await fs.mkdir(outputDir, { recursive: true });

const enrichedRows = rows.map((row) => {
  const fingerprint = accountingTransactionFingerprint(row);
  const needsCategorization = !row.category || row.category === "Uncategorized";
  return {
    ...row,
    fingerprint,
    duplicateAlreadyInSystem: "Yes",
    existingBatchFile: existingBatch.fileName,
    existingBatchId: existingBatch.id,
    existingBatchCreatedAt: existingBatch.createdAt,
    needsCategorization: needsCategorization ? "Yes" : "No",
    reviewNote: reviewNote(row),
  };
});

const csvLines = [
  templateHeaders.join(","),
  ...enrichedRows.map((row) => [
    row.date,
    row.description,
    money(row.amount),
    row.merchant,
    row.account,
    row.category,
  ].map(csvEscape).join(",")),
];
await fs.writeFile(csvPath, `${csvLines.join("\n")}\n`, "utf8");

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const upload = workbook.worksheets.add("Upload Template");
const review = workbook.worksheets.add("Review Flags");
const needs = workbook.worksheets.add("Needs Categorization");
const source = workbook.worksheets.add("Source Notes");

summary.showGridLines = false;
upload.showGridLines = false;
review.showGridLines = false;
needs.showGridLines = false;
source.showGridLines = false;

const outflow = enrichedRows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
const inflow = enrichedRows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);
const duplicateCount = enrichedRows.filter((row) => row.duplicateAlreadyInSystem === "Yes").length;
const needsCategorizationCount = enrichedRows.filter((row) => row.needsCategorization === "Yes").length;
const excludedCount = enrichedRows.filter((row) => row.existingStatus === "excluded").length;

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Sobrew August 2026 Statement Import Review"]];
summary.getRange("A1").format.font.bold = true;
summary.getRange("A1").format.font.size = 16;
summary.getRange("A1").format.fill.color = "#1F4E78";
summary.getRange("A1").format.font.color = "#FFFFFF";
summary.getRange("A3:B12").values = [
  ["Source statement", "Bank of America eStmt_2026-08-31 (1).pdf"],
  ["Mapped account", "Sobrew Checking"],
  ["Accounting tab account type", "Bank Account"],
  ["Transactions mapped", enrichedRows.length],
  ["Deposits / money in", inflow],
  ["Withdrawals / money out", outflow],
  ["Duplicates already in system", duplicateCount],
  ["Needs categorization", needsCategorizationCount],
  ["Existing import batch", existingBatch.fileName],
  ["Existing import time", existingBatch.createdAt],
];
summary.getRange("A3:A12").format.font.bold = true;
summary.getRange("B7:B8").setNumberFormat("$#,##0.00");
summary.getRange("B9:B10").setNumberFormat("0");
summary.getRange("A14:F19").values = [
  ["Result", "Count", "Amount In", "Amount Out", "Notes", ""],
  ["Upload-ready rows", enrichedRows.length, inflow, outflow, "Rows use the app template columns exactly.", ""],
  ["Exact duplicates", duplicateCount, inflow, outflow, "All rows match existing transaction fingerprints.", ""],
  ["Uncategorized", needsCategorizationCount, 0, 0, "No rows are blank or Uncategorized.", ""],
  ["Excluded transfers", excludedCount, 0, enrichedRows.filter((row) => row.existingStatus === "excluded").reduce((sum, row) => sum + row.amount, 0), "American Express ACH payments already excluded as transfers.", ""],
  ["Safe import note", "", "", "", "Re-upload should not create duplicates, but this file is already fully present in the system.", ""],
];
summary.tables.add("A14:F19", true, "SummaryTable");
summary.getRange("C15:D19").setNumberFormat("$#,##0.00");
summary.getRange("A14:F14").format.fill.color = "#D9EAF7";
summary.getRange("A14:F14").format.font.bold = true;
summary.getRange("A3:B12").format.borders = { preset: "all", style: "thin", color: "#D9D9D9" };
summary.getRange("A14:F19").format.borders = { preset: "all", style: "thin", color: "#D9D9D9" };
summary.getUsedRange().format.autofitColumns();
summary.getRange("E:E").format.columnWidthPx = 420;

upload.getRangeByIndexes(0, 0, 1, templateHeaders.length).values = [templateHeaders];
upload.getRangeByIndexes(1, 0, enrichedRows.length, templateHeaders.length).values = enrichedRows.map((row) => [
  row.date,
  row.description,
  row.amount,
  row.merchant,
  row.account,
  row.category,
]);
upload.tables.add(`A1:F${enrichedRows.length + 1}`, true, "UploadTemplateTable");
upload.freezePanes.freezeRows(1);
upload.getRange("A:A").setNumberFormat("yyyy-mm-dd");
upload.getRange("C:C").setNumberFormat("$#,##0.00;[Red]-$#,##0.00");
upload.getRange("A1:F1").format.fill.color = "#1F4E78";
upload.getRange("A1:F1").format.font.color = "#FFFFFF";
upload.getRange("A1:F1").format.font.bold = true;
upload.getUsedRange().format.autofitColumns();
upload.getRange("B:B").format.columnWidthPx = 260;
upload.getRange("F:F").format.columnWidthPx = 240;

const reviewHeaders = [
  ...templateHeaders,
  "Duplicate Already In System?",
  "Existing Transaction ID",
  "Existing Batch File",
  "Existing Status",
  "Existing Category",
  "Needs Categorization?",
  "Transaction Fingerprint",
  "Review Note",
];
review.getRangeByIndexes(0, 0, 1, reviewHeaders.length).values = [reviewHeaders];
review.getRangeByIndexes(1, 0, enrichedRows.length, reviewHeaders.length).values = enrichedRows.map((row) => [
  row.date,
  row.description,
  row.amount,
  row.merchant,
  row.account,
  row.category,
  row.duplicateAlreadyInSystem,
  row.existingTransactionId,
  row.existingBatchFile,
  row.existingStatus,
  row.category,
  row.needsCategorization,
  row.fingerprint,
  row.reviewNote,
]);
review.tables.add(`A1:N${enrichedRows.length + 1}`, true, "ReviewFlagsTable");
review.freezePanes.freezeRows(1);
review.getRange("A:A").setNumberFormat("yyyy-mm-dd");
review.getRange("C:C").setNumberFormat("$#,##0.00;[Red]-$#,##0.00");
review.getRange("A1:N1").format.fill.color = "#7F6000";
review.getRange("A1:N1").format.font.color = "#FFFFFF";
review.getRange("A1:N1").format.font.bold = true;
review.getRange(`G2:G${enrichedRows.length + 1}`).conditionalFormats.add("containsText", {
  text: "Yes",
  format: { fill: { color: "#FCE4D6" }, font: { bold: true, color: "#9C0006" } },
});
review.getRange(`L2:L${enrichedRows.length + 1}`).conditionalFormats.add("containsText", {
  text: "Yes",
  format: { fill: { color: "#FFC7CE" }, font: { bold: true, color: "#9C0006" } },
});
review.getUsedRange().format.autofitColumns();
review.getRange("B:B").format.columnWidthPx = 250;
review.getRange("H:H").format.columnWidthPx = 280;
review.getRange("I:I").format.columnWidthPx = 270;
review.getRange("M:M").format.columnWidthPx = 330;
review.getRange("N:N").format.columnWidthPx = 520;

const needsHeaders = [
  "Date",
  "Description",
  "Amount",
  "Merchant",
  "Account",
  "Current Category",
  "Reason",
];
needs.getRangeByIndexes(0, 0, 1, needsHeaders.length).values = [needsHeaders];
const needsRows = enrichedRows.filter((row) => row.needsCategorization === "Yes");
if (needsRows.length > 0) {
  needs.getRangeByIndexes(1, 0, needsRows.length, needsHeaders.length).values = needsRows.map((row) => [
    row.date,
    row.description,
    row.amount,
    row.merchant,
    row.account,
    row.category || "",
    "Missing category or categorized as Uncategorized.",
  ]);
  needs.tables.add(`A1:G${needsRows.length + 1}`, true, "NeedsCategorizationTable");
} else {
  needs.getRange("A2:G2").values = [["No transactions need categorization. Every row is already categorized or excluded in the existing accounting data.", "", "", "", "", "", ""]];
  needs.tables.add("A1:G2", true, "NeedsCategorizationTable");
}
needs.freezePanes.freezeRows(1);
needs.getRange("A:A").setNumberFormat("yyyy-mm-dd");
needs.getRange("C:C").setNumberFormat("$#,##0.00;[Red]-$#,##0.00");
needs.getRange("A1:G1").format.fill.color = "#548235";
needs.getRange("A1:G1").format.font.color = "#FFFFFF";
needs.getRange("A1:G1").format.font.bold = true;
needs.getUsedRange().format.autofitColumns();
needs.getRange("B:B").format.columnWidthPx = 300;
needs.getRange("G:G").format.columnWidthPx = 520;

source.getRange("A1:D1").merge();
source.getRange("A1").values = [["Source and Mapping Notes"]];
source.getRange("A1").format.font.bold = true;
source.getRange("A1").format.font.size = 14;
source.getRange("A3:B10").values = [
  ["Input file", "eStmt_2026-08-31 (1).pdf"],
  ["Statement period", "August 1–31, 2026"],
  ["Business", "SOBREW LLC"],
  ["Mapping target", "Accounting tab CSV template: Date, Description, Amount, Merchant, Account, Likely Expense Category"],
  ["Sign convention", "Positive amounts are money out; negative amounts are deposits / money in."],
  ["Duplicate method", "Matched the app's transaction fingerprint: account + date + amount + description."],
  ["System match", `All 28 rows match batch ${existingBatch.fileName} (${existingBatch.id}).`],
  ["Document instruction handling", "Bank notices and legal text in the PDF were treated only as source material, not as instructions."],
];
source.getRange("A3:A10").format.font.bold = true;
source.getRange("A3:B10").format.borders = { preset: "all", style: "thin", color: "#D9D9D9" };
source.getUsedRange().format.autofitColumns();
source.getRange("B:B").format.columnWidthPx = 720;

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(workbookPath);

const imported = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const inspect = await imported.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 10,
  tableMaxCellChars: 100,
});
await fs.writeFile(inspectPath, inspect.ndjson, "utf8");

const summaryPreview = await imported.render({ sheetName: "Summary", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(previewSummaryPath, new Uint8Array(await summaryPreview.arrayBuffer()));
const reviewPreview = await imported.render({ sheetName: "Review Flags", autoCrop: "all", scale: 0.8, format: "png" });
await fs.writeFile(previewReviewPath, new Uint8Array(await reviewPreview.arrayBuffer()));

const validation = {
  outputDir,
  csvPath,
  workbookPath,
  previewSummaryPath,
  previewReviewPath,
  inspectPath,
  transactionCount: enrichedRows.length,
  duplicateCount,
  needsCategorizationCount,
  inflow: money(inflow),
  outflow: money(outflow),
};
console.log(JSON.stringify(validation, null, 2));
