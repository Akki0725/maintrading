// backend/utils/fetcher.js
// Resilient HTTP client with timeout, retry, and rate-limit protection

const axios = require('axios')

const TIMEOUT = parseInt(process.env.FETCH_TIMEOUT || '6000')

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
}

const REDDIT_HEADERS = {
  'User-Agent': 'APEX-Research-Bot/1.0 (research tool; not commercial)',
  'Accept': 'application/json',
}

/**
 * Fetch with timeout — returns null on any error
 */
async function safeFetch(url, options = {}) {
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT,
      headers: options.headers || YF_HEADERS,
      ...options,
    })
    return res.data
  } catch (err) {
    const status = err?.response?.status
    const label  = options._label || url.slice(0, 60)
    if (status === 429) console.warn(`[fetcher] Rate limited: ${label}`)
    else if (status === 404) console.warn(`[fetcher] Not found: ${label}`)
    else console.warn(`[fetcher] Failed (${status || err.code}): ${label}`)
    return null
  }
}

/**
 * Alpaca equities bars (daily) — returns OHLCV array or null
 * Requires ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY and ALPACA_DATA_BASE_URL.
 */
async function fetchAlpacaDaily(ticker, range = '3mo') {
  const keyId    = process.env.ALPACA_API_KEY_ID
  const secret   = process.env.ALPACA_API_SECRET_KEY
  const baseUrl  = process.env.ALPACA_DATA_BASE_URL || 'https://data.alpaca.markets'

  if (!keyId || !secret) return null

  const url = `${baseUrl.replace(/\/+$/, '')}/v2/stocks/${encodeURIComponent(ticker)}/bars`

  // Map our range hint to a bar count. Alpaca max is 10000; keep this modest.
  const limitMap = { '1mo': 30, '3mo': 90, '6mo': 180 }
  const limit = limitMap[range] || 90

  const params = new URLSearchParams({
    timeframe: '1Day',
    limit: String(limit),
    adjustment: 'split',
  })

  const data = await safeFetch(`${url}?${params.toString()}`, {
    _label: `Alpaca daily ${ticker}`,
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
      Accept: 'application/json',
    },
  })

  const bars = data?.bars || data?.[ticker] || []
  if (!Array.isArray(bars) || bars.length === 0) return null

  return bars.map(b => {
    // Alpaca v2 uses ISO8601 in b.t, prices in b.o/h/l/c, volume in b.v
    const dateStr = typeof b.t === 'string' ? b.t.split('T')[0] : null
    return {
      date: dateStr,
      close: b.c,
      high: b.h,
      low: b.l,
      volume: b.v,
    }
  }).filter(c => c.date && c.close != null)
}

/**
 * Alpha Vantage daily time series — returns OHLCV array or null
 * Uses ALPHA_VANTAGE_KEY when available, otherwise callers should
 * fall back to other providers.
 */
async function fetchAVDaily(ticker, range = '3mo') {
  const key = process.env.ALPHA_VANTAGE_KEY
  if (!key || key === 'your_alpha_vantage_key_here') return null

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${key}&outputsize=compact`

  const data = await safeFetch(url, { _label: `AV daily ${ticker}` })
  const series = data && (data['Time Series (Daily)'] || data['Time Series Daily'])
  if (!series) return null

  // Alpha Vantage returns an object keyed by ISO date (YYYY-MM-DD)
  const dates = Object.keys(series).sort() // oldest → newest
  let candles = dates.map(d => {
    const row = series[d]
    const close = parseFloat(row['4. close'] || row['4. Close'])
    const high = parseFloat(row['2. high'] || row['2. High'])
    const low = parseFloat(row['3. low'] || row['3. Low'])
    const volume = parseFloat(row['6. volume'] || row['6. Volume'] || row['5. volume'])

    return {
      date: d,
      close: isFinite(close) ? close : null,
      high: isFinite(high) ? high : null,
      low: isFinite(low) ? low : null,
      volume: isFinite(volume) ? volume : 0,
    }
  }).filter(c => c.close != null)

  // Rough range trimming based on requested window
  const daysMap = { '1mo': 30, '3mo': 90, '6mo': 180 }
  const keep = daysMap[range] || 90
  if (candles.length > keep) {
    candles = candles.slice(-keep)
  }

  return candles
}

/**
 * Yahoo Finance chart data — returns OHLCV array or null
 */
async function fetchYFChart(ticker, range = '3mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`
  const data = await safeFetch(url, { _label: `YF chart ${ticker}` })
  if (!data?.chart?.result?.[0]) return null

  const result  = data.chart.result[0]
  const ts      = result.timestamp || []
  const quote   = result.indicators?.quote?.[0] || {}
  const closes  = quote.close || []
  const volumes = quote.volume || []
  const highs   = quote.high || []
  const lows    = quote.low || []

  return ts.map((t, i) => ({
    date:   new Date(t * 1000).toISOString().split('T')[0],
    close:  closes[i],
    high:   highs[i],
    low:    lows[i],
    volume: volumes[i],
  })).filter(d => d.close != null)
}

