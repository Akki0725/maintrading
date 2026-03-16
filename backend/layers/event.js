// backend/layers/event.js
// Stage 1A — Catalyst Detection: event-focused view of Alpha Vantage news snapshot

const fs = require('fs')
const path = require('path')

const { scoreText, clamp } = require('../utils/scorer')
const { generateLayerReasoning } = require('../utils/llmClient')

const LAYER_ID = 'event'

// Event type classification keywords
const EVENT_PATTERNS = {
  EARNINGS:     ['earnings', 'eps', 'revenue', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'guidance', 'beat', 'miss'],
  GEOPOLITICAL: ['war', 'conflict', 'sanctions', 'military', 'geopolit', 'invasion', 'tension', 'middle east', 'china', 'russia', 'ukraine'],
  REGULATORY:   ['fda', 'sec', 'ftc', 'doj', 'antitrust', 'regulation', 'fine', 'lawsuit', 'investigation', 'probe', 'compliance'],
  PRODUCT:      ['launch', 'product', 'announced', 'unveiled', 'release', 'partnership', 'deal', 'contract', 'acquisition', 'merger'],
  MACRO:        ['fed', 'federal reserve', 'interest rate', 'cpi', 'inflation', 'gdp', 'jobs report', 'payroll', 'unemployment'],
  MANAGEMENT:   ['ceo', 'cfo', 'executive', 'resigned', 'appointed', 'leadership', 'departure'],
}

// Event type → magnitude multiplier (how much should it move the market?)
const EVENT_MAGNITUDE = {
  EARNINGS: 0.9, GEOPOLITICAL: 0.7, REGULATORY: 0.8,
  PRODUCT: 0.5, MACRO: 0.6, MANAGEMENT: 0.5, NONE: 0.2,
}

function parseTimePublished(str, fallbackTs) {
  if (!str) return fallbackTs
  // Alpha Vantage format: YYYYMMDDTHHMMSS (or HHMM)
  try {
    const year = Number(str.slice(0, 4))
    const month = Number(str.slice(4, 6)) - 1
    const day = Number(str.slice(6, 8))
    const hour = Number(str.slice(9, 11) || '0')
    const min = Number(str.slice(11, 13) || '0')
    const sec = Number(str.slice(13, 15) || '0')
    const ms = Date.UTC(year, month, day, hour, min, sec)
    return isNaN(ms) ? fallbackTs : ms / 1000
  } catch {
    return fallbackTs
  }
}

function loadNewsSnapshot(ticker) {
  const file = path.join(__dirname, '..', 'alpha-news-output.json')
  const raw = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const feed = Array.isArray(data.feed) ? data.feed : []

  // Filter to items actually tagged with this ticker when possible
  const upper = String(ticker || '').toUpperCase()
  const filtered = feed.filter(item => {
    const ts = item.ticker_sentiment
    if (!Array.isArray(ts) || !upper) return true
    return ts.some(t => String(t.ticker || '').toUpperCase() === upper)
  })

  const now = Date.now() / 1000
  return (filtered.length > 0 ? filtered : feed).map(item => ({
    title: item.title,
    summary: item.summary || '',
    providerPublishTime: parseTimePublished(item.time_published, now),
    url: item.url,
  }))
}

