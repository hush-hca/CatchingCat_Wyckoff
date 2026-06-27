const FALLBACK = [
  { symbol: "SUI", name: "Sui", price: 3.8421, change: 8.42, rvol: 4.8, phase: "C", phaseLabel: "Spring / test", signal: "Entry pending", support: 3.41, resistance: 3.96 },
  { symbol: "ONDO", name: "Ondo", price: 1.1274, change: 5.18, rvol: 3.9, phase: "D", phaseLabel: "Sign of strength", signal: "Breakout watch", support: 0.94, resistance: 1.14 },
  { symbol: "ENA", name: "Ethena", price: .6842, change: -1.24, rvol: 3.2, phase: "B", phaseLabel: "Building cause", signal: "Accumulating", support: .61, resistance: .73 },
  { symbol: "ARB", name: "Arbitrum", price: 1.0548, change: 3.61, rvol: 2.8, phase: "C", phaseLabel: "Last point support", signal: "Test forming", support: .92, resistance: 1.08 },
  { symbol: "INJ", name: "Injective", price: 28.391, change: 2.07, rvol: 2.4, phase: "B", phaseLabel: "Secondary test", signal: "Range watch", support: 25.4, resistance: 30.2 }
];

let assets = structuredClone(FALLBACK);
let selected = assets[0];
let threshold = Number(localStorage.getItem("cc-threshold") || 2);
const qs = (s) => document.querySelector(s);
const qsa = (s) => [...document.querySelectorAll(s)];
const fmt = (value) => value >= 1000 ? `$${value.toLocaleString(undefined,{maximumFractionDigits:0})}` : value >= 10 ? `$${value.toFixed(3)}` : `$${value.toFixed(4)}`;

function renderTickers() {
  const extras = [
    {symbol:"BTC", price: 104382.2, change:.81},
    {symbol:"ETH", price: 3384.1, change:1.25},
    {symbol:"TOTAL3", price: 842.6, change:1.84}
  ];
  qs("#tickerStrip").innerHTML = extras.concat(assets.slice(0,4)).map(a =>
    `<span>${a.symbol}<b>${fmt(a.price)}</b><i class="${a.change >= 0 ? "up":"down"}">${a.change>=0?"+":""}${a.change.toFixed(2)}%</i></span>`
  ).join("");
}

function renderRows() {
  qs("#opportunityRows").innerHTML = assets.map((a, i) => `
    <tr data-symbol="${a.symbol}" class="${selected.symbol===a.symbol?"selected":""}">
      <td><div class="asset-cell"><span class="coin-badge ${a.symbol.toLowerCase()}">${a.symbol[0]}</span><span><strong>${a.symbol}</strong><small>${a.name}</small></span></div></td>
      <td><div class="price-cell"><strong>${fmt(a.price)}</strong><span class="${a.change>=0?"up":"down"}">${a.change>=0?"+":""}${a.change.toFixed(2)}%</span></div></td>
      <td><span class="rvol">${a.rvol.toFixed(1)}×</span><div class="rvol-bar"><i style="width:${Math.min(a.rvol/5*100,100)}%"></i></div></td>
      <td><span class="phase-pill phase-${a.phase.toLowerCase()}">PHASE ${a.phase}</span><small style="display:block;color:#697e74;margin-top:3px;font-size:6px">${a.phaseLabel}</small></td>
      <td><span class="signal-pill ${i===0?"signal-spring":i===1?"signal-watch":""}">${a.signal}</span></td>
      <td class="row-arrow">›</td>
    </tr>`).join("");
  qsa("#opportunityRows tr").forEach(row => row.onclick = () => selectAsset(row.dataset.symbol));
}

function renderFire() {
  const fire = [...assets, {symbol:"WIF",rvol:2.2},{symbol:"SEI",rvol:2.0}].sort((a,b)=>b.rvol-a.rvol);
  qs("#fireList").innerHTML = fire.map(a=>`<div class="fire-row"><span>${a.symbol}</span><div class="fire-bar"><i style="width:${Math.min(a.rvol/5.2*100,100)}%"></i></div><b>${a.rvol.toFixed(1)}×</b></div>`).join("");
  qs("#ignitionCount").textContent = fire.filter(a=>a.rvol>=threshold).length;
}

function chartData(asset) {
  const seed = asset.symbol.charCodeAt(0);
  let value = asset.support * 1.1;
  const points = [];
  for(let i=0;i<58;i++) {
    const trend = i < 12 ? -.006 : i < 42 ? .001 : .007;
    value *= 1 + trend + Math.sin((i+seed)*1.7)*.011 + Math.cos(i*.6)*.006;
    if(i===36) value = asset.support*.965;
    if(i===37) value = asset.support*1.045;
    points.push(value);
  }
  const scale = asset.price / points.at(-1);
  return points.map(v=>v*scale);
}

