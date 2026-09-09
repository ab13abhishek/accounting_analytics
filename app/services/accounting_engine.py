"""
The accounting engine: everything downstream of the journal is *computed*,
never stored. This mirrors the source workbook's own design (Ledger, TB and
P&L are formulas over the Journal) and is the reason a bug fix in one
journal line automatically flows through to every report.

Pipeline:  JournalLine rows  -->  ledger()  -->  trial_balance()  -->  pnl() / balance_sheet()
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountType, JournalLine, NormalBalance


def _round2(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


@dataclass
class LedgerRow:
    account_code: str
    account_name: str
    account_type: str
    normal_balance: str
    total_debits: float
    total_credits: float
    closing_balance: float
    is_balance_sheet: bool


@dataclass
class TrialBalanceRow:
    account_code: str
    account_name: str
    debit_balance: float
    credit_balance: float


@dataclass
class TrialBalance:
    rows: list[TrialBalanceRow]
    total_debits: float
    total_credits: float

    @property
    def is_balanced(self) -> bool:
        return abs(self.total_debits - self.total_credits) < 0.005


@dataclass
class PnLLine:
    account_code: str
    account_name: str
    amount: float


@dataclass
class ProfitAndLoss:
    income: list[PnLLine]
    expenses: list[PnLLine]
    total_income: float
    total_expenses: float
    net_profit: float


@dataclass
class BalanceSheetSection:
    lines: list[PnLLine]
    total: float


@dataclass
class BalanceSheet:
    assets: BalanceSheetSection
    liabilities: BalanceSheetSection
    net_profit_current_period: float
    retained_earnings: float
    total_liabilities_and_equity: float
    is_balanced: bool


def build_ledger(db: Session, company_id: int) -> list[LedgerRow]:
    """Post every journal line for this company into per-account totals."""
    query = (
        select(
            Account.code,
            Account.name,
            Account.account_type,
            Account.normal_balance,
            JournalLine.debit,
            JournalLine.credit,
        )
        .join(JournalLine, JournalLine.account_id == Account.id)
        .join(JournalLine.entry)
        .where(JournalLine.entry.has(company_id=company_id))
    )
    totals: dict[str, dict] = {}
    for code, name, acct_type, normal, debit, credit in db.execute(query):
        row = totals.setdefault(
            code,
            {
                "name": name,
                "type": acct_type,
                "normal": normal,
                "debits": 0.0,
                "credits": 0.0,
            },
        )
        row["debits"] += debit or 0.0
        row["credits"] += credit or 0.0

    ledger_rows: list[LedgerRow] = []
    for code, row in sorted(totals.items()):
        td, tc = row["debits"], row["credits"]
        closing = (td - tc) if row["normal"] == NormalBalance.DEBIT else (tc - td)
        acct_type = row["type"]
        is_bs = acct_type in (AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY)
        ledger_rows.append(
            LedgerRow(
                account_code=code,
                account_name=row["name"],
                account_type=acct_type.value if hasattr(acct_type, "value") else acct_type,
                normal_balance=row["normal"].value if hasattr(row["normal"], "value") else row["normal"],
                total_debits=_round2(td),
                total_credits=_round2(tc),
                closing_balance=_round2(closing),
                is_balance_sheet=is_bs,
            )
        )
    return ledger_rows


def build_trial_balance(ledger_rows: list[LedgerRow]) -> TrialBalance:
    rows = []
    total_debits = total_credits = 0.0
    for r in ledger_rows:
        if r.normal_balance == "DEBIT":
            debit_balance, credit_balance = max(r.closing_balance, 0.0), max(-r.closing_balance, 0.0)
        else:
            credit_balance, debit_balance = max(r.closing_balance, 0.0), max(-r.closing_balance, 0.0)
        rows.append(
            TrialBalanceRow(
                account_code=r.account_code,
                account_name=r.account_name,
                debit_balance=_round2(debit_balance),
                credit_balance=_round2(credit_balance),
            )
        )
        total_debits += debit_balance
        total_credits += credit_balance
    return TrialBalance(rows=rows, total_debits=_round2(total_debits), total_credits=_round2(total_credits))


def build_pnl(ledger_rows: list[LedgerRow]) -> ProfitAndLoss:
    income = [
        PnLLine(r.account_code, r.account_name, r.closing_balance)
        for r in ledger_rows
        if r.account_type == "INCOME" and abs(r.closing_balance) > 0.005
    ]
    expenses = [
        PnLLine(r.account_code, r.account_name, r.closing_balance)
        for r in ledger_rows
        if r.account_type in ("EXPENSE", "COGS") and abs(r.closing_balance) > 0.005
    ]
    total_income = _round2(sum(i.amount for i in income))
    total_expenses = _round2(sum(e.amount for e in expenses))
    return ProfitAndLoss(
        income=income,
        expenses=expenses,
        total_income=total_income,
        total_expenses=total_expenses,
        net_profit=_round2(total_income - total_expenses),
    )


def build_balance_sheet(ledger_rows: list[LedgerRow], net_profit: float) -> BalanceSheet:
    """
    NOTE on scope: the source practice set is a single accounting *period*
    with no opening balance sheet and no owner's-equity account in its
    chart of accounts (a deliberate simplification for a bookkeeping/GST
    practice set, not a full statutory balance sheet). We therefore derive
    equity as a single "Retained Earnings (current period)" line equal to
    net profit, so Assets = Liabilities + Equity holds exactly. This is
    disclosed here rather than silently assumed.
    """
    # Aggregate using each account's *type*-implied sign (debit-positive for
    # assets, credit-positive for liabilities), not its own normal_balance.
    # A contra account (e.g. Accumulated Depreciation is a credit-normal
    # ASSET; GST Paid is a debit-normal LIABILITY) must net *against* its
    # type total rather than add to it, or Assets != Liabilities + Equity.
    assets = [
        PnLLine(r.account_code, r.account_name, _round2(r.total_debits - r.total_credits))
        for r in ledger_rows
        if r.account_type == "ASSET"
    ]
    liabilities = [
        PnLLine(r.account_code, r.account_name, _round2(r.total_credits - r.total_debits))
        for r in ledger_rows
        if r.account_type == "LIABILITY"
    ]
    total_assets = _round2(sum(a.amount for a in assets))
    total_liabilities = _round2(sum(l.amount for l in liabilities))
    retained_earnings = _round2(net_profit)
    total_liab_and_equity = _round2(total_liabilities + retained_earnings)
    return BalanceSheet(
        assets=BalanceSheetSection(assets, total_assets),
        liabilities=BalanceSheetSection(liabilities, total_liabilities),
        net_profit_current_period=net_profit,
        retained_earnings=retained_earnings,
        total_liabilities_and_equity=total_liab_and_equity,
        is_balanced=abs(total_assets - total_liab_and_equity) < 0.01,
    )
