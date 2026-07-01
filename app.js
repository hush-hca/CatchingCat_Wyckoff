const FALLBACK = [
  { symbol: "SUI", name: "Sui", price: 3.8421, change: 8.42, rvol: 4.8, phase: "C", phaseLabel: "Spring / test", signal: "Entry pending", support: 3.41, resistance: 3.96 },
  { symbol: "ONDO", name: "Ondo", price: 1.1274, change: 5.18, rvol: 3.9, phase: "D", phaseLabel: "Sign of strength", signal: "Breakout watch", support: 0.94, resistance: 1.14 },
  { symbol: "ENA", name: "Ethena", price: 0.6842, change: -1.24, rvol: 3.2, phase: "B", phaseLabel: "Building cause", signal: "Accumulating", support: 0.61, resistance: 0.73 },
  { symbol: "ARB", name: "Arbitrum", price: 1.0548, change: 3.61, rvol: 2.8, phase: "C", phaseLabel: "Last point support", signal: "Test forming", support: 0.92, resistance: 1.08 },
  { symbol: "INJ", name: "Injective", price: 28.391, change: 2.07, rvol: 2.4, phase: "B", phaseLabel: "Secondary test", signal: "Range watch", support: 25.4, resistance: 30.2 }
];

const QUALIFIED_UNIVERSE_SIZE = 184;
const PRIORITY_ASSET_COUNT = 5;

const VIEW_COPY = {
  dashboard: ["Good evening, Operator.", "Read the structure. Follow the volume. Protect the downside."],
  volume: ["Volume Fire", "The fastest view of abnormal one-minute participation across the market."],
  scanner: ["Wyckoff Scanner", "Compare qualified structures, then inspect the selected setup below."],
  watchlist: ["Your Watchlist", "Only the assets you chose to monitor—no scanning noise."],
  alpha: ["Alpha Rank", "Phase D opportunities ranked by trend clarity, VWAP precision, and volume depletion."],
  journal: ["Decision Journal", "Write the rule before the market gives you a story."],
  guide: ["How to use", "Catching Cat을 장중에 빠르고 일관되게 사용하는 방법입니다."]
};

