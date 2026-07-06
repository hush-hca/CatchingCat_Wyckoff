const FALLBACK = [
  { symbol: "SUI", name: "Sui", price: 3.8421, change: 8.42, rvol: 4.8, phase: "C", phaseLabel: "Spring / test", signal: "Entry pending", support: 3.41, resistance: 3.96 },
  { symbol: "ONDO", name: "Ondo", price: 1.1274, change: 5.18, rvol: 3.9, phase: "D", phaseLabel: "Sign of strength", signal: "Breakout watch", support: 0.94, resistance: 1.14 },
  { symbol: "ENA", name: "Ethena", price: 0.6842, change: -1.24, rvol: 3.2, phase: "B", phaseLabel: "Building cause", signal: "Accumulating", support: 0.61, resistance: 0.73 },
  { symbol: "ARB", name: "Arbitrum", price: 1.0548, change: 3.61, rvol: 2.8, phase: "C", phaseLabel: "Last point support", signal: "Test forming", support: 0.92, resistance: 1.08 },
  { symbol: "INJ", name: "Injective", price: 28.391, change: 2.07, rvol: 2.4, phase: "B", phaseLabel: "Secondary test", signal: "Range watch", support: 25.4, resistance: 30.2 }
];

const QUALIFIED_UNIVERSE_SIZE = 184;
const PRIORITY_ASSET_COUNT = 5;
const STRUCTURE_INTERVAL = "1h";
const STRUCTURE_CANDLE_LIMIT = 200;
const STRUCTURE_CACHE_TTL = 5 * 60_000;

const VIEW_COPY = {
  dashboard: ["Good evening, Operator.", "Read the structure. Follow the volume. Protect the downside."],
  volume: ["Volume Fire", "The fastest view of abnormal one-minute participation across the market."],
  scanner: ["Wyckoff Scanner", "Compare qualified structures, then inspect the selected setup below."],
  watchlist: ["Your Watchlist", "Only the assets you chose to monitor—no scanning noise."],
  alpha: ["Alpha Rank", "Confirmed Phase C/D structures ranked by trend clarity, VWAP precision, and volume depletion."],
  setup: ["Setup", "Predefined trading setups ranked by structural and volume confirmation."],
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
let expandedScannerSymbol = null;
let scannerToggleToken = 0;
let currentTimeframe = "1H";
let chartRequestToken = 0;
const chartCache = new Map();
let structureRunToken = 0;
let structureAnalysisPromise = null;
let structureProgress = { status: "idle", completed: 0, total: 0, failed: 0 };
let alphaRankings = [];
let alphaLoading = false;
let alphaRunToken = 0;
let liveUniverseReady = false;
let expandedAlphaSymbol = null;
let alphaToggleToken = 0;
let setupRankings = [];
let setupLoading = false;
let setupRunToken = 0;
let expandedSetupSymbol = null;
let setupToggleToken = 0;
let activeSetupView = "setup1";
let setup2Rankings = [];
let setup2VolumeSort = null;

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];
const fmt = (value) => value >= 1000
  ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  : value >= 10 ? `$${value.toFixed(3)}` : `$${value.toFixed(4)}`;
