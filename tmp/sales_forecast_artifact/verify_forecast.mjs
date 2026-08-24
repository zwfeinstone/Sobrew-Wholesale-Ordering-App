import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const file = "/Users/zachfeinstone/Desktop/Sobrew-Wholesale-Ordering-App/outputs/01a026b4-d5dd-7be2-bf1e-ec4d096cc662/sobrew_sales_growth_forecast_2026-08-21.xlsx";
const blob = await FileBlob.load(file);
const workbook = await SpreadsheetFile.importXlsx(blob);

for (const range of [
  "Executive Summary!A10:F13",
  "Sources & Checks!A17:I23",
  "Forecast Model!L5:Q20",
]) {
  const check = await workbook.inspect({ kind: "table", range, include: "values,formulas", tableMaxRows: 25, tableMaxCols: 20, maxChars: 12000 });
  console.log(`CHECK ${range}`);
  console.log(check.ndjson);
}

const drawings = await workbook.inspect({ kind: "drawing", sheetId: "Executive Summary", maxChars: 4000 });
console.log("DRAWINGS");
console.log(drawings.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "post-export formula error scan",
});
console.log("ERRORS");
console.log(errors.ndjson);