let assets = structuredClone(FALLBACK);
let selected = assets[0];
let threshold = Number(localStorage.getItem("cc-threshold") || 2);
const DOMESTIC_DOMINANCE_THRESHOLD = 40;
let manualBlacklist = localStorage.getItem("cc-manual-blacklist") || "BTC, ETH, BNB, SOL, XRP";
let lastUniverseFilterStats = null;
const requestedView = location.pathname === "/how-to-use" ? "guide" : location.hash.slice(1);
let currentView = VIEW_COPY[requestedView] ? requestedView : VIEW_COPY[localStorage.getItem("cc-view")] ? localStorage.getItem("cc-view") : "dashboard";
let currentFilter = "all";
let sortRules = [];
let watchlist = readStorage("cc-watchlist", ["SUI", "ONDO", "ENA"]);
let journalEntries = readStorage("cc-journal", []);
let expandedScannerSymbol = null;
let scannerToggleToken = 0;
let currentTimeframe = "4H";
let chartRequestToken = 0;
const chartCache = new Map();
let alphaRankings = [];
let alphaLoading = false;
let alphaRunToken = 0;
let liveUniverseReady = false;
let expandedAlphaSymbol = null;
let alphaToggleToken = 0;

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];
const fmt = (value) => value >= 1000
  ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  : value >= 10 ? `$${value.toFixed(3)}` : `$${value.toFixed(4)}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[character]);

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function renderTickers() {
  const extras = [
    { symbol: "BTC", price: 104382.2, change: 0.81 },
    { symbol: "ETH", price: 3384.1, change: 1.25 },
    { symbol: "TOTAL3", price: 842.6, change: 1.84 }
  ];
  qs("#tickerStrip").innerHTML = extras.concat(assets.slice(0, 4)).map(asset =>
    `<span>${asset.symbol}<b>${fmt(asset.price)}</b><i class="${asset.change >= 0 ? "up" : "down"}">${asset.change >= 0 ? "+" : ""}${asset.change.toFixed(2)}%</i></span>`
  ).join("");
}

function visibleAssets() {
  let list = currentView === "scanner" ? [...assets] : assets.slice(0, PRIORITY_ASSET_COUNT);
  if (currentView === "watchlist") list = assets.filter(asset => watchlist.includes(asset.symbol));
  if (currentFilter === "accumulation") list = list.filter(asset => ["A", "B"].includes(asset.phase));
  if (currentFilter === "breakouts") list = list.filter(asset => ["C", "D"].includes(asset.phase));
  if (sortRules.length) {
    list = list
      .map((asset, originalIndex) => ({ asset, originalIndex }))
      .sort((left, right) => {
        for (const rule of sortRules) {
          const leftValue = left.asset[rule.key];
          const rightValue = right.asset[rule.key];
          const comparison = typeof leftValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
          if (comparison) return rule.direction === "asc" ? comparison : -comparison;
        }
        return left.originalIndex - right.originalIndex;
      })
      .map(item => item.asset);
  }
  return list;
}

function defaultSortDirection(key) {
  return ["price", "rvol", "change"].includes(key) ? "desc" : "asc";
}

function updateSortControls() {
  qsa("[data-sort-key]").forEach(button => {
    const ruleIndex = sortRules.findIndex(rule => rule.key === button.dataset.sortKey);
    const rule = sortRules[ruleIndex];
    const indicator = button.querySelector(".sort-indicator");
    button.classList.toggle("sorted", Boolean(rule));
    indicator.textContent = rule ? `${rule.direction === "asc" ? "↑" : "↓"} ${ruleIndex + 1}` : "↕";
    const header = button.closest("th");
    if (ruleIndex === 0) header.setAttribute("aria-sort", rule.direction === "asc" ? "ascending" : "descending");
    else header.removeAttribute("aria-sort");
  });
  qs("#clearSortBtn").hidden = sortRules.length === 0;
}

function updateSort(key) {
  const existingIndex = sortRules.findIndex(rule => rule.key === key);
  const defaultDirection = defaultSortDirection(key);
  if (existingIndex < 0) {
    sortRules = [...sortRules, { key, direction: defaultDirection }];
  } else if (sortRules[existingIndex].direction === defaultDirection) {
    sortRules[existingIndex] = {
      ...sortRules[existingIndex],
      direction: defaultDirection === "asc" ? "desc" : "asc"
    };
  } else {
    sortRules = sortRules.filter((_, index) => index !== existingIndex);
  }
  updateSortControls();
  renderRows();
}

function buildQualifiedUniverse(rows) {
  const liveRows = rows
    .filter(row => row.symbol?.endsWith("USDT") && Number(row.lastPrice) > 0 && Number(row.quoteVolume) > 0)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  const liveBySymbol = new Map(liveRows.map(row => [row.symbol.slice(0, -4), row]));
  const prioritySymbols = new Set(FALLBACK.map(asset => asset.symbol));

  const toAsset = (row, index, template) => {
    const symbol = row.symbol.slice(0, -4);
    const price = Number(row.lastPrice);
    const change = Number(row.priceChangePercent);
    const low = Number(row.lowPrice) || price * 0.92;
    const high = Number(row.highPrice) || price * 1.08;
    const rangePosition = high > low ? (price - low) / (high - low) : 0.5;
    const phase = rangePosition < 0.25 ? "A" : rangePosition < 0.5 ? "B" : rangePosition < 0.72 ? "C" : "D";
    const phaseCopy = {
      A: ["Selling climax", "Base forming"],
      B: ["Building cause", "Accumulating"],
      C: ["Spring / test", "Test forming"],
      D: ["Sign of strength", "Breakout watch"]
    };
    const rankBoost = 2 * (1 - Math.min(index, QUALIFIED_UNIVERSE_SIZE - 1) / QUALIFIED_UNIVERSE_SIZE);
    const rvol = Math.min(6.8, Math.max(1.1, 1.5 + rankBoost + Math.min(Math.abs(change) / 8, 1.5)));
    return {
      symbol,
      name: template?.name || symbol,
      price,
      change,
      rvol: template?.rvol || rvol,
      phase,
      phaseLabel: phaseCopy[phase][0],
      signal: phaseCopy[phase][1],
      support: low,
      resistance: high
    };
  };

  const priority = FALLBACK
    .map((template, index) => {
      const row = liveBySymbol.get(template.symbol);
      return row ? toAsset(row, index, template) : template;
    });
  const remaining = liveRows
    .filter(row => !prioritySymbols.has(row.symbol.slice(0, -4)))
    .map((row, index) => toAsset(row, index + priority.length));

  return [...priority, ...remaining].slice(0, QUALIFIED_UNIVERSE_SIZE * 3);
}

function updateUniverseFilterStatus(stats = lastUniverseFilterStats) {
  const status = qs("#universeFilterStatus");
  if (!status) return;
  const korean = window.I18N?.language === "ko";
  status.classList.remove("active", "partial");
  if (!stats) {
    status.textContent = korean ? "키리스 필터 로딩 중…" : "Keyless filter loading…";
    return;
  }
  const partial = stats.warnings.length > 0;
  status.classList.add(partial ? "partial" : "active");
  status.textContent = korean
    ? `키리스 필터 · ${stats.excluded}개 제외`
    : `Keyless filter · ${stats.excluded} excluded`;
  status.dataset.domesticExcluded = stats.domesticSymbols.join(",");
  status.title = korean
    ? `수동 ${stats.manual} · 상장 조건 ${stats.listing} · 국내 비중 40% 이상 ${stats.domestic}${stats.domesticSymbols.length ? ` (${stats.domesticSymbols.join(", ")})` : ""}${partial ? ` · 일부 피드 실패: ${stats.warnings.join(", ")}` : ""}`
    : `Manual ${stats.manual} · Listing ${stats.listing} · Domestic share ≥40% ${stats.domestic}${stats.domesticSymbols.length ? ` (${stats.domesticSymbols.join(", ")})` : ""}${partial ? ` · Partial feeds: ${stats.warnings.join(", ")}` : ""}`;
}

function renderRows(openInlineChart = true) {
  const chartPanel = qs("#selectedSetupPanel");
  const chartAnchor = qs("#chartAnchor");
  if (chartPanel && chartAnchor && !chartAnchor.nextElementSibling?.isSameNode(chartPanel)) {
    chartAnchor.after(chartPanel);
  }
  const rows = visibleAssets();
  const empty = currentView === "watchlist" && rows.length === 0;
  qs(".table-wrap").hidden = empty;
  qs("#watchlistEmpty").style.display = empty ? "flex" : "none";
  qs("#opportunityRows").innerHTML = rows.map((asset, index) => {
    const watched = watchlist.includes(asset.symbol);
    const assetRow = `
      <tr data-symbol="${asset.symbol}" class="${selected.symbol === asset.symbol ? "selected" : ""}" aria-expanded="${currentView === "scanner" && expandedScannerSymbol === asset.symbol}">
        <td><div class="asset-cell">
          <button class="watch-toggle ${watched ? "watched" : ""}" data-watch="${asset.symbol}" aria-label="${watched ? "Remove" : "Add"} ${asset.symbol} ${watched ? "from" : "to"} watchlist">${watched ? "◆" : "◇"}</button>
          <span class="coin-badge ${asset.symbol.toLowerCase()}">${asset.symbol[0]}</span>
          <span><strong>${asset.symbol}</strong><small>${asset.name}</small></span>
        </div></td>
        <td><div class="price-cell"><strong>${fmt(asset.price)}</strong><span class="${asset.change >= 0 ? "up" : "down"}">${asset.change >= 0 ? "+" : ""}${asset.change.toFixed(2)}%</span></div></td>
        <td><span class="rvol">${asset.rvol.toFixed(1)}×</span><div class="rvol-bar"><i style="width:${Math.min(asset.rvol / 5 * 100, 100)}%"></i></div></td>
        <td><span class="phase-pill phase-${asset.phase.toLowerCase()}">PHASE ${asset.phase}</span><small style="display:block;color:#697e74;margin-top:3px;font-size:10px">${asset.phaseLabel}</small></td>
        <td><span class="signal-pill ${index === 0 ? "signal-spring" : index === 1 ? "signal-watch" : ""}">${asset.signal}</span></td>
        <td class="row-arrow">›</td>
      </tr>`;
    const inlineChart = currentView === "scanner" && expandedScannerSymbol === asset.symbol
      ? `<tr class="inline-chart-row" data-chart-for="${asset.symbol}"><td colspan="6"><div class="inline-chart-shell"><div class="inline-chart-mount"></div></div></td></tr>`
      : "";
    return assetRow + inlineChart;
  }).join("");

  const inlineMount = qs(".inline-chart-mount");
  if (inlineMount && chartPanel) {
    inlineMount.append(chartPanel);
    if (openInlineChart) qs(".inline-chart-shell")?.classList.add("open");
  }

  qsa("#opportunityRows tr[data-symbol]").forEach(row => {
    row.onclick = () => {
      if (currentView === "scanner") toggleScannerChart(row.dataset.symbol);
      else selectAsset(row.dataset.symbol);
    };
  });
  qsa("[data-watch]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      toggleWatchlist(button.dataset.watch);
    };
  });
  qs("#watchCount").textContent = watchlist.length;
}

function toggleWatchlist(symbol) {
  if (watchlist.includes(symbol)) {
    watchlist = watchlist.filter(item => item !== symbol);
    showToast(`${symbol} removed`, "Your watchlist has been updated.", "◇");
  } else {
    watchlist = [...watchlist, symbol];
    showToast(`${symbol} added`, "It will stay in your focused watchlist.", "◆");
  }
  localStorage.setItem("cc-watchlist", JSON.stringify(watchlist));
  renderRows();
}

function renderFire() {
  const fire = [...assets.slice(0, 10), { symbol: "WIF", rvol: 2.2 }, { symbol: "SEI", rvol: 2.0 }]
    .sort((a, b) => b.rvol - a.rvol);
  qs("#fireList").innerHTML = fire.map(asset => {
    const interactive = assets.some(item => item.symbol === asset.symbol);
    return `<button class="fire-row" ${interactive ? `data-fire-symbol="${asset.symbol}"` : "disabled"}><span>${asset.symbol}</span><span class="fire-bar"><i style="width:${Math.min(asset.rvol / 5.2 * 100, 100)}%"></i></span><b>${asset.rvol.toFixed(1)}×</b></button>`;
  }).join("");
  const ignitions = fire.filter(asset => asset.rvol >= threshold).length;
  qs("#ignitionCount").textContent = ignitions;
  qs("#navIgnitionCount").textContent = ignitions;
  qsa("[data-fire-symbol]").forEach(button => {
    button.onclick = () => {
      selectAsset(button.dataset.fireSymbol);
      setView("scanner");
    };
  });
}

const PHASE_META = {
  A: { label: "Stopping action", signal: "Base forming" },
  B: { label: "Building cause", signal: "Accumulating" },
  C: { label: "Spring / test", signal: "Test forming" },
  D: { label: "Sign of strength", signal: "Breakout watch" },
  E: { label: "Markup trend", signal: "Trend active" }
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function buildPhaseLabels(candles, phase, events = {}) {
  const labels = [];
  const addLabel = (index, text, dy) => {
    if (Number.isInteger(index) && index >= 0 && index < candles.length && !labels.some(label => label.index === index)) {
      labels.push({ index, text, dy });
    }
  };

  if (["A", "B", "C"].includes(phase)) {
    addLabel(events.preliminarySupportIndex, "PS", -12);
    addLabel(events.sellingClimaxIndex, "SC", 18);
    addLabel(events.automaticRallyIndex, "AR", -15);
  }
  if (["B", "C"].includes(phase)) addLabel(events.secondaryTestIndex, "ST", 18);
  if (phase === "C" && events.springIndex >= 0) {
    addLabel(events.springIndex, "SPRING", 20);
    addLabel(Math.min(candles.length - 1, events.springIndex + 3), "TEST", 18);
  }
  if (["D", "E"].includes(phase) && events.breakoutIndex >= 0) {
    addLabel(events.breakoutIndex, "SOS", -16);
    addLabel(Math.min(candles.length - 1, events.breakoutIndex + 3), "LPS", 18);
  }
  if (phase === "E") addLabel(candles.length - 3, "MARKUP", -16);

  return labels.sort((a, b) => a.index - b.index);
}

function estimateWyckoffPhase(candles) {
  const referenceEnd = Math.max(18, candles.length - 12);
  const reference = candles.slice(0, referenceEnd);
  const support = percentile(reference.map(candle => candle.low), 0.08);
  const resistance = percentile(reference.map(candle => candle.high), 0.92);
  const last = candles.at(-1);
  const searchStart = referenceEnd;
  let springIndex = -1;
  let breakoutIndex = -1;

  for (let index = searchStart; index < candles.length; index += 1) {
    if (springIndex < 0 && candles[index].low < support * 0.995 && candles[index].close > support) springIndex = index;
    if (breakoutIndex < 0 && candles[index].close > resistance * 1.005) breakoutIndex = index;
  }

  const recentCloses = candles.slice(-5).map(candle => candle.close);
  const sustainedBreakout = breakoutIndex >= 0 && recentCloses.filter(close => close > resistance).length >= 4;
  const tenBarsAgo = candles[Math.max(0, candles.length - 11)].close;
  const slope = tenBarsAgo ? (last.close - tenBarsAgo) / tenBarsAgo : 0;
  const rangePosition = resistance > support ? (last.close - support) / (resistance - support) : 0.5;
  let phase = "B";
  if (sustainedBreakout && slope > 0.025) phase = "E";
  else if (breakoutIndex >= 0 && last.close > resistance * 0.995) phase = "D";
  else if (springIndex >= 0 && last.close > support) phase = "C";
  else if (rangePosition < 0.28 && slope < 0.02) phase = "A";

  const firstHalf = candles.slice(0, referenceEnd);
  const sellingClimaxIndex = firstHalf.reduce((lowest, candle, index) =>
    candle.low < firstHalf[lowest].low ? index : lowest, 0);
  const preliminarySupportIndex = Math.max(1, sellingClimaxIndex - 5);
  const rallyWindow = candles.slice(sellingClimaxIndex + 1, Math.min(referenceEnd, sellingClimaxIndex + 14));
  const automaticRallyIndex = rallyWindow.length
    ? sellingClimaxIndex + 1 + rallyWindow.reduce((highest, candle, index) => candle.high > rallyWindow[highest].high ? index : highest, 0)
    : Math.min(candles.length - 1, sellingClimaxIndex + 5);
  const secondaryTestIndex = Math.min(referenceEnd - 1, automaticRallyIndex + 6);
  const events = {
    preliminarySupportIndex,
    sellingClimaxIndex,
    automaticRallyIndex,
    secondaryTestIndex,
    springIndex,
    breakoutIndex
  };

  return { phase, support, resistance, events, labels: buildPhaseLabels(candles, phase, events) };
}

function renderPhaseTrack(phase) {
  const phases = ["A", "B", "C", "D", "E"];
  const currentIndex = phases.indexOf(phase);
  qsa(".phase-track [data-phase]").forEach(item => {
    const index = phases.indexOf(item.dataset.phase);
    item.classList.toggle("done", index < currentIndex);
    item.classList.toggle("current", index === currentIndex);
  });
}

function renderChartState(message) {
  qs("#wyckoffChart").innerHTML = `<div class="chart-state"><span class="pulse"></span>${message}</div>`;
}

function chartCopy(english, korean) {
  return window.I18N?.language === "ko" ? korean : english;
}

function renderChart(candles, estimate) {
  const W = 800, H = 230, pad = 24, priceBottom = 184, volumeBottom = 225;
  const lows = candles.map(candle => candle.low);
  const highs = candles.map(candle => candle.high);
  const min = Math.min(...lows, estimate.support) * 0.995;
  const max = Math.max(...highs, estimate.resistance) * 1.005;
  const spacing = (W - pad * 2) / candles.length;
  const candleWidth = Math.max(2.2, Math.min(7, spacing * 0.58));
  const x = index => pad + spacing * index + spacing / 2;
  const y = value => priceBottom - (value - min) / Math.max(max - min, Number.EPSILON) * (priceBottom - pad);
  const maxVolume = Math.max(...candles.map(candle => candle.volume), 1);
  const last = candles.at(-1);

  qs("#wyckoffChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${selected.symbol} ${currentTimeframe} live candlestick chart">
    ${[0.2, 0.4, 0.6, 0.8].map(level => `<line x1="${pad}" y1="${pad + level * (priceBottom - pad)}" x2="${W - pad}" y2="${pad + level * (priceBottom - pad)}" stroke="rgba(190,225,209,.07)" stroke-dasharray="2 5"/>`).join("")}
    <rect x="${pad}" y="${y(estimate.resistance)}" width="${W - pad * 2}" height="${Math.max(1, y(estimate.support) - y(estimate.resistance))}" fill="rgba(98,168,255,.025)" stroke="rgba(98,168,255,.13)" stroke-dasharray="4 5"/>
    <line x1="${pad}" y1="${y(estimate.support)}" x2="${W - pad}" y2="${y(estimate.support)}" stroke="#62a8ff" stroke-opacity=".4" stroke-dasharray="4 4"/>
    <line x1="${pad}" y1="${y(estimate.resistance)}" x2="${W - pad}" y2="${y(estimate.resistance)}" stroke="#62a8ff" stroke-opacity=".4" stroke-dasharray="4 4"/>
    ${candles.map((candle, index) => {
      const rising = candle.close >= candle.open;
      const color = rising ? "#48e59b" : "#ff6868";
      const bodyTop = y(Math.max(candle.open, candle.close));
      const bodyHeight = Math.max(1.2, Math.abs(y(candle.open) - y(candle.close)));
      const volumeHeight = Math.max(2, candle.volume / maxVolume * 31);
      return `<line x1="${x(index)}" y1="${y(candle.high)}" x2="${x(index)}" y2="${y(candle.low)}" stroke="${color}" stroke-opacity=".72" vector-effect="non-scaling-stroke"/>
        <rect x="${x(index) - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" rx=".5" fill="${color}" opacity=".86"/>
        <rect x="${x(index) - candleWidth / 2}" y="${volumeBottom - volumeHeight}" width="${candleWidth}" height="${volumeHeight}" fill="${color}" opacity=".22"/>`;
    }).join("")}
    ${estimate.labels.map(label => {
      const candle = candles[label.index];
      const labelY = label.dy > 0 ? y(candle.low) : y(candle.high);
      const accent = label.text === "SPRING" ? "#ff8d55" : label.text === "SOS" ? "#48e59b" : "#789085";
      return `<circle cx="${x(label.index)}" cy="${labelY}" r="2.7" fill="#07100d" stroke="${accent}"/><text x="${x(label.index)}" y="${labelY + label.dy}" text-anchor="middle" fill="${accent}">${label.text}</text>`;
    }).join("")}
    <line x1="${x(candles.length - 1)}" y1="${y(last.close)}" x2="${W - pad}" y2="${y(last.close)}" stroke="#48e59b" stroke-opacity=".55" stroke-dasharray="2 3"/>
    <rect x="${W - 58}" y="${y(last.close) - 8}" width="54" height="16" rx="3" fill="#48e59b"/><text x="${W - 31}" y="${y(last.close) + 2}" text-anchor="middle" style="fill:#07100d">${last.close.toFixed(last.close < 10 ? 4 : 2)}</text>
  </svg>`;
}

