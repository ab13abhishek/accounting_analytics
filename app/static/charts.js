/* Accounting Analytics -- small reusable SVG chart library.
   No dependency, no build step. Every chart takes a container element and
   plain data, and renders its own tooltip layer inside that container. */

const CHART_COLORS = {
  categorical: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"], // blue, orange, aqua, yellow -- validated all-pairs-safe as a 4-slice ring (see dataviz palette)
  pos: "#2a78d6",
  neg: "#e34948",
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function ensureTooltip(container) {
  let tt = container.querySelector(".chart-tooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.className = "chart-tooltip";
    container.style.position = container.style.position || "relative";
    container.appendChild(tt);
  }
  return tt;
}
function showTooltip(container, x, y, labelHtml, valueHtml) {
  const tt = ensureTooltip(container);
  tt.innerHTML = `<div class="tt-label">${labelHtml}</div><div class="tt-value">${valueHtml}</div>`;
  tt.style.left = x + "px";
  tt.style.top = (y - 10) + "px";
  tt.classList.add("show");
}
function hideTooltip(container) {
  const tt = container.querySelector(".chart-tooltip");
  if (tt) tt.classList.remove("show");
}

// ============================================================
// Donut chart (2-4 slices; categorical palette in fixed order)
// ============================================================
function donutChart(container, segments, opts = {}) {
  const size = opts.size || 200;
  const thickness = opts.thickness || 30;
  const r = size / 2;
  const inner = r - thickness;
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "donut-wrap";
  container.appendChild(wrap);

  const svg = svgEl("svg", { class: "donut-svg", viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img" });
  const g = svgEl("g", { transform: `translate(${r},${r})` });
  svg.appendChild(g);

  let angle = -Math.PI / 2; // start at 12 o'clock
  const state = { selected: opts.selectedKey || null };

  function arcPath(a0, a1, rOuter, rInner) {
    const x0 = Math.cos(a0) * rOuter, y0 = Math.sin(a0) * rOuter;
    const x1 = Math.cos(a1) * rOuter, y1 = Math.sin(a1) * rOuter;
    const x2 = Math.cos(a1) * rInner, y2 = Math.sin(a1) * rInner;
    const x3 = Math.cos(a0) * rInner, y3 = Math.sin(a0) * rInner;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
  }

  const slices = [];
  segments.forEach((seg, i) => {
    const frac = seg.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const color = seg.color || CHART_COLORS.categorical[i % CHART_COLORS.categorical.length];
    const path = svgEl("path", { d: arcPath(a0, a1, r - 1, inner), class: "donut-slice", fill: color, "data-key": seg.key });
    g.appendChild(path);
    slices.push({ el: path, seg, color, a0, a1, frac });

    if (frac > 0.06) {
      const mid = (a0 + a1) / 2;
      const lr = (r + inner) / 2;
      const lx = Math.cos(mid) * lr, ly = Math.sin(mid) * lr;
      const label = svgEl("text", {
        x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "middle",
        fill: "#fff", "font-family": "var(--font-mono)", "font-size": "11", "font-weight": "600",
        style: "pointer-events:none;",
      });
      label.textContent = Math.round(frac * 100) + "%";
      g.appendChild(label);
    }
  });

  if (opts.centerValue !== undefined) {
    const cv = svgEl("text", { x: 0, y: -3, "text-anchor": "middle", class: "donut-center-value" });
    cv.textContent = opts.centerValue;
    g.appendChild(cv);
    if (opts.centerLabel) {
      const cl = svgEl("text", { x: 0, y: 14, "text-anchor": "middle", class: "donut-center-label" });
      cl.textContent = opts.centerLabel;
      g.appendChild(cl);
    }
  }

  wrap.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  wrap.appendChild(legend);

  function applySelection() {
    slices.forEach((s) => s.el.classList.toggle("dimmed", !!state.selected && state.selected !== s.seg.key));
    legend.querySelectorAll(".legend-item").forEach((li) => li.classList.toggle("dimmed", !!state.selected && state.selected !== li.dataset.key));
  }

  segments.forEach((seg, i) => {
    const color = seg.color || CHART_COLORS.categorical[i % CHART_COLORS.categorical.length];
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.key = seg.key;
    item.innerHTML = `<span class="legend-swatch" style="background:${color}"></span><span class="li-label"></span><span class="li-value"></span>`;
    item.querySelector(".li-label").textContent = seg.label;
    item.querySelector(".li-value").textContent = opts.legendValueFmt ? opts.legendValueFmt(seg.value) : seg.value;
    legend.appendChild(item);
    const onPick = () => {
      state.selected = state.selected === seg.key ? null : seg.key;
      applySelection();
      if (opts.onSelect) opts.onSelect(state.selected);
    };
    item.addEventListener("click", onPick);
    slices[i].el.addEventListener("click", onPick);
    slices[i].el.addEventListener("pointermove", (e) => {
      const rect = container.getBoundingClientRect();
      showTooltip(container, e.clientX - rect.left, e.clientY - rect.top,
        esc(seg.label), (opts.legendValueFmt ? opts.legendValueFmt(seg.value) : seg.value) + ` (${Math.round(seg.value/total*100)}%)`);
    });
    slices[i].el.addEventListener("pointerleave", () => hideTooltip(container));
  });

  applySelection();
}

// ============================================================
// Horizontal bar list -- magnitude comparison, one hue (or diverging via colorFn)
// ============================================================
function hBarChart(container, items, opts = {}) {
  container.innerHTML = "";
  const list = document.createElement("div");
  list.className = "barlist";
  container.appendChild(list);
  const maxAbs = Math.max(1, ...items.map((d) => Math.abs(d.value)));

  items.forEach((d) => {
    const row = document.createElement("div");
    row.className = "barrow" + (opts.onClick ? " clickable" : "") + (opts.selectedKey === d.key ? " selected" : "");
    const pct = Math.min(100, Math.abs(d.value) / maxAbs * 100);
    const color = opts.colorFn ? opts.colorFn(d) : "var(--accent)";
    row.innerHTML = `<div class="rlabel" title="${esc(d.title || d.label)}">${esc(d.label)}</div>
      <div class="bartrack"><div class="barfill" style="width:${pct}%; background:${color}"></div></div>
      <div class="rval">${esc(d.display ?? d.value)}</div>`;
    if (opts.onClick) row.addEventListener("click", () => opts.onClick(d));
    list.appendChild(row);
  });
}

// ============================================================
// Ranked line/area chart -- diverging fill at zero, crosshair tooltip
// ============================================================
function rankedLineChart(container, points, opts = {}) {
  const width = opts.width || 900;
  const height = opts.height || 220;
  const padL = 44, padR = 12, padT = 10, padB = 8;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "chart-box";
  container.appendChild(box);

  const values = points.map((p) => p.value);
  const maxV = Math.max(1, ...values);
  const minV = Math.min(-1, ...values);
  const yScale = (v) => padT + plotH * (1 - (v - minV) / (maxV - minV));
  const xScale = (i) => padL + (points.length <= 1 ? 0 : (i / (points.length - 1)) * plotW);
  const zeroY = yScale(0);

  const svg = svgEl("svg", { class: "chart-svg", viewBox: `0 0 ${width} ${height}` });

  // gridlines at nice y values
  [maxV, 0, minV].forEach((v) => {
    const y = yScale(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: width - padR, y1: y, y2: y, class: v === 0 ? "zero-line" : "grid-line" }));
    const t = svgEl("text", { x: padL - 6, y: y + 3, "text-anchor": "end", class: "axis-label" });
    t.textContent = (opts.yFmt ? opts.yFmt(v) : v.toFixed(0));
    svg.appendChild(t);
  });

  // area (split pos/neg) + line
  let dLine = "";
  let dPos = `M ${xScale(0)} ${zeroY} `;
  let dNeg = `M ${xScale(0)} ${zeroY} `;
  points.forEach((p, i) => {
    const x = xScale(i), y = yScale(p.value);
    dLine += (i === 0 ? "M " : "L ") + x + " " + y + " ";
    dPos += "L " + x + " " + (p.value >= 0 ? y : zeroY) + " ";
    dNeg += "L " + x + " " + (p.value < 0 ? y : zeroY) + " ";
  });
  dPos += `L ${xScale(points.length - 1)} ${zeroY} Z`;
  dNeg += `L ${xScale(points.length - 1)} ${zeroY} Z`;

  svg.appendChild(svgEl("path", { d: dPos, class: "area-pos" }));
  svg.appendChild(svgEl("path", { d: dNeg, class: "area-neg" }));
  svg.appendChild(svgEl("path", { d: dLine, class: "line-path" }));

  const crosshair = svgEl("line", { class: "crosshair-line", y1: padT, y2: height - padB, visibility: "hidden" });
  const dot = svgEl("circle", { class: "crosshair-dot", r: 4, fill: CHART_COLORS.pos, visibility: "hidden" });
  svg.appendChild(crosshair);
  svg.appendChild(dot);

  const hitLayer = svgEl("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
  svg.appendChild(hitLayer);
  box.appendChild(svg);

  hitLayer.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round((localX - padL) / plotW * (points.length - 1))));
    const p = points[idx];
    const x = xScale(idx), y = yScale(p.value);
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);
    crosshair.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y);
    dot.setAttribute("fill", p.value >= 0 ? CHART_COLORS.pos : CHART_COLORS.neg);
    dot.setAttribute("visibility", "visible");
    const contRect = container.getBoundingClientRect();
    const px = (x / width) * rect.width + (rect.left - contRect.left);
    const py = (y / height) * rect.height + (rect.top - contRect.top);
    showTooltip(container, px, py, esc(p.label), (opts.yFmt ? opts.yFmt(p.value) : p.value));
    if (opts.onHover) opts.onHover(p);
  });
  hitLayer.addEventListener("pointerleave", () => {
    crosshair.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    hideTooltip(container);
  });
  if (opts.onClickPoint) {
    hitLayer.addEventListener("click", (e) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const localX = (e.clientX - rect.left) * scaleX;
      const idx = Math.max(0, Math.min(points.length - 1, Math.round((localX - padL) / plotW * (points.length - 1))));
      opts.onClickPoint(points[idx]);
    });
  }
}

