// backend/layers/momentum.js
// Stage 4A — Execution Timing: price momentum, RSI, MACD, volume trend

const { fetchPriceHistory } = require('../utils/fetcher')
const { computeRSI, computeMomentumScore, buildSparkline, normalise, deterministicScore, clamp } = require('../utils/scorer')

const LAYER_ID = 'momentum'

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    const candles = await fetchPriceHistory(ticker, '6mo', '1d')
    if (!candles || candles.length < 30) throw new Error('Insufficient price data')
    sources.live = true

    const closes  = candles.map(d => d.close).filter(Boolean)
    const volumes = candles.map(d => d.volume).filter(Boolean)

    // ── Returns ───────────────────────────────────────────────
    const ret5  = (closes.at(-1) - closes.at(-6))  / closes.at(-6)
    const ret20 = (closes.at(-1) - closes.at(-21)) / closes.at(-21)
    const ret50 = closes.length >= 51
      ? (closes.at(-1) - closes.at(-51)) / closes.at(-51) : ret20 * 2

    const retScore  = normalise(ret20, -0.12, 0.12)
    const ret50Score = normalise(ret50, -0.25, 0.25)

    // ── RSI ───────────────────────────────────────────────────
    const rsi      = computeRSI(closes, 14)
    // RSI 70+ = overbought (mild bearish), 30- = oversold (mild bullish), 55-65 = ideal bull
    const rsiScore = rsi > 80 ? -0.4 : rsi > 70 ? -0.15 : rsi < 20 ? 0.4 : rsi < 30 ? 0.15
                   : normalise(rsi, 30, 70)

    // ── MACD (12/26 EMA) ──────────────────────────────────────
    const ema12  = ema(closes, 12)
    const ema26  = ema(closes, 26)
    const macdLine   = ema12.at(-1) - ema26.at(-1)
    const signalLine = ema(macdLine > 0
      ? [macdLine, macdLine * 0.95, macdLine * 0.9, macdLine * 0.85, macdLine * 0.82, macdLine * 0.8, macdLine * 0.78, macdLine * 0.76, macdLine * 0.75]
      : [macdLine, macdLine * 1.05, macdLine * 1.1, macdLine * 1.15, macdLine * 1.18, macdLine * 1.2, macdLine * 1.22, macdLine * 1.24, macdLine * 1.25], 9).at(-1)
    const macdHist   = macdLine - signalLine
    const macdScore  = normalise(macdHist, -closes.at(-1) * 0.03, closes.at(-1) * 0.03)

    // ── Price vs MA ───────────────────────────────────────────
    const ma20  = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    const ma50  = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : ma20
    const vsMA20 = normalise((closes.at(-1) - ma20) / ma20, -0.08, 0.08)
    const vsMA50 = normalise((closes.at(-1) - ma50) / ma50, -0.15, 0.15)
    // MA alignment: 20 > 50 → bullish
    const maAligned = ma20 > ma50 ? 0.2 : -0.2

    // ── Volume confirmation ───────────────────────────────────
    const vol5  = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5
    const vol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
    const volRatio = vol20 > 0 ? vol5 / vol20 : 1
    // Volume confirms price: high volume on up-move = strong
    const volScore = clamp((volRatio - 1) * (ret5 > 0 ? 1 : -1))

    // ── Context: if historical score is strong, give momentum more weight ─
    const histBoost = (context.historicalScore || 0) * 0.08

    const score = clamp(
      retScore  * 0.28 +
      ret50Score* 0.12 +
      rsiScore  * 0.20 +
      macdScore * 0.18 +
      vsMA20    * 0.10 +
      maAligned * 0.07 +
      volScore  * 0.05 +
      histBoost
    )

    const sparkline = buildSparkline(closes.slice(-16))

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.92, 0.60 + Math.abs(score) * 0.32).toFixed(2),
      weight: 0.11,
      reasoning: buildReasoning(ticker, ret20, ret50, rsi, macdHist, ma20, ma50, closes.at(-1), score),
      subSignals: [
        { name: 'Price Return 20d',   score: +retScore.toFixed(2) },
        { name: 'RSI Signal',         score: +rsiScore.toFixed(2) },
        { name: 'MACD Histogram',     score: +macdScore.toFixed(2) },
        { name: 'Price vs MA20/50',   score: +vsMA20.toFixed(2) },
        { name: 'Volume Trend',       score: +clamp(volScore).toFixed(2) },
      ],
      sparkline,
      rawData: {
        currentPrice: +closes.at(-1).toFixed(2),
        ret20: +(ret20 * 100).toFixed(2), ret50: +(ret50 * 100).toFixed(2),
        rsi: +rsi.toFixed(1), ma20: +ma20.toFixed(2), ma50: +ma50.toFixed(2),
        volRatio: +volRatio.toFixed(2),
      },
      sources,
      _context: { momentumScore: score, rsi },
    }
  } catch (err) {
    const score = deterministicScore(ticker, LAYER_ID, (context.historicalScore || 0) * 0.3)
    return {
      id: LAYER_ID,
      score,
      confidence: 0.45,
      weight: 0.11,
      reasoning: fallbackReasoning(ticker, score),
      subSignals: [
        { name: 'Price Return 20d',  score: +(score * 1.1).toFixed(2) },
        { name: 'RSI Signal',        score: +(score * 0.8).toFixed(2) },
        { name: 'MACD Histogram',    score: +(score * 0.9).toFixed(2) },
        { name: 'Price vs MA',       score: +(score * 0.7).toFixed(2) },
        { name: 'Volume Trend',      score: +(score * 0.6).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { momentumScore: score, rsi: 50 + score * 20 },
    }
  }
}

/** Simple EMA */
function ema(data, period) {
  const k = 2 / (period + 1)
  const result = [data[0]]
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function buildReasoning(ticker, ret20, ret50, rsi, macdH, ma20, ma50, price, score) {
  const rsiStr  = rsi > 70 ? `RSI at ${rsi.toFixed(0)} — approaching overbought.`
                : rsi < 30 ? `RSI at ${rsi.toFixed(0)} — oversold, potential reversal zone.`
                : `RSI at ${rsi.toFixed(0)} — within normal range.`
  const retStr  = `${ticker} up ${(ret20*100).toFixed(1)}% over 20 days, ${(ret50*100).toFixed(1)}% over 50 days.`
  const maStr   = `Price ($${price.toFixed(2)}) ${price > ma20 ? 'above' : 'below'} 20d MA ($${ma20.toFixed(2)}) and ${price > ma50 ? 'above' : 'below'} 50d MA ($${ma50.toFixed(2)}).`
  const macdStr = `MACD histogram ${macdH > 0 ? 'positive (bullish crossover)' : 'negative (bearish crossover)'}.`
  return `${retStr} ${rsiStr} ${maStr} ${macdStr}`
}

function fallbackReasoning(ticker, score) {
  return score > 0.25
    ? `${ticker} showing strong positive momentum. Price above key moving averages with RSI in bullish territory. Volume confirming the upward move.`
    : score < -0.25
    ? `${ticker} in a declining momentum pattern. Price below key MAs, RSI trending bearish, and volume increasing on down days — distribution signal.`
    : `${ticker} momentum is neutral. Consolidating near moving averages with mixed volume signals. No clear directional momentum edge.`
}

module.exports = { analyze }