async function loadSelectedChart() {
  const symbol = selected.symbol;
  const timeframe = currentTimeframe;
  const interval = { "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w" }[timeframe];
  const cacheKey = `${symbol}:${interval}`;
  const requestToken = ++chartRequestToken;
  const cached = chartCache.get(cacheKey);
  qs("#chartStructure").innerHTML = `<i class="meta-dot green"></i>${chartCopy(`Loading ${timeframe} live structure…`, `${timeframe} 실시간 구조 로딩 중…`)}`;
  renderChartState(chartCopy("Loading real-time candles…", "실시간 캔들 로딩 중…"));

  try {
    let payload = cached;
    if (!payload || Date.now() - payload.fetchedAt > 60_000) {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}USDT&interval=${interval}&limit=200`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("candles unavailable");
      const rows = await response.json();
      const candles = rows.map(row => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      })).filter(candle => [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite));
      if (candles.length < 30) throw new Error("insufficient candles");
      payload = { candles, estimate: estimateWyckoffPhase(candles), fetchedAt: Date.now() };
      chartCache.set(cacheKey, payload);
    }
    if (requestToken !== chartRequestToken || selected.symbol !== symbol || currentTimeframe !== timeframe) return;

    const chartPhase = selected.phase;
    const meta = PHASE_META[chartPhase];
    const chartEstimate = {
      ...payload.estimate,
      phase: chartPhase,
      labels: buildPhaseLabels(payload.candles, chartPhase, payload.estimate.events)
    };
    Object.assign(selected, {
      price: payload.candles.at(-1).close,
      support: payload.estimate.support,
      resistance: payload.estimate.resistance
    });
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;
    qs("#chartPrice").textContent = fmt(selected.price);
    qs("#supportPrice").textContent = fmt(selected.support);
    qs("#resistancePrice").textContent = fmt(selected.resistance);
    qs("#chartStructure").innerHTML = `<i class="meta-dot green"></i>${chartCopy(`Scanner Phase ${chartPhase} · ${meta.label} · live ${timeframe}`, `스캐너 Phase ${chartPhase} · ${window.I18N?.tr(meta.label) || meta.label} · 실시간 ${timeframe}`)}`;
    renderPhaseTrack(chartPhase);
    updateJournalSetup();
    renderChart(payload.candles, chartEstimate);
    restoreScrollPosition(scrollTop, scrollLeft);
  } catch {
    if (requestToken !== chartRequestToken || selected.symbol !== symbol) return;
    qs("#chartStructure").innerHTML = `<i class="meta-dot warning"></i>${chartCopy(`Live ${timeframe} structure unavailable`, `실시간 ${timeframe} 구조를 불러올 수 없음`)}`;
    renderPhaseTrack(selected.phase);
    renderChartState(chartCopy("Real-time candles unavailable", "실시간 캔들을 불러올 수 없습니다"));
  }
}

function selectAsset(symbol, shouldRenderRows = true) {
  selected = assets.find(asset => asset.symbol === symbol) || assets[0];
  qs("#chartSymbol").textContent = selected.symbol;
  qs("#chartPrice").textContent = fmt(selected.price);
  qs("#chartChange").textContent = `${selected.change >= 0 ? "+" : ""}${selected.change.toFixed(2)}%`;
  qs("#chartChange").className = selected.change >= 0 ? "up" : "down";
  qs("#supportPrice").textContent = fmt(selected.support);
  qs("#resistancePrice").textContent = fmt(selected.resistance);
  qs("#chartRvol").textContent = `${selected.rvol.toFixed(1)}×`;
  updateJournalSetup();
  if (shouldRenderRows) renderRows();
  renderPhaseTrack(selected.phase);
  loadSelectedChart();
}

function restoreScrollPosition(top, left) {
  window.scrollTo({ top, left, behavior: "auto" });
}

function toggleScannerChart(symbol) {
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;
  const sameSymbol = expandedScannerSymbol === symbol;
  const openShell = qs(".inline-chart-shell.open");
  const token = ++scannerToggleToken;

  const commitToggle = () => {
    if (token !== scannerToggleToken) return;
    expandedScannerSymbol = sameSymbol ? null : symbol;
    if (!sameSymbol) selectAsset(symbol, false);
    renderRows(false);
    restoreScrollPosition(scrollTop, scrollLeft);
    if (!sameSymbol) {
      requestAnimationFrame(() => {
        if (token !== scannerToggleToken) return;
        qs(".inline-chart-shell")?.classList.add("open");
        restoreScrollPosition(scrollTop, scrollLeft);
      });
    }
  };

  if (openShell) {
    openShell.classList.remove("open");
    restoreScrollPosition(scrollTop, scrollLeft);
    window.setTimeout(commitToggle, 220);
  } else {
    commitToggle();
  }
}

function alphaCopy(english, korean) {
  return window.I18N?.language === "ko" ? korean : english;
}

async function fetchPublicKlines(symbol, interval, limit, startTime) {
  const start = Number.isFinite(startTime) ? `&startTime=${startTime}` : "";
  const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}${start}`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`${symbol} ${interval} unavailable`);
  const rows = await response.json();
  const candles = rows.map(row => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  })).filter(candle => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite));
  if (candles.length < Math.min(limit, 20)) throw new Error(`${symbol} ${interval} insufficient`);
  return candles;
}

