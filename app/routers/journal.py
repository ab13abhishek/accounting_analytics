from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Account, Company, JournalEntry, JournalLine
from app.schemas import JournalEntryIn, JournalEntryOut, JournalLineOut

router = APIRouter(tags=["journal"])


@router.get("/companies/{company_id}/journal", response_model=list[JournalEntryOut])
def get_journal(company_id: int, db: Session = Depends(get_db)):
    if not db.get(Company, company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    entries = (
        db.execute(
            select(JournalEntry)
            .where(JournalEntry.company_id == company_id)
            .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
            .order_by(JournalEntry.date, JournalEntry.txn_id)
        )
        .scalars()
        .all()
    )
    return [
        JournalEntryOut(
            txn_id=e.txn_id,
            date=e.date,
            description=e.description,
            lines=[
                JournalLineOut(
                    account_code=l.account.code,
                    account_name=l.account.name,
                    gst_code=l.gst_code,
                    debit=l.debit,
                    credit=l.credit,
                )
                for l in e.lines
            ],
        )
        for e in entries
    ]


@router.post("/companies/{company_id}/journal", response_model=JournalEntryOut, status_code=201)
def post_journal_entry(company_id: int, payload: JournalEntryIn, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    accounts_by_code = {
        code: db.execute(select(Account).where(Account.code == code)).scalar_one_or_none()
        for code in {l.account_code for l in payload.lines}
    }
    missing = [code for code, acct in accounts_by_code.items() if acct is None]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown account code(s): {missing}")

    max_txn_id = db.execute(
        select(JournalEntry.txn_id)
        .where(JournalEntry.company_id == company_id)
        .order_by(JournalEntry.txn_id.desc())
        .limit(1)
    ).scalar_one_or_none()
    next_txn_id = (max_txn_id or 0) + 1

    entry = JournalEntry(
        company_id=company_id, txn_id=next_txn_id, date=payload.date, description=payload.description
    )
    db.add(entry)
    db.flush()

    for line in payload.lines:
        db.add(
            JournalLine(
                entry_id=entry.id,
                account_id=accounts_by_code[line.account_code].id,
                gst_code=line.gst_code,
                debit=line.debit,
                credit=line.credit,
            )
        )
    db.commit()
    db.refresh(entry)

    return JournalEntryOut(
        txn_id=entry.txn_id,
        date=entry.date,
        description=entry.description,
        lines=[
            JournalLineOut(
                account_code=accounts_by_code[l.account_code].code,
                account_name=accounts_by_code[l.account_code].name,
                gst_code=l.gst_code,
                debit=l.debit,
                credit=l.credit,
            )
            for l in payload.lines
        ],
    )
