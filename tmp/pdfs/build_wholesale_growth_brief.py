from __future__ import annotations

from math import ceil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path("/Users/zachfeinstone/Desktop/Sobrew-Wholesale-Ordering-App")
OUTPUT = ROOT / "output/pdf/sobrew-wholesale-growth-brief-2026-08-31.pdf"
LOGO = ROOT / "public/sobrew-logo.png"

PAGE_W, PAGE_H = landscape(letter)

ESPRESSO = colors.HexColor("#2C2118")
FOREST = colors.HexColor("#263326")
SAGE = colors.HexColor("#4F6B58")
EMERALD = colors.HexColor("#1E7464")
TAN = colors.HexColor("#B18C6D")
SAND = colors.HexColor("#E9DDCE")
CREAM = colors.HexColor("#F8F4ED")
WHITE = colors.white
INK = colors.HexColor("#25231F")
MUTED = colors.HexColor("#6B6963")
LINE = colors.HexColor("#D9D0C4")
PALE_GREEN = colors.HexColor("#E7F0EB")
PALE_TAN = colors.HexColor("#F1E7DB")
PALE_GOLD = colors.HexColor("#F5EEDB")
GOLD = colors.HexColor("#C79B3B")


monthly = [
    ("Apr", 5212.01, 23, 28),
    ("May", 11710.09, 34, 55),
    ("Jun", 11604.79, 36, 54),
    ("Jul", 15215.59, 38, 66),
    ("Aug", 17165.43, 47, 78),
]

top_relationships = [
    ("Valley Behavioral Health", 19, 3990.00),
    ("Lakeside Behavioral Health System", 8, 3941.50),
    ("Orchard on the Brazos", 7, 3910.00),
    ("Illinois Recovery Center", 4, 3790.80),
    ("Robert Alexander Center", 6, 2880.00),
]

new_accounts = [
    ("Aug 3", "Harmony Hills", 170.00),
    ("Aug 4", "The Shoulder", 492.00),
    ("Aug 4", "Anew Treatment Center", 45.00),
    ("Aug 10", "Lake Whatcom Residential Treatment Centers", 165.00),
    ("Aug 11", "Trinity Logistics", 42.50),
    ("Aug 13", "Narconon Suncoast", 127.50),
    ("Aug 14", "Synergy Treatment Center", 349.00),
    ("Aug 14", "Turning Point Recovery", 42.50),
    ("Aug 18", "Spirit Mountain Recovery", 170.00),
    ("Aug 21", "Doug Simpson", 120.00),
    ("Aug 24", "Buffalo Valley", 275.00),
    ("Aug 24", "Rennova Health", 44.93),
    ("Aug 25", "CARE Aware Residential", 120.00),
    ("Aug 27", "Ethan Health", 80.00),
]

pipeline_stages = [
    ("New", 3941, PALE_TAN, ESPRESSO),
    ("Working", 83, PALE_GREEN, FOREST),
    ("Follow-up", 116, colors.HexColor("#E9EEF4"), colors.HexColor("#36566E")),
    ("Recycle", 168, PALE_GOLD, colors.HexColor("#725B24")),
    ("Sample requested", 70, colors.HexColor("#DDEFE9"), EMERALD),
]

group_pipeline = [
    ("Valley Hope", 9, "3 sample, 5 follow-up, 1 working"),
    ("Daymark Recovery Services", 4, "4 sample requested"),
    ("Pyramid Healthcare", 4, "3 follow-up, 1 working"),
    ("Futures Recovery Healthcare", 3, "3 working"),
    ("Easterseals PORT Health", 2, "1 sample, 1 follow-up"),
]

sample_names = [
    "Caron Treatment Centers - Wernersville",
    "Carolina Wellness Centers - Sea Level",
    "Starlite Recovery Center",
    "The Arbor",
    "Magnolia City Detox",
    "McLeod Centers for Wellbeing",
]


def money(value: float, decimals: int = 0) -> str:
    return f"${value:,.{decimals}f}"


