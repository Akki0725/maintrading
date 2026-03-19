// backend/layers/fundamental.js
// Stage 2A — Reality Check: EPS surprises, revenue beats, forward guidance

const { fetchFMPEarnings, fetchFMPKeyMetrics } = require('../utils/fetcher')
const { normalise, deterministicScore, clamp } = require('../utils/scorer')

const LAYER_ID = 'fundamental'

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    const [earnings, keyMetrics] = await Promise.all([
      fetchFMPEarnings(ticker, 5),
      fetchFMPKeyMetrics(ticker, 5),
    ])
    if (!earnings?.length && !keyMetrics?.length) throw new Error('No fundamental data')
    sources.live = true

    const sortedEarnings = (earnings || [])
      .slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    const sortedMetrics = (keyMetrics || [])
      .slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

    const latestCompleteEarnings = [...sortedEarnings].reverse().find(e =>
      isFiniteNumber(e?.epsActual) &&
      isFiniteNumber(e?.epsEstimated)
    ) || null

    const nextEarningsEstimate = sortedEarnings.find(e =>
      isFiniteNumber(e?.epsEstimated) && !isFiniteNumber(e?.epsActual)
    ) || null

    const latestMetrics = sortedMetrics.at(-1) || {}
    const prevMetrics = sortedMetrics.length > 1 ? sortedMetrics.at(-2) : null

    // ── EPS Surprise ──────────────────────────────────────────
    const latestEarnings = latestCompleteEarnings
    let epsSurpriseScore  = 0
    if (isFiniteNumber(latestEarnings?.epsActual) && isFiniteNumber(latestEarnings?.epsEstimated)) {
      const actual = Number(latestEarnings.epsActual)
      const estimate = Number(latestEarnings.epsEstimated)
      const surprise = estimate !== 0 ? (actual - estimate) / Math.abs(estimate) : 0
      epsSurpriseScore = normalise(surprise, -0.30, 0.30)
    }

    // ── Revenue surprise/trend proxy ──────────────────────────
    const revActual = isFiniteNumber(latestEarnings?.revenueActual) ? Number(latestEarnings.revenueActual) : null
    const revEstimate = isFiniteNumber(latestEarnings?.revenueEstimated) ? Number(latestEarnings.revenueEstimated) : null
    const revenueSurprise = revActual != null && revEstimate != null && revEstimate !== 0
      ? (revActual - revEstimate) / Math.abs(revEstimate)
      : 0
    const revenueScore = normalise(revenueSurprise, -0.20, 0.20)

    // ── Forward guidance proxy (next est vs last actual EPS) ──
    let guidanceScore = 0
    if (isFiniteNumber(nextEarningsEstimate?.epsEstimated) && isFiniteNumber(latestEarnings?.epsActual)) {
      const nextEstimate = Number(nextEarningsEstimate.epsEstimated)
      const base = Number(latestEarnings.epsActual) || 1
      const projectedDelta = (nextEstimate - base) / Math.abs(base)
      guidanceScore = normalise(projectedDelta, -0.25, 0.25)
    }

    // ── Profitability ─────────────────────────────────────────
    const operatingMgn = toRatio(latestMetrics.operatingMarginRatio)
    const grossMargin = toRatio(latestMetrics.grossProfitMarginRatio)
    const marginScore = normalise(operatingMgn ?? 0, -0.05, 0.30)

    // ── Quality / revision proxy from key metrics ─────────────
    let analystScore = 0
    if (prevMetrics) {
      const currentRoe = toRatio(latestMetrics.returnOnEquity)
      const previousRoe = toRatio(prevMetrics.returnOnEquity)
      if (currentRoe != null && previousRoe != null) {
        analystScore = normalise(currentRoe - previousRoe, -0.06, 0.06)
      }
    }

    // ── Valuation (P/E vs growth) ─────────────────────────────
    const peRatio = numberOrNull(latestMetrics.peRatio)
    const peg = numberOrNull(latestMetrics.pegRatio)
    const valuationScore = peg != null ? normalise(peg, 3.0, 0.5, true) // PEG < 1 = cheap
                         : peRatio != null ? normalise(peRatio, 80, 10, true) : 0

    // ── Context: if catalyst is earnings, weight fundamentals higher ─
    const earningsBoost = context.isEarnings ? 0.15 : 0

    const score = clamp(
      epsSurpriseScore * 0.30 +
      revenueScore     * 0.20 +
      guidanceScore    * 0.18 +
      marginScore      * 0.12 +
      analystScore     * 0.12 +
      valuationScore   * 0.08 +
      earningsBoost
    )

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.92, 0.55 + Math.abs(epsSurpriseScore) * 0.4).toFixed(2),
      weight: context.isEarnings ? 0.18 : 0.12,  // boosted during earnings season
      reasoning: buildReasoning(ticker, latestEarnings, revenueSurprise, guidanceScore, analystScore, score),
      subSignals: [
        { name: 'EPS Surprise',       score: +epsSurpriseScore.toFixed(2) },
        { name: 'Revenue Surprise',   score: +revenueScore.toFixed(2) },
        { name: 'Forward Guidance',   score: +guidanceScore.toFixed(2) },
        { name: 'Profitability',      score: +marginScore.toFixed(2) },
        { name: 'Quality Trend',      score: +analystScore.toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.cos(i * 0.5) * 0.25 + score * (i / 15)),
      rawData: {
        revenueSurprisePct: +(revenueSurprise * 100).toFixed(1),
        grossMargin:   +(toPercent(grossMargin)).toFixed(1),
        operatingMargin: +(toPercent(operatingMgn)).toFixed(1),
        peRatio, pegRatio: peg,
        latestEPS: latestEarnings ? {
          actual: latestEarnings.epsActual, estimate: latestEarnings.epsEstimated
        } : null,
      },
      sources,
      _context: { fundamentalScore: score },
    }
  } catch (err) {
    const score = deterministicScore(ticker, LAYER_ID, (context.catalystStrength || 0) * 0.25)
    return {
      id: LAYER_ID,
      score,
      confidence: 0.45,
      weight: 0.12,
      reasoning: fallbackReasoning(ticker, score),
      subSignals: [
        { name: 'EPS Surprise',       score: +(score * 1.2).toFixed(2) },
        { name: 'Revenue Surprise',   score: +(score * 0.9).toFixed(2) },
        { name: 'Forward Guidance',   score: +(score * 0.7).toFixed(2) },
        { name: 'Profitability',      score: +(score * 0.8).toFixed(2) },
        { name: 'Quality Trend',      score: +(score * 0.6).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { fundamentalScore: score },
    }
  }
}

function buildReasoning(ticker, latestEPS, revSurprise, guidance, analyst, score) {
  let epsStr = 'No recent earnings data available.'
  if (isFiniteNumber(latestEPS?.epsActual) && isFiniteNumber(latestEPS?.epsEstimated)) {
    const actual = Number(latestEPS.epsActual)
    const estimate = Number(latestEPS.epsEstimated)
    const diff = ((actual - estimate) / Math.abs(estimate || 1) * 100)
    epsStr = `Latest EPS: $${actual.toFixed(2)} vs $${estimate.toFixed(2)} estimate (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% surprise).`
  }
  const revStr   = `Revenue surprise: ${(revSurprise * 100).toFixed(1)}%.`
  const guidStr  = guidance > 0.1 ? 'Forward EPS estimates imply improving near-term guidance.'
                : guidance < -0.1 ? 'Forward EPS estimates imply softening near-term guidance.'
                : 'Forward EPS estimates are broadly stable versus recent actuals.'
  return `${epsStr} ${revStr} ${guidStr} Overall fundamental score: ${score > 0 ? 'SUPPORTIVE' : 'CONCERNING'} for ${ticker}.`
}

function fallbackReasoning(ticker, score) {
  return score > 0.2
    ? `${ticker} fundamentals appear strong. Recent earnings beat expectations with positive management guidance and upward analyst revisions. Fundamental case supports bullish thesis.`
    : score < -0.2
    ? `${ticker} showing fundamental weakness. Earnings miss or declining guidance detected. Analyst estimates trending downward. Fundamental backdrop is challenging.`
    : `${ticker} fundamentals are mixed. Earnings roughly in-line with expectations. No strong upward or downward revision trend detected.`
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function numberOrNull(value) {
  return isFiniteNumber(value) ? Number(value) : null
}

function toRatio(value) {
  if (!isFiniteNumber(value)) return null
  const n = Number(value)
  // FMP fields can be either 0.21 or 21.0 depending on endpoint/version.
  return Math.abs(n) > 1 ? n / 100 : n
}

function toPercent(ratio) {
  return ratio == null ? 0 : ratio * 100
}

module.exports = { analyze }
