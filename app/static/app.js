/* Accounting Analytics -- vanilla-JS frontend, same-origin fetch calls
   against the FastAPI app. No build step, no framework. */

const $app = document.getElementById("app");
const $filterPane = document.getElementById("filterPane");
const $topbarActions = document.getElementById("topbarActions");
const $crumbName = document.getElementById("crumbName");

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function fmtMoney(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v) {
  const n = Number(v) || 0;
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error("Request failed");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
function apiErrorMessage(err) {
  if (err.body && Array.isArray(err.body.detail)) {
    return err.body.detail.map((d) => d.msg || JSON.stringify(d)).join(" · ");
  }
  if (err.body && typeof err.body.detail === "string") return err.body.detail;
  return "Something went wrong (" + (err.status || "network error") + ").";
}

const ACCOUNT_TYPE_LABEL = {
  ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity",
  INCOME: "Income", COGS: "Cost of goods sold", EXPENSE: "Expenses",
};

// ---------- theme ----------
function initTheme() {
  const saved = localStorage.getItem("bca-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bca-theme", next);
  });
}

// ---------- router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "company" && parts[1]) {
    return { name: "company", id: Number(parts[1]), tab: parts[2] || "journal" };
  }
  if (parts[0] === "companies") return { name: "companies" };
  return { name: "overview" };
}

function setSidebarActive(routeName) {
  document.querySelectorAll(".sidebar-item[data-route]").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === routeName);
  });
}

async function render() {
  const route = parseHash();
  setSidebarActive(route.name === "company" ? "" : route.name);
  $filterPane.hidden = true;
  $filterPane.innerHTML = "";
  $topbarActions.innerHTML = "";
  try {
    if (route.name === "companies") {
      $crumbName.textContent = "Companies";
      await renderCompaniesList();
    } else if (route.name === "overview") {
      $crumbName.textContent = "Overview";
      await renderOverviewPage();
    } else {
      await renderCompanyDetail(route.id, route.tab);
    }
  } catch (err) {
    $app.innerHTML = `<div class="page-inner"><div class="card"><div class="form-error">Failed to load: ${esc(apiErrorMessage(err))}</div></div></div>`;
  }
}
window.addEventListener("hashchange", render);
document.querySelectorAll(".sidebar-item[data-route]").forEach((btn) => {
  btn.addEventListener("click", () => { location.hash = "#/" + btn.dataset.route; });
});
document.getElementById("sbNewCo").addEventListener("click", openNewCompanyModal);

// ---------- shared filter pane (Power-BI-style slicer: category checkboxes + search) ----------
function mountFilterPane(categories, countByCategory, state, callbacks) {
  $filterPane.innerHTML = `
    <div class="fp-title">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="4,4 20,4 14,12 14,19 10,21 10,12"/></svg>
      Filters
    </div>
    <div class="slicer-group">
      <div class="slicer-head"><span>Category</span><button class="slicer-clear" id="fpClear" style="visibility:${state.categories.size ? "visible" : "hidden"}">Clear</button></div>
      <div id="fpCatItems"></div>
    </div>
    <div class="slicer-group">
      <div class="slicer-head"><span>Search</span></div>
      <input class="input" id="fpSearch" type="text" placeholder="Business or industry&hellip;" style="width:100%;" value="${esc(state.search || "")}">
    </div>
  `;
  const itemsEl = document.getElementById("fpCatItems");
  categories.forEach((c) => {
    const row = document.createElement("label");
    row.className = "slicer-item";
    row.innerHTML = `<input type="checkbox" ${state.categories.has(c) ? "checked" : ""}><span class="si-label"></span><span class="si-count">${countByCategory[c] || 0}</span>`;
    row.querySelector(".si-label").textContent = c;
    row.querySelector("input").addEventListener("change", () => callbacks.onToggleCategory(c));
    itemsEl.appendChild(row);
  });
  document.getElementById("fpClear").addEventListener("click", callbacks.onClear);
  document.getElementById("fpSearch").addEventListener("input", (e) => callbacks.onSearch(e.target.value));

  const activeCount = state.categories.size + (state.search ? 1 : 0);
  $topbarActions.innerHTML = `
    <button class="filterbtn ${activeCount ? "active" : ""}" id="btnToggleFilters">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="4,4 20,4 14,12 14,19 10,21 10,12"/></svg>
      Filters
      ${activeCount ? `<span class="fcount">${activeCount}</span>` : ""}
    </button>
  `;
  document.getElementById("btnToggleFilters").addEventListener("click", () => {
    $filterPane.hidden = !$filterPane.hidden;
  });
  $filterPane.hidden = false;
}