def compact_money(value: float) -> str:
    if abs(value) >= 1_000_000:
        return f"${value / 1_000_000:.2f}M"
    if abs(value) >= 1_000:
        return f"${value / 1_000:.1f}K"
    return money(value, 0)


def wrap_text(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font: str = "Helvetica",
    size: float = 9,
    color=INK,
    leading: float | None = None,
    max_lines: int | None = None,
) -> float:
    leading = leading or size * 1.35
    lines = wrap_text(text, font, size, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFillColor(color)
    c.setFont(font, size)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def draw_bullet(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    size: float = 9.4,
    color=INK,
    dot_color=EMERALD,
) -> float:
    c.setFillColor(dot_color)
    c.circle(x + 3, y + 3, 2.4, fill=1, stroke=0)
    return draw_wrapped(c, text, x + 14, y + 7, max_width - 14, size=size, color=color, leading=size * 1.4)


def rounded_panel(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill=WHITE, stroke=LINE, radius: float = 12):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def page_header(c: canvas.Canvas, title: str, subtitle: str, page_no: int):
    c.setFillColor(ESPRESSO)
    c.rect(0, PAGE_H - 78, PAGE_W, 78, fill=1, stroke=0)
    c.drawImage(str(LOGO), 40, PAGE_H - 69, 52, 52, mask="auto", preserveAspectRatio=True)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 19)
    c.drawString(108, PAGE_H - 35, title)
    c.setFillColor(SAND)
    c.setFont("Helvetica", 8.5)
    c.drawString(108, PAGE_H - 53, subtitle)
    c.setFillColor(SAND)
    c.setFont("Helvetica-Bold", 7)
    c.drawRightString(PAGE_W - 42, PAGE_H - 32, "CONFIDENTIAL")
    c.setFont("Helvetica", 7)
    c.drawRightString(PAGE_W - 42, PAGE_H - 47, "DATA THROUGH AUG 31, 2026")
    page_footer(c, page_no)


def page_footer(c: canvas.Canvas, page_no: int):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(42, 26, PAGE_W - 42, 26)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.0)
    c.drawString(42, 14, "Source: live SoBrew app | Eastern Time | Standard order revenue excludes tax, shipping, samples, and two demo/test centers")
    c.drawRightString(PAGE_W - 42, 14, f"SoBrew Wholesale Growth Brief | {page_no}")


def kpi_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, value: str, label: str, detail: str, accent=EMERALD):
    rounded_panel(c, x, y, w, h, fill=WHITE)
    c.setFillColor(accent)
    c.roundRect(x, y, 6, h, 3, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 21)
    c.drawString(x + 18, y + h - 32, value)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x + 18, y + h - 51, label.upper())
    draw_wrapped(c, detail, x + 18, y + h - 69, w - 34, size=7.4, color=MUTED, leading=9.5, max_lines=2)


def section_label(c: canvas.Canvas, text: str, x: float, y: float, color=EMERALD):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(x, y, text.upper())


def draw_table_header(c: canvas.Canvas, x: float, y: float, widths: list[float], labels: list[str], h: float = 23):
    c.setFillColor(ESPRESSO)
    c.roundRect(x, y - h, sum(widths), h, 5, fill=1, stroke=0)
    cursor = x
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 7.5)
    for index, (width, label) in enumerate(zip(widths, labels)):
        if index == 0:
            c.drawString(cursor + 9, y - 15, label)
        else:
            c.drawRightString(cursor + width - 9, y - 15, label)
        cursor += width


def projection_series(long_run_rate: float) -> tuple[list[float], list[float]]:
    base_monthly_revenue = 17165.43
    new_accounts_per_month = 14
    first_order_revenue = 220.53
    active_monthly_spend = 380.95
    observed_activity = {1: 0.750, 2: 0.657, 3: 0.750}
    revenues: list[float] = [base_monthly_revenue]
    active_accounts: list[float] = [47.0]
    for month in range(1, 37):
        older_active = 0.0
        for cohort_month in range(1, month):
            age = month - cohort_month
            older_active += new_accounts_per_month * observed_activity.get(age, long_run_rate)
        incremental = new_accounts_per_month * first_order_revenue + older_active * active_monthly_spend
        revenues.append(base_monthly_revenue + incremental)
        active_accounts.append(47 + new_accounts_per_month + older_active)
    return revenues, active_accounts


