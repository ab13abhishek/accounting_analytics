"""
Reconciles the engine's computed Ledger / TB / P&L against the source
workbook's own computed values (app/seed_data/expected_results.json) for
every one of the 50 seeded cases -- the same "trace it back to source"
check a bookkeeping/audit review performs by hand.
"""
import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Company
from app.services.accounting_engine import build_balance_sheet, build_ledger, build_pnl, build_trial_balance

SEED_DIR = Path(__file__).resolve().parent.parent / "app" / "seed_data"
EXPECTED = json.loads((SEED_DIR / "expected_results.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def db() -> Session:
    session = SessionLocal()
    yield session
    session.close()


@pytest.mark.parametrize("case_no", list(range(1, 51)))
def test_case_reconciles_to_workbook(db: Session, case_no: int):
    company = db.query(Company).filter_by(case_no=case_no).one()
    expected = EXPECTED[str(case_no)]

    ledger_rows = build_ledger(db, company.id)
    tb = build_trial_balance(ledger_rows)
    pnl = build_pnl(ledger_rows)

    assert tb.is_balanced, f"Case {case_no}: trial balance does not balance"

    expected_ledger = {r["account_code"]: r for r in expected["ledger"]}
    for row in ledger_rows:
        exp = expected_ledger.get(row.account_code)
        assert exp is not None, f"Case {case_no}: unexpected account {row.account_code} in ledger"
        assert row.closing_balance == pytest.approx(exp["closing_balance"], abs=0.02), (
            f"Case {case_no} {row.account_code}: got {row.closing_balance}, "
            f"workbook says {exp['closing_balance']}"
        )

    assert pnl.total_income == pytest.approx(expected["pnl"]["total_income"], abs=0.02)
    assert pnl.total_expenses == pytest.approx(expected["pnl"]["total_expenses"], abs=0.02)
    assert pnl.net_profit == pytest.approx(expected["pnl"]["net_profit"], abs=0.02)


@pytest.mark.parametrize("case_no", list(range(1, 51)))
def test_balance_sheet_balances(db: Session, case_no: int):
    company = db.query(Company).filter_by(case_no=case_no).one()
    ledger_rows = build_ledger(db, company.id)
    pnl = build_pnl(ledger_rows)
    bs = build_balance_sheet(ledger_rows, pnl.net_profit)
    assert bs.is_balanced, (
        f"Case {case_no}: Assets ({bs.assets.total}) != Liabilities + Equity "
        f"({bs.total_liabilities_and_equity})"
    )
