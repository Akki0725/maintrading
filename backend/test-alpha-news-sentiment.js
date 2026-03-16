// Test script for Alpha Vantage Market News & Sentiment (NEWS_SENTIMENT).
// Usage:
//   node backend/test-alpha-news-sentiment.js                # defaults to AAPL, latest news
//   node backend/test-alpha-news-sentiment.js AAPL           # explicit ticker
//   node backend/test-alpha-news-sentiment.js AAPL technology,ipo 20240101T0000
//
// This mirrors the docs example you shared but:
// - pulls the API key from backend/.env (ALPHA_VANTAGE_KEY)
// - pretty-prints a summary of the returned articles
// - writes ALL articles to a JSON file for easier inspection

const https = require('https')
const { URL } = require('url')
const fs = require('fs')
const path = require('path')

// Load env specifically from backend/.env so it works when run from repo root.
require('dotenv').config({ path: path.join(__dirname, '.env') })

const API_BASE = 'https://www.alphavantage.co/query'

function buildNewsUrl({ tickers, topics, timeFrom, sort, limit }) {
  const url = new URL(API_BASE)
  url.searchParams.set('function', 'NEWS_SENTIMENT')

  if (tickers) url.searchParams.set('tickers', tickers)
  if (topics) url.searchParams.set('topics', topics)
  if (timeFrom) url.searchParams.set('time_from', timeFrom)
  if (sort) url.searchParams.set('sort', sort)
  if (limit) url.searchParams.set('limit', String(limit))

  const key = process.env.ALPHA_VANTAGE_KEY || 'demo'
  if (!process.env.ALPHA_VANTAGE_KEY) {
    console.warn('Warning: ALPHA_VANTAGE_KEY not found in .env, falling back to demo key (highly rate limited).')
  }
  url.searchParams.set('apikey', key)

  return url.toString()
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'apex-backend-test-alpha-vantage',
            Accept: 'application/json',
          },
        },
        res => {
          let data = ''

          res.on('data', chunk => {
            data += chunk
          })

          res.on('end', () => {
            if (res.statusCode !== 200) {
              return reject(
                new Error(`HTTP ${res.statusCode} from Alpha Vantage. Body: ${data.slice(0, 500)}...`)
              )
            }

            try {
              const json = JSON.parse(data)
              resolve(json)
            } catch (err) {
              reject(new Error(`Failed to parse JSON from Alpha Vantage: ${err.message}`))
            }
          })
        }
      )
      .on('error', err => {
        reject(err)
      })
  })
}

async function main() {
  try {
    const [, , tickerArg, topicsArg, timeFromArg] = process.argv

    const tickers = tickerArg || 'AAPL'
    const topics = topicsArg || '' // e.g. "technology" or "technology,ipo"
    const timeFrom = timeFromArg || '' // e.g. "20220410T0130"

    const url = buildNewsUrl({
      tickers,
      topics: topics || undefined,
      timeFrom: timeFrom || undefined,
      sort: 'LATEST',
      limit: 50,
    })

    console.log('Calling Alpha Vantage NEWS_SENTIMENT with URL:')
    console.log(url.replace(process.env.ALPHA_VANTAGE_KEY || 'demo', '***REDACTED***'))

    const data = await fetchJson(url)

    if (data?.Information || data?.Note || data?.['Error Message']) {
      console.error('Alpha Vantage returned a message instead of news data:')
      console.error(JSON.stringify(data, null, 2))
      process.exit(1)
    }

    const feed = data?.feed || []
    console.log(`\nReceived ${feed.length} news item(s) for tickers: ${tickers}`)

    if (feed.length === 0) {
      console.log('No news articles returned. Try adjusting tickers/time range/topics.')
      process.exit(0)
    }

    // Write all raw data (including the full feed) to a JSON file for inspection.
    const outFile = path.join(__dirname, 'alpha-news-output.json')
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8')
    console.log(`\nWrote full response (ALL articles) to: ${outFile}`)

    // Still show a concise table in the terminal so you get a quick feel.
    const summary = feed.map(item => ({
      title: (item.title || '').slice(0, 80),
      time_published: item.time_published,
      overall_sentiment: item.overall_sentiment_score,
      source: item.source,
    }))

    console.log('\nAll articles (truncated titles):')
    console.table(summary)

    console.log('\nFull JSON keys returned from API root object:')
    console.log(Object.keys(data))

    process.exit(0)
  } catch (err) {
    console.error('Error calling Alpha Vantage NEWS_SENTIMENT.')
    console.error(err.message || err)
    process.exit(1)
  }
}

main()