def draw_page_one(c: canvas.Canvas):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(ESPRESSO)
    c.rect(0, PAGE_H - 194, PAGE_W, 194, fill=1, stroke=0)
    c.drawImage(str(LOGO), 42, PAGE_H - 158, 112, 112, mask="auto", preserveAspectRatio=True)
    c.setFillColor(SAND)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(177, PAGE_H - 53, "CONFIDENTIAL BUSINESS GROWTH BRIEF")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 27)
    c.drawString(177, PAGE_H - 89, "Wholesale Growth & Recurring Revenue")
    c.setFillColor(SAND)
    c.setFont("Helvetica", 12)
    c.drawString(177, PAGE_H - 116, "Customer traction, repeat purchasing, pipeline depth, and a 36-month growth scenario")
    c.setFont("Helvetica", 8.5)
    c.drawString(177, PAGE_H - 145, "Live operating data through August 31, 2026 | Growth plan: 14 new accounts per month")

    card_y = 307
    card_w = 169.5
    gap = 10
    x0 = 42
    kpi_card(c, x0, card_y, card_w, 92, "69", "Purchasing accounts", "Legitimate commercial accounts with order revenue to date.")
    kpi_card(c, x0 + card_w + gap, card_y, card_w, 92, "$61.7K", "Gross order revenue", "Commercial revenue to date, including August open orders.", TAN)
    kpi_card(c, x0 + 2 * (card_w + gap), card_y, card_w, 92, "47", "August buying accounts", "Monthly buying relationships more than doubled from 23 in April.", SAGE)
    kpi_card(c, x0 + 3 * (card_w + gap), card_y, card_w, 92, "14", "New August accounts", "The monthly acquisition goal was achieved in the current month.", GOLD)

    rounded_panel(c, 42, 59, 445, 226, fill=WHITE)
    section_label(c, "The growth story", 62, 262)
    c.setFillColor(INK)
    draw_wrapped(
        c,
        "A young wholesale base is compounding through repeat orders.",
        62,
        235,
        385,
        font="Helvetica-Bold",
        size=15.5,
        leading=20,
        max_lines=2,
    )
    y = 182
    y = draw_bullet(c, "August was the highest-revenue month in the app at $17,165.43, up 12.8% from July.", 62, y, 400, size=8.8)
    y -= 9
    y = draw_bullet(c, "Revenue grew 3.29x from April to August while monthly buying accounts more than doubled.", 62, y, 400, size=8.8)
    y -= 9
    y = draw_bullet(c, "Customer retention is 92.9%, including confirmed active customers who did not order in August.", 62, y, 400, size=8.8)
    y -= 9
    draw_bullet(c, "The pipeline holds 4,378 open leads, including 70 at sample-requested stage.", 62, y, 400, size=8.8)

    rounded_panel(c, 505, 59, 245, 226, fill=FOREST, stroke=FOREST)
    section_label(c, "Recurring engine", 525, 262, color=SAND)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(525, 226, "$5,654")
    c.setFont("Helvetica-Bold", 8)
    c.drawString(525, 208, "SCHEDULED MONTHLY RUN RATE")
    c.setFillColor(SAND)
    c.setFont("Helvetica", 8)
    c.drawString(525, 190, "17 active schedules across 15 accounts")
    c.setStrokeColor(colors.HexColor("#536252"))
    c.line(525, 173, 730, 173)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(525, 143, "$3,114")
    c.setFont("Helvetica-Bold", 8)
    c.drawString(525, 127, "AUGUST AUTOMATED RECURRING REVENUE")
    c.setFillColor(SAND)
    c.setFont("Helvetica", 8)
    c.drawString(525, 109, "17 shipments | 18.1% of August order revenue")
    c.setFillColor(colors.HexColor("#AFC5B7"))
    c.setFont("Helvetica", 7)
    c.drawString(525, 80, "Annualized scheduled run rate: $67,843.")
    page_footer(c, 1)
    c.showPage()


