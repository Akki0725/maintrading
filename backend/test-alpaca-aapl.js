// Test script for Alpaca Market Data API using the official JS SDK.
// Mirrors the usage pattern from the Alpaca docs snippet you shared.

require('dotenv').config()

const Alpaca = require('@alpacahq/alpaca-trade-api')

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_API_SECRET_KEY,
  paper: true, // set to false if you're using live keys
})

async function main() {
  try {
    // Options object shaped like the docs example (start/end + timeframe).
    // You can adjust the dates to any recent window you care about.
    let options = {
      start: '2022-09-01',
      end: '2022-09-07',
      timeframe: alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY),
    }

    // For equities, use the stock bars endpoint (AAPL instead of BTC/USD).
    // The exact method name varies slightly between SDK versions; this
    // mirrors the "getCryptoBars" style from the docs.
    const bars = await alpaca.getBarsV2('AAPL', options)

    // getBarsV2 returns an async iterator; collect into an array for display.
    const rows = []
    for await (const bar of bars) {
      rows.push(bar)
    }

    if (rows.length === 0) {
      console.log('No AAPL bar data returned from Alpaca.')
      process.exit(1)
    }

    console.table(rows)
    const last = rows[rows.length - 1]
    console.log('Most recent close for AAPL in this window:', last.Close || last.c || last.close)
    process.exit(0)
  } catch (err) {
    const status = err?.response?.status
    console.error('Error calling Alpaca SDK for AAPL bars.')
    console.error('Status:', status)
    console.error('Message:', err?.message || err)
    if (err?.response?.data) {
      console.error('Body:', err.response.data)
    }
    if (err?.response?.headers?.['x-request-id']) {
      console.error('X-Request-ID:', err.response.headers['x-request-id'])
    }
    process.exit(1)
  }
}

main()

