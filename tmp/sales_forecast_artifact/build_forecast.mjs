import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/zachfeinstone/Desktop/Sobrew-Wholesale-Ordering-App";
const results = JSON.parse(await fs.readFile(path.join(root, "tmp/sales_forecast_results.json"), "utf8"));
const outputDir = path.join(root, "outputs/01a026b4-d5dd-7be2-bf1e-ec4d096cc662");
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Executive Summary");
const history = workbook.worksheets.add("Historical Actuals");
const assumptions = workbook.worksheets.add("Assumptions");
const forecast = workbook.worksheets.add("Forecast Model");
const validation = workbook.worksheets.add("Model Validation");
const sources = workbook.worksheets.add("Sources & Checks");

const C = {
  navy: "#0F2747",
  teal: "#0E7490",
  blue: "#2563EB",
  green: "#0F766E",
  darkGreen: "#166534",
  orange: "#D97706",
  red: "#B91C1C",
  slate: "#475569",
  ink: "#111827",
  muted: "#64748B",
  line: "#CBD5E1",
  paleBlue: "#EAF2F8",
  paleTeal: "#E6F6F6",
  paleGreen: "#DCFCE7",
  paleOrange: "#FFF7ED",
  paleYellow: "#FFFBE6",
  paleRed: "#FEE2E2",
  white: "#FFFFFF",
  soft: "#F8FAFC",
};

const moneyFmt = '$#,##0;[Red]($#,##0);-';
const money1Fmt = '$#,##0.0;[Red]($#,##0.0);-';
const pctFmt = '0.0%;[Red](0.0%);-';
const countFmt = '#,##0;[Red](#,##0);-';
const decimalFmt = '#,##0.0;[Red](#,##0.0);-';

