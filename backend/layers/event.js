// backend/layers/event.js
// Stage 1A — Catalyst Detection: scrape live news, classify event type

const { fetchYFNews } = require('../utils/fetcher')
const { scoreText, deterministicScore, clamp } = require('../utils/scorer')

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

async function analyze(ticker, context = {}) {
  const sources = { live: false }

  try {
    const news = await fetchYFNews(ticker, 25)
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

      return { title: article.title, sentiment, recency, eventType, magnitude, ts }
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

    // ── Volume signal: lots of news = catalyst is brewing ─────
    const newsVolumeScore = clamp(news.length / 20 - 0.4)  // >8 articles = positive catalyst signal

    // ── Context influence: if geopolitical, boost macro signal ─
    const isGeopol = eventTypes.includes('GEOPOLITICAL')
    const isEarnings = eventTypes.includes('EARNINGS')

    const score = clamp(weightedSent * 0.65 + newsVolumeScore * 0.20 + (isEarnings ? 0.10 : 0) + (isGeopol ? -0.05 : 0))

    const topHeadlines = scored.slice(0, 5).map(a => a.title).filter(Boolean)

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +Math.min(0.88, 0.45 + (recent24h.length / 8) * 0.4).toFixed(2),
      weight: 0.10,
      reasoning: buildReasoning(ticker, news.length, recent24h.length, primaryEvent, eventTypes, score, topHeadlines),
      subSignals: [
        { name: 'News Sentiment Avg',  score: +clamp(weightedSent).toFixed(2) },
        { name: 'News Volume',         score: +newsVolumeScore.toFixed(2) },
        { name: 'Recency Boost',       score: +(recent24h.length > 2 ? 0.3 : 0).toFixed(2) },
        { name: 'Event Magnitude',     score: +(EVENT_MAGNITUDE[primaryEvent] * Math.sign(score)).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.sin(i * 0.4) * 0.3 + score * (i / 15)),
      rawData: { newsCount: news.length, recent24h: recent24h.length, primaryEvent, eventTypes, topHeadlines },
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
    const score = deterministicScore(ticker, LAYER_ID, (context.regimeScore || 0) * 0.2)
    return {
      id: LAYER_ID,
      score,
      confidence: 0.42,
      weight: 0.10,
      reasoning: fallbackReasoning(ticker, score),
      subSignals: [
        { name: 'News Sentiment',   score: +score.toFixed(2) },
        { name: 'News Volume',      score: +(score * 0.7).toFixed(2) },
        { name: 'Recency',          score: +(score * 0.5).toFixed(2) },
        { name: 'Event Magnitude',  score: +(score * 0.8).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { eventType: 'UNKNOWN', isGeopolitical: false, isEarnings: false, catalystStrength: 0, boostCommodity: false, boostMacro: false },
    }
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

function fallbackReasoning(ticker, score) {
  return score > 0.2
    ? `Positive catalyst activity detected around ${ticker}. Recent news flow suggests bullish developments that could act as a near-term price driver.`
    : score < -0.2
    ? `Negative event signals around ${ticker}. News flow indicates potential headwinds. Market may have not yet fully priced this in.`
    : `No dominant catalyst identified for ${ticker}. News flow is routine with no unusual event classification detected.`
}

module.exports = { analyze }