const CATEGORY_SHORT = {
  "Month-End Processing & Management Reports": "Month-End Processing",
  "Accounts Receivable & Payable / Invoice Processing": "AR/AP & Invoicing",
  "Daily Transaction Recording": "Daily Transactions",
  "GST Reconciliation / BAS Preparation": "GST Reconciliation",
};
const shortCat = (c) => CATEGORY_SHORT[c] || c;

// ============================================================
// Companies list
// ============================================================
let companiesCache = null;
let companiesPageState = { categories: new Set(), search: "" };

async function renderCompaniesList() {
  $app.innerHTML = `<div class="loading">Loading companies&hellip;</div>`;
  if (!companiesCache) companiesCache = await api("/companies");
  const companies = companiesCache.map((c) => ({ ...c, category_short: shortCat(c.category) }));
  const categories = [...new Set(companies.map((c) => c.category_short))].sort();
  const countByCategory = {};
  categories.forEach((c) => (countByCategory[c] = companies.filter((x) => x.category_short === c).length));

  $app.innerHTML = `
    <div class="page-inner">
      <div class="toolbar">
        <div style="font-size:12.5px; color:var(--ink-muted);">${companies.length} companies seeded &middot; add your own from the + button</div>
        <span class="grow"></span>
        <button class="btn primary" id="btnNewCo">+ New company</button>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th class="num">#</th><th>Business</th><th>Industry</th><th>Category</th>
          </tr></thead>
          <tbody id="coRows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("btnNewCo").addEventListener("click", openNewCompanyModal);

  function draw() {
    mountFilterPane(categories, countByCategory, companiesPageState, {
      onToggleCategory: (c) => {
        companiesPageState.categories.has(c) ? companiesPageState.categories.delete(c) : companiesPageState.categories.add(c);
        draw();
      },
      onClear: () => { companiesPageState.categories.clear(); draw(); },
      onSearch: (v) => { companiesPageState.search = v; drawRows(); },
    });
    drawRows();
  }

  function drawRows() {
    const q = companiesPageState.search.toLowerCase();
    const rows = companies.filter((c) => {
      if (companiesPageState.categories.size && !companiesPageState.categories.has(c.category_short)) return false;
      if (q && !c.business_name.toLowerCase().includes(q) && !c.industry.toLowerCase().includes(q)) return false;
      return true;
    });
    const body = document.getElementById("coRows");
    body.innerHTML = rows.length
      ? rows.map((c) => `
        <tr class="clickable" data-id="${c.id}">
          <td class="num mono">${c.case_no}</td>
          <td>${esc(c.business_name)}</td>
          <td>${esc(c.industry)}</td>
          <td><span class="badge neutral">${esc(c.category_short)}</span></td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="empty">No companies match this filter.</td></tr>`;
    body.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => { location.hash = `#/company/${tr.dataset.id}/journal`; });
    });
  }

  draw();
}

function openNewCompanyModal() {
  const tpl = document.getElementById("tpl-modal-newco").content.cloneNode(true);
  document.body.appendChild(tpl);
  const backdrop = document.getElementById("modalBackdrop");
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.getElementById("ncCancel").addEventListener("click", close);
  document.getElementById("ncCreate").addEventListener("click", async () => {
    const business_name = document.getElementById("ncName").value.trim();
    const industry = document.getElementById("ncIndustry").value.trim();
    const category = document.getElementById("ncCategory").value;
    const errEl = document.getElementById("ncError");
    errEl.style.display = "none";
    if (!business_name || !industry) {
      errEl.textContent = "Business name and industry are both required.";
      errEl.style.display = "block";
      return;
    }
    try {
      const company = await api("/companies", { method: "POST", body: JSON.stringify({ business_name, industry, category }) });
      companiesCache = null;
      close();
      location.hash = `#/company/${company.id}/journal`;
    } catch (err) {
      errEl.textContent = apiErrorMessage(err);
      errEl.style.display = "block";
    }
  });
}

// ============================================================
// Overview page (cross-company dashboard -- the app's home page)
// ============================================================
let overviewFilterState = { categories: new Set(), search: "" };
let overviewSortState = { sortKey: "net_margin_pct", sortDir: "desc" };

const AN_COLS = [
  { key: "case_no", label: "#", type: "num" },
  { key: "business_name", label: "Business", type: "text" },
  { key: "industry", label: "Industry", type: "text" },
  { key: "category_short", label: "Category", type: "text" },
  { key: "total_income", label: "Income", type: "money" },
  { key: "net_profit", label: "Net profit", type: "money" },
  { key: "net_margin_pct", label: "Margin", type: "pct" },
  { key: "current_ratio", label: "Current ratio", type: "ratio" },
];

