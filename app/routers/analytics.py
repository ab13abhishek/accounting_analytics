from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company
from app.schemas import RatiosOut
from app.services.analytics import compute_all_ratios, compute_ratios, industry_benchmark

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/ratios", response_model=list[RatiosOut])
def all_ratios(db: Session = Depends(get_db)):
    return [RatiosOut(**vars(r)) for r in compute_all_ratios(db)]


@router.get("/ratios/{company_id}", response_model=RatiosOut)
def company_ratios(company_id: int, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return RatiosOut(**vars(compute_ratios(db, company)))


@router.get("/industry-benchmark")
def industry_benchmark_endpoint(db: Session = Depends(get_db)):
    return industry_benchmark(compute_all_ratios(db))


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    ratios = compute_all_ratios(db)
    n = len(ratios)
    return {
        "company_count": n,
        "total_income": round(sum(r.total_income for r in ratios), 2),
        "total_net_profit": round(sum(r.net_profit for r in ratios), 2),
        "avg_net_margin_pct": round(sum(r.net_margin_pct for r in ratios) / n, 2) if n else 0,
        "most_profitable": max(ratios, key=lambda r: r.net_margin_pct).business_name if ratios else None,
        "least_profitable": min(ratios, key=lambda r: r.net_margin_pct).business_name if ratios else None,
    }
