// backend/layers/macro.js
// Stage 0A — Big Picture: interest rates, volatility regime, yield curve, credit stress, dollar

const { fetchFRED } = require('../utils/fetcher')
const { normalise, buildSparkline, clamp } = require('../utils/scorer')

const LAYER_ID = 'macro'

// FRED Series IDs — pure macro data (no equity proxies)
const FRED_SERIES = {
  treasury10y: 'DGS10',        // 10-Year Treasury Yield
  tbill3m:     'DTB3',        // 3-Month T-Bill Yield
  vix:         'VIXCLS',      // Volatility Index (close)
  dollarIndex: 'DTWEXBGS',    // US Dollar Index (Broad)
  hySpread:    'BAMLH0A0HYM2', // High Yield Option-Adjusted Credit Spread
  cpi:         'CPIAUCSL',   // CPI All Urban (for YoY inflation)
  gdpGrowth:   'A191RL1Q225SBEA', // Real GDP % change from prior quarter (annualized)
  pmi:         'GACDFSA066MSFRBPHI', // Philly Fed Mfg General Activity (ISM PMI removed from FRED 2016)
}

const FRED_LIMIT = 65   // ~3 months daily for 5d/20d trends
const FRED_LIMIT_MONTHLY = 24 // ~2 years monthly for CPI YoY

/**
 * Parse FRED observations (desc = newest first) into array of { date, value } oldest-first.
 * Drops missing ('.') and non-numeric values.
 */
function parseFREDSeries(observations) {
  if (!observations || !Array.isArray(observations)) return []
  const valid = observations
    .filter(o => o.value != null && String(o.value).trim() !== '' && o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !Number.isNaN(o.value))
  return valid.reverse() // oldest first for trend math
}

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    // ── Fetch all macro series from FRED (1–3 months for trends; monthly for CPI/GDP/PMI) ─────
    const [dgs10Obs, dtb3Obs, vixObs, dxyObs, hyObs, cpiObs, gdpObs, pmiObs] = await Promise.all([
      fetchFRED(FRED_SERIES.treasury10y, FRED_LIMIT),
      fetchFRED(FRED_SERIES.tbill3m, FRED_LIMIT),
      fetchFRED(FRED_SERIES.vix, FRED_LIMIT),
      fetchFRED(FRED_SERIES.dollarIndex, FRED_LIMIT),
      fetchFRED(FRED_SERIES.hySpread, FRED_LIMIT),
      fetchFRED(FRED_SERIES.cpi, FRED_LIMIT_MONTHLY),
      fetchFRED(FRED_SERIES.gdpGrowth, 8),
      fetchFRED(FRED_SERIES.pmi, 24),
    ])

    const dgs10  = parseFREDSeries(dgs10Obs)
    const dtb3   = parseFREDSeries(dtb3Obs)
    const vixArr = parseFREDSeries(vixObs)
    const dxyArr = parseFREDSeries(dxyObs)
    const hyArr  = parseFREDSeries(hyObs)
    const cpiArr = parseFREDSeries(cpiObs)
    const gdpArr = parseFREDSeries(gdpObs)
    const pmiArr = parseFREDSeries(pmiObs)

    if (dgs10.length < 2 || dtb3.length < 2 || vixArr.length < 2) throw new Error('Macro data unavailable')
    sources.live = true

    // ── Yield Curve (DGS10 - DTB3) — no fallbacks: score from live FRED only ───
    const tnxLast  = dgs10.at(-1)?.value
    const irxLast  = dtb3.at(-1)?.value
    if (tnxLast == null || irxLast == null) throw new Error('Macro data incomplete: missing 10Y or 3M yield')
    const spread   = tnxLast - irxLast  // negative = inverted = bearish
    const yieldScore = normalise(spread, -2, 2)  // +2 steep good, -2 inverted bad

    // ── Volatility (VIXCLS) level and 5-day trend ────────────────────
    const vixLast   = vixArr.at(-1)?.value
    if (vixLast == null) throw new Error('Macro data incomplete: missing VIX')
    const vix5dAgo  = vixArr.length >= 6 ? vixArr.at(-6).value : vixLast
    const vix5dChg  = vixLast - (vix5dAgo ?? vixLast)
    const vixScore  = normalise(vixLast, 40, 12, true)   // low VIX = good
    const vixTrend  = normalise(vix5dChg, 5, -5, true)   // rising VIX = bad

    // ── Credit Stress (BAMLH0A0HYM2): rising spread = bearish ────────
    const hyLast    = hyArr.at(-1)?.value
    const hy20dAgo  = hyArr.length >= 21 ? hyArr.at(-21).value : hyLast
    if (hyLast == null) throw new Error('Macro data incomplete: missing HY spread')
    const hyPctChg  = hy20dAgo && hy20dAgo > 0 ? (hyLast - hy20dAgo) / hy20dAgo : 0
    const creditScore = normalise(-hyPctChg, -0.25, 0.25)  // rising spread → negative score

    // ── US Dollar (DTWEXBGS): rapidly rising 20d = tighter conditions = bearish ─
    const dxyLast   = dxyArr.at(-1)?.value
    const dxy20dAgo = dxyArr.length >= 21 ? dxyArr.at(-21).value : dxyLast
    if (dxyLast == null) throw new Error('Macro data incomplete: missing dollar index')
    const dxyPctChg = dxy20dAgo && dxy20dAgo > 0 ? (dxyLast - dxy20dAgo) / dxy20dAgo : 0
    const dollarScore = normalise(-dxyPctChg, -0.05, 0.05)  // rising dollar → negative score

    // ── Composite score (each sub-score is in [-1, +1]; weights sum to 1) ───
    // Formula: score = clamp( 0.35*yield + 0.30*credit + 0.20*vixLevel + 0.08*vixTrend + 0.07*dollar )
    const score = clamp(
      yieldScore  * 0.35 +
      creditScore * 0.30 +
      vixScore    * 0.20 +
      vixTrend    * 0.08 +
      dollarScore * 0.07
    )

    const isHighVol = vixLast > 25
    const sparkline = buildSparkline(vixArr.map(d => 40 - d.value))  // invert VIX for sparkline

    // ── CPI YoY, GDP growth, PMI (live from FRED for dashboard) ─────
    const cpiLast = cpiArr.at(-1)?.value
    const cpi12Ago = cpiArr.length >= 13 ? cpiArr.at(-13).value : null
    const cpiYoY = (cpiLast != null && cpi12Ago != null && cpi12Ago > 0)
      ? ((cpiLast / cpi12Ago) - 1) * 100
      : null
    const gdpGrowthQ = gdpArr.length ? gdpArr.at(-1).value : null
    const pmiLast = pmiArr.length ? pmiArr.at(-1).value : null // Philly Fed diffusion index (not 0–100 like ISM)

    const reasoning = buildReasoning(vixLast, spread, tnxLast, hyPctChg, dxyPctChg, score)

    // Confidence: 0.6 base + 0.35 * |score|, capped at 0.92. Stronger |score| → higher confidence.
    const confidence = Math.min(0.92, 0.6 + Math.abs(score) * 0.35)
    // Weight: fixed share of the pipeline (macro’s contribution to the final blend).
    const weight = 0.12

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +confidence.toFixed(2),
      weight,
      reasoning,
      subSignals: [
        { name: 'Yield Curve',   score: +yieldScore.toFixed(2) },
        { name: 'Credit Stress', score: +creditScore.toFixed(2) },
        { name: 'VIX Level',     score: +vixScore.toFixed(2) },
        { name: 'VIX Trend',     score: +vixTrend.toFixed(2) },
        { name: 'Dollar Trend',  score: +dollarScore.toFixed(2) },
      ],
      sparkline,
      rawData: {
        scoreFromLiveData: true, // Score is computed only from FRED; no mock/fallback values
        tnxLast: +tnxLast.toFixed(2),
        cpiYoY: cpiYoY != null ? +(cpiYoY).toFixed(2) : null,
        gdpGrowthQ: gdpGrowthQ != null ? +(gdpGrowthQ).toFixed(2) : null,
        pmi: pmiLast != null ? +(pmiLast).toFixed(1) : null,
        vixLast: +vixLast.toFixed(2),
        yieldSpread: +spread.toFixed(2),
        hySpreadLast: +hyLast.toFixed(1),
        hyPctChg20d: +(hyPctChg * 100).toFixed(2),
        dxyPctChg20d: +(dxyPctChg * 100).toFixed(2),
        isHighVol,
      },
      sources,
      _context: { isHighVol, regimeScore: score, vixLevel: vixLast },
    }
  } catch (err) {
    // No mock fallback: macro layer is FRED-only. Rethrow so caller sees real failure.
    throw err
  }
}