function simpleMovingAverage(candles, period = 200, offset = 0) {
  const end = offset ? -offset : candles.length;
  const start = offset ? -(period + offset) : -period;
  const closes = candles.slice(start, end).map(candle => candle.close);
  if (closes.length < period) return NaN;
  return closes.reduce((sum, close) => sum + close, 0) / closes.length;
}

function movingAverageSlope(candles, period = 200, lookback = 20) {
  const current = simpleMovingAverage(candles, period);
  const previous = simpleMovingAverage(candles, period, lookback);
  const percentPerBar = previous ? ((current - previous) / previous) / lookback * 100 : 0;
  return {
    current,
    previous,
    percentPerBar,
    angle: Math.atan(percentPerBar) * 180 / Math.PI
  };
}

function sessionVwapMetrics(candles, lookback = 12) {
  let weightedPrice = 0;
  let totalVolume = 0;
  const series = candles.map(candle => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    weightedPrice += typicalPrice * candle.volume;
    totalVolume += candle.volume;
    return totalVolume ? weightedPrice / totalVolume : NaN;
  });
  const current = series.at(-1);
  const previousIndex = Math.max(0, series.length - 1 - lookback);
  const previous = series[previousIndex];
  const bars = Math.max(1, series.length - 1 - previousIndex);
  const percentPerBar = previous ? ((current - previous) / previous) / bars * 100 : 0;
  return {
    current,
    previous,
    percentPerBar,
    angle: Math.atan(percentPerBar) * 180 / Math.PI
  };
}

