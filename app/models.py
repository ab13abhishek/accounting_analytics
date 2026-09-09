import enum

from sqlalchemy import Date, Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    COGS = "COGS"
    EXPENSE = "EXPENSE"


class NormalBalance(str, enum.Enum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_no: Mapped[int] = mapped_column(unique=True, index=True)
    business_name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(200))

    journal_entries: Mapped[list["JournalEntry"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )


class Account(Base):
    """Global chart of accounts, shared across all companies."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    normal_balance: Mapped[NormalBalance] = mapped_column(Enum(NormalBalance))

    @property
    def is_balance_sheet(self) -> bool:
        return self.account_type in (AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY)


class JournalEntry(Base):
    """One transaction header. May contain multiple debit/credit lines."""

    __tablename__ = "journal_entries"
    __table_args__ = (UniqueConstraint("company_id", "txn_id", name="uq_company_txn"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    txn_id: Mapped[int] = mapped_column(Integer)
    date: Mapped[str] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(500))

    company: Mapped["Company"] = relationship(back_populates="journal_entries")
    lines: Mapped[list["JournalLine"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan"
    )


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    gst_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    debit: Mapped[float] = mapped_column(Float, default=0.0)
    credit: Mapped[float] = mapped_column(Float, default=0.0)

    entry: Mapped["JournalEntry"] = relationship(back_populates="lines")
    account: Mapped["Account"] = relationship()
