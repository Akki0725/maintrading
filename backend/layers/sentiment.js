// backend/layers/sentiment.js
// Stage 1B — News-driven sentiment view of the same Alpha Vantage snapshot used by the event layer.
//
// Pipeline:
// 1) test-alpha-news-sentiment.js writes Alpha Vantage NEWS_SENTIMENT to backend/alpha-news-output.json
// 2) This layer reads that snapshot, filters by ticker, and computes an average sentiment score.

const fs = require('fs')
const path = require('path')

const { scoreText, clamp } = require('../utils/scorer')

const LAYER_ID = 'sentiment'

function loadNewsSnapshot(ticker) {
  const file = path.join(__dirname, '..', 'alpha-news-output.json')
  const raw = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const feed = Array.isArray(data.feed) ? data.feed : []

  const upper = String(ticker || '').toUpperCase()
  const filtered = feed.filter(item => {
    const ts = item.ticker_sentiment
    if (!Array.isArray(ts) || !upper) return true
    return ts.some(t => String(t.ticker || '').toUpperCase() === upper)
  })

  return filtered.length > 0 ? filtered : feed
}

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  const newsFeed = loadNewsSnapshot(ticker)
  if (!newsFeed || newsFeed.length === 0) {
    throw new Error('No news data for sentiment layer')
  }
  sources.live = true

  const scored = newsFeed.map(item => {
    const base =
      typeof item.overall_sentiment_score === 'number'
        ? item.overall_sentiment_score
        : scoreText(`${item.title || ''} ${item.summary || ''}`.toLowerCase())

    return {
      title: item.title,
      summary: item.summary || '',
      overall: base,
      time_published: item.time_published,
      source: item.source,
      url: item.url,
    }
  })

  const avgSentiment =
    scored.reduce((s, a) => s + a.overall, 0) / (scored.length || 1)

  const score = clamp(avgSentiment)

  const newsItems = scored.slice(0, 20)

  const reasoning =
    `${scored.length} Alpha Vantage news articles loaded for ${ticker}. ` +
    `Average news sentiment score is ${avgSentiment.toFixed(2)}, indicating a ` +
    (score > 0.25
      ? 'broadly bullish tone.'
      : score < -0.25
      ? 'broadly bearish tone.'
      : 'mixed or neutral tone.')

  return {
    id: LAYER_ID,
    score: +score.toFixed(3),
    confidence: +Math.min(0.9, 0.4 + Math.abs(score) * 0.4).toFixed(2),
    weight: 0.11,
    reasoning,
    subSignals: [{ name: 'News Sentiment', score: +score.toFixed(2) }],
    sparkline: Array(16)
      .fill(0)
      .map((_, i) => Math.sin(i * 0.5) * 0.2 + score * (i / 15)),
    rawData: {
      newsCount: scored.length,
      avgSentiment: +avgSentiment.toFixed(3),
      newsItems,
    },
    sources,
    _context: { sentimentScore: score },
  }
}

module.exports = { analyze }