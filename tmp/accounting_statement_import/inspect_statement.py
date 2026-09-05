from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber


INPUT = Path("/Users/zachfeinstone/Downloads/eStmt_2026-08-31 (1).pdf")
OUT_DIR = Path("tmp/accounting_statement_import")


def redact(text: str) -> str:
    text = re.sub(r"\b\d{8,}\b", "[long-number]", text)
    text = re.sub(r"\b(?:\d[ -]?){12,19}\b", "[card-or-account]", text)
    return text


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pages = []
    with pdfplumber.open(INPUT) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            tables = page.extract_tables() or []
            pages.append({
                "page": index,
                "text": text,
                "tables": tables,
            })

    (OUT_DIR / "statement_pages.json").write_text(json.dumps(pages, indent=2), encoding="utf-8")

    print(f"pages={len(pages)}")
    for page in pages:
        lines = [line.strip() for line in page["text"].splitlines() if line.strip()]
        print(f"page={page['page']} lines={len(lines)} tables={len(page['tables'])}")
        for line in lines[:18]:
            print(redact(line)[:220])

    activity_text = []
    for page in pages:
        if page["page"] in {3, 4}:
            activity_text.append(f"PAGE {page['page']}\n{redact(page['text'])}")
    (OUT_DIR / "activity_pages_redacted.txt").write_text("\n\n".join(activity_text), encoding="utf-8")


if __name__ == "__main__":
    main()
