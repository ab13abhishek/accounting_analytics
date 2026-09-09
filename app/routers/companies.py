from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Company
from app.schemas import AccountOut, CompanyIn, CompanyOut

router = APIRouter(tags=["companies"])


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(
    industry: str | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Company).order_by(Company.case_no)
    if industry:
        stmt = stmt.where(Company.industry == industry)
    if category:
        stmt = stmt.where(Company.category == category)
    return db.execute(stmt).scalars().all()


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(payload: CompanyIn, db: Session = Depends(get_db)):
    max_case_no = db.execute(select(Company.case_no).order_by(Company.case_no.desc()).limit(1)).scalar_one_or_none()
    company = Company(
        case_no=(max_case_no or 0) + 1,
        business_name=payload.business_name,
        industry=payload.industry,
        category=payload.category,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@router.get("/companies/{company_id}", response_model=CompanyOut)
def get_company(company_id: int, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.execute(select(Account).order_by(Account.code)).scalars().all()