function renderChart() {
  const data = chartData(selected);
  const W=800,H=230,pad=22;
  const min=Math.min(...data,selected.support)*.985,max=Math.max(...data,selected.resistance)*1.015;
  const x=i=>pad+i*(W-pad*2)/(data.length-1);
  const y=v=>H-pad-(v-min)/(max-min)*(H-pad*2);
  const line=data.map((v,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area=`${line} L${x(data.length-1)},${H-pad} L${x(0)},${H-pad} Z`;
  const volumes=data.map((v,i)=>({x:x(i),h:7+Math.abs(Math.sin(i*1.9))*19+(i>43?12:0)}));
  const labels = [
    {i:7,t:"PS",dy:-12},{i:14,t:"SC",dy:18},{i:20,t:"AR",dy:-17},{i:27,t:"ST",dy:18},{i:36,t:"SPRING",dy:21},{i:43,t:"TEST",dy:18},{i:51,t:"SOS",dy:-17}
  ];
  qs("#wyckoffChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#48e59b" stop-opacity=".18"/><stop offset="1" stop-color="#48e59b" stop-opacity="0"/></linearGradient></defs>
    ${[.2,.4,.6,.8].map(n=>`<line x1="${pad}" y1="${pad+n*(H-pad*2)}" x2="${W-pad}" y2="${pad+n*(H-pad*2)}" stroke="rgba(190,225,209,.07)" stroke-dasharray="2 5"/>`).join("")}
    <rect x="${pad}" y="${y(selected.resistance)}" width="${W-pad*2}" height="${y(selected.support)-y(selected.resistance)}" fill="rgba(98,168,255,.025)" stroke="rgba(98,168,255,.13)" stroke-dasharray="4 5"/>
    <line x1="${pad}" y1="${y(selected.support)}" x2="${W-pad}" y2="${y(selected.support)}" stroke="#62a8ff" stroke-opacity=".35" stroke-dasharray="4 4"/>
    <line x1="${pad}" y1="${y(selected.resistance)}" x2="${W-pad}" y2="${y(selected.resistance)}" stroke="#62a8ff" stroke-opacity=".35" stroke-dasharray="4 4"/>
    <path d="${area}" fill="url(#area)"/><path d="${line}" fill="none" stroke="#48e59b" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    ${volumes.map((v,i)=>`<rect x="${v.x-2}" y="${H-v.h-3}" width="3.2" height="${v.h}" fill="${i>43?"#48e59b":"#345347"}" opacity="${i>43?.55:.32}"/>`).join("")}
    ${labels.map(l=>`<circle cx="${x(l.i)}" cy="${y(data[l.i])}" r="2.8" fill="#07100d" stroke="${l.t==="SPRING"?"#ff8d55":"#48e59b"}"/><text x="${x(l.i)}" y="${y(data[l.i])+l.dy}" text-anchor="middle" fill="${l.t==="SPRING"?"#ff8d55":"#789085"}">${l.t}</text>`).join("")}
    <line x1="${x(data.length-1)}" y1="${y(data.at(-1))}" x2="${W-pad}" y2="${y(data.at(-1))}" stroke="#48e59b" stroke-opacity=".5" stroke-dasharray="2 3"/>
    <rect x="${W-49}" y="${y(data.at(-1))-8}" width="45" height="16" rx="3" fill="#48e59b"/><text x="${W-26.5}" y="${y(data.at(-1))+2}" text-anchor="middle" style="fill:#07100d">${selected.price.toFixed(selected.price<10?3:2)}</text>
  </svg>`;
}

function selectAsset(symbol) {
  selected=assets.find(a=>a.symbol===symbol);
  qs("#chartSymbol").textContent=selected.symbol;
  qs("#modalAsset").textContent=selected.symbol;
  qs("#chartPrice").textContent=fmt(selected.price);
  qs("#chartChange").textContent=`${selected.change>=0?"+":""}${selected.change.toFixed(2)}%`;
  qs("#chartChange").className=selected.change>=0?"up":"down";
  qs("#supportPrice").textContent=fmt(selected.support);
  qs("#resistancePrice").textContent=fmt(selected.resistance);
  qs("#chartRvol").textContent=`${selected.rvol.toFixed(1)}×`;
  renderRows();renderChart();
}

function showToast(title, detail, icon="✓") {
  const toast=document.createElement("div");toast.className="toast";
  toast.innerHTML=`<span>${icon}</span><div><strong>${title}</strong><small>${detail}</small></div>`;
  qs("#toastStack").append(toast);setTimeout(()=>toast.remove(),3800);
}

async function refreshLiveData() {
  try {
    const response=await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr",{signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error("feed unavailable");
    const rows=await response.json();
    assets=assets.map((asset)=>{
      const live=rows.find(r=>r.symbol===asset.symbol+"USDT");
      return live ? {...asset,price:Number(live.lastPrice),change:Number(live.priceChangePercent)} : asset;
    });
    const volumeResults=await Promise.allSettled(assets.map(async asset=>{
      const result=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${asset.symbol}USDT&interval=1m&limit=21`,{signal:AbortSignal.timeout(5000)});
      if(!result.ok) throw new Error("volume unavailable");
      const candles=await result.json();
      const volumes=candles.map(c=>Number(c[5]));
      const baseline=volumes.slice(0,20).reduce((sum,v)=>sum+v,0)/20;
      return {symbol:asset.symbol,rvol:baseline ? volumes.at(-1)/baseline : asset.rvol};
    }));
    volumeResults.forEach(result=>{
      if(result.status!=="fulfilled") return;
      const asset=assets.find(a=>a.symbol===result.value.symbol);
      if(asset) asset.rvol=Math.max(.1,Math.min(result.value.rvol,9.9));
    });
    selected=assets.find(asset=>asset.symbol===selected.symbol) || assets[0];
    const btc=rows.find(r=>r.symbol==="BTCUSDT");
    if(btc) {
      const change=Number(btc.priceChangePercent);
      qs("#btcRegime").textContent=Math.abs(change)>5?"Volatile":change>-2?"Constructive":"Defensive";
    }
    qs("#feedStatus").textContent="Binance live";
    qs(".pulse").style.background="#48e59b";
    renderAll();
  } catch {
    qs("#feedStatus").textContent="Demo feed";
    qs(".pulse").style.background="#ff8d55";
    showToast("Demo feed active","Live endpoint unavailable; scanner remains interactive.","○");
  }
  qs("#refreshTime").textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}