def draw_revenue_chart(c: canvas.Canvas, x: float, y: float, w: float, h: float):
    rounded_panel(c, x, y, w, h, fill=WHITE)
    section_label(c, "Recent sales trend", x + 18, y + h - 22)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 18, y + h - 44, "Order revenue and buying relationships")
    chart_x = x + 42
    chart_y = y + 43
    chart_w = w - 72
    chart_h = h - 98
    max_rev = 20000
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    for tick in [0, 5000, 10000, 15000, 20000]:
        yy = chart_y + (tick / max_rev) * chart_h
        c.line(chart_x, yy, chart_x + chart_w, yy)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawRightString(chart_x - 7, yy - 2, f"${tick/1000:.0f}K")
    slot = chart_w / len(monthly)
    bar_w = slot * 0.52
    points: list[tuple[float, float]] = []
    for index, (month, revenue, accounts, _orders) in enumerate(monthly):
        bx = chart_x + index * slot + (slot - bar_w) / 2
        bh = (revenue / max_rev) * chart_h
        c.setFillColor(EMERALD if month == "Aug" else SAGE)
        c.roundRect(bx, chart_y, bar_w, bh, 4, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 6.0)
        revenue_label = money(revenue, 2) if month == "Aug" else compact_money(revenue)
        c.drawCentredString(bx + bar_w / 2, chart_y + bh - 12, revenue_label)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7)
        c.drawCentredString(bx + bar_w / 2, chart_y - 14, month)
        px = bx + bar_w / 2
        py = chart_y + (accounts / 50) * chart_h
        points.append((px, py))
    c.setStrokeColor(GOLD)
    c.setLineWidth(2)
    for first, second in zip(points, points[1:]):
        c.line(first[0], first[1], second[0], second[1])
    for (px, py), (_, _revenue, accounts, _orders) in zip(points, monthly):
        c.setFillColor(GOLD)
        c.circle(px, py, 3.5, fill=1, stroke=0)
        c.setFillColor(ESPRESSO)
        c.setFont("Helvetica-Bold", 6.5)
        c.drawCentredString(px, py + 9, str(accounts))
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawString(x + 18, y + 15, "Bars: order revenue | Gold line: buying accounts (labels show account count)")


def draw_page_two(c: canvas.Canvas):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Revenue and Customer Traction", "Wholesale relationships are broadening while monthly revenue reaches a new high.", 2)
    draw_revenue_chart(c, 42, 293, 455, 218)

    kpi_card(c, 515, 419, 235, 92, "3.29x", "Revenue growth", "$5,212 in April to $17,165.43 in August.", EMERALD)
    kpi_card(c, 515, 317, 112, 92, "$225", "Recent AOV", "Jul-Aug weighted average.", TAN)
    kpi_card(c, 638, 317, 112, 92, "78", "Aug orders", "+18.2% from July.", SAGE)

    rounded_panel(c, 42, 55, 708, 216, fill=WHITE)
    section_label(c, "Established wholesale relationships", 60, 247)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 225, "Top purchasing accounts by lifetime shipped revenue")
    widths = [390, 90, 190]
    header_y = 208
    draw_table_header(c, 60, header_y, widths, ["Account", "Orders", "Lifetime revenue"])
    row_y = header_y - 42
    for index, (name, orders, revenue) in enumerate(top_relationships):
        if index % 2 == 0:
            c.setFillColor(colors.HexColor("#FAF8F4"))
            c.rect(60, row_y - 7, sum(widths), 22, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Helvetica", 8.5)
        c.drawString(69, row_y + 1, name)
        c.drawRightString(60 + widths[0] + widths[1] - 9, row_y + 1, str(orders))
        c.setFont("Helvetica-Bold", 8.5)
        c.drawRightString(60 + sum(widths) - 9, row_y + 1, money(revenue, 2))
        row_y -= 23
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7)
    c.drawString(60, 63, "Diversification: the largest August account was 9.9% of monthly revenue; the top five were 36.8%.")
    c.showPage()


