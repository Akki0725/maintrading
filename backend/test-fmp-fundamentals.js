// Test script for FMP fundamental endpoints used by fundamental.js
// Usage:
//   node backend/test-fmp-fundamentals.js
//   node backend/test-fmp-fundamentals.js AAPL

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const { fetchFMPEarnings, fetchFMPKeyMetrics } = require('./utils/fetcher')

function isConfiguredKey(value) {
  return Boolean(value && value !== 'your_fmp_key_here')
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a'
  const n = Number(value)
  const ratio = Math.abs(n) > 1 ? n / 100 : n
  return `${(ratio * 100).toFixed(2)}%`
}

async function main() {
  const [, , tickerArg] = process.argv
  const ticker = (tickerArg || 'AAPL').toUpperCase()
  const key = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY

  if (!isConfiguredKey(key)) {
    console.error('FMP key not configured.')
    console.error('Set FMP_API_KEY in backend/.env, then re-run this script.')
    process.exit(1)
  }

  console.log(`Testing FMP fundamental APIs for ${ticker}...`)

  const [earnings, metrics] = await Promise.all([
    fetchFMPEarnings(ticker, 5),
    fetchFMPKeyMetrics(ticker, 5),
  ])

  if (!Array.isArray(earnings) || earnings.length === 0) {
    console.error('Earnings API test FAILED: empty or invalid response.')
    process.exit(1)
  }
  if (!Array.isArray(metrics) || metrics.length === 0) {
    console.error('Key Metrics API test FAILED: empty or invalid response.')
    process.exit(1)
  }

  const latestEarn = earnings
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
  const latestMetric = metrics
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]

  console.log('Earnings API test PASSED')
  console.log(`- records: ${earnings.length}`)
  console.log(`- latest date: ${latestEarn?.date || 'n/a'}`)
  console.log(`- EPS actual/estimate: ${latestEarn?.epsActual ?? 'n/a'} / ${latestEarn?.epsEstimated ?? 'n/a'}`)
  console.log(`- revenue actual/estimate: ${latestEarn?.revenueActual ?? 'n/a'} / ${latestEarn?.revenueEstimated ?? 'n/a'}`)

  console.log('\nKey Metrics API test PASSED')
  console.log(`- records: ${metrics.length}`)
  console.log(`- latest date: ${latestMetric?.date || 'n/a'}`)
  console.log(`- PE ratio: ${latestMetric?.peRatio ?? 'n/a'}`)
  console.log(`- PEG ratio: ${latestMetric?.pegRatio ?? 'n/a'}`)
  console.log(`- operating margin: ${fmtPct(latestMetric?.operatingMarginRatio)}`)
  console.log(`- ROE: ${fmtPct(latestMetric?.returnOnEquity)}`)

  console.log('\nOverall: FMP fundamental APIs are working.')
}

main().catch(err => {
  console.error('FMP API test FAILED with exception:')
  console.error(err?.message || err)
  process.exit(1)
})
