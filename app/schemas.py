from datetime import date

from pydantic import BaseModel, Field, model_validator


class CompanyOut(BaseModel):
    id: int
    case_no: int
    business_name: str
    industry: str
    category: str

    model_config = {"from_attributes": True}


class CompanyIn(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    industry: str = Field(min_length=1, max_length=200)
    category: str = Field(default="Custom", max_length=200)


class AccountOut(BaseModel):
    code: str
    name: str
    account_type: str
    normal_balance: str

    model_config = {"from_attributes": True}


class JournalLineIn(BaseModel):
    account_code: str
    gst_code: str | None = None
    debit: float = Field(default=0.0, ge=0)
    credit: float = Field(default=0.0, ge=0)


class JournalEntryIn(BaseModel):
    date: date
    description: str
    lines: list[JournalLineIn]

    @model_validator(mode="after")
    def check_balanced(self) -> "JournalEntryIn":
        if len(self.lines) < 2:
            raise ValueError("A journal entry needs at least two lines (double-entry).")
        total_debit = round(sum(l.debit for l in self.lines), 2)
        total_credit = round(sum(l.credit for l in self.lines), 2)
        if abs(total_debit - total_credit) > 0.01:
            raise ValueError(
                f"Journal entry is not balanced: debits={total_debit} vs credits={total_credit}"
            )
        if total_debit == 0:
            raise ValueError("Journal entry has zero value.")
        return self


class JournalLineOut(BaseModel):
    account_code: str
    account_name: str
    gst_code: str | None
    debit: float
    credit: float


class JournalEntryOut(BaseModel):
    txn_id: int
    date: date
    description: str
    lines: list[JournalLineOut]


class LedgerRowOut(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    normal_balance: str
    total_debits: float
    total_credits: float
    closing_balance: float
    is_balance_sheet: bool


class TrialBalanceRowOut(BaseModel):
    account_code: str
    account_name: str
    debit_balance: float
    credit_balance: float


class TrialBalanceOut(BaseModel):
    rows: list[TrialBalanceRowOut]
    total_debits: float
    total_credits: float
    is_balanced: bool


class PnLLineOut(BaseModel):
    account_code: str
    account_name: str
    amount: float


class ProfitAndLossOut(BaseModel):
    income: list[PnLLineOut]
    expenses: list[PnLLineOut]
    total_income: float
    total_expenses: float
    net_profit: float
    net_margin_pct: float


class BalanceSheetOut(BaseModel):
    assets: list[PnLLineOut]
    total_assets: float
    liabilities: list[PnLLineOut]
    total_liabilities: float
    retained_earnings: float
    total_liabilities_and_equity: float
    is_balanced: bool


class RatiosOut(BaseModel):
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
