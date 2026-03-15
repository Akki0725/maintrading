// backend/layers/sector.js
// Stage 0B — Sector rotation and relative strength vs. broad market

const { fetchAlpacaDailySdk } = require('../utils/alpacaSdk')
const { normalise, buildSparkline, clamp } = require('../utils/scorer')

const LAYER_ID = 'sector'

// Ticker → sector ETF mapping
const SECTOR_MAP = {
  // Technology
  NVDA: 'XLK', AAPL: 'XLK', MSFT: 'XLK', AMD: 'XLK', INTC: 'XLK',
  CRM: 'XLK', PLTR: 'XLK', ORCL: 'XLK', IBM: 'XLK',
  GOOGL: 'XLC', META: 'XLC', NFLX: 'XLC',
  AMZN: 'XLY', TSLA: 'XLY',
  DIS: 'XLY', NKE: 'XLY',
  // Financials / Fintech
  JPM: 'XLF', GS: 'XLF', BAC: 'XLF', V: 'XLF', MA: 'XLF', PYPL: 'XLF', COIN: 'XLF',
  // Energy
  XOM: 'XLE', CVX: 'XLE',
  // Healthcare
  JNJ: 'XLV', PFE: 'XLV',
  // Industrials / Aerospace
  BA: 'XLI',
  // Consumer Staples
  WMT: 'XLP',
  // Broad market / index ETFs
  SPY: 'SPY',
  QQQ: 'QQQ',
  // Default
  DEFAULT: 'SPY',
}

async function analyze(ticker, context = {}) {
  const sources = { live: false }
  const etf = SECTOR_MAP[ticker.toUpperCase()] || SECTOR_MAP.DEFAULT

  try {
    const [etfData, spyData, tickerData] = await Promise.all([
      fetchAlpacaDailySdk(etf, 90),
      fetchAlpacaDailySdk('SPY', 90),
      fetchAlpacaDailySdk(ticker, 90),
    ])

    if (!etfData || !spyData || etfData.length < 21 || spyData.length < 21) throw new Error('Sector data unavailable')
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
        { name: 'Sector ETF 1M',          score: +etfScore.toFixed(2) },
        { name: 'Peer Rel Strength',      score: +relScore.toFixed(2) },
        { name: 'Ticker vs Sector',       score: +tickerRelScore.toFixed(2) },
        { name: 'Momentum Acceleration',  score: +momentumAcc.toFixed(2) },
      ],
      sparkline,
      rawData: {
        source: 'alpaca',
        etf,
        etfRet20Pct: +(etfRet20 * 100).toFixed(2),
        spyRet20Pct: +(spyRet20 * 100).toFixed(2),
        relPerfPct:  +(relPerf  * 100).toFixed(2),
        etfRet5Pct:  +(etfRet5  * 100).toFixed(2),
      },
      sources,
      _context: { sectorETF: etf, sectorScore: score },
    }
  } catch (err) {
    // Propagate errors so the pipeline / API can decide how to handle missing sector data.
    throw err
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

module.exports = { analyze }
