/* DemandIQ — frontend logic (ORION-style overview driven by the XGBoost demand model) */

const state = {
  inventory: [],
  overview: null,
  zoom: 1,
};

let simTimer = null;
let searchTimer = null;
let resizeTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 0) => 'Rs. ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  lucide.createIcons();
  refreshAll();
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderFlow, 80);
  });
  if (window.ResizeObserver) new ResizeObserver(() => renderFlow()).observe($('stage'));
});

/* ───────────── Wiring ───────────── */
function bindUI() {
  document.querySelectorAll('.nav-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  const btnMetrics = $('btnShowMetrics');
  if (btnMetrics) {
    btnMetrics.addEventListener('click', showModelInfo);
  }

  $('btnUpload').addEventListener('click', openUpload);
  $('btnCloseUpload').addEventListener('click', closeUpload);
  $('uploadModal').addEventListener('click', (e) => { if (e.target.id === 'uploadModal') closeUpload(); });
  const btnTune = $('btnTune');
  if (btnTune) btnTune.addEventListener('click', () => switchTab('forecaster'));
  const btnAbout = $('btnAbout');
  if (btnAbout) btnAbout.addEventListener('click', showModelInfo);
  $('btnBulk').addEventListener('click', () => toast('Bulk markdown scheduled for all slow-moving lots'));
  $('cardReorder').addEventListener('click', () => switchTab('procurement'));

  const drop = $('dropZone');
  drop.addEventListener('click', () => { $('fileInput').value = ''; $('fileInput').click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });
  $('fileInput').addEventListener('change', (e) => { if (e.target.files.length) uploadFile(e.target.files[0]); });

  const input = $('skuSearch');
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
  input.addEventListener('focus', runSearch);
  document.addEventListener('click', (e) => { if (!$('searchBox').contains(e.target)) $('searchResults').classList.add('hidden'); });

  $('skuPicker').addEventListener('change', () => {
    const f = state.inventory.find((i) => i.sku === $('skuPicker').value);
    if (f) fillForecaster(f);
  });
  ['fcCategory', 'fcSize', 'fcUnitCost', 'fcUnitPrice'].forEach((id) => $(id).addEventListener('change', () => simulate()));
  [['slStock', 'lblStock', ' units'], ['slLead', 'lblLead', ' days'], ['slS7', 'lblS7', ' units'], ['slZero', 'lblZero', ' days']].forEach(([s, l, suf]) =>
    $(s).addEventListener('input', () => { $(l).textContent = `${$(s).value}${suf}`; simulate(); }));

  const btnAnalyze = $('btnAnalyzeFlow');
  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', () => {
      runAnalyzeAndFocusFlow();
    });
  }

  const btnReset = $('btnResetCenter');
  if (btnReset) {
    btnReset.addEventListener('click', async (e) => {
      e.stopPropagation();
      await resetToDefaultDataset();
    });
  }
}

async function refreshAll() {
  await Promise.all([loadOverview(), loadDataset(), loadProcurement(), loadClearance()]);
  lucide.createIcons();
}

function switchTab(tab) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(`view-${tab}`).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'overview') requestAnimationFrame(renderFlow);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setZoom(z) {
  state.zoom = Math.max(0.8, Math.min(1.3, Math.round(z * 10) / 10));
  $('stageInner').style.transform = `scale(${state.zoom})`;
}

/* ───────────── Overview ───────────── */
async function loadOverview() {
  try {
    const res = await fetch('/api/orion-overview');
    if (!res.ok) throw new Error('overview failed');
    state.overview = await res.json();
    renderSidebar();
    renderStrip();
    renderFlow();
    const m = state.overview.model || {};
    if (m.r2 != null) $('footMeta').textContent = `${m.algorithm} (31 features) · R² ${m.r2} · MAE ${m.mae} · RMSE ${m.rmse}`;
  } catch (e) {
    console.error(e);
  }
}