function scoreTrendClarity(price, averages, vwap) {
  const alignmentFor = (sma100, sma200) => {
    if (price > sma100 && sma100 > sma200) return "bullish";
    if (price < sma100 && sma100 < sma200) return "bearish";
    return "tangled";
  };
  const oneHour = alignmentFor(averages.sma1h100, averages.sma1h200.current);
  const fourHour = alignmentFor(averages.sma4h100, averages.sma4h200.current);
  const distance1h = (price - averages.sma1h200.current) / averages.sma1h200.current * 100;
  const distance4h = (price - averages.sma4h200.current) / averages.sma4h200.current * 100;
  const stronglyOpposed = oneHour !== "tangled"
    && fourHour !== "tangled"
    && oneHour !== fourHour
    && Math.abs(distance1h) > 0.5
    && Math.abs(distance4h) > 0.5;
  const tolerance = 0.3;
  let macroDirection = "ambiguous";
  let alignmentScore = 0;
  let alignmentLabel = "Mixed timeframe direction";
  let alignmentLabelKo = "시간봉 방향 혼조";

  if (oneHour === fourHour && oneHour !== "tangled") {
    macroDirection = oneHour;
    alignmentScore = 30;
    alignmentLabel = "Full multi-timeframe alignment";
    alignmentLabelKo = "다중 시간봉 완전 정렬";
  } else if ((oneHour === "bullish" && distance4h >= -tolerance) || (fourHour === "bullish" && distance1h >= -tolerance)) {
    macroDirection = "bullish";
    alignmentScore = 22;
    alignmentLabel = "Partial bullish alignment";
    alignmentLabelKo = "부분 상승 정렬";
  } else if ((oneHour === "bearish" && distance4h <= tolerance) || (fourHour === "bearish" && distance1h <= tolerance)) {
    macroDirection = "bearish";
    alignmentScore = 22;
    alignmentLabel = "Partial bearish alignment";
    alignmentLabelKo = "부분 하락 정렬";
  } else if (distance1h > 0 && distance4h > 0) {
    macroDirection = "bullish";
    alignmentScore = 14;
    alignmentLabel = "Above both SMA200s; MAs tangled";
    alignmentLabelKo = "두 SMA200 위 · 이평선 혼조";
  } else if (distance1h < 0 && distance4h < 0) {
    macroDirection = "bearish";
    alignmentScore = 14;
    alignmentLabel = "Below both SMA200s; MAs tangled";
    alignmentLabelKo = "두 SMA200 아래 · 이평선 혼조";
  }

  const flatAngle = 0.15;
  const firstSlope = averages.sma1h200.angle;
  const secondSlope = averages.sma4h200.angle;
  const confirms = angle => macroDirection === "bullish" ? angle > flatAngle : macroDirection === "bearish" ? angle < -flatAngle : false;
  const flat = angle => Math.abs(angle) <= flatAngle;
  let slopeScore = 0;
  let slopeLabel = "Opposing SMA200 slopes";
  let slopeLabelKo = "SMA200 기울기 충돌";

  if (macroDirection !== "ambiguous" && confirms(firstSlope) && confirms(secondSlope)) {
    slopeScore = 20;
    slopeLabel = "Both SMA200 slopes confirm";
    slopeLabelKo = "두 SMA200 기울기 확인";
  } else if (macroDirection !== "ambiguous" && ((confirms(firstSlope) && flat(secondSlope)) || (confirms(secondSlope) && flat(firstSlope)))) {
    slopeScore = 12;
    slopeLabel = "One slope confirms; one is flat";
    slopeLabelKo = "한 기울기 확인 · 하나 횡보";
  } else if (macroDirection !== "ambiguous" && flat(firstSlope) && flat(secondSlope)) {
    slopeScore = 5;
    slopeLabel = "Both SMA200 slopes are flat";
    slopeLabelKo = "두 SMA200 기울기 횡보";
  }

  return {
    score: alignmentScore + slopeScore,
    alignmentScore,
    slopeScore,
    direction: macroDirection,
    macroDirection,
    excluded: stronglyOpposed,
    label: `${alignmentLabel} · ${slopeLabel}`,
    labelKo: `${alignmentLabelKo} · ${slopeLabelKo}`,
    oneHour,
    fourHour,
    distance1h,
    distance4h
  };
}

function scoreVwapConvergence(price, vwap, macroDirection) {
  const signedDistanceBps = (price - vwap.current) / vwap.current * 10_000;
  const distanceBps = Math.abs(signedDistanceBps);
  const proximityScore = Math.min(20, 20 * Math.exp(-distanceBps / 20));
  const correctSide = macroDirection === "bullish" ? signedDistanceBps >= 0 : macroDirection === "bearish" ? signedDistanceBps <= 0 : false;
  const pullbackTolerance = 25;
  const neutralZone = 15;
  const withinPullback = distanceBps <= pullbackTolerance;
  const positionScore = macroDirection === "ambiguous" ? 0 : correctSide || distanceBps <= neutralZone ? 6 : withinPullback ? 4 : 0;
  const slopeConfirms = macroDirection === "bullish" ? vwap.angle > 0 : macroDirection === "bearish" ? vwap.angle < 0 : false;
  const slopeScore = macroDirection === "ambiguous" ? 0 : slopeConfirms ? 4 : Math.abs(vwap.angle) <= 0.02 ? 2 : 0;
  const wrongSideBeyondConflict = !correctSide && distanceBps > 50;
  const opposingSlope = macroDirection === "bullish" ? vwap.angle < -0.02 : macroDirection === "bearish" ? vwap.angle > 0.02 : false;
  return {
    distanceBps,
    signedDistanceBps,
    proximityScore,
    positionScore,
    slopeScore,
    correctSide,
    withinPullback,
    slopeConfirms,
    score: proximityScore + positionScore + slopeScore,
    excluded: macroDirection !== "ambiguous" && wrongSideBeyondConflict && opposingSlope
  };
}

