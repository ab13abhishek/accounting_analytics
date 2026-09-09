from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company
from app.schemas import (
    BalanceSheetOut,
    LedgerRowOut,
    PnLLineOut,
    ProfitAndLossOut,
    TrialBalanceOut,
    TrialBalanceRowOut,
)
from app.services.accounting_engine import build_balance_sheet, build_ledger, build_pnl, build_trial_balance

router = APIRouter(tags=["reports"])


def _get_company_or_404(company_id: int, db: Session) -> Company:
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.get("/companies/{company_id}/ledger", response_model=list[LedgerRowOut])
def get_ledger(company_id: int, db: Session = Depends(get_db)):
    _get_company_or_404(company_id, db)
    return build_ledger(db, company_id)


@router.get("/companies/{company_id}/trial-balance", response_model=TrialBalanceOut)
def get_trial_balance(company_id: int, db: Session = Depends(get_db)):
    _get_company_or_404(company_id, db)
    ledger_rows = build_ledger(db, company_id)
    tb = build_trial_balance(ledger_rows)
    return TrialBalanceOut(
        rows=[TrialBalanceRowOut(**vars(r)) for r in tb.rows],
        total_debits=tb.total_debits,
        total_credits=tb.total_credits,
        is_balanced=tb.is_balanced,
    )


@router.get("/companies/{company_id}/pnl", response_model=ProfitAndLossOut)
def get_pnl(company_id: int, db: Session = Depends(get_db)):
    _get_company_or_404(company_id, db)
    ledger_rows = build_ledger(db, company_id)
    pnl = build_pnl(ledger_rows)
    net_margin = (pnl.net_profit / pnl.total_income * 100) if pnl.total_income else 0.0
    return ProfitAndLossOut(
        income=[PnLLineOut(**vars(i)) for i in pnl.income],
        expenses=[PnLLineOut(**vars(e)) for e in pnl.expenses],
        total_income=pnl.total_income,
        total_expenses=pnl.total_expenses,
        net_profit=pnl.net_profit,
        net_margin_pct=round(net_margin, 2),
    )


@router.get("/companies/{company_id}/balance-sheet", response_model=BalanceSheetOut)
def get_balance_sheet(company_id: int, db: Session = Depends(get_db)):
    _get_company_or_404(company_id, db)
    ledger_rows = build_ledger(db, company_id)
    pnl = build_pnl(ledger_rows)
    bs = build_balance_sheet(ledger_rows, pnl.net_profit)
    return BalanceSheetOut(
        assets=[PnLLineOut(**vars(a)) for a in bs.assets.lines],
        total_assets=bs.assets.total,
        liabilities=[PnLLineOut(**vars(l)) for l in bs.liabilities.lines],
        total_liabilities=bs.liabilities.total,
        retained_earnings=bs.retained_earnings,
        total_liabilities_and_equity=bs.total_liabilities_and_equity,
        is_balanced=bs.is_balanced,
    )