// ============================================================
// Scatter chart -- single hue, quadrant baselines, per-point hit target
// ============================================================
function scatterChart(container, points, opts = {}) {
  const width = opts.width || 560;
  const height = opts.height || 340;
  const padL = 50, padR = 16, padT = 14, padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "chart-box";
  container.appendChild(box);

  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xMax = opts.xMax ?? Math.max(1, ...xs) * 1.08;
  const xMin = opts.xMin ?? Math.min(0, ...xs);
  const yMax = opts.yMax ?? Math.max(1, ...ys) * 1.1;
  const yMin = opts.yMin ?? Math.min(-1, ...ys) * 1.1;
  const xScale = (v) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v) => padT + plotH * (1 - (v - yMin) / (yMax - yMin));

  const svg = svgEl("svg", { class: "chart-svg", viewBox: `0 0 ${width} ${height}` });

  // gridlines + axis ticks (x: current ratio, y: net margin)
  const xTicks = opts.xTicks || [0, 1, 2, 3];
  xTicks.forEach((v) => {
    if (v < xMin || v > xMax) return;
    const x = xScale(v);
    svg.appendChild(svgEl("line", { x1: x, x2: x, y1: padT, y2: height - padB, class: v === 1 ? "zero-line" : "grid-line" }));
    const t = svgEl("text", { x, y: height - padB + 16, "text-anchor": "middle", class: "axis-label" });
    t.textContent = v + "x";
    svg.appendChild(t);
  });
  const yTicks = opts.yTicks || [yMin, 0, yMax];
  yTicks.forEach((v) => {
    const y = yScale(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: width - padR, y1: y, y2: y, class: v === 0 ? "zero-line" : "grid-line" }));
    const t = svgEl("text", { x: padL - 6, y: y + 3, "text-anchor": "end", class: "axis-label" });
    t.textContent = Math.round(v) + "%";
    svg.appendChild(t);
  });

  const xLabel = svgEl("text", { x: padL + plotW / 2, y: height - 2, "text-anchor": "middle", class: "axis-label" });
  xLabel.textContent = opts.xLabel || "";
  svg.appendChild(xLabel);
  const yLabel = svgEl("text", { x: 12, y: padT + 8, "text-anchor": "start", class: "axis-label" });
  yLabel.textContent = opts.yLabel || "";
  svg.appendChild(yLabel);

  points.forEach((p) => {
    const cx = xScale(Math.min(p.x, xMax)), cy = yScale(Math.max(yMin, Math.min(p.y, yMax)));
    const dot = svgEl("circle", { cx, cy, r: 4.5, class: "scatter-dot" });
    const hit = svgEl("circle", { cx, cy, r: 12, class: "scatter-hit" });
    svg.appendChild(dot);
    svg.appendChild(hit);
    const onMove = (e) => {
      const rect = svg.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const px = (cx / width) * rect.width + (rect.left - contRect.left);
      const py = (cy / height) * rect.height + (rect.top - contRect.top);
      showTooltip(container, px, py, esc(p.label),
        `${p.x.toFixed(2)}&times; current ratio, ${p.y >= 0 ? "+" : ""}${p.y.toFixed(1)}% margin`);
      dot.classList.add("hovered");
    };
    const onLeave = () => { hideTooltip(container); dot.classList.remove("hovered"); };
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerleave", onLeave);
    if (opts.onClick) hit.addEventListener("click", () => opts.onClick(p));
  });

  box.appendChild(svg);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