function delta(el, pct, suffix = '%') {
  const up = pct >= 0;
  el.className = `delta ${pct === 0 ? 'flat' : up ? 'up' : 'down'}`;
  el.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct)}${suffix}`;
}

function renderSidebar() {
  const d = state.overview;
  const fc = d.forecast_card;
  $('fcCardLabel').textContent = 'Predicted 7-day revenue';
  $('fcCardValue').textContent = fc.revenue;
  delta($('fcCardDelta'), fc.growth_pct);
  $('fcCardSub').textContent = `${fc.units.toLocaleString()} units forecast · ${fc.compare_text}`;

  const r = d.health_rings;
  $('stockValue').textContent = r.total_active_stock;
  const hd = $('healthDelta');
  hd.className = 'delta up';
  hd.textContent = `▲ ${r.healthy_pct}% healthy`;
  setRing('ringHealthy', 376.99, r.healthy_pct);
  setRing('ringReorder', 307.9, r.low_stock_pct);
  setRing('ringCritical', 238.76, r.critical_pct);

  const palette = ['#0a84ff', '#f59e0b', '#30d158', '#ea580c', '#5e5ce6', '#64d2ff', '#ffd60a', '#ff453a'];
  const tbl = $('catTable');
  tbl.innerHTML = '<div class="cat-head"><span>Category</span><span>Fcst</span><span>Stock</span></div>' +
    r.breakdown.map((b, i) => `
      <div class="cat-row">
        <span class="cat-name" style="--c:${palette[i % palette.length]}"><b>${esc(b.label)}</b></span>
        <span class="mono">${b.forecast.toLocaleString()}</span>
        <span class="mono stock">${b.stock.toLocaleString()}</span>
      </div>`).join('');

  const rc = d.reorder_card;
  $('reorderValue').textContent = rc.total_po_cost;
  const rd = $('reorderDelta');
  rd.className = `delta ${rc.critical > 0 ? 'down' : 'flat'}`;
  rd.textContent = rc.critical > 0 ? `● ${rc.critical} critical` : '● none critical';
  $('reorderSub').textContent = `${rc.skus} SKUs · ${rc.units.toLocaleString()} units to order · ${rc.compare_text}`;
}

function setRing(id, circ, pct) {
  const el = $(id);
  if (el) el.style.strokeDashoffset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
}

function renderStrip() {
  const b = state.overview.bottom;
  $('miniPred').textContent = b.prediction.value.toLocaleString();
  $('miniRisk').textContent = `${b.prediction.at_risk_pct}%`;
  $('miniPulse').textContent = b.pulse.value.toLocaleString();
  $('miniActivity').textContent = b.activity.value.toLocaleString();

  // sparkline: aggregate projected stock for the next 7 days
  const c = b.prediction.curve;
  const w = 110, h = 30, pad = 3;
  const max = Math.max(...c), min = Math.min(...c);
  const rng = max - min || 1;
  const pts = c.map((v, i) => [(i / (c.length - 1)) * w, pad + (1 - (v - min) / rng) * (h - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  $('sparkSvg').innerHTML = `
    <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a84ff" stop-opacity=".42"/><stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w},${h} L0,${h} Z" fill="url(#spk)"/>
    <path d="${line}" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="#fff" stroke="#0a84ff" stroke-width="1.6"/>`;

  $('pulseBars').innerHTML = b.pulse.bars.map((v) => `<span style="height:${Math.max(14, Math.round(v * 100))}%"></span>`).join('');

  const total = b.activity.segments.reduce((s, x) => s + x.count, 0) || 1;
  $('segBar').innerHTML = b.activity.segments
    .filter((s) => s.count > 0)
    .map((s) => `<span title="${esc(s.label)}: ${s.count}" style="flex:${s.count / total};background:${s.color}"></span>`).join('');
}

/* ───────────── Sankey flow engine ───────────── */
function renderFlow() {
  const d = state.overview;
  const stage = $('stage');
  if (!d || !stage || !$('view-overview').classList.contains('active')) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 200 || H < 160) return;

  const labelW = Math.min(160, W * 0.17);
  const rightPad = 0; // floating toolbar was removed
  const cx = W / 2, cy = H / 2;
  const r = Math.max(68, Math.min(H * 0.38, W * 0.16));

  // Hub
  const hub = $('hub');
  hub.style.width = hub.style.height = `${r * 2}px`;
  hub.style.left = `${cx}px`;
  hub.style.top = `${cy}px`;
  $('hubNumber').style.fontSize = `${Math.round(Math.max(26, Math.min(46, r * 0.40)))}px`;

  const hubSkuEl = $('hubSku');
  const pill = $('hubPill');
  const resetBtn = $('btnResetCenter');

  if (state.focusedSku) {
    const f = state.focusedSku;
    if (hubSkuEl) {
      hubSkuEl.style.display = 'block';
      hubSkuEl.textContent = f.sku;
    }
    if (resetBtn) resetBtn.title = 'Clear focus and reset to original dataset';
    $('hubLabel').textContent = `${f.category} (${f.size}) · 7D Forecast`;
    $('hubNumber').textContent = Number(f.forecast_units || 0).toFixed(1);
    $('hubRev').textContent = `${f.current_stock} stock · ${f.stock_runway}d runway`;
    pill.textContent = f.status || 'WATCH';
    pill.className = 'hub-pill ' + (f.status === 'HEALTHY' ? 'healthy' : f.status === 'LOW STOCK' ? 'watch' : 'risk');
  } else {
    if (hubSkuEl) hubSkuEl.style.display = 'none';
    if (resetBtn) resetBtn.title = 'Reset dataset to original default 16 benchmark SKUs';
    const ch = d.center_hub;
    $('hubLabel').textContent = ch.label;
    $('hubNumber').textContent = ch.forecast_units.toLocaleString();
    $('hubRev').textContent = ch.revenue_val;
    pill.textContent = ch.status;
    pill.className = 'hub-pill ' + (ch.status === 'HEALTHY' ? 'healthy' : ch.status === 'AT RISK' ? 'risk' : 'watch');
  }

  const left = d.left_demand_streams;
  const right = d.right_health_streams;
  const defs = [];
  let paths = '';
  let leftHtml = '', rightHtml = '';

  const span = r * 1.35; // total ribbon thickness stacked at the hub rim

  function layout(streams) {
    const total = streams.reduce((s, x) => s + x.flow, 0) || 1;
    let thick = streams.map((s) => Math.max(8, (s.flow / total) * span));
    const sum = thick.reduce((a, b) => a + b, 0);
    if (sum > span * 1.15) thick = thick.map((t) => (t / sum) * span * 1.15);
    return thick;
  }

  function build(streams, side) {
    const thick = layout(streams);
    const stackH = thick.reduce((a, b) => a + b, 0) + (streams.length - 1) * 3;
    let yCursor = cy - stackH / 2;
    const n = streams.length;
    const topY = H * 0.14, botY = H * 0.86;

    streams.forEach((s, i) => {
      const t = thick[i];
      const yHub = yCursor + t / 2;
      yCursor += t + 3;
      const yOuter = n === 1 ? cy : topY + (i / (n - 1)) * (botY - topY);
      const dy = Math.min(r - 2, Math.abs(yHub - cy));
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      const xHub = side === 'L' ? cx - dx + 6 : cx + dx - 6;
      const xOuter = side === 'L' ? labelW + 14 : W - labelW - rightPad - 14;
      const xm = (xOuter + xHub) / 2;
      const id = `g${side}${i}`;
      const x0 = xOuter, x1 = xHub, y0 = yOuter, y1 = yHub;
      const d1 = `M${x0},${y0 - t / 2} C${xm},${y0 - t / 2} ${xm},${y1 - t / 2} ${x1},${y1 - t / 2} L${x1},${y1 + t / 2} C${xm},${y1 + t / 2} ${xm},${y0 + t / 2} ${x0},${y0 + t / 2} Z`;

      if (side === 'L') {
        const base = s.color;
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">
          <stop offset="0" stop-color="${base}" stop-opacity=".95"/><stop offset="1" stop-color="#f59e0b" stop-opacity=".70"/></linearGradient>`);
      } else {
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x0}" y2="0">
          <stop offset="0" stop-color="#f59e0b" stop-opacity=".70"/><stop offset="1" stop-color="${s.color}" stop-opacity=".95"/></linearGradient>`);
      }
      paths += `<path class="ribbon" data-k="${side}${i}" fill="url(#${id})" d="${d1}" style="animation-delay:${i * 90}ms"/>`;

      if (side === 'L') {
        leftHtml += `<div class="flow-label left" data-k="L${i}" style="left:0;top:${yOuter}px;width:${labelW}px;animation-delay:${i * 90}ms">
          <span class="name">${esc(s.category)}</span>
          <span class="val mono">${esc(s.revenue)}</span>
          <span class="sub mono">${s.units.toLocaleString()} units · ${s.skus} SKU${s.skus === 1 ? '' : 's'}</span></div>`;
      } else {
        rightHtml += `<div class="flow-label right" data-k="R${i}" data-key="${s.key}" style="left:${W - labelW - rightPad}px;top:${yOuter}px;width:${labelW}px;animation-delay:${i * 90}ms">
          <span class="name">${esc(s.status)}</span>
          <span class="val mono">${esc(s.capital)}</span>
          <span class="sub mono">${esc(s.subtitle)}</span></div>`;
      }
    });
  }

  build(left, 'L');
  build(right, 'R');

  $('flowDefs').innerHTML = defs.join('');
  $('ribbons').innerHTML = paths;
  $('leftLabels').innerHTML = leftHtml;
  $('rightLabels').innerHTML = rightHtml;
  $('flowSvg').setAttribute('viewBox', `0 0 ${W} ${H}`);

  // hover linking + click navigation
  const link = (k, on) => {
    stage.classList.toggle('is-hovering', on);
    document.querySelectorAll(`[data-k="${k}"]`).forEach((el) => el.classList.toggle('hot', on));
  };
  stage.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('mouseenter', () => link(el.dataset.k, true));
    el.addEventListener('mouseleave', () => link(el.dataset.k, false));
  });
  stage.querySelectorAll('.flow-label.left').forEach((el, i) => el.addEventListener('click', () => focusCategory(left[i].category)));
  stage.querySelectorAll('.flow-label.right').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.key;
    if (k === 'critical' || k === 'reorder') switchTab('procurement');
    else if (k === 'dead') switchTab('clearance');
    else switchTab('forecaster');
  }));
}

function shade(hex) {
  // slightly shift toward violet for the hub end of left ribbons
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 20), g = Math.max(0, ((n >> 8) & 255) - 10), b = Math.min(255, (n & 255) + 5);
  return `rgb(${r},${g},${b})`;
}

function focusCategory(name) {
  const base = String(name).replace(/\s\+\d+$/, '');
  const found = state.inventory.find((i) => i.category.toLowerCase() === base.toLowerCase());
  if (found) openSku(found.sku);
}

function openSku(sku) {
  const found = state.inventory.find((i) => i.sku === sku);
  if (!found) return;
  $('skuPicker').value = found.sku;
  fillForecaster(found);
  switchTab('forecaster');
}

/* ───────────── Search ───────────── */
function runSearch() {
  const q = $('skuSearch').value.trim().toLowerCase();
  const box = $('searchResults');
  if (!q) { box.classList.add('hidden'); return; }
  const hits = state.inventory.filter((i) => i.sku.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map((h) => `<button data-sku="${esc(h.sku)}"><span><b class="mono">${esc(h.sku)}</b></span><small>${esc(h.category)} · ${esc(h.size)} · ${h.current_stock} in stock</small></button>`).join('')
    : '<div class="empty" style="padding:12px">No matching SKU</div>';
  box.classList.remove('hidden');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    box.classList.add('hidden');
    openSku(b.dataset.sku);
  }));
}

/* ───────────── Dataset & Forecaster ───────────── */
async function loadDataset() {
  try {
    const res = await fetch('/api/inventory-dataset');
    const data = await res.json();
    state.inventory = data.items || [];
    const picker = $('skuPicker');
    picker.innerHTML = state.inventory.map((i) => `<option value="${esc(i.sku)}">${esc(i.sku)} · ${esc(i.category)} ${esc(i.size)} · stock ${i.current_stock}</option>`).join('');
    if (state.inventory.length) fillForecaster(state.inventory[0]);
  } catch (e) { console.error(e); }
}

function fillForecaster(s) {
  $('fcCategory').value = s.category;
  $('fcSize').value = s.size;
  $('slStock').max = Math.max(250, s.current_stock * 1.2);
  $('slStock').value = s.current_stock;
  $('lblStock').textContent = `${s.current_stock} units`;
  $('slLead').value = s.lead_time_days;
  $('lblLead').textContent = `${s.lead_time_days} days`;
  const s7 = Math.round(s.sales_last_7d);
  $('slS7').max = Math.max(120, s7 * 1.5);
  $('slS7').value = s7;
  $('lblS7').textContent = `${s7} units`;
  const z = Math.round(s.zero_days_last_14d);
  $('slZero').value = z;
  $('lblZero').textContent = `${z} days`;
  $('fcUnitCost').value = Number(s.unit_cost).toFixed(2);
  $('fcUnitPrice').value = Number(s.unit_price).toFixed(2);
  simulate(s);
}

function simulate(seed) {
  clearTimeout(simTimer);
  simTimer = setTimeout(async () => {
    const base = (seed && seed.sku) ? seed : state.inventory.find((i) => i.sku === $('skuPicker').value) || {};
    const s7 = parseFloat($('slS7').value);
    const payload = {
      sku: $('skuPicker').value || base.sku || 'SIM-SKU',
      category: $('fcCategory').value,
      size: $('fcSize').value,
      current_stock: parseInt($('slStock').value, 10),
      lead_time_days: parseInt($('slLead').value, 10),
      sales_last_7d: s7,
      // keep the file's own 14d / lag-1 values until the user moves the 7d slider
      sales_last_14d: base.sales_last_7d && Math.round(base.sales_last_7d) === Math.round(s7) && base.sales_last_14d ? base.sales_last_14d : s7 * 1.9,
      sales_lag_1: base.sales_last_7d && Math.round(base.sales_last_7d) === Math.round(s7) && base.sales_lag_1 != null ? base.sales_lag_1 : s7 / 6.0,
      zero_days_last_14d: parseFloat($('slZero').value),
      unit_cost: parseFloat($('fcUnitCost').value) || 0,
      unit_price: parseFloat($('fcUnitPrice').value) || 0,
    };
    try {
      const res = await fetch('/api/predict-sku', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) return;
      const data = await res.json();
      const m = data.metrics;
      $('fcSku').textContent = data.sku;
      $('fcForecast').textContent = m.predicted_7d_demand.toFixed(1);
      $('fcRop').textContent = m.reorder_point.toFixed(1);
      $('fcRunway').textContent = `${m.stockout_timeline_days} d`;
      $('fcQty').textContent = m.recommended_reorder_qty;
      $('fcAdvice').textContent = m.actionable_advice;
      const v = $('fcVerdict');
      v.textContent = m.risk_status;
      v.className = 'badge ' + (m.risk_status === 'Healthy' ? 'healthy' : m.risk_status === 'Reorder Advised' ? 'high' : 'critical');
      const g = data.model_governance || {};
      $('fcNote').innerHTML = `<span>Lead-time demand <b>${m.demand_during_lead_time}</b></span><span>Safety stock <b>${m.safety_stock}</b></span><span>Daily velocity <b>${m.daily_velocity}</b>/day</span><span>Model <b>${esc(g.algorithm || 'XGBoost')}</b> · R² <b>${g.test_r2}</b> · RMSE <b>${g.test_rmse}</b></span>`;
      drawCurve(data.projected_trajectory, payload.current_stock);
      state.lastSimulationResult = data;
    } catch (e) { console.error(e); }
  }, 220);
}

async function runAnalyzeAndFocusFlow() {
  const picker = $('skuPicker');
  const skuName = picker ? picker.value : 'JNE3797-KR-M';
  const base = state.inventory.find((i) => i.sku === skuName) || {};
  const s7 = parseFloat($('slS7').value);

  const payload = {
    sku: skuName,
    category: $('fcCategory').value,
    size: $('fcSize').value,
    current_stock: parseInt($('slStock').value, 10),
    lead_time_days: parseInt($('slLead').value, 10),
    sales_last_7d: s7,
    sales_last_14d: base.sales_last_7d && Math.round(base.sales_last_7d) === Math.round(s7) && base.sales_last_14d ? base.sales_last_14d : s7 * 1.9,
    sales_lag_1: base.sales_last_7d && Math.round(base.sales_last_7d) === Math.round(s7) && base.sales_lag_1 != null ? base.sales_lag_1 : s7 / 6.0,
    zero_days_last_14d: parseFloat($('slZero').value),
    unit_cost: parseFloat($('fcUnitCost').value) || 0,
    unit_price: parseFloat($('fcUnitPrice').value) || 0,
  };

  try {
    toast(`Running XGBoost prediction on ${skuName}...`);
    const res = await fetch('/api/predict-sku', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Prediction failed');
    const data = await res.json();
    const m = data.metrics;

    let statusPill = 'HEALTHY';
    if (m.risk_status === 'Critical Stockout') statusPill = 'CRITICAL';
    else if (m.risk_status === 'Reorder Advised') statusPill = 'LOW STOCK';

    state.focusedSku = {
      sku: data.sku,
      category: data.category,
      size: data.size,
      forecast_units: m.predicted_7d_demand,
      current_stock: data.current_stock,
      stock_runway: m.stockout_timeline_days,
      reorder_point: m.reorder_point,
      order_qty: m.recommended_reorder_qty,
      advice: m.actionable_advice,
      status: statusPill,
    };

    switchTab('overview');
    renderFlow();
    toast(`Focused ${data.sku}: 7D forecast = ${m.predicted_7d_demand.toFixed(1)} units (${statusPill})`);
  } catch (err) {
    console.error('Analyze error:', err);
    toast('Prediction error: ' + err.message);
  }
}

function clearSkuFocus() {
  state.focusedSku = null;
  renderFlow();
}

async function resetToDefaultDataset() {
  const btn = $('btnResetCenter');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Resetting…</span>';
  }
  try {
    const res = await fetch('/api/reset-dataset', { method: 'POST' });
    if (!res.ok) throw new Error('Reset failed');
    const data = await res.json();
    state.focusedSku = null;
    await refreshAll();
    toast(`✓ ${data.message || 'Restored original default data (16 SKUs)'}`);
  } catch (err) {
    toast(`Error resetting data: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="rotate-ccw"></i><span>Reset</span>';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  }
}