function buildReasoning(vix, spread, tnx, hyPctChg, dxyPctChg, score) {
  const vixStr = vix > 30
    ? `VIX at ${vix.toFixed(0)} signals extreme fear — market in risk-off mode.`
    : vix > 20
    ? `VIX elevated at ${vix.toFixed(0)} indicating caution.`
    : `VIX low at ${vix.toFixed(0)}, market calm and risk appetite healthy.`

  const curveStr = spread < 0
    ? `Inverted yield curve (${spread.toFixed(2)}%) — recession signal active.`
    : `Yield curve spread: ${spread.toFixed(2)}% — ${spread > 1 ? 'healthy steepness supports risk assets.' : 'relatively flat, macro ambiguous.'}`

  const rateStr = `10-Year Treasury at ${tnx.toFixed(2)}%. ${tnx > 5 ? 'High rates pressure growth valuations.' : tnx > 4 ? 'Elevated rates create valuation headwind.' : 'Rate environment relatively supportive.'}`

  const creditStr = hyPctChg > 0.05
    ? `High-yield credit spread widening (${(hyPctChg * 100).toFixed(1)}% over 20d) — credit stress rising, risk-off.`
    : hyPctChg < -0.03
    ? `Credit spread tightening — supportive for risk assets.`
    : `Credit conditions stable.`

  const dollarStr = dxyPctChg > 0.02
    ? `US Dollar strengthening (${(dxyPctChg * 100).toFixed(1)}% over 20d) — tighter financial conditions.`
    : dxyPctChg < -0.02
    ? `US Dollar weakening — looser financial conditions, supportive for risk.`
    : `US Dollar trend neutral.`

  return `${vixStr} ${curveStr} ${rateStr} ${creditStr} ${dollarStr}`
}

module.exports = { analyze }