const compactUsd = (value) => `$${new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1
}).format(Math.max(0, value))}`;
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
  if (currentFilter === "accumulation") list = list.filter(asset => asset.structure === "accumulation");
  if (currentFilter === "breakouts") list = list.filter(asset => ["C", "D", "E"].includes(asset.phase));
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
    const phase = rangePosition < 0.15 ? "C" : rangePosition >= 0.72 ? "D" : rangePosition < 0.36 ? "A" : "B";
    const phaseCopy = {
      A: ["Provisional range", "Structure loading"],
      B: ["Provisional range", "Structure loading"],
      C: ["Potential spring zone", "Awaiting 200-candle confirmation"],
      D: ["Potential breakout zone", "Awaiting 200-candle confirmation"]
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
      phaseSource: "proximity",
      structure: "unknown",
      rangePosition,
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
  if (structureProgress.status === "loading") {
    status.textContent += ` · ${korean ? "구조" : "structure"} ${structureProgress.completed}/${structureProgress.total}`;
  } else if (structureProgress.status === "ready") {
    status.textContent += ` · ${korean ? "200캔들 분석 완료" : "200-candle scan ready"}`;
    if (structureProgress.failed) status.textContent += ` · ${structureProgress.failed} ${korean ? "개 데이터 부족 제외" : "insufficient excluded"}`;
  }
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
    const structureLabel = asset.structure === "distribution" ? "DIST" : asset.structure === "accumulation" ? "ACC" : "PREFILTER";
    const structureClass = asset.structure === "distribution" ? "distribution" : asset.structure === "accumulation" ? "accumulation" : "provisional";
    const assetRow = `
      <tr data-symbol="${asset.symbol}" class="${selected.symbol === asset.symbol ? "selected" : ""}" aria-expanded="${currentView === "scanner" && expandedScannerSymbol === asset.symbol}">
        <td><div class="asset-cell">
          <button class="watch-toggle ${watched ? "watched" : ""}" data-watch="${asset.symbol}" aria-label="${watched ? "Remove" : "Add"} ${asset.symbol} ${watched ? "from" : "to"} watchlist">${watched ? "◆" : "◇"}</button>
          <span class="coin-badge ${asset.symbol.toLowerCase()}">${asset.symbol[0]}</span>
          <span><strong>${asset.symbol}</strong><small>${asset.name}</small></span>
        </div></td>
        <td><div class="price-cell"><strong>${fmt(asset.price)}</strong><span class="${asset.change >= 0 ? "up" : "down"}">${asset.change >= 0 ? "+" : ""}${asset.change.toFixed(2)}%</span></div></td>
        <td><span class="rvol">${asset.rvol.toFixed(1)}×</span><div class="rvol-bar"><i style="width:${Math.min(asset.rvol / 5 * 100, 100)}%"></i></div></td>
        <td><span class="phase-pill phase-${asset.phase.toLowerCase()} ${structureClass}">${structureLabel} · PHASE ${asset.phase}</span><small style="display:block;color:#697e74;margin-top:3px;font-size:10px">${asset.phaseLabel}${asset.phaseSource === "structure" ? ` · ${asset.confidence}%` : ""}</small></td>
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

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function buildPhaseLabels(candles, phase, events = {}, structure = "accumulation") {
  const labels = [];
  const addLabel = (index, text, dy) => {
    if (Number.isInteger(index) && index >= 0 && index < candles.length && !labels.some(label => label.index === index)) {
      labels.push({ index, text, dy });
    }
  };

  if (["A", "B", "C"].includes(phase)) {
    addLabel(events.preliminarySupportIndex, structure === "distribution" ? "PSY" : "PS", -12);
    addLabel(events.climaxIndex, structure === "distribution" ? "BC" : "SC", structure === "distribution" ? -16 : 18);
    addLabel(events.automaticRallyIndex, "AR", -15);
  }
  if (["B", "C"].includes(phase)) addLabel(events.secondaryTestIndex, "ST", 18);
  const phaseCIndex = structure === "distribution" ? events.upthrustIndex : events.springIndex;
  if (phase === "C" && phaseCIndex >= 0) {
    addLabel(phaseCIndex, structure === "distribution" ? "UTAD" : "SPRING", structure === "distribution" ? -18 : 20);
    addLabel(Math.min(candles.length - 1, phaseCIndex + 3), "TEST", structure === "distribution" ? -16 : 18);
  }
  const phaseDIndex = structure === "distribution" ? events.breakdownIndex : events.breakoutIndex;
  if (["D", "E"].includes(phase) && phaseDIndex >= 0) {
    addLabel(phaseDIndex, structure === "distribution" ? "SOW" : "SOS", structure === "distribution" ? 18 : -16);
    addLabel(Math.min(candles.length - 1, phaseDIndex + 3), structure === "distribution" ? "LPSY" : "LPS", structure === "distribution" ? -16 : 18);
  }
  if (phase === "E") addLabel(candles.length - 3, structure === "distribution" ? "MARKDOWN" : "MARKUP", structure === "distribution" ? 18 : -16);

  return labels.sort((a, b) => a.index - b.index);
}

function estimateWyckoffPhase(candles) {
  const referenceEnd = Math.max(120, candles.length - 40);
  const reference = candles.slice(0, referenceEnd);
  const support = percentile(reference.map(candle => candle.low), 0.1);
  const resistance = percentile(reference.map(candle => candle.high), 0.9);
  const last = candles.at(-1);
  const searchStart = referenceEnd;
  let springIndex = -1;
  let upthrustIndex = -1;
  let breakoutIndex = -1;
  let breakdownIndex = -1;
  const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const ranges = reference.slice(-40).map(candle => candle.high - candle.low);
  const averageRange = average(ranges);
  const structureRange = Math.max(resistance - support, last.close * 0.001);
  const eventBuffer = Math.max(last.close * 0.0025, averageRange * 0.35, structureRange * 0.012);

  for (let index = searchStart; index < candles.length; index += 1) {
    const candle = candles[index];
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const lowerWick = bodyLow - candle.low;
    const upperWick = candle.high - bodyHigh;
    if (candle.low < support - eventBuffer && candle.close > support && lowerWick > Math.abs(candle.close - candle.open) * 0.45) springIndex = index;
    if (candle.high > resistance + eventBuffer && candle.close < resistance && upperWick > Math.abs(candle.close - candle.open) * 0.45) upthrustIndex = index;
    if (candle.close > resistance + eventBuffer * 0.5) breakoutIndex = index;
    if (candle.close < support - eventBuffer * 0.5) breakdownIndex = index;
  }

  const recentCloses = candles.slice(-5).map(candle => candle.close);
  const sustainedBreakout = breakoutIndex >= 0 && recentCloses.filter(close => close > resistance).length >= 4;
  const sustainedBreakdown = breakdownIndex >= 0 && recentCloses.filter(close => close < support).length >= 4;
  const twentyBarsAgo = candles[Math.max(0, candles.length - 21)].close;
  const momentum = twentyBarsAgo ? (last.close - twentyBarsAgo) / twentyBarsAgo : 0;
  const rangePosition = resistance > support ? (last.close - support) / (resistance - support) : 0.5;
  const earlyMean = average(reference.slice(0, 20).map(candle => candle.close));
  const lateMean = average(reference.slice(-20).map(candle => candle.close));
  const priorTrend = earlyMean ? (lateMean - earlyMean) / earlyMean : 0;
  const bullishEventIndex = Math.max(springIndex, breakoutIndex);
  const bearishEventIndex = Math.max(upthrustIndex, breakdownIndex);
  const structure = bullishEventIndex >= 0 || bearishEventIndex >= 0
    ? bullishEventIndex > bearishEventIndex ? "accumulation" : "distribution"
    : priorTrend <= 0 ? "accumulation" : "distribution";
  const recentRangeAcceptance = candles.slice(-40).filter(candle =>
    candle.close >= support - eventBuffer && candle.close <= resistance + eventBuffer
  ).length / Math.min(40, candles.length);

  let phase = "B";
  if (structure === "accumulation") {
    if (sustainedBreakout && momentum > 0.025) phase = "E";
    else if (breakoutIndex >= 0 && last.close >= resistance - eventBuffer) phase = "D";
    else if (springIndex >= 0 && last.close > support) phase = "C";
    else if (recentRangeAcceptance < 0.55 || (rangePosition < 0.28 && momentum < 0.02)) phase = "A";
  } else {
    if (sustainedBreakdown && momentum < -0.025) phase = "E";
    else if (breakdownIndex >= 0 && last.close <= support + eventBuffer) phase = "D";
    else if (upthrustIndex >= 0 && last.close < resistance) phase = "C";
    else if (recentRangeAcceptance < 0.55 || (rangePosition > 0.72 && momentum > -0.02)) phase = "A";
  }

  const firstHalf = candles.slice(0, referenceEnd);
  const climaxIndex = firstHalf.reduce((extreme, candle, index) =>
    structure === "distribution"
      ? candle.high > firstHalf[extreme].high ? index : extreme
      : candle.low < firstHalf[extreme].low ? index : extreme, 0);
  const preliminarySupportIndex = Math.max(1, climaxIndex - 5);
  const rallyWindow = candles.slice(climaxIndex + 1, Math.min(referenceEnd, climaxIndex + 14));
  const automaticRallyIndex = rallyWindow.length
    ? climaxIndex + 1 + rallyWindow.reduce((extreme, candle, index) =>
      structure === "distribution"
        ? candle.low < rallyWindow[extreme].low ? index : extreme
        : candle.high > rallyWindow[extreme].high ? index : extreme, 0)
    : Math.min(candles.length - 1, climaxIndex + 5);
  const secondaryTestIndex = Math.min(referenceEnd - 1, automaticRallyIndex + 6);
  const events = {
    preliminarySupportIndex,
    climaxIndex,
    automaticRallyIndex,
    secondaryTestIndex,
    springIndex,
    upthrustIndex,
    breakoutIndex,
    breakdownIndex
  };

  const phaseNames = structure === "distribution"
    ? { A: "Stopping demand", B: "Building supply", C: "Upthrust / test", D: "Sign of weakness", E: "Markdown trend" }
    : { A: "Stopping action", B: "Building cause", C: "Spring / test", D: "Sign of strength", E: "Markup trend" };
  const signalNames = structure === "distribution"
    ? { A: "Range forming", B: "Distribution range", C: "Upthrust confirmed", D: "Breakdown confirmed", E: "Markdown active" }
    : { A: "Range forming", B: "Accumulation range", C: "Spring confirmed", D: "Breakout confirmed", E: "Markup active" };
  const eventCount = [springIndex, upthrustIndex, breakoutIndex, breakdownIndex].filter(index => index >= 0).length;
  const confidence = Math.min(100, Math.round(35 + recentRangeAcceptance * 25 + eventCount * 15 + Math.min(10, Math.abs(momentum) * 200)));

  return {
    phase,
    structure,
    phaseLabel: phaseNames[phase],
    signal: signalNames[phase],
    confidence,
    support,
    resistance,
    rangePosition,
    momentum,
    priorTrend,
    events,
    labels: buildPhaseLabels(candles, phase, events, structure)
  };
}

function renderPhaseTrack(phase, structure = selected?.structure || "accumulation") {
  const phases = ["A", "B", "C", "D", "E"];
  const phaseLabels = structure === "distribution"
    ? ["Stopping demand", "Building supply", "Upthrust / test", "Sign of weakness", "Markdown trend"]
    : ["Stopping action", "Building cause", "Spring / test", "Sign of strength", "Markup trend"];
  const currentIndex = phases.indexOf(phase);
  qsa(".phase-track [data-phase]").forEach(item => {
    const index = phases.indexOf(item.dataset.phase);
    item.classList.toggle("done", index < currentIndex);
    item.classList.toggle("current", index === currentIndex);
    const detail = item.querySelector("small");
    if (detail) detail.textContent = phaseLabels[index];
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
      const accent = ["UTAD", "SOW", "LPSY", "MARKDOWN"].includes(label.text)
        ? "#ff6868"
        : label.text === "SPRING" ? "#ff8d55" : ["SOS", "LPS", "MARKUP"].includes(label.text) ? "#48e59b" : "#789085";
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
  const requestToken = ++chartRequestToken;
  qs("#chartStructure").innerHTML = `<i class="meta-dot green"></i>${chartCopy(`Loading ${timeframe} live structure…`, `${timeframe} 실시간 구조 로딩 중…`)}`;
  renderChartState(chartCopy("Loading real-time candles…", "실시간 캔들 로딩 중…"));

  try {
    const payload = await getStructurePayload(symbol, interval, 60_000);
    if (requestToken !== chartRequestToken || selected.symbol !== symbol || currentTimeframe !== timeframe) return;

    const chartEstimate = payload.estimate;
    const chartPhase = chartEstimate.phase;
    if (interval === STRUCTURE_INTERVAL) applyStructureEstimate(selected, payload);
    selected.price = payload.candles.at(-1).close;
    selected.support = chartEstimate.support;
    selected.resistance = chartEstimate.resistance;
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;
    qs("#chartPrice").textContent = fmt(selected.price);
    qs("#supportPrice").textContent = fmt(selected.support);
    qs("#resistancePrice").textContent = fmt(selected.resistance);
    const structureName = chartEstimate.structure === "distribution"
      ? chartCopy("Distribution", "분산")
      : chartCopy("Accumulation", "매집");
    const dotClass = chartEstimate.structure === "distribution" ? "danger" : "green";
    qs("#chartStructure").innerHTML = `<i class="meta-dot ${dotClass}"></i>${structureName} · Phase ${chartPhase} · ${chartEstimate.phaseLabel} · ${timeframe} / 200`;
    renderPhaseTrack(chartPhase, chartEstimate.structure);
    renderChart(payload.candles, chartEstimate);
    restoreScrollPosition(scrollTop, scrollLeft);
  } catch {
    if (requestToken !== chartRequestToken || selected.symbol !== symbol) return;
    qs("#chartStructure").innerHTML = `<i class="meta-dot warning"></i>${chartCopy(`Live ${timeframe} structure unavailable`, `실시간 ${timeframe} 구조를 불러올 수 없음`)}`;
    renderPhaseTrack(selected.phase, selected.structure);
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
  if (shouldRenderRows) renderRows();
  renderPhaseTrack(selected.phase, selected.structure);
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
    volume: Number(row[5]),
    quoteVolume: Number(row[7])
  })).filter(candle => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite));
  if (candles.length < Math.min(limit, 20)) throw new Error(`${symbol} ${interval} insufficient`);
  return candles;
}

async function getStructurePayload(symbol, interval = STRUCTURE_INTERVAL, maxAge = STRUCTURE_CACHE_TTL) {
  const cacheKey = `${symbol}:${interval}`;
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= maxAge) return cached;
  const candles = await fetchPublicKlines(symbol, interval, STRUCTURE_CANDLE_LIMIT);
  const payload = {
    candles,
    estimate: estimateWyckoffPhase(candles),
    fetchedAt: Date.now()
  };
  chartCache.set(cacheKey, payload);
  return payload;
}

function applyStructureEstimate(asset, payload) {
  const estimate = payload.estimate;
  Object.assign(asset, {
    phase: estimate.phase,
    phaseLabel: estimate.phaseLabel,
    signal: estimate.signal,
    structure: estimate.structure,
    confidence: estimate.confidence,
    support: estimate.support,
    resistance: estimate.resistance,
    phaseSource: "structure",
    structureAnalyzedAt: payload.fetchedAt
  });
  return asset;
}

async function analyzeUniverseStructures(targetAssets) {
  const token = ++structureRunToken;
  structureProgress = { status: "loading", completed: 0, total: targetAssets.length, failed: 0 };
  updateUniverseFilterStatus();
  const results = await mapWithConcurrency(targetAssets, 8, async asset => ({
    symbol: asset.symbol,
    payload: await getStructurePayload(asset.symbol)
  }), (completed, total) => {
    if (token !== structureRunToken) return;
    structureProgress = { ...structureProgress, completed, total };
    if (completed === total || completed % 8 === 0) updateUniverseFilterStatus();
  });
  if (token !== structureRunToken) return;

  let failed = 0;
  const failedSymbols = new Set();
  results.forEach(result => {
    if (!result || result.error || !result.payload) {
      failed += 1;
      if (result?.symbol) failedSymbols.add(result.symbol);
      return;
    }
    const asset = assets.find(item => item.symbol === result.symbol);
    if (asset) applyStructureEstimate(asset, result.payload);
  });
  if (failedSymbols.size) assets = assets.filter(asset => !failedSymbols.has(asset.symbol));
  structureProgress = {
    status: "ready",
    completed: targetAssets.length,
    total: targetAssets.length,
    failed
  };
  selected = assets.find(asset => asset.symbol === selected.symbol) || assets[0];
  qs("#universeCount").textContent = assets.length;
  updateUniverseFilterStatus();
  renderRows();
  renderTickers();
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
  const structureDirection = asset.structure === "distribution" ? "bearish" : "bullish";
  const proximity = scoreVwapConvergence(price, vwap, structureDirection);
  const depletion = scoreVolumeDepletion(session, proximity.distanceBps);
  const structureConflict = trend.macroDirection !== "ambiguous" && trend.macroDirection !== structureDirection;
  const conflictPenalty = structureConflict ? 25 : 0;
  const total = Math.max(0, trend.score + proximity.score + depletion.score - conflictPenalty);
  const directionQualified = !structureConflict && trend.macroDirection !== "ambiguous" && trend.score >= 30 && proximity.positionScore >= 4;
  const confirmed = directionQualified && total >= 70 && proximity.correctSide && proximity.slopeScore >= 2;
  const targetTier = confirmed ? "confirmed" : directionQualified && total >= 50 ? "developing" : "none";
  const side = asset.structure === "distribution" ? "short" : "long";

  return {
    symbol: asset.symbol,
    name: asset.name,
    phase: asset.phase,
    structure: asset.structure,
    price,
    averages,
    vwap,
    trend,
    proximity,
    depletion,
    total,
    excluded: false,
    structureConflict,
    conflictPenalty,
    targetTier,
    side
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
      "No analyzed Phase C/D structures are available yet.",
      "분석 가능한 Phase C/D 구조가 아직 없습니다."
    )}</div>`;
    return;
  }

  list.innerHTML = alphaRankings.map((item, index) => {
    const phase = item.phase || "D";
    const phaseDirection = item.side === "long"
      ? alphaCopy("Long", "롱")
      : item.side === "short"
        ? alphaCopy("Short", "숏")
        : alphaCopy("Neutral", "중립");
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
      <span class="alpha-direction"><b class="alpha-phase-letter" aria-label="Phase ${phase} · ${phaseDirection}" title="Phase ${phase} · ${phaseDirection}">${phase}</b></span>
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
  const status = qs("#alphaStatus");
  const updated = qs("#alphaUpdated");
  const token = ++alphaRunToken;
  expandedAlphaSymbol = null;
  alphaToggleToken += 1;
  alphaLoading = true;
  alphaRankings = [];
  renderAlphaRank();
  if (structureAnalysisPromise) {
    status.innerHTML = `<span class="pulse"></span><div><strong>${alphaCopy("Waiting for 200-candle structures", "200캔들 구조 분석 대기 중")}</strong><small>${structureProgress.completed} / ${structureProgress.total}</small></div>`;
    await structureAnalysisPromise;
    if (token !== alphaRunToken) return;
  }
  const candidates = assets
    .filter(asset => asset.phaseSource === "structure" && ["C", "D"].includes(asset.phase))
    .map(asset => ({ ...asset }));

  if (!candidates.length) {
    alphaLoading = false;
    status.innerHTML = `<span>○</span><div><strong>${alphaCopy("No confirmed Phase C/D structures", "확인된 Phase C/D 구조 없음")}</strong><small>${alphaCopy("No 200-candle Spring, Upthrust, breakout, or breakdown is active.", "활성화된 200캔들 Spring, Upthrust, 돌파 또는 이탈 구조가 없습니다.")}</small></div>`;
    updated.textContent = alphaCopy("0 eligible assets", "대상 0개");
    renderAlphaRank();
    return;
  }

  status.innerHTML = `<span class="pulse"></span><div><strong>${alphaCopy("Analyzing structural Phase C/D candidates", "구조 기반 Phase C/D 후보 분석 중")}</strong><small>0 / ${candidates.length}</small></div>`;
  updated.textContent = alphaCopy(`${candidates.length} eligible assets`, `대상 ${candidates.length}개`);

  const results = await mapWithConcurrency(candidates, 6, analyzeAlphaAsset, (completed, total) => {
    if (token !== alphaRunToken) return;
    const detail = status.querySelector("small");
    if (detail) detail.textContent = `${completed} / ${total}`;
  });
  if (token !== alphaRunToken) return;

  const failed = results.filter(result => result?.error).length;
  const conflicts = results.filter(result => result?.structureConflict).length;
  alphaRankings = results
    .filter(result => result && !result.error)
    .sort((left, right) => right.total - left.total || right.trend.score - left.trend.score || left.proximity.distanceBps - right.proximity.distanceBps);
  alphaLoading = false;
  status.innerHTML = `<span class="status-dot"></span><div><strong>${alphaCopy("Ranking live", "실시간 순위 완료")}</strong><small>${alphaCopy(
    `${alphaRankings.length} ranked${conflicts ? ` · ${conflicts} conflicts penalized` : ""}${failed ? ` · ${failed} unavailable` : ""}`,
    `${alphaRankings.length}개 순위${conflicts ? ` · 충돌 ${conflicts}개 감점` : ""}${failed ? ` · ${failed}개 데이터 실패` : ""}`
  )}</small></div>`;
  updated.textContent = `${alphaCopy("Updated", "업데이트")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  renderAlphaRank();
}

function analyzeFakeoutShort(asset) {
  if (asset.phaseSource !== "structure") return null;
  const payload = chartCache.get(`${asset.symbol}:${STRUCTURE_INTERVAL}`);
  const candles = payload?.candles;
  if (!candles || candles.length < STRUCTURE_CANDLE_LIMIT) return null;

  const failedTests = [];
  const weeklyWindow = 168;
  for (let index = weeklyWindow; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.close <= candle.open) continue;
    const priorWeeklyHigh = Math.max(...candles.slice(index - weeklyWindow, index).map(item => item.high));
    const highGapRatio = Math.abs(candle.high - priorWeeklyHigh) / priorWeeklyHigh;
    if (highGapRatio > 0.005 || candle.close >= priorWeeklyHigh) continue;
    const recentTest = failedTests.at(-1);
    if (recentTest && index - recentTest.index < 6) {
      if (candle.volume <= recentTest.failedVolume) continue;
      failedTests.pop();
    }

    const followingEnd = Math.min(candles.length, index + 7);
    const following = candles.slice(index + 1, followingEnd);
    const bullishFollowThrough = following.filter(item => item.close > item.open).slice(0, 3);
    const bullishAverageVolume = bullishFollowThrough.reduce((sum, item) => sum + item.volume, 0) / Math.max(bullishFollowThrough.length, 1);
    const bullishVolumeRatio = candle.volume ? bullishAverageVolume / candle.volume : Infinity;
    const volumeDivergence = bullishFollowThrough.length >= 2 && bullishVolumeRatio <= 0.5;

    let bearishConfirmation = null;
    for (let offset = 1; offset < followingEnd - index; offset += 1) {
      const confirmationIndex = index + offset;
      const confirmation = candles[confirmationIndex];
      if (confirmation.close >= confirmation.open || confirmationIndex < 3) continue;
      const previousAverage = candles
        .slice(confirmationIndex - 3, confirmationIndex)
        .reduce((sum, item) => sum + item.volume, 0) / 3;
      if (confirmation.volume >= previousAverage) {
        bearishConfirmation = {
          index: confirmationIndex,
          ratio: previousAverage ? confirmation.volume / previousAverage : 1
        };
        break;
      }
    }

    failedTests.push({
      index,
      priorWeeklyHigh,
      highGapRatio,
      failedVolume: candle.volume,
      bullishFollowThrough: bullishFollowThrough.length,
      bullishVolumeRatio,
      volumeDivergence,
      bearishConfirmation
    });
  }

  const confirmedTests = failedTests.filter(test => test.volumeDivergence && test.bearishConfirmation);
  if (failedTests.length < 2 || !confirmedTests.length) return null;
  const latest = confirmedTests.at(-1);
  const precisionScore = 25 * Math.max(0, 1 - latest.highGapRatio / 0.005);
  const repetitionScore = 20 * Math.min(1, failedTests.length / 3);
  const divergenceScore = 15 + 15 * Math.max(0, 1 - latest.bullishVolumeRatio / 0.5);
  const bearishScore = 10 + 10 * Math.min(1, Math.max(0, latest.bearishConfirmation.ratio - 1));
  const barsAgo = candles.length - 1 - latest.index;
  const recencyScore = 5 * Math.max(0, 1 - barsAgo / 32);

  return {
    symbol: asset.symbol,
    phase: asset.phase,
    structure: asset.structure,
    score: Math.min(100, precisionScore + repetitionScore + divergenceScore + bearishScore + recencyScore),
    testCount: failedTests.length,
    weeklyHigh: latest.priorWeeklyHigh,
    highGapPercent: latest.highGapRatio * 100,
    bullishVolumeRatio: latest.bullishVolumeRatio,
    bullishCandleCount: latest.bullishFollowThrough,
    bearishVolumeRatio: latest.bearishConfirmation.ratio,
    barsAgo
  };
}

function analyzeKstDeclineWindow(asset) {
  const payload = chartCache.get(`${asset.symbol}:${STRUCTURE_INTERVAL}`);
  const candles = payload?.candles;
  if (!candles || candles.length < STRUCTURE_CANDLE_LIMIT) return null;

  const kstOffset = 9 * 60 * 60_000;
  const sessions = new Map();
  candles.forEach(candle => {
    if (candle.time + 60 * 60_000 > Date.now()) return;
    const kst = new Date(candle.time + kstOffset);
    const hour = kst.getUTCHours();
    if (hour < 4 || hour >= 9) return;
    const day = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
    if (!sessions.has(day)) sessions.set(day, new Map());
    sessions.get(day).set(hour, candle);
  });

  const completed = [...sessions.entries()]
    .map(([day, hours]) => {
      if (![4, 5, 6, 7, 8].every(hour => hours.has(hour))) return null;
      const ordered = [4, 5, 6, 7, 8].map(hour => hours.get(hour));
      const open = ordered[0].open;
      const close = ordered.at(-1).close;
      const quoteVolume = ordered.reduce((sum, candle) => {
        const fallbackQuoteVolume = candle.volume * ((candle.high + candle.low + candle.close) / 3);
        return sum + (Number.isFinite(candle.quoteVolume) && candle.quoteVolume > 0 ? candle.quoteVolume : fallbackQuoteVolume);
      }, 0);
      return { day, returnRate: open ? close / open - 1 : 0, quoteVolume };
    })
    .filter(Boolean)
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-7);

  if (completed.length < 5) return null;
  const downSessions = completed.filter(session => session.returnRate < 0);
  const declineProbability = downSessions.length / completed.length;
  const averageReturn = completed.reduce((sum, session) => sum + session.returnRate, 0) / completed.length;
  if (declineProbability <= 0.5 || averageReturn >= 0) return null;

  const averageQuoteVolume = completed.reduce((sum, session) => sum + session.quoteVolume, 0) / completed.length;
  const averageDownMove = downSessions.length
    ? downSessions.reduce((sum, session) => sum + session.returnRate, 0) / downSessions.length
    : 0;

  return {
    symbol: asset.symbol,
    phase: asset.phase,
    structure: asset.structure,
    sessionCount: completed.length,
    downSessions: downSessions.length,
    declineProbability,
    averageReturn,
    averageDownMove,
    averageQuoteVolume
  };
}

function sortedSetup2Rankings() {
  const defaultSorted = [...setup2Rankings].sort((left, right) =>
    right.declineProbability - left.declineProbability
    || left.averageReturn - right.averageReturn
    || right.averageQuoteVolume - left.averageQuoteVolume
  );
  if (!setup2VolumeSort) return defaultSorted;
  return defaultSorted
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const difference = left.item.averageQuoteVolume - right.item.averageQuoteVolume;
      return difference
        ? (setup2VolumeSort === "asc" ? difference : -difference)
        : left.originalIndex - right.originalIndex;
    })
    .map(entry => entry.item);
}

function updateSetup2VolumeSort() {
  setup2VolumeSort = setup2VolumeSort === null ? "desc" : setup2VolumeSort === "desc" ? "asc" : null;
  expandedSetupSymbol = null;
  setupToggleToken += 1;
  renderSetupRank();
}

function renderSetup2Rank(openInlineChart = true) {
  const list = qs("#setupList");
  if (!list) return;
  const chartPanel = qs("#selectedSetupPanel");
  const chartAnchor = qs("#chartAnchor");
  if (chartPanel && chartAnchor && !chartAnchor.nextElementSibling?.isSameNode(chartPanel)) chartAnchor.after(chartPanel);
  if (!setup2Rankings.length) {
    list.innerHTML = setupLoading ? "" : `<div class="setup-empty">${alphaCopy(
      "No scanner symbol has a majority decline pattern in the latest seven KST sessions.",
      "최근 7개 KST 세션에서 과반 하락 패턴을 보인 스캐너 종목이 없습니다."
    )}</div>`;
    return;
  }

  const indicator = setup2VolumeSort === "desc" ? "↓" : setup2VolumeSort === "asc" ? "↑" : "↕";
  const rankings = sortedSetup2Rankings();
  list.innerHTML = `<div class="setup2-table">
    <div class="setup2-table-head">
      <span>#</span>
      <span>${alphaCopy("Symbol", "종목")}</span>
      <span>${alphaCopy("Phase", "단계")}</span>
      <span>${alphaCopy("Decline probability", "하락 확률")}</span>
      <span>${alphaCopy("Average move", "평균 변동")}</span>
      <span>${alphaCopy("Down days", "하락 일수")}</span>
      <button id="setup2VolumeSort" class="${setup2VolumeSort ? "sorted" : ""}" type="button" aria-label="${alphaCopy("Sort by volume", "거래량 기준 정렬")}">${alphaCopy("04–09 volume", "04–09 거래대금")} <b>${indicator}</b></button>
    </div>
    ${rankings.map((item, index) => {
      const inlineChart = expandedSetupSymbol === item.symbol
        ? `<div class="setup-inline-shell" data-setup-chart-for="${item.symbol}"><div class="setup-inline-mount"></div></div>`
        : "";
      return `<button class="setup2-row ${expandedSetupSymbol === item.symbol ? "expanded" : ""}" type="button" data-setup-symbol="${item.symbol}" aria-expanded="${expandedSetupSymbol === item.symbol}">
        <span class="setup-rank">#${index + 1}</span>
        <strong class="setup-symbol">${escapeHtml(item.symbol)}</strong>
        <span class="setup-phase">${item.structure === "distribution" ? "DIST" : item.structure === "accumulation" ? "ACC" : "—"} · ${item.phase}</span>
        <strong class="setup2-probability">${(item.declineProbability * 100).toFixed(0)}%</strong>
        <span class="setup2-move down">${(item.averageReturn * 100).toFixed(2)}%</span>
        <span class="setup2-days">${item.downSessions}/${item.sessionCount}</span>
        <strong class="setup2-volume">${compactUsd(item.averageQuoteVolume)}</strong>
      </button>${inlineChart}`;
    }).join("")}
  </div>`;

  const inlineMount = qs(".setup-inline-mount");
  if (inlineMount && chartPanel) {
    inlineMount.append(chartPanel);
    if (openInlineChart) qs(".setup-inline-shell")?.classList.add("open");
  }
  qs("#setup2VolumeSort").onclick = updateSetup2VolumeSort;
  qsa("[data-setup-symbol]").forEach(button => {
    button.onclick = () => toggleSetupChart(button.dataset.setupSymbol);
  });
}

function renderSetupRank(openInlineChart = true) {
  if (activeSetupView === "setup2") {
    renderSetup2Rank(openInlineChart);
    return;
  }
  const list = qs("#setupList");
  if (!list) return;
  const chartPanel = qs("#selectedSetupPanel");
  const chartAnchor = qs("#chartAnchor");
  if (chartPanel && chartAnchor && !chartAnchor.nextElementSibling?.isSameNode(chartPanel)) chartAnchor.after(chartPanel);
  if (!setupRankings.length) {
    list.innerHTML = setupLoading ? "" : `<div class="setup-empty">${alphaCopy(
      "No coin currently satisfies every Setup 1 condition.",
      "현재 Setup 1의 모든 조건을 충족하는 코인이 없습니다."
    )}</div>`;
    return;
  }

  list.innerHTML = setupRankings.map((item, index) => {
    const inlineChart = expandedSetupSymbol === item.symbol
      ? `<div class="setup-inline-shell" data-setup-chart-for="${item.symbol}"><div class="setup-inline-mount"></div></div>`
      : "";
    return `<button class="setup-row ${expandedSetupSymbol === item.symbol ? "expanded" : ""}" type="button" data-setup-symbol="${item.symbol}" aria-expanded="${expandedSetupSymbol === item.symbol}">
      <span class="setup-rank">#${index + 1}</span>
      <strong class="setup-symbol">${escapeHtml(item.symbol)}</strong>
      <span class="setup-phase">${item.structure === "distribution" ? "DIST" : "ACC"} · ${item.phase}</span>
      <span class="setup-metric"><small>${alphaCopy("Weekly-high failures", "주간 고점 실패")}</small><strong>${item.testCount}× · gap ${item.highGapPercent.toFixed(2)}%</strong></span>
      <span class="setup-metric"><small>${alphaCopy("Bullish volume", "상승봉 거래량")}</small><strong>${item.bullishVolumeRatio.toFixed(2)}× · ${item.bullishCandleCount} candles</strong></span>
      <span class="setup-metric"><small>${alphaCopy("Bearish confirmation", "하락봉 확인")}</small><strong>${item.bearishVolumeRatio.toFixed(2)}× prev. avg</strong></span>
      <span class="setup-score">${item.score.toFixed(0)}</span>
    </button>${inlineChart}`;
  }).join("");

  const inlineMount = qs(".setup-inline-mount");
  if (inlineMount && chartPanel) {
    inlineMount.append(chartPanel);
    if (openInlineChart) qs(".setup-inline-shell")?.classList.add("open");
  }
  qsa("[data-setup-symbol]").forEach(button => {
    button.onclick = () => toggleSetupChart(button.dataset.setupSymbol);
  });
}

function toggleSetupChart(symbol) {
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;
  const listScrollLeft = qs("#setupList")?.scrollLeft || 0;
  const sameSymbol = expandedSetupSymbol === symbol;
  const openShell = qs(".setup-inline-shell.open");
  const token = ++setupToggleToken;
  const commitToggle = () => {
    if (token !== setupToggleToken) return;
    expandedSetupSymbol = sameSymbol ? null : symbol;
    if (!sameSymbol) {
      currentTimeframe = "1H";
      qsa(".timeframes button").forEach(button => button.classList.toggle("active", button.textContent.trim() === "1H"));
      selectAsset(symbol, false);
    }
    renderSetupRank(false);
    if (qs("#setupList")) qs("#setupList").scrollLeft = listScrollLeft;
    restoreScrollPosition(scrollTop, scrollLeft);
    if (!sameSymbol) requestAnimationFrame(() => {
      if (token !== setupToggleToken) return;
      qs(".setup-inline-shell")?.classList.add("open");
      restoreScrollPosition(scrollTop, scrollLeft);
    });
  };
  if (openShell) {
    openShell.classList.remove("open");
    window.setTimeout(commitToggle, 220);
  } else {
    commitToggle();
  }
}

async function refreshSetupRank() {
  if (setupLoading) return;
  const setupView = activeSetupView;
  const token = ++setupRunToken;
  const status = qs("#setupStatus");
  setupLoading = true;
  if (setupView === "setup1") setupRankings = [];
  else setup2Rankings = [];
  expandedSetupSymbol = null;
  setupToggleToken += 1;
  renderSetupRank();
  status.innerHTML = setupView === "setup1"
    ? `<span class="pulse"></span><div><strong>${alphaCopy("Analyzing Setup 1", "Setup 1 분석 중")}</strong><small>${alphaCopy("Checking 1H 200-candle weekly-high and volume conditions.", "1H 200캔들의 주간 고점 및 거래량 조건을 확인합니다.")}</small></div>`
    : `<span class="pulse"></span><div><strong>${alphaCopy("Analyzing Setup 2", "Setup 2 분석 중")}</strong><small>${alphaCopy("Comparing the latest seven completed 04:00–09:00 KST sessions.", "최근 완료된 KST 04:00–09:00 세션 7개를 비교합니다.")}</small></div>`;
  if (structureAnalysisPromise) await structureAnalysisPromise;
  if (token !== setupRunToken || setupView !== activeSetupView) return;

  if (setupView === "setup1") {
    setupRankings = assets
      .map(analyzeFakeoutShort)
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || right.testCount - left.testCount || left.highGapPercent - right.highGapPercent);
  } else {
    setup2Rankings = assets
      .map(analyzeKstDeclineWindow)
      .filter(Boolean);
  }
  setupLoading = false;
  status.innerHTML = setupView === "setup1"
    ? `<span class="status-dot"></span><div><strong>${alphaCopy("Setup 1 ranking ready", "Setup 1 순위 완료")}</strong><small>${alphaCopy(
      `${setupRankings.length} assets meet every condition`,
      `${setupRankings.length}개 종목이 모든 조건을 충족`
    )}</small></div>`
    : `<span class="status-dot"></span><div><strong>${alphaCopy("Setup 2 ranking ready", "Setup 2 순위 완료")}</strong><small>${alphaCopy(
      `${setup2Rankings.length} scanner symbols show a majority decline pattern`,
      `${setup2Rankings.length}개 스캐너 종목에서 과반 하락 패턴 확인`
    )}</small></div>`;
  renderSetupRank();
}

function setActiveSetup(view, refresh = true) {
  if (!["setup1", "setup2"].includes(view) || view === activeSetupView && qs("#setupPanel")?.dataset.activeSetup === view) return;
  activeSetupView = view;
  setupRunToken += 1;
  setupLoading = false;
  expandedSetupSymbol = null;
  setupToggleToken += 1;
  const panel = qs("#setupPanel");
  if (panel) panel.dataset.activeSetup = view;
  qsa("[data-setup-view]").forEach(button => {
    const active = button.dataset.setupView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderSetupRank();
  if (refresh && liveUniverseReady) refreshSetupRank();
}

function setView(view) {
  if (!VIEW_COPY[view]) return;
  if (view !== "scanner") expandedScannerSymbol = null;
  if (view !== "alpha") {
    expandedAlphaSymbol = null;
    alphaToggleToken += 1;
  }
  if (view !== "setup") {
    expandedSetupSymbol = null;
    setupToggleToken += 1;
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
  if (view === "alpha") {
    renderAlphaRank();
    if (liveUniverseReady) refreshAlphaRank();
  }
  if (view === "setup") {
    currentTimeframe = "1H";
    qsa(".timeframes button").forEach(button => button.classList.toggle("active", button.textContent.trim() === "1H"));
    renderSetupRank();
    if (liveUniverseReady) refreshSetupRank();
  }
}

function showToast(title, detail, icon = "✓") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${icon}</span><div><strong>${title}</strong><small>${detail}</small></div>`;
  qs("#toastStack").append(toast);
  setTimeout(() => toast.remove(), 3800);
}

async function refreshLiveData() {
  if (structureAnalysisPromise) return;
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
    structureAnalysisPromise = analyzeUniverseStructures(assets);
    try {
      await structureAnalysisPromise;
    } finally {
      structureAnalysisPromise = null;
    }
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
  if (currentView === "setup") refreshSetupRank();
}

function renderAll() {
  qs("#universeCount").textContent = assets.length;
  renderTickers();
  renderFire();
  selectAsset(selected.symbol);
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
qs("#refreshSetupBtn").onclick = () => refreshSetupRank();
qsa("[data-setup-view]").forEach(button => {
  button.onclick = () => setActiveSetup(button.dataset.setupView);
});
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

window.addEventListener("catchingcat:language", () => {
  updateUniverseFilterStatus();
  loadSelectedChart();
  renderAlphaRank();
  renderSetupRank();
});

updateSortControls();
setActiveSetup(activeSetupView, false);
setView(currentView);
renderAll();
refreshLiveData();
setInterval(refreshLiveData, 60000);
