"""
CFA-flavoured analytics layer built on top of the accounting engine.

Everything here is derived, cross-sectionally, across the 50 seeded
companies (each one is a distinct business/industry for a single period --
there is no time series per company, so "trend" analysis in this dataset
means comparing companies and industries, not one company over time).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Company
from app.services.accounting_engine import build_balance_sheet, build_ledger, build_pnl

CURRENT_ASSET_CODES = {"1-1000", "1-1100", "1-1300"}  # Bank, AR, Prepaid Expenses
QUICK_ASSET_CODES = {"1-1000", "1-1100"}  # Bank, AR (excludes prepaid)
CURRENT_LIABILITY_CODES = {"2-1000", "2-1100", "2-1600"}  # AP, GST Collected, Accrued Expenses


@dataclass
class CompanyRatios:
    company_id: int
    business_name: str
    industry: str
    category: str
    total_income: float
    total_expenses: float
    net_profit: float
    net_margin_pct: float
    current_assets: float
    current_liabilities: float
    current_ratio: float
    quick_ratio: float
    gst_net_position: float
    top_expense_account: str | None
    top_expense_pct_of_income: float


def compute_ratios(db: Session, company: Company) -> CompanyRatios:
    ledger_rows = build_ledger(db, company.id)
    pnl = build_pnl(ledger_rows)

    by_code = {r.account_code: r for r in ledger_rows}

    current_assets = sum(by_code[c].closing_balance for c in CURRENT_ASSET_CODES if c in by_code)
    quick_assets = sum(by_code[c].closing_balance for c in QUICK_ASSET_CODES if c in by_code)
    current_liabilities = sum(
        by_code[c].closing_balance for c in CURRENT_LIABILITY_CODES if c in by_code
    )

    gst_collected = by_code.get("2-1100")
    gst_paid = by_code.get("2-1200")
    gst_net = (gst_collected.closing_balance if gst_collected else 0.0) - (
        gst_paid.closing_balance if gst_paid else 0.0
    )

    top_expense = max(pnl.expenses, key=lambda e: e.amount, default=None)

    net_margin = (pnl.net_profit / pnl.total_income * 100) if pnl.total_income else 0.0
    current_ratio = (current_assets / current_liabilities) if current_liabilities else float("inf")
    quick_ratio = (quick_assets / current_liabilities) if current_liabilities else float("inf")
    top_expense_pct = (top_expense.amount / pnl.total_income * 100) if top_expense and pnl.total_income else 0.0

    return CompanyRatios(
        company_id=company.id,
        business_name=company.business_name,
        industry=company.industry,
        category=company.category,
        total_income=pnl.total_income,
        total_expenses=pnl.total_expenses,
        net_profit=pnl.net_profit,
        net_margin_pct=round(net_margin, 2),
        current_assets=round(current_assets, 2),
        current_liabilities=round(current_liabilities, 2),
        current_ratio=round(current_ratio, 2) if current_ratio != float("inf") else 0.0,
        quick_ratio=round(quick_ratio, 2) if quick_ratio != float("inf") else 0.0,
        gst_net_position=round(gst_net, 2),
        top_expense_account=top_expense.account_name if top_expense else None,
        top_expense_pct_of_income=round(top_expense_pct, 2),
    )


def compute_all_ratios(db: Session) -> list[CompanyRatios]:
    companies = db.execute(select(Company).order_by(Company.case_no)).scalars().all()
    return [compute_ratios(db, c) for c in companies]


def industry_benchmark(all_ratios: list[CompanyRatios]) -> list[dict]:
    grouped: dict[str, list[CompanyRatios]] = {}
    for r in all_ratios:
        grouped.setdefault(r.industry, []).append(r)

    out = []
    for industry, rows in sorted(grouped.items()):
        n = len(rows)
        out.append(
            {
                "industry": industry,
                "company_count": n,
                "avg_net_margin_pct": round(sum(r.net_margin_pct for r in rows) / n, 2),
                "avg_current_ratio": round(sum(r.current_ratio for r in rows) / n, 2),
                "total_income": round(sum(r.total_income for r in rows), 2),
                "total_net_profit": round(sum(r.net_profit for r in rows), 2),
            }
        )
    return out
