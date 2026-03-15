// backend/test-alpaca-momentum.js
// Sanity check for momentum-style metrics using Alpaca daily bars.
//
// Usage:
//   node test-alpaca-momentum.js XLK
//   node test-alpaca-momentum.js AAPL

require('dotenv').config()

const { fetchAlpacaDailySdk } = require('./utils/alpacaSdk')

async function main() {
  const ticker = (process.argv[2] || 'XLK').toUpperCase()
  console.log(`Testing Alpaca daily bars + momentum-style returns for ${ticker}...\n`)

  const candles = await fetchAlpacaDailySdk(ticker, 90)

  if (!candles || candles.length === 0) {
    console.log('No candles returned from Alpaca for', ticker)
    process.exit(1)
  }

  console.log(`Got ${candles.length} candles (oldest -> newest).`)
  console.log('Last 3 candles:')
  console.table(candles.slice(-3))

  // Simple momentum-style metrics similar to sector layer:
  if (candles.length >= 21) {
    const closes = candles.map(c => c.close)
    const last = closes[closes.length - 1]
    const d20 = closes[closes.length - 21]
    const d5 = closes[closes.length - 6]

    const ret20 = (last - d20) / d20
    const ret5 = (last - d5) / d5

    console.log('\nMomentum-style returns:')
    console.log(`20-day return: ${(ret20 * 100).toFixed(2)}%`)
    console.log(` 5-day return: ${(ret5 * 100).toFixed(2)}%`)
  } else {
    console.log('\nNot enough history for 20-day / 5-day momentum (need >= 21 candles).')
  }
}

main().catch(err => {
  console.error('Alpaca momentum test failed:', err.message || err)
  process.exit(1)
})

