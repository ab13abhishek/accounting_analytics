# Accounting Analytics — FastAPI

A double-entry bookkeeping engine exposed as a FastAPI service: **Journal → Ledger →
Trial Balance → P&L → Balance Sheet**, all computed live from journal lines (nothing
downstream is stored — fix a journal line and every report recalculates), plus a
CFA-style ratio/analytics layer across 50 seeded real-world small-business cases.

## Source data

Seeded from `Bookkeeping_50_Cases_EndToEnd.xlsx` (Australian GST bookkeeping
practice set): 50 businesses across 30+ industries, ~6,350 journal lines total
(100–150 per case), posted through a fixed 34-account chart of accounts. The
workbook itself computes Ledger/TB/P&L via spreadsheet formulas from the Journal —
this project reimplements that same pipeline as a proper computation engine
(`app/services/accounting_engine.py`) instead of spreadsheet formulas.

`scripts/extract_xlsx_seed.py` is a one-time converter: it reads the `.xlsx` and
writes `app/seed_data/*.json`. The running app never touches the spreadsheet —
only the JSON. `expected_results.json` captures the workbook's *own* computed
figures for every case, used only by the test suite to prove the engine
reconciles to source (see below).

## Architecture

```
app/
  models.py                    Company, Account, JournalEntry, JournalLine (SQLAlchemy)
  schemas.py                   Pydantic request/response models
  database.py                  SQLite session/engine
  services/accounting_engine.py   build_ledger() -> build_trial_balance() / build_pnl() -> build_balance_sheet()
  services/analytics.py        CFA ratios: margins, current/quick ratio, GST position, industry benchmarks
  routers/companies.py         GET /companies, /companies/{id}, /accounts
  routers/journal.py           GET/POST /companies/{id}/journal  (POST validates debits == credits)
  routers/reports.py           GET .../ledger, .../trial-balance, .../pnl, .../balance-sheet
  routers/analytics.py         GET /analytics/ratios, /analytics/industry-benchmark, /analytics/overview
  seed_data/                   extracted JSON (chart of accounts, companies, journal lines, expected results)
  seed.py                      loads seed_data/*.json into SQLite
  main.py                      FastAPI app
scripts/extract_xlsx_seed.py   one-time .xlsx -> JSON converter
tests/test_accounting_engine.py  reconciles all 50 cases against the workbook's own numbers
```

### Balance sheet scope note

The source practice set is a single accounting period with no opening balance
sheet and no owner's-equity account in its chart of accounts (by design — it's a
bookkeeping/GST practice set, not a full statutory set of accounts). Equity is
therefore derived as a single **Retained Earnings (current period) = Net Profit**
line, so `Assets = Liabilities + Equity` holds exactly (verified for all 50 cases
in `tests/test_accounting_engine.py::test_balance_sheet_balances`). Say this
explicitly if you cite the balance sheet in your CFA write-up.

## Run it

```bash
pip install -r requirements.txt

# 1. (already done — committed seed_data/*.json is derived from the source .xlsx)
#    Re-run only if you need to regenerate from the original workbook:
#    python scripts/extract_xlsx_seed.py "C:\path\to\Bookkeeping_50_Cases_EndToEnd.xlsx"

# 2. Load the seed data into SQLite
python -m app.seed

# 3. Run the API
python -m uvicorn app.main:app --reload
# docs at http://127.0.0.1:8000/docs

# 4. Run the reconciliation test suite (100 tests: TB balances + BS balances for all 50 cases)
python -m pytest tests/ -v
```

## Example calls

```
GET /companies?category=GST Reconciliation / BAS Preparation
GET /companies/1/journal
GET /companies/1/ledger
GET /companies/1/trial-balance      # { is_balanced: true, total_debits == total_credits }
GET /companies/1/pnl                # income lines, expense lines, net_profit, net_margin_pct
GET /companies/1/balance-sheet      # assets, liabilities, retained_earnings, is_balanced
GET /analytics/ratios/1             # current ratio, quick ratio, GST net position, top expense driver
GET /analytics/ratios               # same, for all 50 companies — cross-sectional CFA comparison
GET /analytics/industry-benchmark   # avg net margin / current ratio per industry
POST /companies/1/journal           # add a new double-entry transaction (rejected if unbalanced)
```

## For the CFA project

Because every company here is a distinct business in a distinct industry for a
single period, "trend" analysis in this dataset means **cross-sectional
comparison** (company vs. company, industry vs. industry, category vs. category)
rather than one company over time — `/analytics/ratios` and
`/analytics/industry-benchmark` are built for exactly that. The four JD
categories (Month-End Processing, AR/AP & Invoice Processing, Daily Transaction
Recording, GST Reconciliation/BAS) each contain 10–15 companies, which is the
more statistically meaningful grouping than "industry" (which is ~1 company
each).
