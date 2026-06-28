const FALLBACK = [
  { symbol: "SUI", name: "Sui", price: 3.8421, change: 8.42, rvol: 4.8, phase: "C", phaseLabel: "Spring / test", signal: "Entry pending", support: 3.41, resistance: 3.96 },
  { symbol: "ONDO", name: "Ondo", price: 1.1274, change: 5.18, rvol: 3.9, phase: "D", phaseLabel: "Sign of strength", signal: "Breakout watch", support: 0.94, resistance: 1.14 },
  { symbol: "ENA", name: "Ethena", price: 0.6842, change: -1.24, rvol: 3.2, phase: "B", phaseLabel: "Building cause", signal: "Accumulating", support: 0.61, resistance: 0.73 },
  { symbol: "ARB", name: "Arbitrum", price: 1.0548, change: 3.61, rvol: 2.8, phase: "C", phaseLabel: "Last point support", signal: "Test forming", support: 0.92, resistance: 1.08 },
  { symbol: "INJ", name: "Injective", price: 28.391, change: 2.07, rvol: 2.4, phase: "B", phaseLabel: "Secondary test", signal: "Range watch", support: 25.4, resistance: 30.2 }
];

const VIEW_COPY = {
  dashboard: ["Good evening, Operator.", "Read the structure. Follow the volume. Protect the downside."],
  volume: ["Volume Fire", "The fastest view of abnormal one-minute participation across the market."],
  scanner: ["Wyckoff Scanner", "Compare qualified structures, then inspect the selected setup below."],
  watchlist: ["Your Watchlist", "Only the assets you chose to monitor—no scanning noise."],
  journal: ["Decision Journal", "Write the rule before the market gives you a story."],
  guide: ["How to use", "Catching Cat을 장중에 빠르고 일관되게 사용하는 방법입니다."]
};

let assets = structuredClone(FALLBACK);
let selected = assets[0];
let threshold = Number(localStorage.getItem("cc-threshold") || 2);
const requestedView = location.pathname === "/how-to-use" ? "guide" : location.hash.slice(1);
let currentView = VIEW_COPY[requestedView] ? requestedView : VIEW_COPY[localStorage.getItem("cc-view")] ? localStorage.getItem("cc-view") : "dashboard";
let currentFilter = "all";
let watchlist = readStorage("cc-watchlist", ["SUI", "ONDO", "ENA"]);
let journalEntries = readStorage("cc-journal", []);

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
  let list = [...assets];
  if (currentView === "watchlist") list = list.filter(asset => watchlist.includes(asset.symbol));
  if (currentFilter === "accumulation") list = list.filter(asset => ["A", "B"].includes(asset.phase));
  if (currentFilter === "breakouts") list = list.filter(asset => ["C", "D"].includes(asset.phase));
  return list;
}