async function renderOverviewPage() {
  $app.innerHTML = `<div class="loading">Loading overview&hellip;</div>`;

  const [companies, ratios] = await Promise.all([
    companiesCache ? Promise.resolve(companiesCache) : api("/companies"),
    api("/analytics/ratios"),
  ]);
  companiesCache = companies;
  const rows = ratios.map((r) => ({ ...r, category_short: shortCat(r.category) }));

  // Expense structure needs each company's P&L expense lines -- fetch once, in parallel.
  const pnls = await Promise.all(rows.map((r) => api(`/companies/${r.company_id}/pnl`).catch(() => null)));
  rows.forEach((r, i) => { r.expense_lines = pnls[i] ? pnls[i].expenses : []; });

  const categories = [...new Set(rows.map((r) => r.category_short))].sort();
  const countByCategory = {};
  categories.forEach((c) => (countByCategory[c] = rows.filter((r) => r.category_short === c).length));

  $app.innerHTML = `
    <div class="page-inner">
      <div class="stat-grid" id="anKpis"></div>
      <div class="grid-2">
        <div class="card">
          <h2>Companies by category</h2>
          <div class="sub">Click a slice (or a legend row) to filter the whole page</div>
          <div id="chDonut" style="margin-top:10px;"></div>
        </div>
        <div class="card">
          <h2>Avg. net margin by category</h2>
          <div class="sub">Net profit &divide; total income, averaged per category</div>
          <div id="chMarginCat" style="margin-top:10px;"></div>
          <h2 style="margin-top:20px;">Avg. current ratio by category</h2>
          <div class="sub">(Bank + Receivables + Prepaid) &divide; (Payables + GST Collected + Accrued)</div>
          <div id="chRatioCat" style="margin-top:10px;"></div>
        </div>
      </div>
      <div class="card">
        <h2>Net margin across all companies &mdash; ranked</h2>
        <div class="sub">Sorted highest to lowest within the current filter. Hover to inspect, click a point to open that company.</div>
        <div id="chRanked" style="margin-top:14px;"></div>
      </div>
      <div class="grid-2-wide">
        <div class="card">
          <h2>Profitability vs. liquidity</h2>
          <div class="sub">Current ratio (x) vs. net margin (y) &mdash; the 1&times; and 0% lines mark the breakeven quadrants</div>
          <div id="chScatter" style="margin-top:10px; display:flex; justify-content:center;"></div>
        </div>
        <div class="card">
          <h2>Where the money goes</h2>
          <div class="sub">Top expense accounts, averaged as % of income across companies that record them</div>
          <div id="chExpense" style="margin-top:10px;"></div>
        </div>
      </div>
      <div class="card">
        <h2>All companies</h2>
        <div class="tablewrap" style="margin-top:10px;">
          <table><thead><tr id="anHead"></tr></thead><tbody id="anBody"></tbody></table>
        </div>
      </div>
    </div>
  `;

  function currentRows() {
    const q = overviewFilterState.search.toLowerCase();
    return rows.filter((r) => {
      if (overviewFilterState.categories.size && !overviewFilterState.categories.has(r.category_short)) return false;
      if (q && !r.business_name.toLowerCase().includes(q) && !r.industry.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function drawFilterPane() {
    mountFilterPane(categories, countByCategory, overviewFilterState, {
      onToggleCategory: (c) => {
        overviewFilterState.categories.has(c) ? overviewFilterState.categories.delete(c) : overviewFilterState.categories.add(c);
        drawAll();
      },
      onClear: () => { overviewFilterState.categories.clear(); drawAll(); },
      // text input: re-render the tiles only, never the pane itself, or the search box loses focus every keystroke
      onSearch: (v) => { overviewFilterState.search = v; drawTiles(); },
    });
  }

  function drawKPIs(filtered) {
    const totalIncome = filtered.reduce((s, r) => s + r.total_income, 0);
    const totalProfit = filtered.reduce((s, r) => s + r.net_profit, 0);
    const avgMargin = filtered.length ? filtered.reduce((s, r) => s + r.net_margin_pct, 0) / filtered.length : 0;
    const atLoss = filtered.filter((r) => r.net_profit < 0).length;
    const tiles = [
      ["Companies in view", filtered.length, ""],
      ["Total income", fmtMoney(totalIncome), ""],
      ["Total net profit", fmtMoney(totalProfit), totalProfit >= 0 ? "pos" : "neg"],
      ["Avg. net margin", fmtPct(avgMargin), avgMargin >= 0 ? "pos" : "neg"],
      ["Companies at a loss", atLoss + " / " + filtered.length, atLoss ? "neg" : "pos"],
    ];
    document.getElementById("anKpis").innerHTML = tiles.map(([label, value, cls]) =>
      `<div class="stat-tile"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`).join("");
  }

  function isolateCategory(key) {
    // clicking a chart element isolates to just that one category (replacing the current selection);
    // clicking the same lone selection again clears it. Manual multi-select still lives in the filter pane.
    const only = overviewFilterState.categories.size === 1 && overviewFilterState.categories.has(key);
    overviewFilterState.categories = only ? new Set() : new Set([key]);
    drawAll();
  }

  function drawDonut() {
    const byCategory = {};
    categories.forEach((c) => (byCategory[c] = 0));
    rows.forEach((r) => byCategory[r.category_short]++);
    const segments = categories.map((c) => ({ key: c, label: c, value: byCategory[c] }));
    const selectedKey = overviewFilterState.categories.size === 1 ? [...overviewFilterState.categories][0] : null;
    donutChart(document.getElementById("chDonut"), segments, {
      size: 180, thickness: 26, centerValue: rows.length, centerLabel: "companies",
      selectedKey,
      onSelect: isolateCategory,
    });
  }

  function drawCategoryBars() {
    const groups = {};
    categories.forEach((c) => (groups[c] = []));
    rows.forEach((r) => groups[r.category_short].push(r));
    const selectedKey = overviewFilterState.categories.size === 1 ? [...overviewFilterState.categories][0] : null;

    const marginItems = categories.map((c) => {
      const arr = groups[c];
      const avg = arr.length ? arr.reduce((s, r) => s + r.net_margin_pct, 0) / arr.length : 0;
      return { key: c, label: c, value: avg, display: fmtPct(avg), title: `${c} (n=${arr.length})` };
    });
    hBarChart(document.getElementById("chMarginCat"), marginItems, {
      selectedKey,
      colorFn: (d) => (d.value < 0 ? "var(--neg)" : "var(--accent)"),
      onClick: (d) => isolateCategory(d.key),
    });

    const ratioItems = categories.map((c) => {
      const arr = groups[c];
      const avg = arr.length ? arr.reduce((s, r) => s + r.current_ratio, 0) / arr.length : 0;
      return { key: c, label: c, value: avg, display: avg.toFixed(2) + "×", title: `${c} (n=${arr.length})` };
    });
    hBarChart(document.getElementById("chRatioCat"), ratioItems, {
      selectedKey,
      onClick: (d) => isolateCategory(d.key),
    });
  }

  function drawRanked(filtered) {
    const sorted = [...filtered].sort((a, b) => b.net_margin_pct - a.net_margin_pct);
    const points = sorted.map((r) => ({ label: r.business_name, value: r.net_margin_pct, id: r.company_id }));
    rankedLineChart(document.getElementById("chRanked"), points, {
      width: 1040, height: 220,
      yFmt: (v) => fmtPct(v),
      onClickPoint: (p) => { location.hash = `#/company/${p.id}/ratios`; },
    });
  }

  function drawScatter(filtered) {
    const points = filtered.map((r) => ({ x: r.current_ratio, y: r.net_margin_pct, label: r.business_name, id: r.company_id }));
    scatterChart(document.getElementById("chScatter"), points, {
      width: 520, height: 320, xLabel: "Current ratio", yLabel: "Net margin %",
      xTicks: [0, 1, 2, 3, 4], yMin: -260, yMax: 60, yTicks: [-250, -125, 0, 50],
      onClick: (p) => { location.hash = `#/company/${p.id}/ratios`; },
    });
  }

  function drawExpense(filtered) {
    const agg = {};
    filtered.forEach((r) => {
      (r.expense_lines || []).forEach((l) => {
        if (l.amount <= 0 || !r.total_income) return;
        (agg[l.account_name] ||= []).push(l.amount / r.total_income * 100);
      });
    });
    const items = Object.entries(agg)
      .map(([name, arr]) => ({ key: name, label: name, value: arr.reduce((a, b) => a + b, 0) / arr.length, display: (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) + "%", title: `${name} — avg over ${arr.length} companies` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    hBarChart(document.getElementById("chExpense"), items, { colorFn: () => "var(--expense)" });
  }

  function drawTable(filtered) {
    const head = document.getElementById("anHead");
    head.innerHTML = AN_COLS.map((c) => {
      const arrow = overviewSortState.sortKey === c.key ? (overviewSortState.sortDir === "asc" ? "&#8593;" : "&#8595;") : "";
      return `<th class="${c.type === "text" ? "" : "num"}" data-key="${c.key}">${c.label} <span style="opacity:.4">${arrow}</span></th>`;
    }).join("");
    head.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (overviewSortState.sortKey === k) overviewSortState.sortDir = overviewSortState.sortDir === "asc" ? "desc" : "asc";
      else { overviewSortState.sortKey = k; overviewSortState.sortDir = "desc"; }
      drawTable(filtered);
    }));

    const sorted = [...filtered].sort((a, b) => {
      let va = a[overviewSortState.sortKey], vb = b[overviewSortState.sortKey];
      if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return overviewSortState.sortDir === "asc" ? -1 : 1;
      if (va > vb) return overviewSortState.sortDir === "asc" ? 1 : -1;
      return 0;
    });
    document.getElementById("anBody").innerHTML = sorted.map((r) => `
      <tr class="clickable" data-id="${r.company_id}">
        <td class="num mono">${r.case_no}</td>
        <td>${esc(r.business_name)}</td>
        <td>${esc(r.industry)}</td>
        <td><span class="badge neutral">${esc(r.category_short)}</span></td>
        <td class="num mono">${fmtMoney(r.total_income)}</td>
        <td class="num mono">${fmtMoney(r.net_profit)}</td>
        <td class="num mono" style="color:${r.net_margin_pct >= 0 ? "var(--pos)" : "var(--neg)"}">${fmtPct(r.net_margin_pct)}</td>
        <td class="num mono">${r.current_ratio.toFixed(2)}&times;</td>
      </tr>`).join("");
    document.getElementById("anBody").querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => { location.hash = `#/company/${tr.dataset.id}/ratios`; });
    });
  }

  function drawTiles() {
    const filtered = currentRows();
    drawKPIs(filtered);
    drawDonut();
    drawCategoryBars();
    drawRanked(filtered);
    drawScatter(filtered);
    drawExpense(filtered);
    drawTable(filtered);
  }

  function drawAll() {
    drawFilterPane();
    drawTiles();
  }

  drawAll();
}

// ============================================================
// Company detail
// ============================================================
const TABS = [
  { key: "journal", label: "Journal" },
  { key: "ledger", label: "Ledger" },
  { key: "trial-balance", label: "Trial balance" },
  { key: "pnl", label: "P&L" },
  { key: "balance-sheet", label: "Balance sheet" },
  { key: "ratios", label: "Analytics" },
];

async function renderCompanyDetail(id, tab) {
  $app.innerHTML = `<div class="loading">Loading&hellip;</div>`;
  const company = await api(`/companies/${id}`);
  $crumbName.textContent = company.business_name;

  $app.innerHTML = `
    <div class="page-inner">
      <a class="backlink" href="#/companies">&larr; All companies</a>
      <div class="detail-head">
        <div>
          <h1>${esc(company.business_name)}</h1>
          <div class="meta">
            <span class="badge neutral">${esc(company.industry)}</span>
            <span class="badge neutral">${esc(company.category)}</span>
            <span class="badge neutral">Case #${company.case_no}</span>
          </div>
        </div>
      </div>
      <div class="tabs">
        ${TABS.map((t) => `<a href="#/company/${id}/${t.key}" class="${t.key === tab ? "active" : ""}">${t.label}</a>`).join("")}
      </div>
      <div id="tabBody"><div class="loading">Loading&hellip;</div></div>
    </div>
  `;

  const body = document.getElementById("tabBody");
  if (tab === "journal") return renderJournalTab(body, id);
  if (tab === "ledger") return renderLedgerTab(body, id);
  if (tab === "trial-balance") return renderTBTab(body, id);
  if (tab === "pnl") return renderPnLTab(body, id);
  if (tab === "balance-sheet") return renderBSTab(body, id);
  if (tab === "ratios") return renderRatiosTab(body, id);
  body.innerHTML = `<div class="empty">Unknown tab.</div>`;
}

// ---------- Journal tab (view + add-entry form) ----------
async function renderJournalTab(body, companyId) {
  const [entries, accounts] = await Promise.all([
    api(`/companies/${companyId}/journal`),
    api("/accounts"),
  ]);

  const grouped = {};
  ACCOUNT_TYPE_LABEL && Object.keys(ACCOUNT_TYPE_LABEL).forEach((t) => (grouped[t] = []));
  accounts.forEach((a) => (grouped[a.account_type] ||= []).push(a));

  const acctOptions = Object.entries(grouped)
    .filter(([, list]) => list.length)
    .map(([type, list]) => `<optgroup label="${esc(ACCOUNT_TYPE_LABEL[type] || type)}">
      ${list.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} &mdash; ${esc(a.name)}</option>`).join("")}
    </optgroup>`).join("");

  body.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <h2>Add journal entry</h2>
          <div class="sub">Double-entry: total debits must equal total credits before you can submit.</div>
        </div>
        <button class="btn primary small" id="btnAddLine" type="button">+ Add line</button>
      </div>
      <div class="entry-form" style="margin-top:14px;">
        <div class="row2">
          <div class="field" style="margin:0;">
            <label for="jeDate">Date</label>
            <input class="input" id="jeDate" type="date" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="field" style="margin:0;">
            <label for="jeDesc">Description</label>
            <input class="input" id="jeDesc" type="text" placeholder="e.g. Invoice paid by client">
          </div>
        </div>
        <table class="lines-table">
          <thead><tr><th>Account</th><th>GST code</th><th>Debit</th><th>Credit</th><th></th></tr></thead>
          <tbody id="linesBody"></tbody>
        </table>
        <div class="entry-totals">
          <span class="tval">Debits: <strong id="sumDebit">0.00</strong></span>
          <span class="tval">Credits: <strong id="sumCredit">0.00</strong></span>
          <span id="balanceBadge" class="badge neutral">Enter amounts</span>
        </div>
        <div class="entry-actions">
          <button class="btn primary" id="btnSubmitEntry" disabled>Post entry</button>
          <span id="entryMsg"></span>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Journal (${entries.length} transaction${entries.length === 1 ? "" : "s"})</h2>
      <div class="tablewrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>GST</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody id="journalRows"></tbody>
        </table>
      </div>
    </div>
  `;

  // ---- render existing journal rows ----
  const jrows = document.getElementById("journalRows");
  if (!entries.length) {
    jrows.innerHTML = `<tr><td colspan="6" class="empty">No transactions yet. Add the first one above.</td></tr>`;
  } else {
    jrows.innerHTML = [...entries].reverse().flatMap((e) =>
      e.lines.map((l, i) => `
        <tr class="${i === 0 ? "txn-group" : ""}">
          <td class="mono">${i === 0 ? esc(e.date) : ""}</td>
          <td>${i === 0 ? esc(e.description) : "&#8618;"}</td>
          <td>${esc(l.account_code)} &mdash; ${esc(l.account_name)}</td>
          <td class="mono">${esc(l.gst_code || "")}</td>
          <td class="num mono">${l.debit ? fmtMoney(l.debit) : ""}</td>
          <td class="num mono">${l.credit ? fmtMoney(l.credit) : ""}</td>
        </tr>`)
    ).join("");
  }

  // ---- line-row builder ----
  const linesBody = document.getElementById("linesBody");
  function addLine() {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><select class="select acct">${acctOptions}</select></td>
      <td><input class="input gst" type="text" placeholder="optional" style="width:90px;"></td>
      <td><input class="input amt debit" type="number" step="0.01" min="0" placeholder="0.00"></td>
      <td><input class="input amt credit" type="number" step="0.01" min="0" placeholder="0.00"></td>
      <td class="rm"><button class="btn ghost small rmBtn" type="button" title="Remove line">&times;</button></td>
    `;
    linesBody.appendChild(tr);
    tr.querySelector(".rmBtn").addEventListener("click", () => {
      if (linesBody.children.length > 2) { tr.remove(); recompute(); }
    });
    tr.querySelectorAll(".debit, .credit").forEach((inp) => inp.addEventListener("input", recompute));
    recompute();
  }
  document.getElementById("btnAddLine").addEventListener("click", addLine);
  addLine(); addLine();

  function recompute() {
    let sumD = 0, sumC = 0;
    linesBody.querySelectorAll("tr").forEach((tr) => {
      sumD += parseFloat(tr.querySelector(".debit").value) || 0;
      sumC += parseFloat(tr.querySelector(".credit").value) || 0;
    });
    document.getElementById("sumDebit").textContent = sumD.toFixed(2);
    document.getElementById("sumCredit").textContent = sumC.toFixed(2);
    const badge = document.getElementById("balanceBadge");
    const submitBtn = document.getElementById("btnSubmitEntry");
    const balanced = sumD > 0 && Math.abs(sumD - sumC) < 0.005;
    if (sumD === 0 && sumC === 0) {
      badge.className = "badge neutral"; badge.textContent = "Enter amounts";
    } else if (balanced) {
      badge.className = "badge good"; badge.textContent = "Balanced";
    } else {
      badge.className = "badge crit"; badge.textContent = `Off by ${fmtMoney(Math.abs(sumD - sumC))}`;
    }
    submitBtn.disabled = !balanced;
  }

  document.getElementById("btnSubmitEntry").addEventListener("click", async () => {
    const msgEl = document.getElementById("entryMsg");
    msgEl.className = ""; msgEl.textContent = "";
    const lines = [...linesBody.querySelectorAll("tr")].map((tr) => ({
      account_code: tr.querySelector(".acct").value,
      gst_code: tr.querySelector(".gst").value.trim() || null,
      debit: parseFloat(tr.querySelector(".debit").value) || 0,
      credit: parseFloat(tr.querySelector(".credit").value) || 0,
    })).filter((l) => l.debit > 0 || l.credit > 0);

    const payload = {
      date: document.getElementById("jeDate").value,
      description: document.getElementById("jeDesc").value.trim() || "(no description)",
      lines,
    };
    try {
      await api(`/companies/${companyId}/journal`, { method: "POST", body: JSON.stringify(payload) });
      msgEl.className = "form-success";
      msgEl.textContent = "Posted. Ledger, trial balance, P&L and balance sheet are all up to date.";
      await renderJournalTab(body, companyId);
    } catch (err) {
      msgEl.className = "form-error";
      msgEl.textContent = apiErrorMessage(err);
    }
  });
}

// ---------- Ledger tab ----------
async function renderLedgerTab(body, companyId) {
  const rows = await api(`/companies/${companyId}/ledger`);
  body.innerHTML = `
    <div class="card">
      <h2>General ledger</h2>
      <div class="sub">Posted automatically from every journal line for this company.</div>
      <div class="tablewrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>Account</th><th>Type</th><th>Normal balance</th><th class="num">Total debits</th><th class="num">Total credits</th><th class="num">Closing balance</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td>${esc(r.account_code)} &mdash; ${esc(r.account_name)}</td>
                <td><span class="badge neutral">${esc(r.account_type)}</span></td>
                <td class="mono">${esc(r.normal_balance)}</td>
                <td class="num mono">${fmtMoney(r.total_debits)}</td>
                <td class="num mono">${fmtMoney(r.total_credits)}</td>
                <td class="num mono">${fmtMoney(r.closing_balance)}</td>
              </tr>`).join("") : `<tr><td colspan="6" class="empty">No postings yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------- Trial balance tab ----------
async function renderTBTab(body, companyId) {
  const tb = await api(`/companies/${companyId}/trial-balance`);
  body.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <h2>Trial balance</h2>
          <div class="sub">Every ledger closing balance, split into its debit or credit column.</div>
        </div>
        <span class="badge ${tb.is_balanced ? "good" : "crit"}">${tb.is_balanced ? "Balanced" : "Not balanced"}</span>
      </div>
      <div class="tablewrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            ${tb.rows.length ? tb.rows.map((r) => `
              <tr><td>${esc(r.account_code)} &mdash; ${esc(r.account_name)}</td>
                <td class="num mono">${r.debit_balance ? fmtMoney(r.debit_balance) : ""}</td>
                <td class="num mono">${r.credit_balance ? fmtMoney(r.credit_balance) : ""}</td></tr>`).join("")
              : `<tr><td colspan="3" class="empty">No postings yet.</td></tr>`}
          </tbody>
          <tfoot><tr><td>Total</td><td class="num mono">${fmtMoney(tb.total_debits)}</td><td class="num mono">${fmtMoney(tb.total_credits)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  `;
}

// ---------- P&L tab ----------
async function renderPnLTab(body, companyId) {
  const p = await api(`/companies/${companyId}/pnl`);
  const section = (title, lines, total) => `
    <div class="tablewrap" style="margin-top:10px;">
      <table>
        <thead><tr><th>${title}</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.length ? lines.map((l) => `<tr><td>${esc(l.account_code)} &mdash; ${esc(l.account_name)}</td><td class="num mono">${fmtMoney(l.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty">None</td></tr>`}</tbody>
        <tfoot><tr><td>Total ${title.toLowerCase()}</td><td class="num mono">${fmtMoney(total)}</td></tr></tfoot>
      </table>
    </div>`;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile"><div class="label">Total income</div><div class="value">${fmtMoney(p.total_income)}</div></div>
      <div class="stat-tile"><div class="label">Total expenses</div><div class="value">${fmtMoney(p.total_expenses)}</div></div>
      <div class="stat-tile"><div class="label">Net profit</div><div class="value ${p.net_profit >= 0 ? "pos" : "neg"}">${fmtMoney(p.net_profit)}</div></div>
      <div class="stat-tile"><div class="label">Net margin</div><div class="value ${p.net_margin_pct >= 0 ? "pos" : "neg"}">${fmtPct(p.net_margin_pct)}</div></div>
    </div>
    <div class="card">
      <h2>Profit &amp; loss</h2>
      <div class="sub">Pulled live from the trial balance's income and expense accounts.</div>
      ${section("Income", p.income, p.total_income)}
      ${section("Expenses", p.expenses, p.total_expenses)}
    </div>
  `;
}

// ---------- Balance sheet tab ----------
async function renderBSTab(body, companyId) {
  const b = await api(`/companies/${companyId}/balance-sheet`);
  const section = (title, lines, total) => `
    <div class="tablewrap" style="margin-top:10px;">
      <table>
        <thead><tr><th>${title}</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.length ? lines.map((l) => `<tr><td>${esc(l.account_code)} &mdash; ${esc(l.account_name)}</td><td class="num mono">${fmtMoney(l.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty">None</td></tr>`}</tbody>
        <tfoot><tr><td>Total ${title.toLowerCase()}</td><td class="num mono">${fmtMoney(total)}</td></tr></tfoot>
      </table>
    </div>`;
  body.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <h2>Balance sheet</h2>
          <div class="sub">Equity is derived as current-period retained earnings only (single-period practice set, no opening balance / owner's-equity account).</div>
        </div>
        <span class="badge ${b.is_balanced ? "good" : "crit"}">${b.is_balanced ? "Balanced" : "Not balanced"}</span>
      </div>
      ${section("Assets", b.assets, b.total_assets)}
      ${section("Liabilities", b.liabilities, b.total_liabilities)}
      <div class="tablewrap" style="margin-top:10px;">
        <table>
          <tbody>
            <tr><td>Retained earnings (current period)</td><td class="num mono">${fmtMoney(b.retained_earnings)}</td></tr>
          </tbody>
          <tfoot><tr><td>Total liabilities + equity</td><td class="num mono">${fmtMoney(b.total_liabilities_and_equity)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  `;
}

// ---------- Analytics (ratios) tab ----------
async function renderRatiosTab(body, companyId) {
  const [r, pnl] = await Promise.all([
    api(`/analytics/ratios/${companyId}`),
    api(`/companies/${companyId}/pnl`),
  ]);
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile"><div class="label">Net margin</div><div class="value ${r.net_margin_pct >= 0 ? "pos" : "neg"}">${fmtPct(r.net_margin_pct)}</div></div>
      <div class="stat-tile"><div class="label">Current ratio</div><div class="value">${r.current_ratio.toFixed(2)}&times;</div></div>
      <div class="stat-tile"><div class="label">Quick ratio</div><div class="value">${r.quick_ratio.toFixed(2)}&times;</div></div>
      <div class="stat-tile"><div class="label">Net GST position</div><div class="value">${fmtMoney(r.gst_net_position)}</div></div>
    </div>
    <div class="grid-2-wide">
      <div class="card">
        <h2>Income composition</h2>
        <div class="sub">Of every dollar of income, how much became profit vs. was spent</div>
        <div id="ddDonut" style="margin-top:12px;"></div>
      </div>
      <div class="card">
        <h2>Expense breakdown</h2>
        <div class="sub">This company's expense accounts, by amount</div>
        <div id="ddExpense" style="margin-top:12px;"></div>
      </div>
    </div>
  `;

  const expenseSegment = Math.max(0, pnl.total_expenses);
  const profitSegment = Math.max(0, pnl.net_profit);
  const lossSegment = Math.max(0, -pnl.net_profit);
  const segments = [
    { key: "expenses", label: "Expenses", value: expenseSegment, color: "#eb6834" },
    { key: "profit", label: "Net profit", value: profitSegment, color: "#2a78d6" },
  ];
  if (lossSegment > 0) segments.push({ key: "loss", label: "Loss (expenses exceeded income)", value: lossSegment, color: "#e34948" });

  donutChart(document.getElementById("ddDonut"), segments, {
    size: 170, thickness: 26,
    centerValue: fmtPct(r.net_margin_pct), centerLabel: "net margin",
    legendValueFmt: (v) => fmtMoney(v),
  });

  const expenseItems = [...pnl.expenses].sort((a, b) => b.amount - a.amount).map((l) => ({
    key: l.account_code, label: l.account_name, value: l.amount, display: fmtMoney(l.amount),
  }));
  if (expenseItems.length) {
    hBarChart(document.getElementById("ddExpense"), expenseItems, { colorFn: () => "var(--expense)" });
  } else {
    document.getElementById("ddExpense").innerHTML = `<div class="empty">No expenses recorded yet.</div>`;
  }
}

// ---------- boot ----------
initTheme();
render();
