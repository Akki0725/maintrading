// backend/test-price-history-aapl.js
// Quick sanity check for live price history via Alpaca / Alpha Vantage.

require('dotenv').config()

const { fetchPriceHistory } = require('./utils/fetcher')
const sectorLayer = require('./layers/sector')

async function main() {
  const ticker = process.argv[2] || 'AAPL'
  const sectorEtf = 'XLK'

  console.log(`Testing price history for ${ticker}, ${sectorEtf}, and SPY...\n`)

  const [tickerData, etfData, spyData] = await Promise.all([
    fetchPriceHistory(ticker, '3mo', '1d'),
    fetchPriceHistory(sectorEtf, '3mo', '1d'),
    fetchPriceHistory('SPY', '3mo', '1d'),
  ])

  console.log('Ticker candles:', {
    symbol: ticker,
    provider: tickerData?.[0]?.provider || 'unknown',
    points: tickerData?.length || 0,
    sample: tickerData ? tickerData.slice(-3) : null,
  })

  console.log('\nSector ETF candles:', {
    symbol: sectorEtf,
    provider: etfData?.[0]?.provider || 'unknown',
    points: etfData?.length || 0,
    sample: etfData ? etfData.slice(-3) : null,
  })

  console.log('\nSPY candles:', {
    symbol: 'SPY',
    provider: spyData?.[0]?.provider || 'unknown',
    points: spyData?.length || 0,
    sample: spyData ? spyData.slice(-3) : null,
  })

  console.log('\nRunning sector layer analyze() for', ticker, '...\n')
  const sectorResult = await sectorLayer.analyze(ticker)

  console.log('Sector layer sources:', sectorResult.sources)
  console.log('Sector layer rawData:', sectorResult.rawData)
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})

