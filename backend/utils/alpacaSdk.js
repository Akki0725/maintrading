// Lightweight Alpaca SDK wrapper used by the /api/price route.
// Mirrors the working test scripts so the app and tests share the same path.

require('dotenv').config()

const Alpaca = require('@alpacahq/alpaca-trade-api')

let _client = null

function getClient() {
  if (_client) return _client
  const keyId = process.env.ALPACA_API_KEY_ID
  const secretKey = process.env.ALPACA_API_SECRET_KEY
  if (!keyId || !secretKey) return null
  _client = new Alpaca({
    keyId,
    secretKey,
    paper: true, // assume paper by default; can be toggled via env later if needed
  })
  return _client
}

/**
 * Fetch recent daily bars for an equity using the Alpaca SDK.
 * Returns array of { date, close, high, low, volume } sorted oldest → newest.
 */
async function fetchAlpacaDailySdk(ticker, days = 180) {
  const client = getClient()
  if (!client) return null

  // Rough 6‑month window; Alpaca will trim by market days.
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - days - 5) // a bit of cushion for weekends/holidays

  const options = {
    start: start.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
    timeframe: client.newTimeframe(1, client.timeframeUnit.DAY),
    feed: 'iex', // avoid SIP restriction for free / IEX-only subscriptions
  }

  const iter = await client.getBarsV2(ticker, options)
  const rows = []
  for await (const bar of iter) {
    const ts = bar.Timestamp || bar.t
    const dateStr = typeof ts === 'string' ? ts.split('T')[0] : null
    if (!dateStr) continue
    const close = bar.ClosePrice ?? bar.c ?? bar.close
    const high  = bar.HighPrice  ?? bar.h ?? bar.high
    const low   = bar.LowPrice   ?? bar.l ?? bar.low
    const vol   = bar.Volume     ?? bar.v ?? bar.volume ?? 0
    if (close == null) continue
    rows.push({
      date: dateStr,
      close,
      high,
      low,
      volume: vol,
    })
  }

  if (rows.length === 0) return null

  // getBarsV2 already yields oldest → newest, but sort defensively.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return rows
}

/**
 * Fetch the latest bar only — returns { price, bar } or null.
 */
async function fetchAlpacaLatestPrice(ticker) {
  const client = getClient()
  if (!client) return null
  const bar = await client.getLatestBar(ticker)
  if (!bar) return null
  const price = bar.ClosePrice ?? bar.c ?? bar.close
  return {
    price,
    bar,
  }
}

module.exports = {
  fetchAlpacaDailySdk,
  fetchAlpacaLatestPrice,
}