function scoreVolumeDepletion(candles, distanceBps) {
  const current = candles.at(-1);
  const completed = candles.slice(-21, -1);
  const average = completed.reduce((sum, candle) => sum + candle.volume, 0) / Math.max(completed.length, 1);
  const elapsedFraction = Math.min(1, Math.max(0.15, (Date.now() - current.time) / (5 * 60_000)));
  const projectedVolume = current.volume / elapsedFraction;
  const ratio = average ? projectedVolume / average : 1;
  const nearVwap = distanceBps <= 50;
  const score = nearVwap ? 20 * Math.max(0, Math.min(1, (1 - ratio) / 0.7)) : 0;
  return { ratio, score, nearVwap };
}

async function analyzeAlphaAsset(asset) {
  const now = new Date();
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [hourly, fourHourly, session] = await Promise.all([
    fetchPublicKlines(asset.symbol, "1h", 240),
    fetchPublicKlines(asset.symbol, "4h", 240),
    fetchPublicKlines(asset.symbol, "5m", 300, sessionStart)
  ]);
  const price = session.at(-1).close;
  const averages = {
    sma1h100: simpleMovingAverage(hourly, 100),
    sma1h200: movingAverageSlope(hourly),
    sma4h100: simpleMovingAverage(fourHourly, 100),
    sma4h200: movingAverageSlope(fourHourly)
  };
  const vwap = sessionVwapMetrics(session);
  if (![price, averages.sma1h100, averages.sma1h200.current, averages.sma1h200.previous, averages.sma4h100, averages.sma4h200.current, averages.sma4h200.previous, vwap.current].every(Number.isFinite)) {
    throw new Error(`${asset.symbol} analysis incomplete`);
  }

  const trend = scoreTrendClarity(price, averages, vwap);
  const proximity = scoreVwapConvergence(price, vwap, trend.macroDirection);
  const depletion = scoreVolumeDepletion(session, proximity.distanceBps);
  const total = trend.score + proximity.score + depletion.score;
  const excluded = trend.excluded || proximity.excluded;
  const directionQualified = trend.macroDirection !== "ambiguous" && trend.score >= 30 && proximity.positionScore >= 4;
  const confirmed = directionQualified && total >= 70 && proximity.correctSide && proximity.slopeScore >= 2;
  const targetTier = confirmed ? "confirmed" : directionQualified && total >= 50 ? "developing" : "none";
  const side = targetTier === "none" ? "neutral" : trend.macroDirection === "bullish" ? "long" : "short";
  const phaseLabel = side === "long"
    ? `${targetTier === "confirmed" ? "Confirmed" : "Developing"} Accumulation Phase D (Target Long)`
    : side === "short"
      ? `${targetTier === "confirmed" ? "Confirmed" : "Developing"} Distribution Phase D (Target Short)`
      : "Phase D (No clear target)";

  return {
    symbol: asset.symbol,
    name: asset.name,
    price,
    averages,
    vwap,
    trend,
    proximity,
    depletion,
    total,
    excluded,
    targetTier,
    side,
    phaseLabel
  };
}

