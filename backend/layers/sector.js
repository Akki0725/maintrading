// backend/layers/sector.js
// Stage 0B — Sector rotation and relative strength vs. broad market

const { fetchYFChart } = require('../utils/fetcher')
const { normalise, deterministicScore, buildSparkline, clamp } = require('../utils/scorer')

const LAYER_ID = 'sector'

// Ticker → sector ETF mapping
const SECTOR_MAP = {
  // Technology
  NVDA: 'XLK', AAPL: 'XLK', MSFT: 'XLK', AMD: 'XLK', INTC: 'XLK',
  GOOGL: 'XLC', META: 'XLC', NFLX: 'XLC',
  AMZN: 'XLY', TSLA: 'XLY',
  // Financials
  JPM: 'XLF', GS: 'XLF', BAC: 'XLF', V: 'XLF', MA: 'XLF',
  // Energy
  XOM: 'XLE', CVX: 'XLE',
  // Healthcare
  JNJ: 'XLV', PFE: 'XLV',
  // Consumer
  WMT: 'XLP',
  // Fintech/Crypto
  PYPL: 'XLF', COIN: 'XLF',
  // Default
  DEFAULT: 'SPY',
}

async function analyze(ticker, context = {}) {
  const sources = { live: false }
  const etf = SECTOR_MAP[ticker.toUpperCase()] || SECTOR_MAP.DEFAULT

  try {
    const [etfData, spyData, tickerData] = await Promise.all([
      fetchYFChart(etf,  '3mo', '1d'),
      fetchYFChart('SPY', '3mo', '1d'),
      fetchYFChart(ticker, '3mo', '1d'),
    ])

    if (!etfData || !spyData) throw new Error('Sector data unavailable')
    sources.live = true

    // ── ETF momentum ──────────────────────────────────────────
    const etfCloses = etfData.map(d => d.close)
    const spyCloses = spyData.map(d => d.close)

    const etfRet20  = (etfCloses.at(-1) - etfCloses.at(-21)) / etfCloses.at(-21)
    const spyRet20  = (spyCloses.at(-1) - spyCloses.at(-21)) / spyCloses.at(-21)
    const relPerf   = etfRet20 - spyRet20  // relative strength vs SPY

    const etfRet5   = (etfCloses.at(-1) - etfCloses.at(-6)) / etfCloses.at(-6)
    const etfScore  = normalise(etfRet20, -0.10, 0.10)
    const relScore  = normalise(relPerf,  -0.06, 0.06)

    // ── Ticker vs sector (if available) ───────────────────────
    let tickerRelScore = 0
    if (tickerData?.length >= 21) {
      const tkCloses = tickerData.map(d => d.close)
      const tkRet20  = (tkCloses.at(-1) - tkCloses.at(-21)) / tkCloses.at(-21)
      tickerRelScore = normalise(tkRet20 - etfRet20, -0.08, 0.08)
    }

    // ── Sector breadth proxy: recent acceleration ─────────────
    const etfRet5Prev = (etfCloses.at(-6) - etfCloses.at(-11)) / etfCloses.at(-11)
    const momentumAcc = normalise(etfRet5 - etfRet5Prev, -0.04, 0.04)

    const score = clamp(
      etfScore      * 0.30 +
      relScore      * 0.35 +
      tickerRelScore* 0.20 +
      momentumAcc   * 0.15
    )

    const sparkline = buildSparkline(etfCloses)

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.90, 0.58 + Math.abs(score) * 0.35).toFixed(2),
      weight: 0.11,
      reasoning: buildReasoning(ticker, etf, etfRet20, relPerf, spyRet20, score),
      subSignals: [
        { name: `${etf} 20d Return`,     score: +etfScore.toFixed(2) },
        { name: 'Relative vs SPY',        score: +relScore.toFixed(2) },
        { name: 'Ticker vs Sector',       score: +tickerRelScore.toFixed(2) },
        { name: 'Momentum Acceleration',  score: +momentumAcc.toFixed(2) },
      ],
      sparkline,
      rawData: { etf, etfRet20: +(etfRet20*100).toFixed(2), spyRet20: +(spyRet20*100).toFixed(2), relPerf: +(relPerf*100).toFixed(2) },
      sources,
      _context: { sectorETF: etf, sectorScore: score },
    }
  } catch (err) {
    const score = deterministicScore(ticker, LAYER_ID)
    const etf   = SECTOR_MAP[ticker.toUpperCase()] || SECTOR_MAP.DEFAULT
    return {
      id: LAYER_ID,
      score,
      confidence: 0.45,
      weight: 0.11,
      reasoning: fallbackReasoning(ticker, etf, score),
      subSignals: [
        { name: `${etf} Momentum`,   score: +(score * 0.9).toFixed(2) },
        { name: 'Relative vs SPY',   score: +(score * 0.8).toFixed(2) },
        { name: 'Ticker vs Sector',  score: +(score * 0.6).toFixed(2) },
        { name: 'Sector Breadth',    score: +(score * 0.7).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock', etf },
      sources,
      _context: { sectorETF: etf, sectorScore: score },
    }
  }
}

function buildReasoning(ticker, etf, etfRet, relPerf, spyRet, score) {
  const dir  = relPerf > 0 ? 'outperforming' : 'underperforming'
  const mag  = Math.abs(relPerf * 100).toFixed(1)
  const sec  = etfRet > 0.02 ? 'strong uptrend' : etfRet < -0.02 ? 'downtrend' : 'sideways'
  return `${etf} sector ETF in ${sec} with ${(etfRet*100).toFixed(1)}% 20-day return vs SPY ${(spyRet*100).toFixed(1)}%. ` +
    `${ticker} sector is ${dir} the broad market by ${mag}%. ` +
    `${score > 0.3 ? 'Capital rotation into this sector is a tailwind.' : score < -0.3 ? 'Capital is flowing out of this sector — headwind.' : 'Sector dynamics are neutral at this time.'}`
}

function fallbackReasoning(ticker, etf, score) {
  return score > 0.2
    ? `${etf} sector showing relative strength vs S&P 500. Industry peers trending positively. ${ticker} should benefit from sector tailwind.`
    : score < -0.2
    ? `${etf} sector underperforming broad market. Capital rotation away from this space. Industry group headwinds likely to persist.`
    : `${etf} sector performing in line with broader market. No significant rotation detected in either direction.`
}

module.exports = { analyze }