def draw_retention_curve(c: canvas.Canvas, x: float, y: float, w: float, h: float):
    rounded_panel(c, x, y, w, h, fill=WHITE)
    section_label(c, "Retention", x + 18, y + h - 22)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 18, y + h - 45, "Customer retention rate")
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 38)
    c.drawString(x + 18, y + h - 98, "92.9%")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(x + 20, y + h - 118, "CONFIRMED ACTIVE CUSTOMER RELATIONSHIPS")
    bar_x = x + 20
    bar_y = y + 68
    bar_w = w - 40
    c.setFillColor(colors.HexColor("#E5E0D8"))
    c.roundRect(bar_x, bar_y, bar_w, 14, 7, fill=1, stroke=0)
    c.setFillColor(EMERALD)
    c.roundRect(bar_x, bar_y, bar_w * 0.929, 14, 7, fill=1, stroke=0)
    draw_wrapped(
        c,
        "Includes customers who confirmed they remain active even if they did not place an August order.",
        x + 20,
        y + 48,
        w - 40,
        size=7.4,
        color=MUTED,
        leading=10,
        max_lines=3,
    )


def draw_page_three(c: canvas.Canvas):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Retention, Recurring Revenue, and August Wins", "Repeat purchasing is supported by both customer behavior and formal recurring schedules.", 3)
    draw_retention_curve(c, 42, 303, 335, 208)

    rounded_panel(c, 395, 303, 355, 208, fill=FOREST, stroke=FOREST)
    section_label(c, "Recurring business", 415, 486, color=SAND)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(415, 461, "Visible scheduled demand")
    values = [
        ("17", "ACTIVE SCHEDULES"),
        ("15", "SCHEDULED ACCOUNTS"),
        ("$5.65K", "MRR-EQUIVALENT"),
        ("$67.84K", "ARR-EQUIVALENT"),
    ]
    card_w = 150
    for index, (value, label) in enumerate(values):
        col = index % 2
        row = index // 2
        bx = 415 + col * 164
        by = 394 - row * 61
        c.setFillColor(colors.HexColor("#344334"))
        c.roundRect(bx, by, card_w, 50, 8, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(bx + 12, by + 27, value)
        c.setFillColor(SAND)
        c.setFont("Helvetica-Bold", 6.5)
        c.drawString(bx + 12, by + 12, label)
    c.setFillColor(colors.HexColor("#AFC5B7"))
    c.setFont("Helvetica", 6.5)
    c.drawString(415, 319, "August recurring automation: $3,114 across 17 shipments (18.1% of order revenue).")

    rounded_panel(c, 42, 54, 708, 237, fill=WHITE)
    section_label(c, "14 new purchasing accounts in August", 60, 267)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 13.5)
    c.drawString(60, 245, "$2,243.43 in combined first orders - the current 14-account monthly target was reached.")
    column_w = 330
    for index, (date, name, value) in enumerate(new_accounts):
        col = 0 if index < 7 else 1
        row = index if index < 7 else index - 7
        bx = 60 + col * 350
        by = 216 - row * 22
        if row % 2 == 0:
            c.setFillColor(colors.HexColor("#FAF8F4"))
            c.roundRect(bx - 4, by - 6, column_w + 8, 20, 4, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawString(bx, by, date)
        c.setFillColor(INK)
        c.setFont("Helvetica", 7.2)
        c.drawString(bx + 42, by, name)
        c.setFont("Helvetica-Bold", 7.2)
        c.drawRightString(bx + column_w, by, money(value, 2))
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawString(60, 64, "New account means the first standard wholesale order was placed for that commercial center.")
    c.showPage()


def draw_page_four(c: canvas.Canvas):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Sales Pipeline and Expansion Potential", "The lead inventory is deep; the next operating opportunity is systematic assignment and follow-up.", 4)

    kpi_card(c, 42, 411, 226, 100, "4,378", "Open leads left to work", "Every unarchived lead in an open prospecting stage.", EMERALD)
    kpi_card(c, 283, 411, 226, 100, "3,938", "Untouched open leads", "No call or email activity is recorded yet.", TAN)
    kpi_card(c, 524, 411, 226, 100, "70", "Sample requested", "Most advanced stored open pipeline stage.", GOLD)

    card_gap = 8
    stage_w = (708 - card_gap * 4) / 5
    for index, (label, count, fill, color) in enumerate(pipeline_stages):
        x = 42 + index * (stage_w + card_gap)
        rounded_panel(c, x, 319, stage_w, 72, fill=fill, stroke=fill)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 17)
        c.drawCentredString(x + stage_w / 2, 357, f"{count:,}")
        c.setFont("Helvetica-Bold", 6.8)
        c.drawCentredString(x + stage_w / 2, 337, label.upper())

    rounded_panel(c, 42, 55, 432, 243, fill=WHITE)
    section_label(c, "Multi-location opportunity signals", 60, 274)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 13.5)
    c.drawString(60, 252, "Named group opportunities in open stages")
    widths = [185, 55, 155]
    draw_table_header(c, 60, 235, widths, ["Organization", "Open", "Stage mix"])
    row_y = 191
    for index, (name, count, stage_mix) in enumerate(group_pipeline):
        if index % 2 == 0:
            c.setFillColor(colors.HexColor("#FAF8F4"))
            c.rect(60, row_y - 7, sum(widths), 26, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Helvetica", 7.7)
        c.drawString(69, row_y + 1, name)
        c.drawRightString(60 + widths[0] + widths[1] - 9, row_y + 1, str(count))
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.2)
        c.drawRightString(60 + sum(widths) - 9, row_y + 1, stage_mix)
        row_y -= 28
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawString(60, 69, "Group matches are inferred from organization names and are not signed partnerships.")

    rounded_panel(c, 492, 55, 258, 243, fill=FOREST, stroke=FOREST)
    section_label(c, "Sample-requested examples", 512, 274, color=SAND)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13.5)
    c.drawString(512, 252, "Advanced open opportunities")
    y = 225
    for name in sample_names:
        c.setFillColor(GOLD)
        c.circle(515, y + 2, 2.2, fill=1, stroke=0)
        y = draw_wrapped(c, name, 525, y + 5, 205, size=7.3, color=WHITE, leading=9.5, max_lines=2) - 6
    c.setStrokeColor(colors.HexColor("#536252"))
    c.line(512, 101, 730, 101)
    c.setFillColor(colors.HexColor("#AFC5B7"))
    c.setFont("Helvetica", 6.5)
    c.drawString(512, 86, "No expected spend or deal value is stored in the app,")
    c.drawString(512, 75, "so pipeline is shown as lead volume and stage only.")
    c.showPage()


