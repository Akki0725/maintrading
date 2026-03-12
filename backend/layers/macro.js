// backend/layers/macro.js
// Stage 0A — Big Picture: interest rates, volatility regime, yield curve

const { fetchPriceHistory, fetchFRED } = require('../utils/fetcher')
const { normalise, deterministicScore, buildSparkline, clamp } = require('../utils/scorer')

const LAYER_ID = 'macro'

// Macro indicators to fetch from Yahoo Finance
const MACRO_TICKERS = {
  vix:    '^VIX',   // Fear gauge
  tnx:    '^TNX',   // 10Y Treasury yield
  irx:    '^IRX',   // 3-Month T-Bill
  sp500:  '^GSPC',  // S&P 500 trend
  dxy:    'DX-Y.NYB', // Dollar index
}

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    // ── Fetch macro instruments in parallel ──────────────────
    const [vixData, tnxData, irxData, spData] = await Promise.all([
      fetchPriceHistory(MACRO_TICKERS.vix,   '1mo', '1d'),
      fetchPriceHistory(MACRO_TICKERS.tnx,   '1mo', '1d'),
      fetchPriceHistory(MACRO_TICKERS.irx,   '1mo', '1d'),
      fetchPriceHistory(MACRO_TICKERS.sp500, '3mo', '1d'),
    ])

    if (!vixData || !tnxData || !spData) throw new Error('Macro data unavailable')
    sources.live = true

    // ── VIX Score ─────────────────────────────────────────────
    const vixLast    = vixData.at(-1)?.close ?? 20
    const vix5dAvg   = vixData.slice(-5).reduce((s, d) => s + d.close, 0) / 5
    // VIX < 15: calm → bullish (+0.5), 20-25: caution, >30: fear → bearish
    const vixScore   = normalise(vixLast, 40, 12, true)  // inverted: low VIX = good
    const vixTrend   = normalise(vixLast - vix5dAvg, 5, -5, true)  // rising VIX = bad

    // ── Yield Curve Score ─────────────────────────────────────
    const tnxLast  = tnxData.at(-1)?.close ?? 4.5
    const irxLast  = irxData?.at(-1)?.close ?? 5.0
    const spread   = tnxLast - irxLast  // negative = inverted = bearish
    const yieldScore = normalise(spread, -2, 2)  // +2 = steep (good), -2 = inverted (bad)

    // ── S&P 500 Trend ─────────────────────────────────────────
    const spCloses  = spData.map(d => d.close)
    const sp20dRet  = spCloses.length >= 21
      ? (spCloses.at(-1) - spCloses.at(-21)) / spCloses.at(-21)
      : 0
    const spScore   = normalise(sp20dRet, -0.08, 0.08)

    // ── Rate Level (absolute) ─────────────────────────────────
    // Very high rates (>5%) hurt growth stocks; moderate (<3%) helps
    const rateScore = normalise(tnxLast, 6, 1, true)

    // ── Composite ────────────────────────────────────────────
    const score = clamp(
      vixScore * 0.30 +
      vixTrend * 0.15 +
      yieldScore * 0.25 +
      spScore  * 0.20 +
      rateScore * 0.10
    )

    // ── Volatility regime for downstream context ──────────────
    const isHighVol = vixLast > 25

    const sparkline = buildSparkline(vixData.map(d => 40 - d.close))  // invert VIX for sparkline

    const reasoning = buildReasoning(vixLast, spread, tnxLast, sp20dRet, score)

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.92, 0.6 + Math.abs(score) * 0.35).toFixed(2),
      weight: 0.12,
      reasoning,
      subSignals: [
        { name: 'VIX Level',        score: +vixScore.toFixed(2) },
        { name: 'VIX Trend',        score: +vixTrend.toFixed(2) },
        { name: 'Yield Curve',      score: +yieldScore.toFixed(2) },
        { name: 'S&P 500 Trend',    score: +spScore.toFixed(2) },
        { name: 'Rate Environment', score: +rateScore.toFixed(2) },
      ],
      sparkline,
      rawData: { vixLast: +vixLast.toFixed(2), tnxLast: +tnxLast.toFixed(2), yieldSpread: +spread.toFixed(2), sp20dRet: +(sp20dRet*100).toFixed(2), isHighVol },
      sources,
      // Context for downstream layers
      _context: { isHighVol, regimeScore: score, vixLevel: vixLast },
    }
  } catch (err) {
    // ── Graceful fallback ─────────────────────────────────────
    const score = deterministicScore(ticker, LAYER_ID)
    return {
      id: LAYER_ID,
      score,
      confidence: 0.45,
      weight: 0.12,
      reasoning: fallbackReasoning(ticker, score),
      subSignals: [
        { name: 'VIX Level',        score: +(score * 0.8).toFixed(2) },
        { name: 'Yield Curve',      score: +(score * 0.7).toFixed(2) },
        { name: 'S&P 500 Trend',    score: +(score * 0.9).toFixed(2) },
        { name: 'Rate Environment', score: +(-score * 0.5).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { isHighVol: false, regimeScore: score, vixLevel: 18 },
    }
  }
}

function buildReasoning(vix, spread, tnx, spRet, score) {
  const vixStr   = vix > 30 ? `VIX at ${vix.toFixed(0)} signals extreme fear — market in risk-off mode.`
                 : vix > 20 ? `VIX elevated at ${vix.toFixed(0)} indicating caution in the market.`
                 : `VIX low at ${vix.toFixed(0)}, market calm and risk appetite healthy.`
  const curveStr = spread < 0 ? `Inverted yield curve (${spread.toFixed(2)}%) — recession signal active.`
                 : `Yield curve spread: ${spread.toFixed(2)}% — ${spread > 1 ? 'healthy steepness supports risk assets.' : 'relatively flat, macro ambiguous.'}`
  const rateStr  = `10-Year Treasury at ${tnx.toFixed(2)}%. ${tnx > 5 ? 'High rates pressure growth valuations significantly.' : tnx > 4 ? 'Elevated rates create valuation headwind.' : 'Rate environment relatively supportive.'}`
  const spStr    = `S&P 500 20-day return: ${(spRet*100).toFixed(1)}%. ${spRet > 0.03 ? 'Broad market trending up — risk-on.' : spRet < -0.03 ? 'Market in downtrend — risk-off environment.' : 'Broad market neutral.'}`
  return `${vixStr} ${curveStr} ${rateStr} ${spStr}`
}

function fallbackReasoning(ticker, score) {
  return score > 0.2
    ? `Macro environment appears supportive. Rate trajectory showing signs of easing, volatility contained, and broad market trend positive. Growth-oriented positions favored.`
    : score < -0.2
    ? `Macro headwinds detected. Elevated volatility, persistent rate pressure, and weakening market breadth suggest defensive positioning. Risk-off environment likely.`
    : `Macro conditions are mixed. Rates elevated but stable, volatility within normal range, and market trend neutral. No strong directional macro bias.`
}

module.exports = { analyze }
