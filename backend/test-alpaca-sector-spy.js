// backend/test-alpaca-sector-spy.js
// Test Alpaca daily bars for a sector ETF + SPY to mirror the sector layer inputs.
//
// Usage:
//   node test-alpaca-sector-spy.js XLK
//   node test-alpaca-sector-spy.js XLF

require('dotenv').config()

const { fetchAlpacaDailySdk } = require('./utils/alpacaSdk')

async function main() {
  const etf = (process.argv[2] || 'XLK').toUpperCase()
  const spy = 'SPY'

  console.log(`Testing Alpaca daily bars for sector ETF ${etf} and SPY...\n`)

  const [etfData, spyData] = await Promise.all([
    fetchAlpacaDailySdk(etf, 90),
    fetchAlpacaDailySdk(spy, 90),
  ])

  console.log('Sector ETF candles:', {
    symbol: etf,
    points: etfData?.length || 0,
    sample: etfData ? etfData.slice(-3) : null,
  })

  console.log('\nSPY candles:', {
    symbol: spy,
    points: spyData?.length || 0,
    sample: spyData ? spyData.slice(-3) : null,
  })

  if (etfData && etfData.length >= 21 && spyData && spyData.length >= 21) {
    const etfCloses = etfData.map(c => c.close)
    const spyCloses = spyData.map(c => c.close)
    const etfRet20 = (etfCloses.at(-1) - etfCloses.at(-21)) / etfCloses.at(-21)
    const spyRet20 = (spyCloses.at(-1) - spyCloses.at(-21)) / spyCloses.at(-21)
    const relPerf = etfRet20 - spyRet20

    console.log('\n20-day performance:')
    console.log(`${etf} 20d return: ${(etfRet20 * 100).toFixed(2)}%`)
    console.log(`SPY 20d return: ${(spyRet20 * 100).toFixed(2)}%`)
    console.log(`Relative vs SPY: ${(relPerf * 100).toFixed(2)}%`)
  } else {
    console.log('\nNot enough history for 20-day comparison (need >= 21 candles for both).')
  }
}

main().catch(err => {
  console.error('Alpaca sector/SPY test failed:', err.message || err)
  process.exit(1)
})