function titleBand(sheet, title, subtitle, endCol) {
  sheet.mergeCells(`A1:${endCol}1`);
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${endCol}1`).format = {
    fill: C.navy,
    font: { bold: true, color: C.white, size: 18 },
    verticalAlignment: "center",
  };
  sheet.getRange("1:1").format.rowHeight = 30;
  sheet.mergeCells(`A2:${endCol}2`);
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = {
    fill: C.paleBlue,
    font: { color: C.slate, size: 10 },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("2:2").format.rowHeight = 28;
}

function header(range) {
  range.format = {
    fill: C.navy,
    font: { bold: true, color: C.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: C.navy },
  };
}

function section(range) {
  range.format = {
    fill: C.teal,
    font: { bold: true, color: C.white, size: 11 },
    verticalAlignment: "center",
  };
}

function setColumnWidths(sheet, widths) {
  for (const [col, width] of Object.entries(widths)) {
    sheet.getRange(`${col}:${col}`).format.columnWidth = width;
  }
}

function monthDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

for (const sheet of [summary, history, assumptions, forecast, validation, sources]) {
  sheet.showGridLines = false;
}

// Historical Actuals
titleBand(
  history,
  "Historical Sales & Operating Drivers",
  "Primary revenue basis: standard orders with status Shipped; recognized on shipped_at (created_at fallback), America/Chicago. August is MTD through Aug 21, 2026.",
  "O",
);
history.getRange("A4:O4").values = [[
  "Month", "Period", "Cash sales receipts", "Portal shipped revenue", "Shipped orders",
  "Active customers", "New customers", "Average order value", "Orders / active customer",
  "Recurring revenue", "Top 5 customer share", "Gross margin", "Orders using estimated COGS",
  "Cash MoM", "Shipment MoM",
]];
header(history.getRange("A4:O4"));

const historyRows = [
  [monthDate("2026-01-01"), "Full month", 4898.48, null, null, null, null, null, null, null, null, null, null],
  [monthDate("2026-02-01"), "Full month", 4632.68, 350.00, 11, 1, 1, 31.82, 11.00, null, 1.000, 0.343, 7 / 11],
  [monthDate("2026-03-01"), "Full month", 3853.03, 2095.00, 51, 5, 4, 41.08, 10.20, null, 1.000, 0.210, 1.000],
  [monthDate("2026-04-01"), "Full month", 6656.15, 5692.01, 45, 25, 21, 126.49, 1.80, null, 0.364, 0.423, 1.000],
  [monthDate("2026-05-01"), "Full month", 8319.26, 11710.09, 57, 35, 13, 205.44, 1.63, null, 0.396, 0.390, 1.000],
  [monthDate("2026-06-01"), "Full month", 11722.24, 11604.79, 54, 36, 9, 214.90, 1.50, null, 0.391, 0.407, 51 / 54],
  [monthDate("2026-07-01"), "Full month", 15484.04, 15215.59, 66, 38, 9, 230.54, 1.74, 0.212, 0.434, 0.250, 14 / 66],
  [monthDate("2026-08-01"), "MTD to Aug 21", null, 11555.40, 52, 38, 9, 222.22, 1.37, 0.209, 0.348, 0.239, 5 / 52],
];
history.getRange("A5:M12").values = historyRows;
for (let row = 5; row <= 12; row += 1) {
  history.getRange(`N${row}`).formulas = [[row === 5 || row === 12 ? '=""' : `=IFERROR(C${row}/C${row - 1}-1,"")`]];
  history.getRange(`O${row}`).formulas = [[row <= 6 || row === 12 ? '=""' : `=IFERROR(D${row}/D${row - 1}-1,"")`]];
}
history.getRange("A5:O12").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
history.getRange("A5:A12").format.numberFormat = "mmm yyyy";
history.getRange("C5:D12").format.numberFormat = moneyFmt;
history.getRange("E5:G12").format.numberFormat = countFmt;
history.getRange("H5:H12").format.numberFormat = money1Fmt;
history.getRange("I5:I12").format.numberFormat = "0.00x";
history.getRange("J5:O12").format.numberFormat = pctFmt;
history.getRange("A12:O12").format.fill = C.paleYellow;
history.mergeCells("A15:O15");
history.getRange("A15").values = [["Interpretation notes"]];
section(history.getRange("A15:O15"));
history.mergeCells("A16:O17");
history.getRange("A16").values = [[
  "Cash receipts and shipped revenue are different timing measures, but they converge as the portal matures: June receipts were $11.72K vs $11.60K shipped, and July receipts were $15.48K vs $15.22K shipped. Gross-margin comparisons are not fully like-for-like because estimated COGS coverage fell from 100% in May to 21% in July and 10% in August as actual costs replaced estimates.",
]];
history.getRange("A16:O17").format = { fill: C.soft, font: { color: C.slate }, wrapText: true, verticalAlignment: "top" };
history.getRange("16:17").format.rowHeight = 28;
history.freezePanes.freezeRows(4);
history.freezePanes.freezeColumns(2);
setColumnWidths(history, { A: 13, B: 17, C: 17, D: 18, E: 14, F: 15, G: 13, H: 17, I: 18, J: 16, K: 18, L: 14, M: 20, N: 12, O: 13 });

// Assumptions
titleBand(
  assumptions,
  "Scenario Assumptions",
  "Blue cells are editable scenario inputs. The normal case uses recent operating medians; conservative and aggressive cases use observed lower/upper operating performance, not arbitrary percentage haircuts.",
  "E",
);
assumptions.getRange("A4:E4").values = [["Driver", "Conservative", "Normal", "Aggressive", "Basis / rationale"]];
header(assumptions.getRange("A4:E4"));
const assumptionRows = [
  ["Starting monthly active customers", 42, 42, 42, "August MTD active customers were 38; four incremental active customers assumed by month-end."],
  ["Monthly logo retention", 0.74, 0.78, 0.84, "Observed May-July: 84.0%, 71.4%, and 77.8%."],
  ["New customers / month", 7, 9, 12, "Recent actuals: 13 in May, 9 in June, 9 in July; upside is supported—but not guaranteed—by pipeline."],
  ["Reactivated customers / month", 1, 1.5, 2, "Observed reactivation began as the customer base matured."],
  ["Orders / active customer", 1.55, 1.65, 1.72, "May-July actuals: 1.63x, 1.50x, and 1.74x."],
  ["Starting average order value", 214, 223, 232, "May-July AOV: $205, $215, and $231."],
  ["Monthly AOV growth", 0.000, 0.002, 0.004, "No price increase assumed in downside; upside requires favorable price/mix."],
  ["Recurring revenue floor / month", results.assumptions.normal.recurring_floor, results.assumptions.normal.recurring_floor, results.assumptions.normal.recurring_floor, "15 active schedules annualized by their 2-, 3-, and 4-week frequencies."],
  ["Time-series blend weight", 0.55, 0.55, 0.55, "Slightly favors observed weekly shipments because the driver history is young."],
  ["Driver-model blend weight", 0.45, 0.45, 0.45, "Balances customer mechanics against recent run-rate behavior."],
  ["Estimated company YTD through Aug 21", results.company_bridge.estimated_company_ytd_through_2026_08_21, results.company_bridge.estimated_company_ytd_through_2026_08_21, results.company_bridge.estimated_company_ytd_through_2026_08_21, "QuickBooks YTD through Aug 5 plus portal shipments from Aug 6-21; not an audited close."],
  ["Forecast Aug 22-31 revenue", results.summary.conservative.aug_remaining, results.summary.normal.aug_remaining, results.summary.aggressive.aug_remaining, "Six remaining business days, scaled from the time-series scenario path."],
];
assumptions.getRange("A5:E16").values = assumptionRows;
assumptions.getRange("A5:E16").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
assumptions.getRange("B5:D16").format = { fill: C.paleYellow, font: { color: "#0000FF" } };
assumptions.getRange("B5:D5").format.numberFormat = countFmt;
assumptions.getRange("B6:D6").format.numberFormat = pctFmt;
assumptions.getRange("B7:D8").format.numberFormat = decimalFmt;
assumptions.getRange("B9:D9").format.numberFormat = "0.00x";
assumptions.getRange("B10:D10").format.numberFormat = moneyFmt;
assumptions.getRange("B11:D11").format.numberFormat = pctFmt;
assumptions.getRange("B12:D12").format.numberFormat = moneyFmt;
assumptions.getRange("B13:D14").format.numberFormat = pctFmt;
assumptions.getRange("B15:D16").format.numberFormat = moneyFmt;
assumptions.getRange("E5:E16").format = { wrapText: true, font: { color: C.slate } };
assumptions.mergeCells("A19:E19");
assumptions.getRange("A19").values = [["Color legend"]];
section(assumptions.getRange("A19:E19"));
assumptions.getRange("A20:E21").values = [
  ["Blue text / yellow fill", "Editable assumptions", null, null, "Change these cells to test a different operating plan."],
  ["Green text", "Imported model output / cross-sheet link", null, null, "Derived forecast calculations remain formula-driven."],
];
assumptions.getRange("A20:E21").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
assumptions.getRange("A20").format = { fill: C.paleYellow, font: { color: "#0000FF" } };
assumptions.getRange("A21").format.font = { color: "#008000" };
assumptions.freezePanes.freezeRows(4);
setColumnWidths(assumptions, { A: 32, B: 16, C: 16, D: 16, E: 72 });

// Forecast Model
titleBand(
  forecast,
  "Monthly Revenue Forecast",
  "Forecast horizon: September 2026-December 2027. The first 12 months (Sep 2026-Aug 2027) are the primary forecast; the remaining four months support a full CY2027 view and carry lower confidence.",
  "Q",
);
forecast.getRange("A4:Q4").values = [[
  "Month", "Business days", "Time series: low", "Time series: base", "Time series: high",
  "Cons. active customers", "Cons. driver revenue", "Base active customers", "Base driver revenue",
  "Agg. active customers", "Agg. driver revenue", "Conservative", "Normal", "Aggressive",
  "Statistical P10", "Statistical P90", "Scenario order check",
]];
header(forecast.getRange("A4:Q4"));
const forecastDates = results.forecast_months.map(monthDate);
const forecastBaseValues = forecastDates.map((d, i) => [
  d,
  businessDays(d),
  results.time_series_monthly.p20[i],
  results.time_series_monthly.p50[i],
  results.time_series_monthly.p80[i],
  null, null, null, null, null, null, null, null, null,
  results.uncertainty.monthly_p10[i],
  results.uncertainty.monthly_p90[i],
  null,
]);
forecast.getRange("A5:Q20").values = forecastBaseValues;
for (let i = 0; i < 16; i += 1) {
  const row = 5 + i;
  const priorCons = i === 0 ? "'Assumptions'!$B$5" : `F${row - 1}`;
  const priorBase = i === 0 ? "'Assumptions'!$C$5" : `H${row - 1}`;
  const priorAgg = i === 0 ? "'Assumptions'!$D$5" : `J${row - 1}`;
  const monthPower = i + 1;
  forecast.getRange(`F${row}:N${row}`).formulas = [[
    `=${priorCons}*'Assumptions'!$B$6+'Assumptions'!$B$7+'Assumptions'!$B$8`,
    `=MAX(F${row}*'Assumptions'!$B$9*'Assumptions'!$B$10*(1+'Assumptions'!$B$11)^${monthPower},'Assumptions'!$B$12)`,
    `=${priorBase}*'Assumptions'!$C$6+'Assumptions'!$C$7+'Assumptions'!$C$8`,
    `=MAX(H${row}*'Assumptions'!$C$9*'Assumptions'!$C$10*(1+'Assumptions'!$C$11)^${monthPower},'Assumptions'!$C$12)`,
    `=${priorAgg}*'Assumptions'!$D$6+'Assumptions'!$D$7+'Assumptions'!$D$8`,
    `=MAX(J${row}*'Assumptions'!$D$9*'Assumptions'!$D$10*(1+'Assumptions'!$D$11)^${monthPower},'Assumptions'!$D$12)`,
    `=C${row}*'Assumptions'!$B$13+G${row}*'Assumptions'!$B$14`,
    `=D${row}*'Assumptions'!$C$13+I${row}*'Assumptions'!$C$14`,
    `=E${row}*'Assumptions'!$D$13+K${row}*'Assumptions'!$D$14`,
  ]];
  forecast.getRange(`Q${row}`).formulas = [[`=IF(AND(L${row}<=M${row},M${row}<=N${row}),"OK","FAIL")`]];
}
forecast.getRange("A5:Q20").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
forecast.getRange("A5:A20").format.numberFormat = "mmm yyyy";
forecast.getRange("B5:B20").format.numberFormat = countFmt;
forecast.getRange("C5:E20").format = { font: { color: "#008000" }, numberFormat: moneyFmt };
forecast.getRange("F5:F20").format.numberFormat = decimalFmt;
forecast.getRange("G5:G20").format.numberFormat = moneyFmt;
forecast.getRange("H5:H20").format.numberFormat = decimalFmt;
forecast.getRange("I5:I20").format.numberFormat = moneyFmt;
forecast.getRange("J5:J20").format.numberFormat = decimalFmt;
forecast.getRange("K5:P20").format.numberFormat = moneyFmt;
forecast.getRange("L5:L20").format.fill = C.paleBlue;
forecast.getRange("M5:M20").format.fill = C.paleTeal;
forecast.getRange("N5:N20").format.fill = C.paleOrange;
forecast.getRange("O5:P20").format.font = { color: "#008000" };
forecast.getRange("Q5:Q20").conditionalFormats.add("containsText", { text: "OK", format: { fill: C.paleGreen, font: { color: C.darkGreen, bold: true } } });
forecast.getRange("Q5:Q20").conditionalFormats.add("containsText", { text: "FAIL", format: { fill: C.paleRed, font: { color: C.red, bold: true } } });
forecast.freezePanes.freezeRows(4);
forecast.freezePanes.freezeColumns(2);
setColumnWidths(forecast, { A: 13, B: 13, C: 16, D: 16, E: 16, F: 17, G: 18, H: 17, I: 18, J: 17, K: 18, L: 16, M: 16, N: 16, O: 16, P: 16, Q: 18 });

// Model Validation
titleBand(
  validation,
  "Model Validation & Range",
  "Rolling-origin backtests use weekly shipped revenue. Error is high because wholesale orders are lumpy and the business has only five complete mature months; use scenarios as operating ranges, not promises.",
  "H",
);
validation.getRange("A4:H4").values = [["Model", "1-week MAE", "1-week sMAPE", "1-week bias", "4-week MAE", "4-week sMAPE", "4-week bias", "Ensemble weight"]];
header(validation.getRange("A4:H4"));
const bt = results.weekly.backtest;
validation.getRange("A5:H6").values = [
  ["Trailing 4-week mean", bt.metrics.ma4.h1.mae, bt.metrics.ma4.h1.smape, bt.metrics.ma4.h1.bias, bt.metrics.ma4.h4.mae, bt.metrics.ma4.h4.smape, bt.metrics.ma4.h4.bias, bt.weights.ma4],
  ["Damped Holt on log weekly sales", bt.metrics.holt_log_damped.h1.mae, bt.metrics.holt_log_damped.h1.smape, bt.metrics.holt_log_damped.h1.bias, bt.metrics.holt_log_damped.h4.mae, bt.metrics.holt_log_damped.h4.smape, bt.metrics.holt_log_damped.h4.bias, bt.weights.holt_log_damped],
];
validation.getRange("A5:H6").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
validation.getRange("B5:B6").format.numberFormat = moneyFmt;
validation.getRange("C5:C6").format.numberFormat = pctFmt;
validation.getRange("D5:D6").format.numberFormat = moneyFmt;
validation.getRange("E5:E6").format.numberFormat = moneyFmt;
validation.getRange("F5:F6").format.numberFormat = pctFmt;
validation.getRange("G5:G6").format.numberFormat = moneyFmt;
validation.getRange("H5:H6").format.numberFormat = pctFmt;

validation.mergeCells("A9:H9");
validation.getRange("A9").values = [["Alternative model outputs"]];
section(validation.getRange("A9:H9"));
validation.getRange("A10:E10").values = [["Model", "Next 12 months", "Decision", "Why", "Role in final forecast"]];
header(validation.getRange("A10:E10"));
const tsPoint12 = results.time_series_monthly.point.slice(0, 12).reduce((a, b) => a + b, 0);
const driverBase12 = results.driver.normal.revenue.slice(0, 12).reduce((a, b) => a + b, 0);
const cashTrend12 = results.cash_receipts.holt_forecast.slice(0, 12).reduce((a, b) => a + b, 0);
validation.getRange("A11:E14").values = [
  ["Weekly shipment ensemble", tsPoint12, "USE", "Anchors to the recent $3.7K-$4.2K weekly run rate.", "55% blend weight"],
  ["Customer / cohort driver model", driverBase12, "USE", "Builds revenue from active customers, retention, frequency, and AOV.", "45% blend weight"],
  ["Seven-month cash trend", cashTrend12, "REJECT", "Mechanically compounds the launch ramp and produces an implausible result.", "Cross-check only"],
  ["Final normal case", results.summary.normal.next_12_months, "USE", "Reconciles the two defensible model families.", "Primary forecast"],
];
validation.getRange("A11:E14").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
validation.getRange("B11:B14").format.numberFormat = moneyFmt;
validation.getRange("C13").format = { fill: C.paleRed, font: { color: C.red, bold: true } };
validation.getRange("C11:C12").format = { fill: C.paleGreen, font: { color: C.darkGreen, bold: true } };
validation.getRange("C14").format = { fill: C.paleTeal, font: { color: C.teal, bold: true } };
validation.getRange("D11:E14").format.wrapText = true;

validation.mergeCells("A17:H17");
validation.getRange("A17").values = [["Statistical uncertainty around the normal forecast"]];
section(validation.getRange("A17:H17"));
validation.getRange("A18:C18").values = [["Range", "Next 12-month total", "Interpretation"]];
header(validation.getRange("A18:C18"));
validation.getRange("A19:C22").values = [
  ["95% lower (P2.5)", results.uncertainty.next12_p2_5, "Severe downside within the modeled distribution"],
  ["80% lower (P10)", results.uncertainty.next12_p10, "Practical downside confidence bound"],
  ["80% upper (P90)", results.uncertainty.next12_p90, "Practical upside confidence bound"],
  ["95% upper (P97.5)", results.uncertainty.next12_p97_5, "High-end statistical bound"],
];
validation.getRange("A19:C22").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
validation.getRange("B19:B22").format.numberFormat = moneyFmt;
validation.mergeCells("A25:H27");
validation.getRange("A25").values = [[
  "The aggressive operating case is deliberately above the 95% statistical range. It is a plan requiring sustained 84% monthly retention, 12 new customers each month, stronger order frequency, and favorable AOV/mix—not the most likely outcome. No annual seasonality is modeled because fewer than 12 months of comparable sales exist.",
]];
validation.getRange("A25:H27").format = { fill: C.paleOrange, font: { color: C.slate }, wrapText: true, verticalAlignment: "top" };
validation.getRange("25:27").format.rowHeight = 26;
validation.freezePanes.freezeRows(4);
setColumnWidths(validation, { A: 31, B: 17, C: 17, D: 17, E: 17, F: 17, G: 17, H: 17 });

// Sources & Checks
titleBand(
  sources,
  "Sources, Reconciliation & Model Checks",
  "All business data is user-owned. Live database queries were read-only. Local exports are dated and are retained as reconciliation sources rather than silently blended with shipment actuals.",
  "I",
);
sources.getRange("A4:I4").values = [["Item", "Value", "Units", "Period / as-of", "Source type", "Source name", "Reference", "Owner", "Notes"]];
header(sources.getRange("A4:I4"));
const sourceRows = [
  ["Portal shipped revenue", 58222.88, "USD", "Feb 27-Aug 21, 2026", "Live database", "Supabase public.orders", "https://supabase.com/dashboard/project/ovrzooxvvernqqcotpkv", "SoBrew", "336 shipped standard orders; samples excluded; America/Chicago."],
  ["Portal shipped orders", 336, "orders", "Feb 27-Aug 21, 2026", "Live database", "Supabase public.orders", "https://supabase.com/dashboard/project/ovrzooxvvernqqcotpkv", "SoBrew", "Archived shipped orders included; open orders excluded."],
  ["Cash sales receipts", 55565.88, "USD", "Jan 1-Jul 31, 2026", "Live database", "Supabase accounting_transactions", "https://supabase.com/dashboard/project/ovrzooxvvernqqcotpkv", "SoBrew", "165 categorized Sales Revenue transactions; cash timing, not accrual revenue."],
  ["QuickBooks YTD all sales", 64673.49, "USD", "Jan 1-Aug 5, 2026", "Local export", "QuickBooks all-sales CSV", path.join(root, "output/reports/quickbooks-customer-ytd-orders-all-sales-2026-08-05.csv"), "SoBrew", "91 customers, 307 transactions, excluding tax; no transaction dates in rows."],
  ["QuickBooks YTD customers", 91, "customers", "Jan 1-Aug 5, 2026", "Local export", "QuickBooks all-sales CSV", path.join(root, "output/reports/quickbooks-customer-ytd-orders-all-sales-2026-08-05.csv"), "SoBrew", "Top 5 customers were 31.2% of YTD QuickBooks sales."],
  ["Active recurring run rate", results.assumptions.normal.recurring_floor, "USD/month", "Aug 21, 2026", "Live database", "Supabase recurring_orders", "https://supabase.com/dashboard/project/ovrzooxvvernqqcotpkv", "SoBrew", "15 active schedules annualized by frequency."],
  ["Sales pipeline", 292, "leads", "Aug 21, 2026", "Live database", "Supabase prospecting_leads", "https://supabase.com/dashboard/project/ovrzooxvvernqqcotpkv", "SoBrew", "95 working + 132 follow-up + 65 sample requested; only 7 converted, so pipeline is not booked revenue."],
  ["Price-per-pound covered revenue", 47133.48, "USD", "Mar 29-Aug 4, 2026", "Local report", "Client price-per-pound PDF", path.join(root, "output/pdf/client-price-per-pound-report-2026-08-05.pdf"), "SoBrew", "Partial view: 105 positive-revenue lines lacked recipe-derived weight and were skipped."],
];
sources.getRange("A5:I12").values = sourceRows;
sources.getRange("A5:I12").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
sources.getRange("B5:B12").format.numberFormat = moneyFmt;
sources.getRange("B6").format.numberFormat = countFmt;
sources.getRange("B9").format.numberFormat = countFmt;
sources.getRange("B11").format.numberFormat = countFmt;
sources.getRange("G5:I12").format.wrapText = true;

sources.mergeCells("A15:G15");
sources.getRange("A15").values = [["Checks"]];
section(sources.getRange("A15:G15"));
sources.mergeCells("H15:I15");
sources.getRange("H15").values = [["MODEL STATUS"]];
sources.getRange("H15:I15").format = { fill: C.navy, font: { bold: true, color: C.white }, horizontalAlignment: "center" };
sources.getRange("A17:G17").values = [["Check", "Actual", "Expected", "Difference", "Tolerance", "Status", "Notes"]];
header(sources.getRange("A17:G17"));
const checkLabels = [
  ["Portal monthly revenue ties to source", null, 58222.88, null, 0.01, null, "History total must equal live shipped standard-order subtotal."],
  ["Cash receipts tie to source", null, 55565.88, null, 0.01, null, "January-July categorized Sales Revenue total."],
  ["Current actual bridge", null, 73609.89, null, 0.01, null, "QuickBooks through Aug 5 plus portal shipments Aug 6-21."],
  ["Scenario ordering", null, 0, null, 0, null, "No month may have Conservative > Normal or Normal > Aggressive."],
  ["Blend weights", null, 1, null, 0.0001, null, "Time-series and driver weights must sum to 100%."],
  ["Forecast period count", null, 16, null, 0, null, "Sep 2026-Dec 2027 provides primary 12 months plus CY2027 extension."],
];
sources.getRange("A18:G23").values = checkLabels;
sources.getRange("B18").formulas = [["=SUM('Historical Actuals'!D5:D12)"]];
sources.getRange("B19").formulas = [["=SUM('Historical Actuals'!C5:C12)"]];
sources.getRange("B20").formulas = [["='Assumptions'!B15"]];
sources.getRange("B21").formulas = [["=COUNTIF('Forecast Model'!Q5:Q20,\"FAIL\")"]];
sources.getRange("B22").formulas = [["='Assumptions'!B13+'Assumptions'!B14"]];
sources.getRange("B23").formulas = [["=COUNTA('Forecast Model'!A5:A20)"]];
for (let row = 18; row <= 23; row += 1) {
  sources.getRange(`D${row}`).formulas = [[`=B${row}-C${row}`]];
  sources.getRange(`F${row}`).formulas = [[`=IF(ABS(D${row})<=E${row},"PASS","FAIL")`]];
}
sources.getRange("A18:G23").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
sources.getRange("B18:E20").format.numberFormat = moneyFmt;
sources.getRange("B22:E22").format.numberFormat = pctFmt;
sources.getRange("F18:F23").conditionalFormats.add("containsText", { text: "PASS", format: { fill: C.paleGreen, font: { color: C.darkGreen, bold: true } } });
sources.getRange("F18:F23").conditionalFormats.add("containsText", { text: "FAIL", format: { fill: C.paleRed, font: { color: C.red, bold: true } } });
sources.mergeCells("H17:I19");
sources.getRange("H17").formulas = [["=IF(COUNTIF(F18:F23,\"FAIL\")=0,\"PASS\",\"FAIL\")"]];
sources.getRange("H17:I19").format = { font: { bold: true, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "medium", color: C.navy } };
sources.getRange("H17:I19").conditionalFormats.add("containsText", { text: "PASS", format: { fill: C.paleGreen, font: { color: C.darkGreen, bold: true } } });
sources.getRange("H17:I19").conditionalFormats.add("containsText", { text: "FAIL", format: { fill: C.paleRed, font: { color: C.red, bold: true } } });
sources.freezePanes.freezeRows(4);
setColumnWidths(sources, { A: 31, B: 16, C: 14, D: 22, E: 16, F: 27, G: 55, H: 14, I: 58 });

// Executive Summary
titleBand(
  summary,
  "SoBrew Sales Growth & Forecast",
  "Executive view | USD, excluding sales tax | Actuals through Aug 21, 2026 | Primary forecast: Sep 2026-Aug 2027 | Confidence: low-to-moderate due limited history",
  "O",
);
summary.getRange("A3:O3").format = { fill: C.white, font: { color: C.muted, italic: true }, horizontalAlignment: "left" };
summary.mergeCells("A3:O3");
summary.getRange("A3").values = [["Revenue means completed standard wholesale shipments. Prospecting samples, tax, and shipping cost are excluded. Archived shipped orders remain in history."]];

const cards = [
  { label: "Portal shipments tracked", top: "A5:C5", value: "A6:C7", formula: "=SUM('Historical Actuals'!D5:D12)", fill: C.paleBlue, color: C.navy },
  { label: "July shipped revenue", top: "E5:G5", value: "E6:G7", formula: "='Historical Actuals'!D11", fill: C.paleTeal, color: C.teal },
  { label: "Estimated company YTD", top: "I5:K5", value: "I6:K7", formula: "='Assumptions'!C15", fill: C.paleGreen, color: C.darkGreen },
  { label: "Normal next 12 months", top: "M5:O5", value: "M6:O7", formula: "=SUM('Forecast Model'!M5:M16)", fill: C.paleOrange, color: C.orange },
];
for (const card of cards) {
  summary.mergeCells(card.top);
  summary.getRange(card.top.split(":")[0]).values = [[card.label]];
  summary.getRange(card.top).format = { fill: C.navy, font: { bold: true, color: C.white }, horizontalAlignment: "center", verticalAlignment: "center" };
  summary.mergeCells(card.value);
  summary.getRange(card.value.split(":")[0]).formulas = [[card.formula]];
  summary.getRange(card.value).format = { fill: card.fill, font: { bold: true, color: card.color, size: 18 }, numberFormat: moneyFmt, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: card.color } };
}
summary.getRange("5:7").format.rowHeight = 23;

summary.getRange("A10:F10").values = [["Scenario", "Next 12 months", "CY2026", "CY2027", "2027 growth", "Operating interpretation"]];
header(summary.getRange("A10:F10"));
summary.getRange("A11:A13").values = [["Conservative"], ["Normal"], ["Aggressive"]];
summary.getRange("B11").formulas = [["=SUM('Forecast Model'!L5:L16)"]];
summary.getRange("B12").formulas = [["=SUM('Forecast Model'!M5:M16)"]];
summary.getRange("B13").formulas = [["=SUM('Forecast Model'!N5:N16)"]];
summary.getRange("C11").formulas = [["='Assumptions'!B15+'Assumptions'!B16+SUM('Forecast Model'!L5:L8)"]];
summary.getRange("C12").formulas = [["='Assumptions'!C15+'Assumptions'!C16+SUM('Forecast Model'!M5:M8)"]];
summary.getRange("C13").formulas = [["='Assumptions'!D15+'Assumptions'!D16+SUM('Forecast Model'!N5:N8)"]];
summary.getRange("D11").formulas = [["=SUM('Forecast Model'!L9:L20)"]];
summary.getRange("D12").formulas = [["=SUM('Forecast Model'!M9:M20)"]];
summary.getRange("D13").formulas = [["=SUM('Forecast Model'!N9:N20)"]];
summary.getRange("E11").formulas = [["=D11/C11-1"]];
summary.getRange("E12").formulas = [["=D12/C12-1"]];
summary.getRange("E13").formulas = [["=D13/C13-1"]];
summary.getRange("F11:F13").values = [
  ["Attrition outpaces acquisition; AOV is flat."],
  ["Recent retention, acquisition, frequency, and AOV broadly hold."],
  ["Upper observed drivers persist and pipeline converts materially."],
];
summary.getRange("A11:F13").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
summary.getRange("B11:D13").format.numberFormat = moneyFmt;
summary.getRange("E11:E13").format.numberFormat = pctFmt;
summary.getRange("F11:F13").format.wrapText = true;
summary.getRange("A11:F11").format.fill = C.paleBlue;
summary.getRange("A12:F12").format.fill = C.paleTeal;
summary.getRange("A13:F13").format.fill = C.paleOrange;

summary.mergeCells("H10:O10");
summary.getRange("H10").values = [["Forecast range and decision frame"]];
section(summary.getRange("H10:O10"));
summary.getRange("H11:J14").values = [
  ["80% statistical range", null, null],
  ["95% statistical range", null, null],
  ["Normal vs recent annualized run rate", null, null],
  ["Forecast confidence", "LOW-MODERATE", null],
];
summary.mergeCells("I11:J11");
summary.getRange("I11").formulas = [[`="$${Math.round(results.uncertainty.next12_p10).toLocaleString()} to $${Math.round(results.uncertainty.next12_p90).toLocaleString()}"`]];
summary.mergeCells("I12:J12");
summary.getRange("I12").formulas = [[`="$${Math.round(results.uncertainty.next12_p2_5).toLocaleString()} to $${Math.round(results.uncertainty.next12_p97_5).toLocaleString()}"`]];
summary.mergeCells("I13:J13");
summary.getRange("I13").formulas = [["=B12/(AVERAGE('Historical Actuals'!D11,'Historical Actuals'!D12+'Assumptions'!C16)*12)-1"]];
summary.mergeCells("I14:J14");
summary.getRange("H11:J14").format = { fill: C.soft, borders: { insideHorizontal: { style: "thin", color: C.line } } };
summary.getRange("H11:H14").format.wrapText = true;
summary.getRange("11:14").format.rowHeight = 30;
summary.getRange("I11:I12").format.font = { bold: true, color: C.navy };
summary.getRange("I13").format.numberFormat = pctFmt;
summary.getRange("I14").format = { fill: C.paleYellow, font: { bold: true, color: C.orange }, horizontalAlignment: "center" };
summary.mergeCells("K11:O14");
summary.getRange("K11").values = [[
  "The normal case is the planning forecast. Conservative is a downside operating case; aggressive is a stretch plan above the modeled 95% statistical range and needs sustained pipeline conversion plus strong retention.",
]];
summary.getRange("K11:O14").format = { fill: C.soft, font: { color: C.slate }, wrapText: true, verticalAlignment: "center" };

summary.mergeCells("K18:O18");
summary.getRange("K18").values = [["What I see"]];
section(summary.getRange("K18:O18"));
const findings = [
  "1. Real acceleration: cash receipts rose from $4.9K in January to $15.5K in July (+216%); shipped revenue rose from $5.7K in April to $15.2K in July (+167%).",
  "2. The engine matured: May-July AOV climbed from $205 to $231 while the monthly customer count stabilized at 35-38. Growth is now more about repeat volume and ticket size than raw launch acquisition.",
  "3. Recurring base: 15 active schedules imply about $5.0K per month, roughly 30% of the current normal run rate.",
  "4. Customer risk is manageable: the top customer is about 10% of monthly sales; QuickBooks top 5 are 31% of YTD sales. Repeat customers are 76% of the portal base, with a 16-day median reorder interval.",
  "5. Watch margin and data comparability: reported gross margin fell near 24-25% in July/August, but estimated-COGS coverage also changed sharply. Treat the direction as a warning, not a clean apples-to-apples trend.",
];
for (let i = 0; i < findings.length; i += 1) {
  const start = 19 + i * 3;
  summary.mergeCells(`K${start}:O${start + 2}`);
  summary.getRange(`K${start}`).values = [[findings[i]]];
  summary.getRange(`K${start}:O${start + 2}`).format = { fill: i % 2 === 0 ? C.soft : C.white, font: { color: C.ink }, wrapText: true, verticalAlignment: "center", borders: { bottom: { style: "thin", color: C.line } } };
  summary.getRange(`${start}:${start + 2}`).format.rowHeight = 22;
}

summary.getRange("A39:E39").values = [["Month", "Shipped actual", "Conservative", "Normal", "Aggressive"]];
header(summary.getRange("A39:E39"));
const chartMonths = [];
let cm = dateFromParts(2026, 1);
for (let i = 0; i < 24; i += 1) {
  chartMonths.push(`${cm.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${cm.getUTCFullYear()}`);
  cm = dateFromParts(cm.getUTCFullYear() + (cm.getUTCMonth() === 11 ? 1 : 0), cm.getUTCMonth() === 11 ? 1 : cm.getUTCMonth() + 2);
}
summary.getRange("A40:A63").values = chartMonths.map((x) => [x]);
for (let i = 0; i < 8; i += 1) {
  summary.getRange(`B${40 + i}`).formulas = [[`='Historical Actuals'!D${5 + i}`]];
}
summary.getRange("C47").formulas = [["='Historical Actuals'!D12+'Assumptions'!B16"]];
summary.getRange("D47").formulas = [["='Historical Actuals'!D12+'Assumptions'!C16"]];
summary.getRange("E47").formulas = [["='Historical Actuals'!D12+'Assumptions'!D16"]];
for (let i = 0; i < 16; i += 1) {
  const chartRow = 48 + i;
  const modelRow = 5 + i;
  summary.getRange(`C${chartRow}:E${chartRow}`).formulas = [[
    `='Forecast Model'!L${modelRow}`,
    `='Forecast Model'!M${modelRow}`,
    `='Forecast Model'!N${modelRow}`,
  ]];
}
summary.getRange("B40:E63").format.numberFormat = moneyFmt;
summary.getRange("A39:E63").format.borders = { insideHorizontal: { style: "thin", color: C.line } };
const trendChart = summary.charts.add("line", summary.getRange("A39:E63"));
trendChart.title = "Shipped Revenue: Actual and Scenario Forecast ($ / month)";
trendChart.titleTextStyle.fontSize = 12;
trendChart.hasLegend = true;
trendChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
trendChart.yAxis = { numberFormatCode: "$#,##0", min: 0 };
trendChart.setPosition("A18", "I35");
const series = trendChart.series.items;
if (series[0]) series[0].fill = C.navy;
if (series[1]) series[1].fill = C.blue;
if (series[2]) series[2].fill = C.teal;
if (series[3]) series[3].fill = C.orange;

summary.freezePanes.freezeRows(3);
setColumnWidths(summary, { A: 14, B: 15, C: 15, D: 14, E: 14, F: 25, G: 6, H: 20, I: 15, J: 15, K: 16, L: 16, M: 16, N: 16, O: 16 });

// Cell comments for material source-backed assumptions.
workbook.comments.setSelf({ displayName: "User" });
workbook.comments.addThread({ cell: assumptions.getRange("B5") }, "Source: live Supabase shipped-order customer history as of 2026-08-21. August MTD active customers = 38; model uses 42 as a full-month estimate.");
workbook.comments.addThread({ cell: assumptions.getRange("B6") }, "Source: live Supabase monthly logo retention. May-Jul 2026 observed: 84.0%, 71.4%, 77.8%.");
workbook.comments.addThread({ cell: assumptions.getRange("B7") }, "Source: live Supabase first-order cohorts. New customers: May 13, Jun 9, Jul 9; pipeline as of 2026-08-21 includes 95 working, 132 follow-up, and 65 sample-requested leads.");
workbook.comments.addThread({ cell: assumptions.getRange("B10") }, "Source: live Supabase shipped standard-order subtotals and counts. May-Jul AOV: $205.44, $214.90, $230.54.");
workbook.comments.addThread({ cell: assumptions.getRange("B12") }, "Source: live Supabase recurring_orders as of 2026-08-21. 15 active schedules; annualized monthly run rate = 4x biweekly, 2x every 3 weeks, 9x every 4 weeks.");
workbook.comments.addThread({ cell: assumptions.getRange("B15") }, "Source bridge: QuickBooks all-sales export through 2026-08-05 ($64,673.49 ex-tax) plus portal shipped revenue from 2026-08-06 through 2026-08-21 ($8,936.40). Estimate is not an audited close.");

// Compact formula and value inspection before export.
const summaryCheck = await workbook.inspect({ kind: "table", range: "'Executive Summary'!A1:O15", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 15, maxChars: 12000 });
console.log("SUMMARY_INSPECT");
console.log(summaryCheck.ndjson);
const forecastCheck = await workbook.inspect({ kind: "table", range: "'Forecast Model'!A4:Q20", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 17, maxChars: 16000 });
console.log("FORECAST_INSPECT");
console.log(forecastCheck.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log("FORMULA_ERRORS");
console.log(errors.ndjson);

for (const sheetName of ["Executive Summary", "Historical Actuals", "Assumptions", "Forecast Model", "Model Validation", "Sources & Checks"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1.25, format: "png" });
  const safeName = sheetName.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and");
  await fs.writeFile(path.join(outputDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const exported = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "sobrew_sales_growth_forecast_2026-08-21.xlsx");
await exported.save(outputPath);
console.log(`OUTPUT=${outputPath}`);

function dateFromParts(year, month) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function businessDays(d) {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    const dow = new Date(Date.UTC(year, month, day)).getUTCDay();
    if (dow >= 1 && dow <= 5) count += 1;
  }
  return count;
}