function renderRows() {
  const rows = visibleAssets();
  const empty = currentView === "watchlist" && rows.length === 0;
  qs(".table-wrap").hidden = empty;
  qs("#watchlistEmpty").style.display = empty ? "flex" : "none";
  qs("#opportunityRows").innerHTML = rows.map((asset, index) => {
    const watched = watchlist.includes(asset.symbol);
    return `
      <tr data-symbol="${asset.symbol}" class="${selected.symbol === asset.symbol ? "selected" : ""}">
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
  }).join("");

  qsa("#opportunityRows tr").forEach(row => {
    row.onclick = () => selectAsset(row.dataset.symbol);
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
  const fire = [...assets, { symbol: "WIF", rvol: 2.2 }, { symbol: "SEI", rvol: 2.0 }]
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

function chartData(asset) {
  const seed = asset.symbol.charCodeAt(0);
  let value = asset.support * 1.1;
  const points = [];
  for (let index = 0; index < 58; index += 1) {
    const trend = index < 12 ? -0.006 : index < 42 ? 0.001 : 0.007;
    value *= 1 + trend + Math.sin((index + seed) * 1.7) * 0.011 + Math.cos(index * 0.6) * 0.006;
    if (index === 36) value = asset.support * 0.965;
    if (index === 37) value = asset.support * 1.045;
    points.push(value);
  }
  const scale = asset.price / points.at(-1);
  return points.map(point => point * scale);
}

function renderChart() {
  const data = chartData(selected);
  const W = 800, H = 230, pad = 22;
  const min = Math.min(...data, selected.support) * 0.985;
  const max = Math.max(...data, selected.resistance) * 1.015;
  const x = index => pad + index * (W - pad * 2) / (data.length - 1);
  const y = value => H - pad - (value - min) / (max - min) * (H - pad * 2);
  const line = data.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  const volumes = data.map((value, index) => ({ x: x(index), h: 7 + Math.abs(Math.sin(index * 1.9)) * 19 + (index > 43 ? 12 : 0) }));
  const labels = [
    { i: 7, t: "PS", dy: -12 }, { i: 14, t: "SC", dy: 18 }, { i: 20, t: "AR", dy: -17 },
    { i: 27, t: "ST", dy: 18 }, { i: 36, t: "SPRING", dy: 21 }, { i: 43, t: "TEST", dy: 18 }, { i: 51, t: "SOS", dy: -17 }
  ];
  qs("#wyckoffChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#48e59b" stop-opacity=".18"/><stop offset="1" stop-color="#48e59b" stop-opacity="0"/></linearGradient></defs>
    ${[0.2, 0.4, 0.6, 0.8].map(level => `<line x1="${pad}" y1="${pad + level * (H - pad * 2)}" x2="${W - pad}" y2="${pad + level * (H - pad * 2)}" stroke="rgba(190,225,209,.07)" stroke-dasharray="2 5"/>`).join("")}
    <rect x="${pad}" y="${y(selected.resistance)}" width="${W - pad * 2}" height="${y(selected.support) - y(selected.resistance)}" fill="rgba(98,168,255,.025)" stroke="rgba(98,168,255,.13)" stroke-dasharray="4 5"/>
    <line x1="${pad}" y1="${y(selected.support)}" x2="${W - pad}" y2="${y(selected.support)}" stroke="#62a8ff" stroke-opacity=".35" stroke-dasharray="4 4"/>
    <line x1="${pad}" y1="${y(selected.resistance)}" x2="${W - pad}" y2="${y(selected.resistance)}" stroke="#62a8ff" stroke-opacity=".35" stroke-dasharray="4 4"/>
    <path d="${area}" fill="url(#area)"/><path d="${line}" fill="none" stroke="#48e59b" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    ${volumes.map((volume, index) => `<rect x="${volume.x - 2}" y="${H - volume.h - 3}" width="3.2" height="${volume.h}" fill="${index > 43 ? "#48e59b" : "#345347"}" opacity="${index > 43 ? 0.55 : 0.32}"/>`).join("")}
    ${labels.map(label => `<circle cx="${x(label.i)}" cy="${y(data[label.i])}" r="2.8" fill="#07100d" stroke="${label.t === "SPRING" ? "#ff8d55" : "#48e59b"}"/><text x="${x(label.i)}" y="${y(data[label.i]) + label.dy}" text-anchor="middle" fill="${label.t === "SPRING" ? "#ff8d55" : "#789085"}">${label.t}</text>`).join("")}
    <line x1="${x(data.length - 1)}" y1="${y(data.at(-1))}" x2="${W - pad}" y2="${y(data.at(-1))}" stroke="#48e59b" stroke-opacity=".5" stroke-dasharray="2 3"/>
    <rect x="${W - 49}" y="${y(data.at(-1)) - 8}" width="45" height="16" rx="3" fill="#48e59b"/><text x="${W - 26.5}" y="${y(data.at(-1)) + 2}" text-anchor="middle" style="fill:#07100d">${selected.price.toFixed(selected.price < 10 ? 3 : 2)}</text>
  </svg>`;
}

function selectAsset(symbol) {
  selected = assets.find(asset => asset.symbol === symbol) || assets[0];
  qs("#chartSymbol").textContent = selected.symbol;
  qs("#modalAsset").textContent = selected.symbol;
  qs("#chartPrice").textContent = fmt(selected.price);
  qs("#chartChange").textContent = `${selected.change >= 0 ? "+" : ""}${selected.change.toFixed(2)}%`;
  qs("#chartChange").className = selected.change >= 0 ? "up" : "down";
  qs("#supportPrice").textContent = fmt(selected.support);
  qs("#resistancePrice").textContent = fmt(selected.resistance);
  qs("#chartRvol").textContent = `${selected.rvol.toFixed(1)}×`;
  const checklistVolume = qs("#checklistDialog .checklist label:nth-child(3) b");
  if (checklistVolume) checklistVolume.textContent = `${selected.rvol.toFixed(1)}× baseline`;
  updateJournalSetup();
  renderRows();
  renderChart();
}

function setView(view) {
  if (!VIEW_COPY[view]) return;
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
    assets = assets.map(asset => {
      const live = rows.find(row => row.symbol === `${asset.symbol}USDT`);
      return live ? { ...asset, price: Number(live.lastPrice), change: Number(live.priceChangePercent) } : asset;
    });
    const volumeResults = await Promise.allSettled(assets.map(async asset => {
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
    qs("#feedStatus").textContent = "Demo feed";
    qs(".pulse").style.background = "#ff8d55";
    showToast("Demo feed active", "Live endpoint unavailable; scanner remains interactive.", "○");
  }
  qs("#refreshTime").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderAll() {
  renderTickers();
  renderFire();
  selectAsset(selected.symbol);
}

function initChecklist() {
  const dialog = qs("#checklistDialog");
  const checks = qsa(".checklist input");
  const update = () => {
    const valid = checks.every(check => check.checked);
    const result = qs("#clearanceResult");
    const button = qs("#executeBtn");
    button.disabled = !valid;
    result.classList.toggle("valid", valid);
    result.innerHTML = valid
      ? `<span>✓</span><div><strong>Chase entry valid — clearance granted</strong><small>Open your order window and execute the trade now.</small></div>`
      : `<span>⏳</span><div><strong>Clearance withheld</strong><small>Confirm all four rules to unlock the conclusion.</small></div>`;
  };
  checks.forEach(check => { check.onchange = update; });
  const open = () => {
    checks.forEach((check, index) => { check.checked = index === 0; });
    update();
    dialog.showModal();
  };
  qs("#clearanceBtn").onclick = open;
  qs("#checklistNav").onclick = open;
  qs("#executeBtn").onclick = () => showToast("Manual execution cleared", "No order was placed. Your exchange remains under your control.");
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
    renderRows();
  };
});
qsa(".timeframes button").forEach(button => {
  button.onclick = () => {
    qsa(".timeframes button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    showToast(`${button.textContent} structure loaded`, "Support and resistance remain mechanically defined.", "⌁");
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
qs("#thresholdRange").oninput = event => {
  qs("#thresholdOutput").textContent = `${Number(event.target.value).toFixed(1)}×`;
};
qs("#saveSettingsBtn").onclick = () => {
  threshold = Number(qs("#thresholdRange").value);
  localStorage.setItem("cc-threshold", threshold);
  renderFire();
  showToast("Scanner settings saved", `Ignition threshold set to ${threshold.toFixed(1)}×.`);
};
qs("#alertBtn").onclick = () => showToast("3 scanner notices", "SUI spring test · ONDO breakout watch · ENA accumulation", "!");
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
qs("#guideChecklistBtn").onclick = () => qs("#clearanceBtn").click();
qs("#guideChecklistFlow").onclick = () => qs("#clearanceBtn").click();

document.addEventListener("keydown", event => {
  const tag = event.target.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || qs("dialog[open]")) return;
  const shortcuts = { "1": "dashboard", "2": "volume", "3": "scanner", "4": "watchlist", "j": "journal", "h": "guide" };
  if (shortcuts[event.key.toLowerCase()]) setView(shortcuts[event.key.toLowerCase()]);
  if (event.key.toLowerCase() === "c") qs("#clearanceBtn").click();
});

initChecklist();
initJournal();
updateJournalSetup();
renderJournal();
setView(currentView);
renderAll();
refreshLiveData();
setInterval(refreshLiveData, 60000);