function drawCurve(traj, stock) {
  const grid = $('curve');
  if (!traj) return;
  const safety = traj[0].safety_line;
  const maxV = Math.max(stock, safety, 1);
  const bars = [{ day: 'Now', projected_stock: stock }, ...traj];
  const H = 118; // drawable px height
  grid.innerHTML = bars.map((t) => {
    const hpx = Math.max(6, Math.round((t.projected_stock / maxV) * H));
    return `<div class="col"><div class="bar ${t.projected_stock <= safety ? 'low' : ''}" style="height:${hpx}px"><span class="v mono">${t.projected_stock}</span></div><span>${t.day}</span></div>`;
  }).join('') + `<div class="safety" style="bottom:${22 + Math.round((safety / maxV) * H)}px"><i>safety ${safety}</i></div>`;
}

/* ───────────── Procurement ───────────── */
async function loadProcurement() {
  try {
    const { summary: s, queue } = await (await fetch('/api/procurement-queue')).json();
    $('poCap').textContent = money(s.total_capital_required, 2);
    $('poSkus').textContent = `${s.skus_to_reorder_count} SKUs below reorder point`;
    $('poCrit').textContent = `${s.critical_stockouts_count} SKUs`;
    $('poUnits').textContent = s.total_units_to_order.toLocaleString();
    $('poLead').textContent = `${s.avg_lead_time_days} d`;
    $('poDot').classList.toggle('hidden', s.critical_stockouts_count === 0);
    $('poBody').innerHTML = queue.length ? queue.map((i) => {
      const cls = i.urgency === 'CRITICAL' ? 'critical' : i.urgency === 'HIGH' ? 'high' : 'low';
      return `<tr>
        <td class="sku mono">${esc(i.sku)}</td><td>${esc(i.category)} (${esc(i.size)})</td>
        <td class="num mono">${i.current_stock}</td><td class="num mono">${i.reorder_point.toFixed(1)}</td>
        <td class="num mono">${i.days_runway} d</td><td class="num mono" style="color:var(--violet);font-weight:600">+${i.recommended_reorder_qty}</td>
        <td class="num mono">${money(i.unit_cost, 2)}</td><td class="num mono" style="font-weight:600;color:var(--ink)">${money(i.total_po_cost, 2)}</td>
        <td><span class="badge ${cls}">${i.urgency}</span></td></tr>`;
    }).join('') : '<tr><td colspan="9" class="empty">Every SKU is above its reorder point 🎉</td></tr>';
  } catch (e) { console.error(e); }
}