async function mapWithConcurrency(items, concurrency, worker, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  const runner = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = { error, symbol: items[index].symbol };
      }
      completed += 1;
      onProgress?.(completed, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function renderAlphaRank(openInlineChart = true) {
  const list = qs("#alphaList");
  if (!list) return;
  const chartPanel = qs("#selectedSetupPanel");
  const chartAnchor = qs("#chartAnchor");
  if (chartPanel && chartAnchor && !chartAnchor.nextElementSibling?.isSameNode(chartPanel)) {
    chartAnchor.after(chartPanel);
  }
  if (!alphaRankings.length) {
    list.innerHTML = alphaLoading ? "" : `<div class="alpha-empty">${alphaCopy(
      "No analyzed Phase D assets are available yet.",
      "분석 가능한 Phase D 종목이 아직 없습니다."
    )}</div>`;
    return;
  }

  list.innerHTML = alphaRankings.map((item, index) => {
    const phaseLabel = alphaCopy(
      item.phaseLabel,
      item.side === "long"
        ? `${item.targetTier === "confirmed" ? "확정" : "형성 중"} 매집 Phase D (롱 후보)`
        : item.side === "short"
          ? `${item.targetTier === "confirmed" ? "확정" : "형성 중"} 분산 Phase D (숏 후보)`
          : "Phase D (방향 불명확)"
    );
    const trendLabel = alphaCopy(item.trend.label, item.trend.labelKo);
    const alignmentText = direction => direction === "bullish"
      ? "P > S100 > S200"
      : direction === "bearish"
        ? "P < S100 < S200"
        : "TANGLED";
    const stack = `1H ${alignmentText(item.trend.oneHour)} · 4H ${alignmentText(item.trend.fourHour)}`;
    const slopeText = `200S ${item.averages.sma1h200.angle >= 0 ? "+" : ""}${item.averages.sma1h200.angle.toFixed(2)}° / ${item.averages.sma4h200.angle >= 0 ? "+" : ""}${item.averages.sma4h200.angle.toFixed(2)}°`;
    const inlineChart = expandedAlphaSymbol === item.symbol
      ? `<div class="alpha-inline-shell" data-alpha-chart-for="${item.symbol}"><div class="alpha-inline-mount"></div></div>`
      : "";
    return `<button class="alpha-row ${item.side} ${expandedAlphaSymbol === item.symbol ? "expanded" : ""}" type="button" data-alpha-symbol="${item.symbol}" aria-expanded="${expandedAlphaSymbol === item.symbol}">
      <span class="alpha-rank">#${index + 1}</span>
      <span class="alpha-asset"><strong>${escapeHtml(item.symbol)}</strong></span>
      <span class="alpha-direction"><b>${phaseLabel}</b><small>${trendLabel}</small></span>
      <span class="alpha-metric"><small>${alphaCopy("Trend", "추세")} · ${item.trend.score.toFixed(0)}/50 (A${item.trend.alignmentScore} + S${item.trend.slopeScore})</small><strong>${stack}<i>${slopeText}</i></strong></span>
      <span class="alpha-metric"><small>VWAP · ${item.proximity.score.toFixed(1)}/30</small><strong>${fmt(item.vwap.current)} <i>${item.proximity.distanceBps.toFixed(1)} bp · ${item.vwap.angle >= 0 ? "+" : ""}${item.vwap.angle.toFixed(2)}°</i></strong></span>
      <span class="alpha-metric"><small>${alphaCopy("Dry-up", "거래량 고갈")} · ${item.depletion.score.toFixed(1)}/20</small><strong>${item.depletion.ratio.toFixed(2)}× avg</strong></span>
      <span class="alpha-total"><strong>${item.total.toFixed(1)}</strong><small>/ 100</small></span>
    </button>${inlineChart}`;
  }).join("");

  const inlineMount = qs(".alpha-inline-mount");
  if (inlineMount && chartPanel) {
    inlineMount.append(chartPanel);
    if (openInlineChart) qs(".alpha-inline-shell")?.classList.add("open");
  }

  qsa("[data-alpha-symbol]").forEach(button => {
    button.onclick = () => toggleAlphaChart(button.dataset.alphaSymbol);
  });
}

function toggleAlphaChart(symbol) {
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;
  const listScrollLeft = qs("#alphaList")?.scrollLeft || 0;
  const sameSymbol = expandedAlphaSymbol === symbol;
  const openShell = qs(".alpha-inline-shell.open");
  const token = ++alphaToggleToken;

  const commitToggle = () => {
    if (token !== alphaToggleToken) return;
    expandedAlphaSymbol = sameSymbol ? null : symbol;
    if (!sameSymbol) selectAsset(symbol, false);
    renderAlphaRank(false);
    if (qs("#alphaList")) qs("#alphaList").scrollLeft = listScrollLeft;
    restoreScrollPosition(scrollTop, scrollLeft);
    if (!sameSymbol) {
      requestAnimationFrame(() => {
        if (token !== alphaToggleToken) return;
        qs(".alpha-inline-shell")?.classList.add("open");
        if (qs("#alphaList")) qs("#alphaList").scrollLeft = listScrollLeft;
        restoreScrollPosition(scrollTop, scrollLeft);
      });
    }
  };

  if (openShell) {
    openShell.classList.remove("open");
    restoreScrollPosition(scrollTop, scrollLeft);
    window.setTimeout(commitToggle, 220);
  } else {
    commitToggle();
  }
}

async function refreshAlphaRank() {
  if (alphaLoading) return;
  const candidates = assets.filter(asset => asset.phase === "D").map(asset => ({ ...asset }));
  const status = qs("#alphaStatus");
  const updated = qs("#alphaUpdated");
  const token = ++alphaRunToken;
  expandedAlphaSymbol = null;
  alphaToggleToken += 1;
  alphaLoading = true;
  alphaRankings = [];
  renderAlphaRank();

  if (!candidates.length) {
    alphaLoading = false;
    status.innerHTML = `<span>○</span><div><strong>${alphaCopy("No Phase D candidates", "Phase D 후보 없음")}</strong><small>${alphaCopy("The current scanner snapshot contains no eligible assets.", "현재 스캐너 결과에 대상 종목이 없습니다.")}</small></div>`;
    updated.textContent = alphaCopy("0 eligible assets", "대상 0개");
    renderAlphaRank();
    return;
  }

  status.innerHTML = `<span class="pulse"></span><div><strong>${alphaCopy("Analyzing Phase D candidates", "Phase D 후보 분석 중")}</strong><small>0 / ${candidates.length}</small></div>`;
  updated.textContent = alphaCopy(`${candidates.length} eligible assets`, `대상 ${candidates.length}개`);

  const results = await mapWithConcurrency(candidates, 6, analyzeAlphaAsset, (completed, total) => {
    if (token !== alphaRunToken) return;
    const detail = status.querySelector("small");
    if (detail) detail.textContent = `${completed} / ${total}`;
  });
  if (token !== alphaRunToken) return;

  const failed = results.filter(result => result?.error).length;
  const excluded = results.filter(result => result?.excluded).length;
  alphaRankings = results
    .filter(result => result && !result.error && !result.excluded)
    .sort((left, right) => right.total - left.total || right.trend.score - left.trend.score || left.proximity.distanceBps - right.proximity.distanceBps);
  alphaLoading = false;
  status.innerHTML = `<span class="status-dot"></span><div><strong>${alphaCopy("Ranking live", "실시간 순위 완료")}</strong><small>${alphaCopy(
    `${alphaRankings.length} ranked${excluded ? ` · ${excluded} conflicts excluded` : ""}${failed ? ` · ${failed} unavailable` : ""}`,
    `${alphaRankings.length}개 순위${excluded ? ` · 충돌 ${excluded}개 제외` : ""}${failed ? ` · ${failed}개 데이터 실패` : ""}`
  )}</small></div>`;
  updated.textContent = `${alphaCopy("Updated", "업데이트")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  renderAlphaRank();
}

function setView(view) {
  if (!VIEW_COPY[view]) return;
  if (view !== "scanner") expandedScannerSymbol = null;
  if (view !== "alpha") {
    expandedAlphaSymbol = null;
    alphaToggleToken += 1;
  }
  currentView = view;
  document.body.dataset.view = view;
  localStorage.setItem("cc-view", view);
  const viewUrl = view === "guide" ? "/how-to-use" : view === "dashboard" ? "/" : `/#${view}`;
  history.replaceState({ view }, "", viewUrl);
  qs("#viewTitle").textContent = VIEW_COPY[view][0];
  qs("#viewSubtitle").textContent = VIEW_COPY[view][1];
  qsa(".nav-item[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  qs("#opportunityTitle").textContent = view === "watchlist" ? "Monitored assets" : view === "scanner" ? "Qualified setups" : "Priority opportunities";
  qs("#opportunityEyebrow").textContent = view === "watchlist" ? "FOCUSED UNIVERSE" : "INSTITUTIONAL FOOTPRINTS";
  renderRows();
  if (view === "journal") renderJournal();
  if (view === "alpha") {
    renderAlphaRank();
    if (liveUniverseReady) refreshAlphaRank();
  }
}

function showToast(title, detail, icon = "✓") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${icon}</span><div><strong>${title}</strong><small>${detail}</small></div>`;
  qs("#toastStack").append(toast);
  setTimeout(() => toast.remove(), 3800);
}

function updateJournalSetup() {
  qs("#journalCoin").textContent = selected.symbol[0];
  qs("#journalCoin").className = `coin-badge ${selected.symbol.toLowerCase()}`;
  qs("#journalAsset").textContent = `${selected.symbol} / USDT`;
  qs("#journalPhase").textContent = `PHASE ${selected.phase}`;
}

function renderJournal() {
  qs("#journalCount").textContent = `${journalEntries.length} ${journalEntries.length === 1 ? "NOTE" : "NOTES"}`;
  qs("#journalEntries").innerHTML = journalEntries.length ? journalEntries.map(entry => `
    <article class="journal-entry">
      <span class="coin-badge ${entry.symbol.toLowerCase()}">${entry.symbol[0]}</span>
      <div><strong>${escapeHtml(entry.symbol)} · ${escapeHtml(entry.type)}</strong><p>${escapeHtml(entry.note)}</p><small>Phase ${escapeHtml(entry.phase)}</small></div>
      <time>${escapeHtml(entry.time)}</time>
    </article>`).join("") : `<div class="journal-empty">No decisions recorded yet.<br/>The best time to write the rule is before the trigger.</div>`;
}

async function refreshLiveData() {
  try {
    const response = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("feed unavailable");
    const rows = await response.json();
    const candidates = buildQualifiedUniverse(rows);
    updateUniverseFilterStatus(null);
    const filterResult = await window.MarketUniverseFilter.filterAssets({
      assets: candidates,
      futuresRows: rows,
      manualBlacklist,
      dominanceThreshold: DOMESTIC_DOMINANCE_THRESHOLD / 100
    });
    lastUniverseFilterStats = filterResult.stats;
    assets = (filterResult.assets.length ? filterResult.assets : candidates).slice(0, QUALIFIED_UNIVERSE_SIZE);
    updateUniverseFilterStatus();
    qs("#universeCount").textContent = assets.length;
    const volumeResults = await Promise.allSettled(assets.slice(0, 10).map(async asset => {
      const result = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${asset.symbol}USDT&interval=1m&limit=21`, { signal: AbortSignal.timeout(5000) });
      if (!result.ok) throw new Error("volume unavailable");
      const candles = await result.json();
      const volumes = candles.map(candle => Number(candle[5]));
      const baseline = volumes.slice(0, 20).reduce((sum, volume) => sum + volume, 0) / 20;
      return { symbol: asset.symbol, rvol: baseline ? volumes.at(-1) / baseline : asset.rvol };
    }));
    volumeResults.forEach(result => {
      if (result.status !== "fulfilled") return;
      const asset = assets.find(item => item.symbol === result.value.symbol);
      if (asset) asset.rvol = Math.max(0.1, Math.min(result.value.rvol, 9.9));
    });
    selected = assets.find(asset => asset.symbol === selected.symbol) || assets[0];
    const btc = rows.find(row => row.symbol === "BTCUSDT");
    if (btc) {
      const change = Number(btc.priceChangePercent);
      qs("#btcRegime").textContent = Math.abs(change) > 5 ? "Volatile" : change > -2 ? "Constructive" : "Defensive";
    }
    qs("#feedStatus").textContent = "Binance live";
    qs(".pulse").style.background = "#48e59b";
    renderAll();
  } catch {
    qs("#universeCount").textContent = assets.length;
    const status = qs("#universeFilterStatus");
    status.classList.add("partial");
    status.textContent = window.I18N?.language === "ko" ? "키리스 필터 · 공개 피드 확인 필요" : "Keyless filter · public feeds unavailable";
    qs("#feedStatus").textContent = "Demo feed";
    qs(".pulse").style.background = "#ff8d55";
    showToast("Demo feed active", "Live endpoint unavailable; scanner remains interactive.", "○");
  }
  liveUniverseReady = true;
  qs("#refreshTime").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (currentView === "alpha") refreshAlphaRank();
}

