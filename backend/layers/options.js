// backend/layers/options.js
// Stage 4B — Smart Money: options flow, IV skew, put/call ratio

const { fetchYFOptions } = require('../utils/fetcher')
const { normalise, deterministicScore, clamp } = require('../utils/scorer')

const LAYER_ID = 'options'

async function analyze(ticker, context = {}) {
  const sources = { live: false }
  // In high-vol regime, options carry more weight (set by pipeline)
  const isHighVol = context.isHighVol || false

  try {
    const optionChain = await fetchYFOptions(ticker)
    if (!optionChain) throw new Error('No options data')
    sources.live = true

    const expirations = optionChain.expirationDates || []
    const options     = optionChain.options?.[0]    // Nearest expiration
    if (!options) throw new Error('No near-term options')

    const calls = options.calls || []
    const puts  = options.puts  || []

    // ── Put/Call ratio (volume) ────────────────────────────────
    const callVol  = calls.reduce((s, c) => s + (c.volume || 0), 0)
    const putVol   = puts.reduce((s, p)  => s + (p.volume || 0), 0)
    const pcRatio  = callVol > 0 ? putVol / callVol : 1
    // PCR < 0.7 = heavy calls = bullish sentiment; PCR > 1.5 = heavy puts = bearish
    const pcrScore = normalise(pcRatio, 2.0, 0.4, true)  // inverted: high PCR = bearish

    // ── Put/Call OI ratio ──────────────────────────────────────
    const callOI = calls.reduce((s, c) => s + (c.openInterest || 0), 0)
    const putOI  = puts.reduce((s, p)  => s + (p.openInterest || 0), 0)
    const pcOI   = callOI > 0 ? putOI / callOI : 1
    const oiScore = normalise(pcOI, 1.8, 0.5, true)

    // ── Implied Volatility ────────────────────────────────────
    const allIVs      = [...calls, ...puts].map(o => o.impliedVolatility).filter(Boolean)
    const avgIV       = allIVs.length > 0 ? allIVs.reduce((a, b) => a + b, 0) / allIVs.length : 0.30
    // Very high IV (>0.8) = fear/expectation of big move; compare vs typical 0.3
    const ivScore     = isHighVol
      ? normalise(avgIV, 0.8, 0.15)  // in high-vol: high IV = more signal
      : normalise(avgIV, 0.8, 0.15, true)  // normal: high IV = fear = slight bearish

    // ── Unusual activity: scan for anomalously large orders ───
    const unusualCalls = calls.filter(c => (c.volume || 0) > (c.openInterest || 1) * 2 && (c.volume || 0) > 500)
    const unusualPuts  = puts.filter(p  => (p.volume || 0) > (p.openInterest || 1) * 2 && (p.volume || 0) > 500)
    const unusualScore = clamp((unusualCalls.length - unusualPuts.length) / 3)

    // ── Skew: far OTM puts vs calls ───────────────────────────
    const currentPrice = optionChain.quote?.regularMarketPrice || 0
    let skewScore = 0
    if (currentPrice > 0) {
      const otmCalls = calls.filter(c => (c.strike?.raw || 0) > currentPrice * 1.05)
      const otmPuts  = puts.filter(p  => (p.strike?.raw || 0) < currentPrice * 0.95)
      const otmCallIV = otmCalls.map(c => c.impliedVolatility || 0)
      const otmPutIV  = otmPuts.map(p => p.impliedVolatility || 0)
      const avgOTMCall = otmCallIV.length ? otmCallIV.reduce((a,b) => a+b) / otmCallIV.length : avgIV
      const avgOTMPut  = otmPutIV.length  ? otmPutIV.reduce((a,b) => a+b) / otmPutIV.length  : avgIV
      // Positive skew (puts > calls IV) = market pricing in downside risk
      skewScore = normalise(avgOTMCall - avgOTMPut, -0.15, 0.15)
    }

    const score = clamp(
      pcrScore   * 0.30 +
      oiScore    * 0.20 +
      unusualScore * 0.25 +
      skewScore  * 0.15 +
      ivScore    * 0.10
    )

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.90, 0.50 + Math.abs(score) * 0.40).toFixed(2),
      weight: isHighVol ? 0.16 : 0.10,
      reasoning: buildReasoning(ticker, pcRatio, avgIV, unusualCalls.length, unusualPuts.length, isHighVol, score),
      subSignals: [
        { name: 'Put/Call Ratio',      score: +pcrScore.toFixed(2) },
        { name: 'OI Skew',             score: +oiScore.toFixed(2) },
        { name: 'Unusual Activity',    score: +unusualScore.toFixed(2) },
        { name: 'IV Skew',             score: +skewScore.toFixed(2) },
        { name: `IV Level ${isHighVol ? '⚡' : ''}`, score: +ivScore.toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.sin(i * 0.7) * 0.2 + score * (i / 15)),
      rawData: {
        putCallRatio: +pcRatio.toFixed(2),
        putCallOI:    +pcOI.toFixed(2),
        avgIV:        +(avgIV * 100).toFixed(1),
        unusualCallCount: unusualCalls.length,
        unusualPutCount:  unusualPuts.length,
        expirations: expirations.length,
        isHighVol,
      },
      sources,
      _context: { optionsScore: score, isHighVol, putCallRatio: pcRatio },
    }
  } catch (err) {
    // Context-aware fallback
    const momentumBias = (context.momentumScore || 0) * 0.25
    const score = clamp(deterministicScore(ticker, LAYER_ID, momentumBias))
    return {
      id: LAYER_ID,
      score,
      confidence: 0.42,
      weight: isHighVol ? 0.16 : 0.10,
      reasoning: fallbackReasoning(ticker, score, isHighVol),
      subSignals: [
        { name: 'Put/Call Ratio',   score: +(score * 1.1).toFixed(2) },
        { name: 'OI Skew',         score: +(score * 0.8).toFixed(2) },
        { name: 'Unusual Activity',score: +(score * 0.9).toFixed(2) },
        { name: 'IV Skew',         score: +(score * 0.7).toFixed(2) },
        { name: isHighVol ? 'IV Level ⚡' : 'IV Level', score: +(-score * 0.3).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock', isHighVol },
      sources,
      _context: { optionsScore: score, isHighVol, putCallRatio: 1 - score * 0.5 },
    }
  }
}

function buildReasoning(ticker, pcr, iv, uc, up, isHighVol, score) {
  const pcrStr  = pcr < 0.7 ? `Put/Call ratio ${pcr.toFixed(2)} — heavy CALL buying, bullish sentiment.`
                : pcr > 1.5 ? `Put/Call ratio ${pcr.toFixed(2)} — heavy PUT buying, institutional hedging.`
                : `Put/Call ratio ${pcr.toFixed(2)} — normal distribution.`
  const ivStr   = `Average IV: ${(iv * 100).toFixed(0)}%. ${isHighVol ? '⚡ High-volatility mode: options signals amplified.' : ''}`
  const unusualStr = uc > 2 ? `Unusual call buying detected (${uc} strikes with anomalous volume) — potential institutional upside positioning.`
                   : up > 2 ? `Unusual put buying detected (${up} strikes) — potential institutional hedging or bearish bet.`
                   : 'No unusual options activity.'
  return `${pcrStr} ${ivStr} ${unusualStr}`
}

function fallbackReasoning(ticker, score, isHighVol) {
  const volStr = isHighVol ? '⚡ High-volatility regime detected — options signals carrying elevated weight. ' : ''
  return score > 0.25
    ? `${volStr}Options market showing bullish positioning for ${ticker}. Call volume elevated relative to puts. Smart money appears to be positioning for upside.`
    : score < -0.25
    ? `${volStr}Heavy put buying detected for ${ticker}. Institutional hedging or directional short bets visible in the options chain. Smart money is defensive.`
    : `${volStr}Options positioning for ${ticker} is neutral. Put/call ratio near equilibrium with no unusual activity detected.`
}

module.exports = { analyze }