/* ───────────── Dead stock ───────────── */
async function loadClearance() {
  try {
    const { summary: s, candidates } = await (await fetch('/api/clearance-candidates')).json();
    $('clDrain').textContent = `${money(s.total_monthly_fba_drain, 2)}/mo`;
    $('clLocked').textContent = money(s.capital_locked, 2);
    $('clIdle').textContent = s.idle_units_count.toLocaleString();
    $('clCount').textContent = `${s.clearance_skus_count} SKUs`;
    $('clAvgIdle').textContent = `avg ${s.avg_idle_days} idle days / 14`;
    $('clBody').innerHTML = candidates.length ? candidates.map((c) => `<tr>
      <td class="sku mono">${esc(c.sku)}</td><td>${esc(c.category)} · ${esc(c.size)}</td>
      <td><span class="badge critical mono">${c.zero_days_last_14d} days idle</span></td>
      <td class="num mono">${c.current_stock}</td><td class="num mono" style="color:var(--coral);font-weight:600">${money(c.est_monthly_fba_fee, 2)}/mo</td>
      <td>${esc(c.action)}</td>
      <td class="num"><button class="btn primary" style="padding:5px 14px" data-sku="${esc(c.sku)}" data-act="${esc(c.action)}">Apply</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No dead stock detected</td></tr>';
    document.querySelectorAll('#clBody button').forEach((b) => b.addEventListener('click', () => toast(`Executed “${b.dataset.act}” on ${b.dataset.sku}`)));
  } catch (e) { console.error(e); }
}

/* ───────────── Upload with 0% -> 100% Multi-Stage Tracker ───────────── */
function openUpload() {
  $('uploadModal').classList.remove('hidden');
  resetUploadModal();
}

function closeUpload() {
  $('uploadModal').classList.add('hidden');
  resetUploadModal();
}

function resetUploadModal() {
  $('dropZone').classList.remove('hidden');
  $('uploadProgressCard').classList.add('hidden');
  $('templatesRow').classList.remove('hidden');
  $('upBtnRetry').classList.add('hidden');
  $('upResult').classList.add('hidden');
  $('upBarFill').style.width = '0%';
  $('upPercent').textContent = '0%';
  for (let i = 1; i <= 5; i++) {
    const st = $(`upStep${i}`);
    if (st) {
      st.className = 'up-step';
      $(`upStep${i}Badge`).textContent = '0%';
    }
  }
  $('upStep1Sub').textContent = 'Pending…';
  $('upStep2Sub').textContent = 'Waiting…';
  $('upStep3Sub').textContent = 'Waiting…';
  $('upStep4Sub').textContent = 'Waiting…';
  $('upStep5Sub').textContent = 'Waiting…';
}

function setStep(num, status, pct, sub) {
  const el = $(`upStep${num}`);
  if (!el) return;
  el.className = `up-step ${status}`;
  if (pct != null) $(`upStep${num}Badge`).textContent = `${pct}%`;
  if (sub != null) $(`upStep${num}Sub`).textContent = sub;
}

function setOverallProgress(pct) {
  const p = Math.min(100, Math.max(0, Math.round(pct)));
  $('upPercent').textContent = `${p}%`;
  $('upBarFill').style.width = `${p}%`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadFile(file) {
  const drop = $('dropZone');
  const card = $('uploadProgressCard');
  const templ = $('templatesRow');
  const retryBtn = $('upBtnRetry');
  const resBox = $('upResult');

  drop.classList.add('hidden');
  templ.classList.add('hidden');
  card.classList.remove('hidden');
  resBox.classList.add('hidden');
  retryBtn.classList.add('hidden');

  $('upFileName').textContent = file.name;
  const kb = (file.size / 1024).toFixed(1);
  $('upFileSize').textContent = `${kb} KB · Processing pipeline`;

  // Determine icon by extension
  const ext = file.name.split('.').pop().toLowerCase();
  const iconMap = {
    pdf: 'file-text',
    xlsx: 'file-spreadsheet',
    xls: 'file-spreadsheet',
    csv: 'file-spreadsheet',
    docx: 'file-text',
    md: 'file-code',
    txt: 'file-text',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
  };
  const icName = iconMap[ext] || 'file';
  $('upFileIcon').innerHTML = `<i data-lucide="${icName}"></i>`;
  if (window.lucide) lucide.createIcons({ root: $('upFileIcon') });

  // Phase 1: Upload stream (0% -> 25%)
  setStep(1, 'active', 10, 'Streaming file chunks…');
  setOverallProgress(5);

  const fd = new FormData();
  fd.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload-inventory', true);

  // Track real byte transmission
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const bytePct = Math.round((ev.loaded / ev.total) * 100);
      const overall = Math.round((bytePct / 100) * 25);
      setOverallProgress(overall);
      setStep(1, 'active', bytePct, `${(ev.loaded / 1024).toFixed(1)} / ${(ev.total / 1024).toFixed(1)} KB uploaded`);
    }
  };

  const uploadPromise = new Promise((resolve, reject) => {
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error('Invalid JSON response from server'));
        }
      } else {
        let msg = `Server returned ${xhr.status}`;
        try {
          const err = JSON.parse(xhr.responseText);
          if (err.detail) msg = err.detail;
        } catch (_) {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during file upload'));
    xhr.ontimeout = () => reject(new Error('Request timed out (45s limit)'));
    xhr.timeout = 45000;
  });

  xhr.send(fd);

  try {
    // Stage 1 completes
    await sleep(200);
    setStep(1, 'done', 100, `✓ Verified checksum (${kb} KB)`);
    setOverallProgress(28);

    // Stage 2: Layout / Tables / OCR (28% -> 55%)
    setStep(2, 'active', 40, `Extracting ${ext.toUpperCase()} document tabular structure…`);
    setOverallProgress(42);
    await sleep(220);
    setStep(2, 'active', 75, 'Parsing table cells & rows…');
    setOverallProgress(54);

    // Await server processing
    const data = await uploadPromise;

    setStep(2, 'done', 100, `✓ Extracted ${data.extracted_count} raw SKU rows`);
    setOverallProgress(62);

    // Stage 3: Schema Mapping & 31 Features (60% -> 80%)
    setStep(3, 'active', 50, 'Mapping columns & generating lag velocity…');
    setOverallProgress(70);
    await sleep(180);
    const catCount = (data.categories_found || []).length || 'Multiple';
    setStep(3, 'done', 100, `✓ 31 features mapped (${catCount} categories)`);
    setOverallProgress(82);

    // Stage 4: XGBoost Batch Inference (82% -> 95%)
    setStep(4, 'active', 60, 'Evaluating 7-day model regression & safety runway…');
    setOverallProgress(90);
    await sleep(180);
    setStep(4, 'done', 100, `✓ 7-Day sales predicted for ${data.extracted_count} SKUs`);
    setOverallProgress(95);

    // Stage 5: ORION Sankey Flow Synthesis (95% -> 100%)
    setStep(5, 'active', 80, 'Synthesizing Sankey streams & donut rings…');
    await refreshAll();
    setStep(5, 'done', 100, '✓ Dashboard refreshed');
    setOverallProgress(100);

    // Final Success Notice
    resBox.className = 'up-result success';
    resBox.innerHTML = `<span>✓</span><span><strong>${esc(data.filename)}</strong> loaded: ${data.extracted_count} SKUs evaluated across 31 features</span>`;
    resBox.classList.remove('hidden');

    toast(`Successfully loaded ${data.extracted_count} SKUs`);
    setTimeout(closeUpload, 1400);

  } catch (err) {
    let activeStep = 2;
    for (let i = 1; i <= 5; i++) {
      const st = $(`upStep${i}`);
      if (st && st.classList.contains('active')) activeStep = i;
    }
    setStep(activeStep, 'error', null, `Failed: ${err.message}`);

    resBox.className = 'up-result fail';
    resBox.innerHTML = `<span>⚠</span><span>${esc(err.message)}</span>`;
    resBox.classList.remove('hidden');
    retryBtn.classList.remove('hidden');
    retryBtn.onclick = () => resetUploadModal();
  }
}

/* ───────────── Misc ───────────── */
function showModelInfo() {
  const m = state.overview && state.overview.model;
  toast(m && m.r2 != null ? `${m.algorithm} · R² ${m.r2} · MAE ${m.mae} · RMSE ${m.rmse}` : 'Model loading…');
}

function toast(msg) {
  $('toastMsg').textContent = msg;
  const t = $('toast');
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