function renderAll() {
  qs("#universeCount").textContent = assets.length;
  renderTickers();
  renderFire();
  selectAsset(selected.symbol);
}

function initJournal() {
  qs("#journalNote").oninput = event => {
    qs("#journalCharacters").textContent = event.target.value.length;
  };
  qs("#journalForm").onsubmit = event => {
    event.preventDefault();
    const note = qs("#journalNote").value.trim();
    if (!note) return;
    journalEntries.unshift({
      symbol: selected.symbol,
      phase: selected.phase,
      type: qs("#journalType").value,
      note,
      time: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    });
    journalEntries = journalEntries.slice(0, 50);
    localStorage.setItem("cc-journal", JSON.stringify(journalEntries));
    qs("#journalForm").reset();
    qs("#journalCharacters").textContent = "0";
    renderJournal();
    showToast("Decision saved", "Your rule is anchored before execution.", "▤");
  };
  qs("#clearJournalBtn").onclick = () => {
    journalEntries = [];
    localStorage.removeItem("cc-journal");
    renderJournal();
    showToast("Journal cleared", "Local decision notes have been removed.", "○");
  };
}

qsa(".tabs button").forEach(button => {
  button.onclick = () => {
    qsa(".tabs button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    currentFilter = button.dataset.filter;
    expandedScannerSymbol = null;
    scannerToggleToken += 1;
    renderRows();
  };
});
qsa("[data-sort-key]").forEach(button => {
  button.onclick = () => updateSort(button.dataset.sortKey);
});
qs("#clearSortBtn").onclick = () => {
  sortRules = [];
  updateSortControls();
  renderRows();
};
qsa(".timeframes button").forEach(button => {
  button.onclick = () => {
    qsa(".timeframes button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    currentTimeframe = button.textContent.trim();
    loadSelectedChart();
  };
});
qsa(".nav-item[data-view]").forEach(button => {
  button.onclick = () => setView(button.dataset.view);
});
qs(".brand").onclick = event => {
  event.preventDefault();
  setView("dashboard");
};
qs("#settingsBtn").onclick = () => qs("#settingsDialog").showModal();
qs("#thresholdRange").value = threshold;
qs("#thresholdOutput").textContent = `${threshold.toFixed(1)}×`;
qs("#blacklistInput").value = manualBlacklist;
qs("#thresholdRange").oninput = event => {
  qs("#thresholdOutput").textContent = `${Number(event.target.value).toFixed(1)}×`;
};
qs("#saveSettingsBtn").onclick = () => {
  threshold = Number(qs("#thresholdRange").value);
  manualBlacklist = qs("#blacklistInput").value.trim();
  localStorage.setItem("cc-threshold", threshold);
  localStorage.setItem("cc-manual-blacklist", manualBlacklist);
  renderFire();
  refreshLiveData();
  showToast("Scanner settings saved", "Keyless blacklist refreshed with the 40% domestic-volume rule.");
};
qs("#alertBtn").onclick = () => showToast("3 scanner notices", "SUI spring test · ONDO breakout watch · ENA accumulation", "!");
qs("#alphaRankBtn").onclick = () => setView("alpha");
qs("#refreshAlphaBtn").onclick = () => refreshAlphaRank();
qs("#reviewRulesBtn").onclick = () => showToast("Trading rules", "Stops are structural. Entries require volume. No exceptions.", "♢");
function openFullScanner() {
  setView("scanner");
  requestAnimationFrame(() => {
    const scanner = qs(".opportunities");
    const heading = qs("#opportunityTitle");
    scanner?.scrollIntoView({ behavior: "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  });
}

qs("#scanAllBtn").onclick = openFullScanner;
qs("#browseScannerBtn").onclick = openFullScanner;
qsa("[data-guide-view]").forEach(button => {
  button.onclick = () => setView(button.dataset.guideView);
});

document.addEventListener("keydown", event => {
  const tag = event.target.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || qs("dialog[open]")) return;
  const shortcuts = { "1": "dashboard", "2": "volume", "3": "scanner", "4": "watchlist", "5": "alpha", "a": "alpha", "j": "journal", "h": "guide" };
  if (shortcuts[event.key.toLowerCase()]) setView(shortcuts[event.key.toLowerCase()]);
});
window.addEventListener("catchingcat:language", () => {
  updateUniverseFilterStatus();
  loadSelectedChart();
  renderAlphaRank();
});

initJournal();
updateJournalSetup();
renderJournal();
updateSortControls();
setView(currentView);
renderAll();
refreshLiveData();
setInterval(refreshLiveData, 60000);
