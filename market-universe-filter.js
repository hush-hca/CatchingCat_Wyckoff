(() => {
  const CACHE_TTL = 5 * 60 * 1000;
  const REQUEST_TIMEOUT = 7000;
  let cachedSnapshot = null;
  let snapshotPromise = null;

  function canonicalSymbol(symbol) {
    return String(symbol || "")
      .toUpperCase()
      .replace(/USDT$/, "")
      .replace(/^(1000000|10000|1000|1M)/, "");
  }

  function parseBlacklist(value) {
    return new Set(String(value || "")
      .split(/[\s,]+/)
      .map(canonicalSymbol)
      .filter(Boolean));
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function addVolume(map, symbol, volume) {
    const key = canonicalSymbol(symbol);
    const amount = Number(volume);
    if (!key || !Number.isFinite(amount) || amount <= 0) return;
    map.set(key, (map.get(key) || 0) + amount);
  }

  function listedUsdtSymbols(exchangeInfo, predicate = () => true) {
    return new Set((exchangeInfo?.symbols || [])
      .filter(symbol => symbol.quoteAsset === "USDT" && symbol.status === "TRADING" && predicate(symbol))
      .map(symbol => canonicalSymbol(symbol.baseAsset || symbol.symbol)));
  }

  function binanceVolumeMap(rows) {
    const volumes = new Map();
    (rows || []).forEach(row => {
      if (row.symbol?.endsWith("USDT")) addVolume(volumes, row.symbol, row.quoteVolume);
    });
    return volumes;
  }

  function krwVolumeMap(rows) {
    const volumes = new Map();
    (rows || []).forEach(row => {
      if (row.market?.startsWith("KRW-")) addVolume(volumes, row.market.slice(4), row.acc_trade_price_24h);
    });
    return volumes;
  }

  async function fetchBithumbTickers() {
    const markets = await fetchJson("https://api.bithumb.com/v1/market/all?isDetails=false");
    const krwMarkets = markets.map(item => item.market).filter(market => market?.startsWith("KRW-"));
    const batches = [];
    for (let index = 0; index < krwMarkets.length; index += 80) {
      batches.push(krwMarkets.slice(index, index + 80));
    }
    const results = await Promise.allSettled(batches.map(batch =>
      fetchJson(`https://api.bithumb.com/v1/ticker?markets=${encodeURIComponent(batch.join(","))}`)
    ));
    const rows = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (!rows.length) throw new Error("Bithumb ticker unavailable");
    return rows;
  }

  function readResult(result, source, warnings, fallback) {
    if (result.status === "fulfilled") return result.value;
    warnings.push(source);
    return fallback;
  }

  async function createSnapshot(futuresRows) {
    const warnings = [];
    const results = await Promise.allSettled([
      fetchJson("https://data-api.binance.vision/api/v3/exchangeInfo"),
      fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo"),
      fetchJson("https://data-api.binance.vision/api/v3/ticker/24hr"),
      fetchJson("https://api.upbit.com/v1/ticker/all?quote_currencies=KRW"),
      fetchBithumbTickers()
    ]);
    const spotInfo = readResult(results[0], "Binance Spot listings", warnings, null);
    const futuresInfo = readResult(results[1], "Binance Futures listings", warnings, null);
    const spotTickers = readResult(results[2], "Binance Spot volume", warnings, []);
    const upbitTickers = readResult(results[3], "Upbit volume", warnings, []);
    const bithumbTickers = readResult(results[4], "Bithumb volume", warnings, []);

    const spotListings = spotInfo
      ? listedUsdtSymbols(spotInfo, symbol => symbol.isSpotTradingAllowed !== false)
      : null;
    const futuresListings = futuresInfo
      ? listedUsdtSymbols(futuresInfo, symbol => symbol.contractType === "PERPETUAL")
      : new Set((futuresRows || []).map(row => canonicalSymbol(row.symbol)));
    const upbitUsdt = upbitTickers.find(row => row.market === "KRW-USDT");
    const bithumbUsdt = bithumbTickers.find(row => row.market === "KRW-USDT");

    return {
      createdAt: Date.now(),
      spotListings,
      futuresListings,
      spotVolumes: binanceVolumeMap(spotTickers),
      futuresVolumes: binanceVolumeMap(futuresRows),
      upbitVolumes: krwVolumeMap(upbitTickers),
      bithumbVolumes: krwVolumeMap(bithumbTickers),
      krwPerUsdt: Number(upbitUsdt?.trade_price || bithumbUsdt?.trade_price) || null,
      warnings
    };
  }

  async function getSnapshot(futuresRows) {
    if (cachedSnapshot && Date.now() - cachedSnapshot.createdAt < CACHE_TTL) return cachedSnapshot;
    if (!snapshotPromise) {
      snapshotPromise = createSnapshot(futuresRows)
        .then(snapshot => {
          cachedSnapshot = snapshot;
          return snapshot;
        })
        .finally(() => {
          snapshotPromise = null;
        });
    }
    return snapshotPromise;
  }

  async function filterAssets({ assets, futuresRows, manualBlacklist, dominanceThreshold = 0.4 }) {
    const manual = parseBlacklist(manualBlacklist);
    let snapshot;
    try {
      snapshot = await getSnapshot(futuresRows);
    } catch {
      snapshot = {
        spotListings: null,
        futuresListings: new Set((futuresRows || []).map(row => canonicalSymbol(row.symbol))),
        spotVolumes: new Map(),
        futuresVolumes: binanceVolumeMap(futuresRows),
        upbitVolumes: new Map(),
        bithumbVolumes: new Map(),
        krwPerUsdt: null,
        warnings: ["Public market feeds"]
      };
    }

    const threshold = Math.min(0.9, Math.max(0.2, Number(dominanceThreshold) || 0.4));
    const currentFuturesVolumes = binanceVolumeMap(futuresRows);
    const excluded = [];
    const included = [];

    assets.forEach(asset => {
      const symbol = canonicalSymbol(asset.symbol);
      if (manual.has(symbol)) {
        excluded.push({ symbol: asset.symbol, reason: "manual" });
        return;
      }

      const onSpot = snapshot.spotListings?.has(symbol);
      const onPerpetual = snapshot.futuresListings?.has(symbol);
      if (snapshot.spotListings && onSpot && !onPerpetual) {
        excluded.push({ symbol: asset.symbol, reason: "spot-only" });
        return;
      }
      if (snapshot.spotListings && (!onSpot || !onPerpetual)) {
        excluded.push({ symbol: asset.symbol, reason: "not-spot-and-perpetual" });
        return;
      }

      const binanceVolume = (snapshot.spotVolumes.get(symbol) || 0) + (currentFuturesVolumes.get(symbol) || snapshot.futuresVolumes.get(symbol) || 0);
      const domesticKrw = (snapshot.upbitVolumes.get(symbol) || 0) + (snapshot.bithumbVolumes.get(symbol) || 0);
      const domesticVolume = snapshot.krwPerUsdt ? domesticKrw / snapshot.krwPerUsdt : 0;
      const comparableVolume = binanceVolume + domesticVolume;
      const domesticShare = comparableVolume > 0 ? domesticVolume / comparableVolume : 0;

      if (snapshot.krwPerUsdt && domesticShare >= threshold) {
        excluded.push({ symbol: asset.symbol, reason: "domestic-dominant", domesticShare });
        return;
      }
      included.push(asset);
    });

    return {
      assets: included,
      excluded,
      stats: {
        input: assets.length,
        included: included.length,
        excluded: excluded.length,
        manual: excluded.filter(item => item.reason === "manual").length,
        listing: excluded.filter(item => ["spot-only", "not-spot-and-perpetual"].includes(item.reason)).length,
        domestic: excluded.filter(item => item.reason === "domestic-dominant").length,
        manualSymbols: excluded.filter(item => item.reason === "manual").map(item => item.symbol),
        listingSymbols: excluded.filter(item => ["spot-only", "not-spot-and-perpetual"].includes(item.reason)).map(item => item.symbol),
        domesticSymbols: excluded.filter(item => item.reason === "domestic-dominant").map(item => item.symbol),
        threshold,
        warnings: snapshot.warnings
      }
    };
  }

  window.MarketUniverseFilter = {
    filterAssets,
    parseBlacklist,
    canonicalSymbol,
    invalidate() {
      cachedSnapshot = null;
    }
  };
})();