async function analyze(ticker, context = {}) {
  const sources = { live: false, llm: false }

  try {
    const news = loadNewsSnapshot(ticker)
    if (!news || news.length === 0) throw new Error('No news data')
    sources.live = true

    const now = Date.now() / 1000  // Unix ts
    const cutoff24h = now - 86400
    const cutoff7d  = now - 604800

    // ── Score each article ────────────────────────────────────
    const scored = news.map(article => {
      const text      = `${article.title || ''} ${article.summary || ''}`.toLowerCase()
      const ts        = article.providerPublishTime || now
      const ageSecs   = now - ts
      const recency   = ageSecs < 3600 ? 1.0 : ageSecs < 86400 ? 0.8 : ageSecs < 604800 ? 0.5 : 0.2
      const sentiment = scoreText(text)
      const eventType = classifyEvent(text)
      const magnitude = EVENT_MAGNITUDE[eventType] || 0.2

      return { title: article.title, summary: article.summary || '', url: article.url, sentiment, recency, eventType, magnitude, ts }
    })

    // ── Recency-weighted average sentiment ───────────────────
    const totalWeight = scored.reduce((s, a) => s + a.recency * a.magnitude, 0)
    const weightedSent = totalWeight > 0
      ? scored.reduce((s, a) => s + a.sentiment * a.recency * a.magnitude, 0) / totalWeight
      : 0

    // ── Count significant events ──────────────────────────────
    const recent24h  = scored.filter(a => now - a.ts < 86400)
    const eventTypes = [...new Set(scored.slice(0, 10).map(a => a.eventType).filter(t => t !== 'NONE'))]
    const primaryEvent = eventTypes[0] || 'NONE'

    // Articles that were actually classified as specific events
    const eventArticles = scored.filter(a => a.eventType !== 'NONE')

    // ── Volume signal: lots of news = catalyst is brewing ─────
    const newsVolumeScore = clamp(news.length / 20 - 0.4)  // >8 articles = positive catalyst signal

    // ── Context influence: if geopolitical, boost macro signal ─
    const isGeopol = eventTypes.includes('GEOPOLITICAL')
    const isEarnings = eventTypes.includes('EARNINGS')

    const score = clamp(weightedSent * 0.65 + newsVolumeScore * 0.20 + (isEarnings ? 0.10 : 0) + (isGeopol ? -0.05 : 0))

    const topHeadlines = scored.slice(0, 5).map(a => a.title).filter(Boolean)
    const confidence = +Math.min(0.88, 0.45 + (recent24h.length / 8) * 0.4).toFixed(2)

    const magVal = EVENT_MAGNITUDE[primaryEvent] || 0.2
    const eventMagnitudeLabel = magVal >= 0.7 ? 'HIGH' : magVal >= 0.4 ? 'MEDIUM' : 'LOW'
    const marketImpact = score > 0.2 ? 'POSITIVE' : score < -0.2 ? 'NEGATIVE' : 'NEUTRAL'

    const eventArticlesForRaw = eventArticles.slice(0, 10).map(a => ({
      title: a.title,
      summary: a.summary,
      eventType: a.eventType,
      sentiment: +a.sentiment.toFixed(3),
      ts: a.ts,
      url: a.url,
    }))
    const rawData = {
      newsCount: news.length,
      recent24h: recent24h.length,
      primaryEvent,
      eventTypes,
      topHeadlines,
      headlineList: topHeadlines,
      eventArticles: eventArticlesForRaw,
      articleSummaries: news.slice(0, 10).map(a => ({ title: a.title || '', summary: (a.summary || '').slice(0, 280), url: a.url })),
      metrics: {
        newsCount: news.length,
        recent24h: recent24h.length,
        primaryEvent,
        eventTypes,
        eventMagnitudeLabel,
        marketImpact,
      },
    }

    let reasoning = buildReasoning(ticker, news.length, recent24h.length, primaryEvent, eventTypes, score, topHeadlines)
    try {
      const geminiReasoning = await generateLayerReasoning({
        ticker,
        layerId: LAYER_ID,
        score,
        confidence,
        subSignals: [
          { name: 'News Sentiment Avg', score: +clamp(weightedSent).toFixed(2) },
          { name: 'News Volume', score: +newsVolumeScore.toFixed(2) },
          { name: 'Recency Boost', score: +(recent24h.length > 2 ? 0.3 : 0).toFixed(2) },
          { name: 'Event Magnitude', score: +(EVENT_MAGNITUDE[primaryEvent] * Math.sign(score)).toFixed(2) },
        ],
        rawData,
      })
      if (geminiReasoning) {
        reasoning = geminiReasoning
        sources.llm = true
      }
    } catch (err) {
      console.error('[event] generateLayerReasoning fallback:', err.message)
    }

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence,
      weight: 0.10,
      reasoning,
      subSignals: [
        { name: 'News Sentiment Avg',  score: +clamp(weightedSent).toFixed(2) },
        { name: 'News Volume',         score: +newsVolumeScore.toFixed(2) },
        { name: 'Recency Boost',       score: +(recent24h.length > 2 ? 0.3 : 0).toFixed(2) },
        { name: 'Event Magnitude',     score: +(EVENT_MAGNITUDE[primaryEvent] * Math.sign(score)).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.sin(i * 0.4) * 0.3 + score * (i / 15)),
      rawData,
      sources,
      _context: {
        eventType: primaryEvent,
        isGeopolitical: isGeopol,
        isEarnings,
        catalystStrength: Math.abs(score),
        boostCommodity: isGeopol,
        boostMacro: isGeopol || eventTypes.includes('MACRO'),
      },
    }
  } catch (err) {
    // Surface the error so the caller knows the snapshot is missing/invalid.
    throw err
  }
}

function classifyEvent(text) {
  for (const [type, keywords] of Object.entries(EVENT_PATTERNS)) {
    if (keywords.some(k => text.includes(k))) return type
  }
  return 'NONE'
}

function buildReasoning(ticker, total, recent, primary, types, score, headlines) {
  const recencyStr = recent > 0 ? `${recent} article${recent > 1 ? 's' : ''} in the last 24 hours.` : 'No breaking news in the last 24 hours.'
  const typeStr    = types.length > 0 ? `Event classification: ${types.join(', ')}.` : 'No dominant event type identified.'
  const headStr    = headlines.length > 0 ? `Recent headline: "${headlines[0]}".` : ''
  const sentStr    = score > 0.3 ? 'News tone is broadly positive — catalyst appears favorable.'
                   : score < -0.3 ? 'News tone is negative — potential headwinds from current events.'
                   : 'Mixed or neutral news environment.'
  return `${total} news articles found for ${ticker}. ${recencyStr} ${typeStr} ${headStr} ${sentStr}`
}

module.exports = { analyze }
