"""
Loads app/seed_data/*.json (pre-extracted from the source workbook) into
the SQLite database: chart of accounts, 50 companies, and ~6,300 journal
lines across ~50 * 100+ transactions.

Run with:  python -m app.seed
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from app.database import Base, SessionLocal, engine
from app.models import Account, Company, JournalEntry, JournalLine

SEED_DIR = Path(__file__).resolve().parent / "seed_data"


def load_json(name: str):
    return json.loads((SEED_DIR / name).read_text(encoding="utf-8"))


def seed() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        coa = load_json("chart_of_accounts.json")
        accounts_by_code: dict[str, Account] = {}
        for a in coa:
            acct = Account(
                code=a["code"],
                name=a["name"],
                account_type=a["account_type"],
                normal_balance=a["normal_balance"],
            )
            db.add(acct)
            accounts_by_code[a["code"]] = acct
        db.flush()

        companies = load_json("companies.json")
        companies_by_case: dict[int, Company] = {}
        for c in companies:
            company = Company(
                case_no=c["case_no"],
                business_name=c["business_name"],
                industry=c["industry"],
                category=c["category"],
            )
            db.add(company)
            companies_by_case[c["case_no"]] = company
        db.flush()

        journal_entries = load_json("journal_entries.json")
        line_count = 0
        for case_no_str, lines in journal_entries.items():
            case_no = int(case_no_str)
            company = companies_by_case[case_no]

            entries_by_txn: dict[int, list[dict]] = {}
            for line in lines:
                entries_by_txn.setdefault(line["txn_id"], []).append(line)

            for txn_id, txn_lines in sorted(entries_by_txn.items()):
                first = txn_lines[0]
                entry = JournalEntry(
                    company_id=company.id,
                    txn_id=txn_id,
                    date=date.fromisoformat(first["date"][:10]),
                    description=first["description"] or "",
                )
                db.add(entry)
                db.flush()
                for line in txn_lines:
                    account = accounts_by_code.get(line["account_code"])
                    if account is None:
                        continue
                    db.add(
                        JournalLine(
                            entry_id=entry.id,
                            account_id=account.id,
                            gst_code=line.get("gst_code"),
                            debit=line["debit"],
                            credit=line["credit"],
                        )
                    )
                    line_count += 1

        db.commit()
        print(f"Seeded {len(accounts_by_code)} accounts, {len(companies_by_case)} companies, {line_count} journal lines.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
