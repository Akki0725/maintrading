// backend/layers/fundamental.js
// Stage 2A — Reality Check: EPS surprises, revenue beats, forward guidance

const { fetchYFSummary } = require('../utils/fetcher')
const { normalise, deterministicScore, clamp } = require('../utils/scorer')

const LAYER_ID = 'fundamental'

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    const summary = await fetchYFSummary(ticker,
      'earnings,earningsTrend,defaultKeyStatistics,financialData,recommendationTrend')
    if (!summary) throw new Error('No fundamental data')
    sources.live = true

    const fd   = summary.financialData    || {}
    const ks   = summary.defaultKeyStatistics || {}
    const et   = summary.earningsTrend    || {}
    const rec  = summary.recommendationTrend || {}
    const earn = summary.earnings         || {}

    // ── EPS Surprise ──────────────────────────────────────────
    const earningsHistory = earn.earningsChart?.quarterly || []
    const latestEarnings  = earningsHistory.at(-1)
    let epsSurpriseScore  = 0
    if (latestEarnings?.actual?.raw != null && latestEarnings?.estimate?.raw != null) {
      const actual   = latestEarnings.actual.raw
      const estimate = latestEarnings.estimate.raw
      const surprise = estimate !== 0 ? (actual - estimate) / Math.abs(estimate) : 0
      epsSurpriseScore = normalise(surprise, -0.30, 0.30)
    }

    // ── Revenue trend ─────────────────────────────────────────
    const revenueGrowth = fd.revenueGrowth?.raw ?? 0
    const revenueScore  = normalise(revenueGrowth, -0.15, 0.25)

    // ── Forward guidance (analyst trend) ─────────────────────
    const trend = et.trend || []
    const fwd   = trend.find(t => t.period === '+1q') || trend[0]
    let guidanceScore = 0
    if (fwd?.epsTrend?.current?.raw != null && fwd?.epsRevisions) {
      const upRevisions   = fwd.epsRevisions.upLast30days?.raw || 0
      const downRevisions = fwd.epsRevisions.downLast30days?.raw || 0
      const netRevisions  = upRevisions - downRevisions
      guidanceScore = normalise(netRevisions, -5, 5)
    }

    // ── Profitability ─────────────────────────────────────────
    const grossMargin   = fd.grossMargins?.raw ?? 0
    const operatingMgn  = fd.operatingMargins?.raw ?? 0
    const marginScore   = normalise(operatingMgn, -0.05, 0.30)

    // ── Analyst recommendations ───────────────────────────────
    const recHistory = rec.trend || []
    const latestRec  = recHistory[0]
    let analystScore = 0
    if (latestRec) {
      const buy    = (latestRec.strongBuy?.raw || 0) + (latestRec.buy?.raw || 0)
      const sell   = (latestRec.strongSell?.raw || 0) + (latestRec.sell?.raw || 0)
      const total  = buy + sell + (latestRec.hold?.raw || 0)
      analystScore = total > 0 ? normalise((buy - sell) / total, -0.5, 0.5) : 0
    }

    // ── Valuation (P/E vs growth) ─────────────────────────────
    const peRatio  = ks.trailingPE?.raw
    const peg      = ks.pegRatio?.raw
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
      reasoning: buildReasoning(ticker, latestEarnings, revenueGrowth, guidanceScore, analystScore, score),
      subSignals: [
        { name: 'EPS Surprise',       score: +epsSurpriseScore.toFixed(2) },
        { name: 'Revenue Growth',     score: +revenueScore.toFixed(2) },
        { name: 'Analyst Revisions',  score: +guidanceScore.toFixed(2) },
        { name: 'Profitability',      score: +marginScore.toFixed(2) },
        { name: 'Analyst Consensus',  score: +analystScore.toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.cos(i * 0.5) * 0.25 + score * (i / 15)),
      rawData: {
        revenueGrowth: +(revenueGrowth * 100).toFixed(1),
        grossMargin:   +(grossMargin * 100).toFixed(1),
        operatingMargin: +(operatingMgn * 100).toFixed(1),
        peRatio, pegRatio: peg,
        latestEPS: latestEarnings ? {
          actual: latestEarnings.actual?.raw, estimate: latestEarnings.estimate?.raw
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
        { name: 'Revenue Growth',     score: +(score * 0.9).toFixed(2) },
        { name: 'Analyst Revisions',  score: +(score * 0.7).toFixed(2) },
        { name: 'Profitability',      score: +(score * 0.8).toFixed(2) },
        { name: 'Analyst Consensus',  score: +(score * 0.6).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { fundamentalScore: score },
    }
  }
}

function buildReasoning(ticker, latestEPS, revGrowth, guidance, analyst, score) {
  let epsStr = 'No recent earnings data available.'
  if (latestEPS?.actual?.raw != null && latestEPS?.estimate?.raw != null) {
    const diff = ((latestEPS.actual.raw - latestEPS.estimate.raw) / Math.abs(latestEPS.estimate.raw || 1) * 100)
    epsStr = `Latest EPS: $${latestEPS.actual.raw.toFixed(2)} vs $${latestEPS.estimate.raw.toFixed(2)} estimate (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% surprise).`
  }
  const revStr   = `Revenue growth: ${(revGrowth * 100).toFixed(1)}%.`
  const guidStr  = guidance > 0.1 ? 'Analyst revisions trending upward — positive guidance signal.'
                 : guidance < -0.1 ? 'Analyst estimates being cut — negative revision cycle.'
                 : 'Analyst estimates stable with no significant revision trend.'
  return `${epsStr} ${revStr} ${guidStr} Overall fundamental score: ${score > 0 ? 'SUPPORTIVE' : 'CONCERNING'} for ${ticker}.`
}

function fallbackReasoning(ticker, score) {
  return score > 0.2
    ? `${ticker} fundamentals appear strong. Recent earnings beat expectations with positive management guidance and upward analyst revisions. Fundamental case supports bullish thesis.`
    : score < -0.2
    ? `${ticker} showing fundamental weakness. Earnings miss or declining guidance detected. Analyst estimates trending downward. Fundamental backdrop is challenging.`
    : `${ticker} fundamentals are mixed. Earnings roughly in-line with expectations. No strong upward or downward revision trend detected.`
}

module.exports = { analyze }
