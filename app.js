/* The Day Traders Skill - version con datos reales.
   Fuentes publicas sin clave en el repositorio:
   - CoinGecko: precios, volumen, variacion 24h y velas OHLC (4h, ultimos 7 dias).
   - Alternative.me: indice de Miedo y Codicia.
   No hay claves, tokens ni credenciales en este archivo. La clave opcional de
   noticias, si el usuario la escribe en Configuracion, queda solo en el
   localStorage de su navegador y nunca se sube al repositorio.
   Esto no es asesoria financiera: las senales son reglas transparentes
   calculadas con los datos visibles en pantalla. */

const UNIVERSE = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "ripple", symbol: "XRP" },
  { id: "dogecoin", symbol: "DOGE" },
  { id: "cardano", symbol: "ADA" },
  { id: "avalanche-2", symbol: "AVAX" },
  { id: "chainlink", symbol: "LINK" },
  { id: "injective-protocol", symbol: "INJ" },
];

const FNG_LABEL = {
  "Extreme Fear": "Miedo extremo",
  Fear: "Miedo",
  Neutral: "Neutral",
  Greed: "Codicia",
  "Extreme Greed": "Codicia extrema",
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmtUSD(v) {
  if (v == null || isNaN(v)) return "-";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return "$" + v.toFixed(2);
  return "$" + v.toFixed(4);
}
function fmtPct(v) { return (v == null || isNaN(v)) ? "-" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }
function fmtCompact(v) {
  if (v == null || isNaN(v)) return "-";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* Filtro de noticias: quita el rastreador de gas y duplicados, ordena por fecha. */
function filterNewsArticles(articles) {
  const seen = new Set();
  return (articles || []).filter((a) => {
    if (!a || !a.link || !a.title) return false;
    if (a.sourceKey === "etherscan_gas" || /ETH Gas/i.test(a.title)) return false;
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  }).sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
}

/* ---------- Indicadores puros (probables en Node) ---------- */
function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(values.length).fill(null);
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(closes, period) {
  period = period || 14;
  if (!closes || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) { avgGain = (avgGain * (period - 1) + d) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - d) / period; }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function atr(ohlc, period) {
  period = period || 14;
  if (!ohlc || ohlc.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < ohlc.length; i++) {
    const high = ohlc[i][2], low = ohlc[i][3], prevClose = ohlc[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) avg = (avg * (period - 1) + trs[i]) / period;
  return avg;
}
function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  if (!e12 || !e26) return null;
  const line = closes.map((_, i) => (e12[i] == null || e26[i] == null) ? null : e12[i] - e26[i]);
  const firstValid = line.findIndex((v) => v != null);
  const valid = line.filter((v) => v != null);
  const sig = ema(valid, 9);
  if (!sig) return null;
  const signal = line.map((v, i) => {
    if (v == null) return null;
    const idx = i - firstValid;
    return idx < 8 ? null : sig[idx];
  });
  const lastLine = line[line.length - 1], lastSignal = signal[signal.length - 1];
  return (lastLine == null || lastSignal == null) ? null : { line: lastLine, signal: lastSignal };
}
function maxDrawdown(closes) {
  let peak = closes[0], worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    worst = Math.min(worst, (c - peak) / peak * 100);
  }
  return worst;
}
function backtestEmaCross(closes) {
  const e = ema(closes, 20);
  if (!e) return null;
  const trades = [];
  let open = null;
  for (let i = 1; i < closes.length; i++) {
    if (e[i] == null || e[i - 1] == null) continue;
    const above = closes[i] > e[i], wasAbove = closes[i - 1] > e[i - 1];
    if (above && !wasAbove) open = closes[i];
    if (!above && wasAbove && open != null) { trades.push((closes[i] - open) / open * 100); open = null; }
  }
  if (open != null) trades.push((closes[closes.length - 1] - open) / open * 100);
  const wins = trades.filter((t) => t > 0).length;
  const total = trades.reduce((a, b) => a + b, 0);
  return { trades: trades.length, winRate: trades.length ? wins / trades.length * 100 : null, totalReturn: total };
}
function scoreAsset(market, tech) {
  if (!market) return null;
  const momentum = clamp(market.price_change_percentage_24h || 0, -10, 10);
  const momentumScore = (momentum + 10) / 20 * 100;
  let techScore = 50;
  if (tech && tech.ema20 != null && tech.rsi != null) {
    const trend = market.current_price > tech.ema20 ? 25 : 0;
    const rsiScore = (tech.rsi >= 40 && tech.rsi <= 65) ? 25 : (tech.rsi >= 30 && tech.rsi <= 75) ? 15 : 5;
    techScore = trend + rsiScore + 25;
    if (tech.macd && tech.macd.line > tech.macd.signal) techScore = Math.min(100, techScore + 10);
    else techScore = Math.max(0, techScore - 10);
  }
  const volScore = market.total_volume >= 1e9 ? 100 : market.total_volume >= 300e6 ? 75 : market.total_volume >= 150e6 ? 50 : 25;
  return Math.round(momentumScore * 0.4 + techScore * 0.4 + volScore * 0.2);
}
function positionFor(capital, riskPct, price, atrVal) {
  const riskAmount = capital * riskPct / 100;
  const stopDistance = 1.5 * atrVal;
  const stopPrice = price - stopDistance;
  const positionUsd = riskAmount / (stopDistance / price);
  return {
    riskAmount, stopPrice, target1: price + stopDistance, target2: price + 2 * stopDistance,
    positionUsd, units: positionUsd / price, exposurePct: positionUsd / capital * 100,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ema, rsi, atr, macd, maxDrawdown, backtestEmaCross, scoreAsset, positionFor, fmtUSD, fmtPct, filterNewsArticles };
}

/* ---------- App en el navegador ---------- */
if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let state = { markets: [], tech: {}, fng: null, signals: [], agents: [], loading: false, lastUpdated: null, error: null };
  let chart1 = null, chart2 = null;

  /* Moneda de cada grafico: se recuerda en este navegador. El grafico 1
     arranca en BTC (como antes) y el grafico 2 en INJ (el nuevo). */
  function chartCoin(slot) {
    const key = slot === 2 ? "dts_chart2" : "dts_chart1";
    const fallback = slot === 2 ? "injective-protocol" : "bitcoin";
    let saved = null;
    try { saved = localStorage.getItem(key); } catch (e) {}
    return UNIVERSE.some((u) => u.id === saved) ? saved : fallback;
  }
  function setChartCoin(slot, id) {
    try { localStorage.setItem(slot === 2 ? "dts_chart2" : "dts_chart1", id); } catch (e) {}
    renderCharts();
  }
  function populateChartSelects() {
    [1, 2].forEach((slot) => {
      const sel = $("#chartCoin" + slot); if (!sel) return;
      sel.innerHTML = UNIVERSE.map((u) => `<option value="${u.id}">${u.symbol.toUpperCase()}/USDT</option>`).join("");
      sel.value = chartCoin(slot);
      sel.addEventListener("change", () => setChartCoin(slot, sel.value));
    });
  }

  async function fetchJSON(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }
  function getSettings() {
    return {
      capital: parseFloat(localStorage.getItem("dts_capital") || "10000") || 10000,
      riskPct: parseFloat(localStorage.getItem("dts_risk") || "1") || 1,
      newsKey: localStorage.getItem("dts_news_key") || "",
    };
  }
  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3200);
  }
  function setStatus(text) { const el = $("#statusText"); if (el) el.textContent = text; }

  function computeAll() {
    const settings = getSettings();
    const byId = {};
    state.markets.forEach((m) => { byId[m.id] = m; });
    const volumes = state.markets.map((m) => m.total_volume || 0).sort((a, b) => a - b);
    const medianVol = volumes.length ? volumes[Math.floor(volumes.length / 2)] : 0;

    /* Agente 1 - Crypto Scanner */
    const eligible = state.markets.filter((m) => (m.total_volume || 0) >= 150000000)
      .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
      .map((m) => ({
        ...m,
        rangePct: m.low_24h ? (m.high_24h - m.low_24h) / m.low_24h * 100 : null,
        tech: state.tech[m.id] || null,
        score: scoreAsset(m, state.tech[m.id] || null),
      }));

    /* Agentes 3, 5, 6, 7, 8 - tecnico, cuantitativo, entrada, riesgo, salida */
    const enriched = eligible.map((a) => {
      const tech = a.tech;
      const checks = tech ? [
        tech.ema20 != null && a.current_price > tech.ema20,
        tech.rsi != null && tech.rsi >= 40 && tech.rsi <= 70,
        tech.macd != null && tech.macd.line > tech.macd.signal,
        (a.total_volume || 0) >= medianVol,
      ] : [false, false, false, false];
      const passed = checks.filter(Boolean).length;
      const entryStatus = passed === 4 ? "CONFIRMADA" : passed === 3 ? "EN OBSERVACION" : "ESPERAR";
      const risk = tech && tech.atr ? positionFor(settings.capital, settings.riskPct, a.current_price, tech.atr) : null;
      return { ...a, checks, passed, entryStatus, risk };
    });
    state.signals = enriched.map((a) => ({
      symbol: a.symbol.toUpperCase(), pair: a.symbol.toUpperCase() + "/USDT", score: a.score,
      status: a.entryStatus, price: a.current_price, change24h: a.price_change_percentage_24h,
      detail: a.passed + "/4 condiciones de entrada cumplidas" + (a.tech && a.tech.rsi != null ? " · RSI " + a.tech.rsi.toFixed(0) : ""),
    }));

    /* Agente 4 - Sentimiento */
    const btc = byId.bitcoin;
    const totalCap = state.markets.reduce((s, m) => s + (m.market_cap || 0), 0);
    const positives = state.markets.filter((m) => (m.price_change_percentage_24h || 0) > 0).length;
    const sentiment = {
      fng: state.fng,
      btcShare: btc && totalCap ? btc.market_cap / totalCap * 100 : null,
      positivePct: state.markets.length ? positives / state.markets.length * 100 : null,
    };

    /* Agente 2 - News Hunter: titulares reales sin clave, catalizadores de respaldo */
    const catalysts = [...eligible].sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0)).slice(0, 5);

    /* Agente 9 - Trade Auditor */
    const audit = loadAudit();
    const today = new Date().toISOString().slice(0, 10);
    enriched.forEach((a) => {
      if (a.score == null || a.score < 70) return;
      const key = a.symbol.toUpperCase() + "@" + today;
      const found = audit.find((x) => x.key === key);
      if (found) { found.current = a.current_price; found.pnl = (a.current_price - found.entry) / found.entry * 100; }
      else audit.push({ key, date: today, symbol: a.symbol.toUpperCase(), entry: a.current_price, current: a.current_price, pnl: 0, score: a.score, status: a.entryStatus });
    });
    saveAudit(audit);

    state.agents = [
      { n: "01", name: "Crypto Scanner", icon: "⌕", task: "Filtrar el universo por volumen real", out: eligible.length + " activos con volumen 24h ≥ $150M, ordenados por volumen. Mayor volumen: " + (eligible[0] ? eligible[0].symbol.toUpperCase() + " (" + fmtCompact(eligible[0].total_volume) + ")" : "-") + "." },
      { n: "02", name: "News Hunter", icon: "▤", task: "Titulares reales sin clave + catalizadores", out: "Fuente principal: cryptocurrency.cv sin clave (titulares de CoinDesk, The Block, Cointelegraph y otros, filtrados y con enlace a la fuente original)." + (settings.newsKey ? " CryptoCompare queda como segunda fuente con tu clave, solo en tu navegador." : " Sin clave de CryptoCompare: los catalizadores reales quedan como respaldo si la fuente principal falla.") },
      { n: "03", name: "Technical Analyst", icon: "⌁", task: "RSI, EMA20, MACD y ATR con velas 4h (7 dias)", out: enriched.filter((a) => a.tech).length + " de " + enriched.length + " activos con indicadores calculados. Sin velas suficientes, el activo queda sin indicador, no con un valor inventado." },
      { n: "04", name: "Market Sentiment", icon: "◉", task: "Miedo y Codicia, peso de BTC y activos en positivo", out: sentiment.fng ? "Miedo y Codicia: " + sentiment.fng.value + " (" + (FNG_LABEL[sentiment.fng.classification] || sentiment.fng.classification) + ")." : "Indice de Miedo y Codicia no disponible en esta carga." },
      { n: "05", name: "Quant Analyst", icon: "∑", task: "Retorno, volatilidad, caida maxima y cruce EMA20", out: "Estadisticas descriptivas de las velas 4h de 7 dias en la vista Performance. No son una promesa de rendimiento futuro." },
      { n: "06", name: "Entry Sniper", icon: "⌖", task: "4 condiciones objetivas de entrada por activo", out: enriched.filter((a) => a.entryStatus === "CONFIRMADA").length + " entradas confirmadas (4/4), " + enriched.filter((a) => a.entryStatus === "EN OBSERVACION").length + " en observacion (3/4)." },
      { n: "07", name: "Risk Guardian", icon: "◇", task: "Tamano de posicion segun ATR, capital y riesgo", out: "Capital demo " + fmtUSD(settings.capital) + " · riesgo " + settings.riskPct + "% por operacion · stop 1.5 × ATR. Posiciones sobre 25% del capital se marcan para reducir." },
      { n: "08", name: "Exit Strategist", icon: "↗", task: "Stop, objetivo 1R y 2R e invalidacion por activo", out: "Stop = precio − 1.5 × ATR · objetivo 1R = precio + 1.5 × ATR · objetivo 2R = precio + 3 × ATR. Se invalida si el precio cierra bajo la EMA20." },
      { n: "09", name: "Trade Auditor", icon: "▥", task: "Seguir cada senal generada contra su precio actual", out: audit.length ? audit.length + " senales registradas en este navegador, con PnL actualizado en cada carga." : "Aun no hay senales con puntaje ≥ 70 registradas en este navegador." },
    ];
    state.enriched = enriched; state.sentiment = sentiment; state.catalysts = catalysts; state.audit = audit;
  }

  function loadAudit() { try { return JSON.parse(localStorage.getItem("dts_audit") || "[]"); } catch (e) { return []; } }
  function saveAudit(a) { try { localStorage.setItem("dts_audit", JSON.stringify(a.slice(-100))); } catch (e) {} }

  function render() {
    const settings = getSettings();
    const enriched = state.enriched || [];
    const btc = state.markets.find((m) => m.id === "bitcoin");
    const totalVol = state.markets.reduce((s, m) => s + (m.total_volume || 0), 0);
    const positives = state.markets.filter((m) => (m.price_change_percentage_24h || 0) > 0).length;
    if ($("#metricBtc")) $("#metricBtc").textContent = btc ? fmtUSD(btc.current_price) : "-";
    if ($("#metricVolume")) $("#metricVolume").textContent = fmtCompact(totalVol);
    if ($("#metricPositive")) $("#metricPositive").textContent = state.markets.length ? positives + " / " + state.markets.length : "-";
    if ($("#metricFng")) $("#metricFng").textContent = state.sentiment && state.sentiment.fng ? state.sentiment.fng.value + " · " + (FNG_LABEL[state.sentiment.fng.classification] || state.sentiment.fng.classification) : "-";
    if ($("#lastUpdated")) $("#lastUpdated").textContent = state.lastUpdated ? "Actualizado: " + state.lastUpdated.toLocaleString("es-DO") : "Sin datos aun";
    if ($("#topAssets")) $("#topAssets").innerHTML = enriched.slice(0, 5).map((a) => `<tr><td><span class="asset-cell"><span class="coin-icon">${esc(a.symbol[0].toUpperCase())}</span>${esc(a.symbol.toUpperCase())}/USDT</span></td><td>${fmtUSD(a.current_price)}</td><td class="${(a.price_change_percentage_24h || 0) >= 0 ? "positive" : "negative"}">${fmtPct(a.price_change_percentage_24h)}</td><td>${fmtCompact(a.total_volume)}</td><td><span class="score">${a.score == null ? "-" : a.score + "/100"}</span></td></tr>`).join("") || '<tr><td colspan="5">Sin datos. Pulsa Actualizar.</td></tr>';
    if ($("#scannerRows")) $("#scannerRows").innerHTML = enriched.map((a) => `<tr><td><span class="asset-cell"><span class="coin-icon">${esc(a.symbol[0].toUpperCase())}</span>${esc(a.symbol.toUpperCase())}/USDT</span></td><td>${fmtUSD(a.current_price)}</td><td class="${(a.price_change_percentage_24h || 0) >= 0 ? "positive" : "negative"}">${fmtPct(a.price_change_percentage_24h)}</td><td>${fmtCompact(a.total_volume)}</td><td>${a.rangePct == null ? "-" : a.rangePct.toFixed(2) + "%"}</td><td>${a.tech && a.tech.rsi != null ? a.tech.rsi.toFixed(0) : "-"}</td><td>${a.tech && a.tech.ema20 != null ? (a.current_price > a.tech.ema20 ? "Sobre EMA20" : "Bajo EMA20") : "-"}</td><td><span class="score">${a.score == null ? "-" : a.score + "/100"}</span></td></tr>`).join("") || '<tr><td colspan="8">Sin datos. Pulsa Actualizar.</td></tr>';
    if ($("#signalList")) $("#signalList").innerHTML = (state.signals || []).map((s) => `<div class="signal-row"><div><strong>${esc(s.pair)}</strong><small>${fmtUSD(s.price)} · 24h ${fmtPct(s.change24h)}</small></div><span class="signal-state">${esc(s.status)}</span><div><strong>${s.score}/100</strong><small>Opportunity score</small></div><small>${esc(s.detail)}</small></div>`).join("") || "<p class=\"muted\">Sin senales todavia.</p>";
    if ($("#agentGrid")) $("#agentGrid").innerHTML = state.agents.map((a) => `<article class="agent-card"><div class="agent-top"><span class="agent-number">AGENT ${a.n}</span><span class="agent-status">● ACTIVO</span></div><div class="agent-symbol">${a.icon}</div><h3>${esc(a.name)}</h3><p>${esc(a.task)}</p><div class="agent-task">${esc(a.out)}</div></article>`).join("");
    if ($("#catalystList")) $("#catalystList").innerHTML = (state.catalysts || []).map((a) => `<div class="activity"><div class="activity-icon blue">!</div><div><strong>${esc(a.symbol.toUpperCase())}/USDT ${fmtPct(a.price_change_percentage_24h)}</strong><p>Volumen 24h ${fmtCompact(a.total_volume)} · precio ${fmtUSD(a.current_price)}. Movimiento inusual: verificar titular en una fuente externa antes de actuar.</p></div></div>`).join("") || "<p class=\"muted\">Sin catalizadores todavia.</p>";
    if ($("#riskRows")) $("#riskRows").innerHTML = enriched.filter((a) => a.risk).map((a) => `<tr><td><strong>${esc(a.symbol.toUpperCase())}/USDT</strong></td><td>${fmtUSD(a.current_price)}</td><td>${fmtUSD(a.risk.stopPrice)}</td><td>${fmtUSD(a.risk.target2)}</td><td>${fmtUSD(a.risk.positionUsd)}</td><td>${a.risk.exposurePct.toFixed(1)}% ${a.risk.exposurePct > 25 ? "· Reducir" : ""}</td></tr>`).join("") || '<tr><td colspan="6">Sin ATR todavia. Pulsa Actualizar.</td></tr>';
    if ($("#perfRows")) $("#perfRows").innerHTML = enriched.filter((a) => a.tech).map((a) => `<tr><td><strong>${esc(a.symbol.toUpperCase())}/USDT</strong></td><td>${fmtPct(a.tech.returnPct)}</td><td>${a.tech.volatility == null ? "-" : a.tech.volatility.toFixed(2) + "%"}</td><td>${fmtPct(a.tech.maxDd)}</td><td>${a.tech.backtest ? a.tech.backtest.trades + " ops · " + (a.tech.backtest.winRate == null ? "-" : a.tech.backtest.winRate.toFixed(0) + "% acierto") : "-"}</td></tr>`).join("") || '<tr><td colspan="5">Sin datos cuantitativos todavia.</td></tr>';
    const audit = state.audit || [];
    if ($("#auditSummary")) {
      if (!audit.length) $("#auditSummary").textContent = "Sin senales registradas en este navegador.";
      else {
        const avg = audit.reduce((s, x) => s + (x.pnl || 0), 0) / audit.length;
        const wins = audit.filter((x) => (x.pnl || 0) > 0).length;
        $("#auditSummary").textContent = audit.length + " senales · PnL promedio " + avg.toFixed(2) + "% · " + wins + " en positivo.";
      }
    }
    if ($("#auditRows")) $("#auditRows").innerHTML = audit.slice().reverse().map((x) => `<tr><td>${esc(x.date)}</td><td><strong>${esc(x.symbol)}/USDT</strong></td><td>${fmtUSD(x.entry)}</td><td>${fmtUSD(x.current)}</td><td class="${(x.pnl || 0) >= 0 ? "positive" : "negative"}">${fmtPct(x.pnl)}</td></tr>`).join("") || '<tr><td colspan="5">Sin historial todavia.</td></tr>';
    renderCharts();
  }

  function drawChart(canvasId, coinId, slot) {
    if (!window.Chart) return;
    const ctx = $("#" + canvasId); if (!ctx) return;
    const prev = slot === 2 ? chart2 : chart1;
    if (prev) { prev.destroy(); if (slot === 2) chart2 = null; else chart1 = null; }
    const coin = UNIVERSE.find((u) => u.id === coinId);
    const kicker = $("#chartKicker" + slot);
    if (kicker && coin) kicker.textContent = coin.symbol.toUpperCase() + " / USDT · VELAS 4H · 7 DIAS";
    const tech = state.tech[coinId];
    const ohlc = tech ? tech.ohlc : null;
    const note = $("#chartNote" + slot);
    if (!ohlc) {
      if (note) note.textContent = "Sin velas para esta moneda en esta carga. Pulsa Actualizar para reintentar.";
      return;
    }
    if (note) note.textContent = "";
    const values = ohlc.map((c) => c[4]);
    const max = Math.max.apply(null, values);
    /* Eje adaptativo: BTC se lee en miles, INJ y similares en dolares. */
    const tickFmt = (v) => max >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : max >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(4);
    const color = slot === 2 ? "#31d49a" : "#63a5ff";
    const bg = slot === 2 ? "rgba(49,212,154,.09)" : "rgba(91,156,255,.09)";
    const instance = new Chart(ctx, { type: "line", data: { labels: values.map((_, i) => i), datasets: [{ data: values, borderColor: color, backgroundColor: bg, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false, grid: { display: false } }, y: { position: "right", grid: { color: "rgba(130,150,180,.10)" }, ticks: { color: "#71839b", font: { size: 9 }, callback: tickFmt } } } } });
    if (slot === 2) chart2 = instance; else chart1 = instance;
  }

  function renderCharts() {
    drawChart("marketChart", chartCoin(1), 1);
    drawChart("marketChart2", chartCoin(2), 2);
  }

  async function loadNews() {
    const settings = getSettings();
    const el = $("#newsList"); if (!el) return;
    el.innerHTML = "<p class=\"muted\">Cargando titulares…</p>";
    /* 1) Fuente principal sin clave: cryptocurrency.cv (3 por categoria en la version gratis). */
    try {
      const collected = [];
      for (const cat of ["bitcoin", "ethereum", "defi"]) {
        try {
          const data = await fetchJSON("https://cryptocurrency.cv/api/news?category=" + cat);
          (data && data.articles || []).forEach((a) => collected.push(a));
        } catch (e) { /* una categoria puede fallar; se sigue con las demas */ }
        await sleep(200);
      }
      const items = filterNewsArticles(collected).slice(0, 8);
      if (items.length) {
        el.innerHTML = items.map((n) => `<div class="activity"><div class="activity-icon purple">▤</div><div><strong><a href="${esc(n.link)}" target="_blank" rel="noopener" style="color:#dce5f0">${esc(n.title)}</a></strong><p>${esc(n.source || "")} · ${n.pubDate ? new Date(n.pubDate).toLocaleString("es-DO") : ""}</p></div></div>`).join("") + "<p class=\"data-note\" style=\"margin-top:12px\">Fuente: cryptocurrency.cv (agregador, sin clave). Abre siempre la fuente original antes de actuar.</p>";
        return;
      }
    } catch (e) { /* cae al respaldo siguiente */ }
    /* 2) Segunda fuente, solo si el usuario puso su clave (queda en su navegador). */
    if (settings.newsKey) {
      try {
        const data = await fetchJSON("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&api_key=" + encodeURIComponent(settings.newsKey));
        const items = (data && data.Data) || [];
        if (items.length) {
          el.innerHTML = items.slice(0, 8).map((n) => `<div class="activity"><div class="activity-icon purple">▤</div><div><strong><a href="${esc(n.url)}" target="_blank" rel="noopener" style="color:#dce5f0">${esc(n.title)}</a></strong><p>${esc(n.source || "")} · ${n.published_on ? new Date(n.published_on * 1000).toLocaleString("es-DO") : ""}</p></div></div>`).join("");
          return;
        }
      } catch (e) { /* cae al respaldo final */ }
    }
    /* 3) Respaldo: no inventar titulares; usar los catalizadores reales. */
    el.innerHTML = "<p class=\"muted\">No se pudieron cargar titulares en este momento. Usa la lista de catalizadores de la izquierda: son los movimientos reales mas fuertes del universo monitoreado.</p>";
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true; setStatus("Cargando datos reales…");
    const errEl = $("#errorBanner"); if (errEl) errEl.style.display = "none";
    try {
      const ids = UNIVERSE.map((u) => u.id).join(",");
      const markets = await fetchJSON("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" + ids + "&order=market_cap_desc&price_change_percentage=24h");
      state.markets = markets;
      try {
        const fng = await fetchJSON("https://api.alternative.me/fng/?limit=1");
        /* Alternative.me usa value_classification, no classification. */
        state.fng = fng && fng.data && fng.data[0] ? { value: fng.data[0].value, classification: fng.data[0].value_classification } : null;
      } catch (e) { state.fng = null; }
      /* Carga las velas de una moneda y calcula sus indicadores. Devuelve
         true solo si la moneda quedo con velas; si no, el llamador decide
         si reintentarla. Un fallo aqui nunca inventa datos. */
      async function loadCoinTech(u) {
        let ohlc = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const data = await fetchJSON("https://api.coingecko.com/api/v3/coins/" + u.id + "/ohlc?vs_currency=usd&days=7");
            if (data && data.length >= 30) { ohlc = data; break; }
          } catch (e) { /* reintento abajo */ }
          if (attempt < 2) await sleep(1500 * (attempt + 1));
        }
        try {
          if (ohlc) {
            const closes = ohlc.map((c) => c[4]);
            const e20 = ema(closes, 20);
            const rets = [];
            for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
            const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
            const vol = Math.sqrt(rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / rets.length) * 100;
            state.tech[u.id] = {
              ohlc, rsi: rsi(closes, 14), ema20: e20 ? e20[e20.length - 1] : null,
              macd: macd(closes), atr: atr(ohlc, 14),
              returnPct: (closes[closes.length - 1] / closes[0] - 1) * 100,
              volatility: vol, maxDd: maxDrawdown(closes), backtest: backtestEmaCross(closes),
            };
            return true;
          }
        } catch (e) { /* sin indicadores para este activo, no se inventa */ }
        return false;
      }
      state.tech = {};
      /* Las dos monedas de los graficos van primero: lo visible no depende
         de llegar al final de la cadena si una llamada falla en el camino. */
      const chartFirst = [];
      [chartCoin(1), chartCoin(2)].forEach((id) => {
        const u = UNIVERSE.find((x) => x.id === id);
        if (u && !chartFirst.includes(u)) chartFirst.push(u);
      });
      const ordered = [...chartFirst, ...UNIVERSE.filter((u) => !chartFirst.includes(u))];
      for (const u of ordered) {
        await loadCoinTech(u);
        await sleep(500);
      }
      /* Segundo pase: solo las monedas que quedaron sin velas, con espera
         mayor, en vez de repetir toda la carga con Actualizar. */
      const missing = UNIVERSE.filter((u) => !state.tech[u.id]);
      for (const u of missing) {
        await sleep(3000);
        await loadCoinTech(u);
      }
      state.lastUpdated = new Date(); state.error = null;
      computeAll(); render(); loadNews();
      setStatus("Datos reales cargados");
      toast("Datos reales actualizados desde CoinGecko.");
    } catch (e) {
      state.error = e;
      setStatus("No se pudieron cargar los datos");
      if (errEl) { errEl.style.display = "block"; errEl.textContent = "No se pudo cargar CoinGecko en este momento (" + (e && e.message ? e.message : "error de red") + "). No se muestran datos inventados: pulsa Actualizar para reintentar. Si el error es 429, espera un minuto; CoinGecko limita las consultas gratuitas."; }
    } finally { state.loading = false; }
  }

  function go(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const target = $("#view-" + view); if (target) target.classList.add("active");
    document.querySelectorAll(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    const titles = { overview: ["Dashboard", "Precios reales, agentes y senales en un solo lugar."], scanner: ["Market scanner", "Universo real filtrado por volumen, con RSI y tendencia."], signals: ["Trading signals", "Senales generadas por reglas visibles, no por datos inventados."], agents: ["AI Skills", "Los nueve agentes y la tarea concreta de cada uno."], news: ["News center", "Catalizadores reales y titulares solo con clave propia."], risk: ["Risk management", "Tamano de posicion segun ATR, capital y riesgo."], performance: ["Performance", "Estadisticas de las velas reales y auditoria de senales."], settings: ["Configuración", "Capital demo, riesgo y clave opcional de noticias (solo en tu navegador)."] };
    if (titles[view]) { $("#pageTitle").textContent = titles[view][0]; $("#heading").textContent = titles[view][0]; $("#subheading").textContent = titles[view][1]; }
    $("#sidebar").classList.remove("open"); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".nav-item[data-view]").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach((n) => n.addEventListener("click", () => go(n.dataset.goto)));
  const refreshBtn = $("#refreshBtn"); if (refreshBtn) refreshBtn.addEventListener("click", loadAll);
  const scanBtn = $("#scanBtn"); if (scanBtn) scanBtn.addEventListener("click", () => { loadAll(); go("scanner"); });
  const scannerRun = $("#scannerRun"); if (scannerRun) scannerRun.addEventListener("click", loadAll);
  const mobileMenu = $("#mobileMenu"); if (mobileMenu) mobileMenu.addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  const dismiss = $("#dismissBanner"); if (dismiss) dismiss.addEventListener("click", () => { const b = $(".demo-banner"); if (b) b.remove(); });
  const assetSearch = $("#assetSearch"); if (assetSearch) assetSearch.addEventListener("input", render);
  const saveBtn = $("#saveSettingsBtn");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const cap = parseFloat($("#capitalInput").value); const risk = parseFloat($("#riskInput").value); const key = $("#newsKeyInput").value.trim();
    if (!isNaN(cap) && cap > 0) localStorage.setItem("dts_capital", String(cap));
    if (!isNaN(risk) && risk > 0 && risk <= 10) localStorage.setItem("dts_risk", String(risk));
    localStorage.setItem("dts_news_key", key);
    computeAll(); render(); loadNews();
    toast("Configuracion guardada solo en tu navegador.");
  });
  const clearBtn = $("#clearAuditBtn");
  if (clearBtn) clearBtn.addEventListener("click", () => { localStorage.removeItem("dts_audit"); state.audit = []; render(); toast("Historial de auditoria borrado de este navegador."); });
  const s = getSettings();
  if ($("#capitalInput")) $("#capitalInput").value = s.capital;
  if ($("#riskInput")) $("#riskInput").value = s.riskPct;
  if ($("#newsKeyInput")) $("#newsKeyInput").value = s.newsKey;
  populateChartSelects();
  loadAll();
}