/**
 * Unified price history helper — prefers Alpaca daily for regular equities,
 * then Alpha Vantage daily, and finally Yahoo Finance as a catch‑all.
 */
async function fetchPriceHistory(ticker, range = '3mo', interval = '1d') {
  const isDaily = interval === '1d'
  const isEquityLike = /^[A-Z.\-]{1,8}$/.test(ticker) // rough filter to avoid indices/futures

  if (isDaily && isEquityLike) {
    // 1) Try Alpaca (best quality for stocks/ETFs)
    try {
      const alpacaCandles = await fetchAlpacaDaily(ticker, range)
      if (alpacaCandles && alpacaCandles.length > 0) return alpacaCandles
    } catch (_) {
      // fall through to other providers
    }
  }

  if (isDaily) {
    // 2) Try Alpha Vantage next
    try {
      const avCandles = await fetchAVDaily(ticker, range)
      if (avCandles && avCandles.length > 0) return avCandles
    } catch (_) {
      // fall through
    }
  }

  // 3) Fallback: Yahoo Finance (supports indices, futures, etc.)
  return fetchYFChart(ticker, range, interval)
}

/**
 * Yahoo Finance quote summary — returns modules object or null
 * modules: financialData, defaultKeyStatistics, earnings, earningsTrend,
 *          recommendationTrend, price, summaryDetail
 */
async function fetchYFSummary(ticker, modules = 'financialData,defaultKeyStatistics,earnings,earningsTrend,recommendationTrend,price') {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`
  const data = await safeFetch(url, { _label: `YF summary ${ticker}` })
  return data?.quoteSummary?.result?.[0] || null
}

/**
 * Yahoo Finance news search
 */
async function fetchYFNews(ticker, count = 20) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${count}&enableFuzzyQuery=false&quotesCount=0`
  const data = await safeFetch(url, { _label: `YF news ${ticker}` })
  return data?.news || []
}

/**
 * Yahoo Finance options chain
 */
async function fetchYFOptions(ticker) {
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`
  const data = await safeFetch(url, { _label: `YF options ${ticker}` })
  return data?.optionChain?.result?.[0] || null
}

/**
 * Reddit search — returns array of posts
 */
async function fetchReddit(query, subreddit = 'wallstreetbets', sort = 'new', time = 'week') {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}&limit=25&restrict_sr=1`
  const data = await safeFetch(url, { headers: REDDIT_HEADERS, _label: `Reddit ${subreddit} ${query}` })
  return data?.data?.children?.map(c => c.data) || []
}

/**
 * FRED API — returns latest observations or null
 */
async function fetchFRED(seriesId) {
  const key = process.env.FRED_API_KEY
  if (!key || key === 'your_fred_key_here') return null
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=10`
  const data = await safeFetch(url, { _label: `FRED ${seriesId}` })
  return data?.observations || null
}

module.exports = {
  safeFetch,
  fetchYFChart,
  fetchPriceHistory,
  fetchYFSummary,
  fetchYFNews,
  fetchYFSummary,
  fetchYFOptions,
  fetchReddit,
  fetchFRED,
}
