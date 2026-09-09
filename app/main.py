from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import DB_PATH
from app.routers import analytics, companies, journal, reports

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(
    title="Accounting Analytics API",
    description=(
        "Journal -> Ledger -> Trial Balance -> P&L -> Balance Sheet, computed live "
        "from double-entry journal lines, seeded with 50 real-world Australian "
        "small-business bookkeeping cases across 30+ industries."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router)
app.include_router(journal.router)
app.include_router(reports.router)
app.include_router(analytics.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def root():
    """The actual web UI. API docs live at /docs, machine-readable status at /api/status."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/status")
def api_status():
    return {
        "name": "Accounting Analytics API",
        "docs": "/docs",
        "seeded": DB_PATH.exists(),
        "hint": "Run `python -m app.seed` first if /companies returns an empty list.",
    }


@app.on_event("startup")
def check_seeded():
    if not DB_PATH.exists():
        print("WARNING: database not found. Run `python -m app.seed` before using the API.")