function renderAll(){renderTickers();renderRows();renderFire();renderChart();}

function initChecklist() {
  const dialog=qs("#checklistDialog"), checks=qsa(".checklist input");
  const update=()=>{
    const valid=checks.every(c=>c.checked), result=qs("#clearanceResult"), btn=qs("#executeBtn");
    btn.disabled=!valid;result.classList.toggle("valid",valid);
    result.innerHTML=valid?`<span>✓</span><div><strong>Chase entry valid — clearance granted</strong><small>Open your order window and execute the trade now.</small></div>`:`<span>⏳</span><div><strong>Clearance withheld</strong><small>Confirm all four rules to unlock the conclusion.</small></div>`;
  };
  checks.forEach(c=>c.onchange=update);
  qs("#clearanceBtn").onclick=qs("#checklistNav").onclick=()=>{checks.forEach((c,i)=>c.checked=i===0);update();dialog.showModal()};
  qs("#executeBtn").onclick=()=>showToast("Manual execution cleared","No order was placed. Your exchange remains under your control.");
}

qsa(".tabs button").forEach(btn=>btn.onclick=()=>{qsa(".tabs button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");showToast(`${btn.textContent} filter applied`,"Priority list updated to match the selected structure.","◎")});
qsa(".timeframes button").forEach(btn=>btn.onclick=()=>{qsa(".timeframes button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");showToast(`${btn.textContent} structure loaded`,"Support and resistance remain mechanically defined.","⌁")});
qs("#settingsBtn").onclick=()=>qs("#settingsDialog").showModal();
qs("#thresholdRange").value=threshold;qs("#thresholdOutput").textContent=`${threshold.toFixed(1)}×`;
qs("#thresholdRange").oninput=e=>qs("#thresholdOutput").textContent=`${Number(e.target.value).toFixed(1)}×`;
qs("#saveSettingsBtn").onclick=()=>{threshold=Number(qs("#thresholdRange").value);localStorage.setItem("cc-threshold",threshold);renderFire();showToast("Scanner settings saved",`Ignition threshold set to ${threshold.toFixed(1)}×.`)};
qs("#alertBtn").onclick=()=>showToast("3 scanner notices","SUI spring test · ONDO breakout watch · ENA accumulation","!");
qs("#reviewRulesBtn").onclick=()=>showToast("Trading rules opened","Stops are structural. Entries require volume. No exceptions.","♢");
qs("#scanAllBtn").onclick=()=>showToast("Full universe scan running","184 qualified Spot + Futures pairs under review.","◎");
qsa(".nav-item[data-view]").forEach(btn=>btn.onclick=()=>{qsa(".nav-item").forEach(b=>b.classList.remove("active"));btn.classList.add("active");showToast(`${btn.textContent.trim()} selected`,"This prototype keeps the navigator in a unified command view.","⌁")});

initChecklist();renderAll();refreshLiveData();setInterval(refreshLiveData,60000);