def draw_projection_chart(c: canvas.Canvas, x: float, y: float, w: float, h: float):
    rounded_panel(c, x, y, w, h, fill=WHITE)
    section_label(c, "36-month revenue scenario", x + 18, y + h - 22)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 18, y + h - 44, "Monthly revenue with 14 new accounts per month")
    base, _ = projection_series(0.60)
    low, _ = projection_series(0.45)
    high, _ = projection_series(0.70)
    chart_x = x + 50
    chart_y = y + 42
    chart_w = w - 80
    chart_h = h - 105
    max_y = 160000
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    for tick in [0, 40000, 80000, 120000, 160000]:
        yy = chart_y + tick / max_y * chart_h
        c.line(chart_x, yy, chart_x + chart_w, yy)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawRightString(chart_x - 7, yy - 2, compact_money(tick))
    for tick in [0, 12, 24, 36]:
        xx = chart_x + tick / 36 * chart_w
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawCentredString(xx, chart_y - 15, f"M{tick}")

    def point(month: int, value: float) -> tuple[float, float]:
        return chart_x + month / 36 * chart_w, chart_y + value / max_y * chart_h

    upper = [point(month, value) for month, value in enumerate(high)]
    lower = [point(month, value) for month, value in enumerate(low)]
    band = c.beginPath()
    band.moveTo(*upper[0])
    for p in upper[1:]:
        band.lineTo(*p)
    for p in reversed(lower):
        band.lineTo(*p)
    band.close()
    c.setFillColor(colors.Color(0.12, 0.45, 0.39, alpha=0.12))
    c.setStrokeColor(colors.Color(0, 0, 0, alpha=0))
    c.drawPath(band, fill=1, stroke=0)

    c.setStrokeColor(EMERALD)
    c.setLineWidth(2.6)
    for month in range(36):
        c.line(*point(month, base[month]), *point(month + 1, base[month + 1]))
    for month in [0, 12, 24, 36]:
        px, py = point(month, base[month])
        c.setFillColor(EMERALD)
        c.circle(px, py, 4, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 6.8)
        label = compact_money(base[month])
        if month == 0:
            c.drawString(px + 7, py - 2, label)
        else:
            c.drawCentredString(px, py + 10, label)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawString(x + 18, y + 15, "Green line: base case | Shaded band: 45%-70% long-run monthly activity sensitivity")


def draw_page_five(c: canvas.Canvas):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "12-, 24-, and 36-Month Growth Scenario", "The base case holds the current book flat and adds monthly cohorts using observed order economics.", 5)
    draw_projection_chart(c, 42, 315, 708, 196)

    rounded_panel(c, 42, 143, 708, 151, fill=WHITE)
    section_label(c, "Base-case milestones", 60, 272)
    widths = [68, 79, 93, 132, 139, 123]
    labels = ["Horizon", "Accounts added", "Exit active*", "Revenue in year", "Cumulative revenue", "Exit monthly"]
    draw_table_header(c, 60, 253, widths, labels)
    rows = [
        ("12 months", "168", "~158", "$473.3K", "$473.3K", "$57.4K"),
        ("24 months", "336", "~259", "$937.9K", "$1.41M", "$95.8K"),
        ("36 months", "504", "~360", "$1.40M", "$2.81M", "$134.2K"),
    ]
    row_y = 207
    for index, row in enumerate(rows):
        if index % 2 == 0:
            c.setFillColor(colors.HexColor("#FAF8F4"))
            c.rect(60, row_y - 7, sum(widths), 23, fill=1, stroke=0)
        cursor = 60
        for col, (value, width) in enumerate(zip(row, widths)):
            c.setFillColor(INK if col < 3 else EMERALD)
            c.setFont("Helvetica-Bold" if col in (0, 3, 4, 5) else "Helvetica", 7.8)
            if col == 0:
                c.drawString(cursor + 9, row_y + 1, value)
            else:
                c.drawRightString(cursor + width - 9, row_y + 1, value)
            cursor += width
        row_y -= 25
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.3)
    c.drawString(60, 148, "*Exit active is an expected transacting-account equivalent: 47 August buyers plus modeled cohorts.")

    rounded_panel(c, 42, 45, 450, 86, fill=WHITE)
    section_label(c, "Model assumptions", 60, 112)
    assumptions = [
        "14 new accounts every month; no price increase.",
        "Current book held at August's $17,165.43 monthly order revenue.",
        "Recent first order: $220.53; active monthly spend: $380.95.",
        "Monthly activity: 75.0%, 65.7%, 75.0%, then 60.0% from month 4 onward.",
    ]
    y = 93
    for item in assumptions:
        y = draw_bullet(c, item, 60, y, 415, size=6.8, dot_color=TAN) - 3

    rounded_panel(c, 510, 45, 240, 86, fill=FOREST, stroke=FOREST)
    section_label(c, "Decision range", 528, 112, color=SAND)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(528, 86, "$2.39M-$3.09M")
    c.setFillColor(SAND)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(528, 70, "36-MONTH CUMULATIVE REVENUE RANGE")
    c.showPage()


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("SoBrew Wholesale Growth & Recurring Revenue Brief")
    c.setAuthor("SoBrew")
    c.setSubject("Customer traction, recurring revenue, sales pipeline, and 36-month growth scenario")
    draw_page_one(c)
    draw_page_two(c)
    draw_page_three(c)
    draw_page_four(c)
    draw_page_five(c)
    c.save()


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
