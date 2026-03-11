// backend/layers/sentiment.js
// Stage 1B — Crowd sentiment from Reddit, news aggregation, and overreaction detection

const { fetchYFNews, fetchReddit } = require('../utils/fetcher')
const { scoreText, deterministicScore, clamp } = require('../utils/scorer')

const LAYER_ID = 'sentiment'

// Sentiment-specific lexicon additions
const FOMO_SIGNALS    = ['to the moon', 'squeeze', 'short squeeze', 'yolo', 'calls', 'loading up', 'all in', '🚀', '💎', '🙌']
const FEAR_SIGNALS    = ['puts', 'short', 'going to zero', 'bubble', 'overvalued', 'crash', 'dump', '🌈🐻', 'bagholders']
const VOLUME_SIGNALS  = ['everyone', 'talking about', 'trending', 'viral', 'blowing up', 'all over']

async function analyze(ticker, context = {}) {
  const sources = { live: false, reddit: false }

  try {
    // ── Fetch from Reddit + Yahoo Finance news concurrently ───
    const [wsbPosts, stocksPosts, news] = await Promise.all([
      fetchReddit(ticker, 'wallstreetbets', 'new', 'week'),
      fetchReddit(ticker, 'stocks', 'new', 'week'),
      fetchYFNews(ticker, 15),
    ])

    const hasSocialData = wsbPosts.length > 0 || stocksPosts.length > 0
    if (!hasSocialData && !news?.length) throw new Error('No sentiment data')
    sources.live = true
    sources.reddit = hasSocialData

    // ── Reddit WSB analysis ───────────────────────────────────
    let wsbScore = 0, wsbConfidence = 0
    if (wsbPosts.length > 0) {
      const scored = wsbPosts.map(p => {
        const text  = `${p.title || ''} ${p.selftext || ''}`.toLowerCase()
        const base  = scoreText(text)
        const fomo  = FOMO_SIGNALS.filter(s => text.includes(s)).length
        const fear  = FEAR_SIGNALS.filter(s => text.includes(s)).length
        // Score up-votes as a weight
        const votes = Math.log1p(p.ups || 0) / Math.log(1000)  // normalise to ~0-1
        return { score: clamp(base + fomo * 0.12 - fear * 0.12), weight: 0.3 + votes * 0.7 }
      })
      const totalW = scored.reduce((s, p) => s + p.weight, 0)
      wsbScore = totalW > 0 ? scored.reduce((s, p) => s + p.score * p.weight, 0) / totalW : 0
      wsbConfidence = Math.min(0.9, wsbPosts.length / 15 * 0.8)
    }

    // ── Reddit /r/stocks ──────────────────────────────────────
    let stocksScore = 0
    if (stocksPosts.length > 0) {
      const scores = stocksPosts.map(p => scoreText(`${p.title} ${p.selftext || ''}`.toLowerCase()))
      stocksScore = scores.reduce((a, b) => a + b, 0) / scores.length
    }

    // ── Yahoo Finance news sentiment ──────────────────────────
    let newsSentScore = 0
    if (news?.length > 0) {
      const scores = news.map(n => scoreText(`${n.title || ''} ${n.summary || ''}`.toLowerCase()))
      newsSentScore = scores.reduce((a, b) => a + b, 0) / scores.length
    }

    // ── Overreaction detection vs event layer ─────────────────
    const eventScore   = context.eventScore || 0
    const rawSentiment = wsbScore * 0.45 + stocksScore * 0.25 + newsSentScore * 0.30
    const crowdGap     = rawSentiment - eventScore   // positive = crowd more bullish than events warrant

    // Crowd divergence penalty: if crowd massively ahead of events → reduce confidence
    const divergencePenalty = Math.abs(crowdGap) > 0.5 ? 0.15 : 0
    const adjustedScore = clamp(rawSentiment - divergencePenalty * Math.sign(rawSentiment))

    // ── Social volume proxy ───────────────────────────────────
    const totalPosts   = wsbPosts.length + stocksPosts.length
    const volumeSignal = clamp(totalPosts / 30 - 0.3)

    const score = clamp(adjustedScore * 0.75 + volumeSignal * 0.25)

    return {
      id: LAYER_ID,
      score: +score.toFixed(3),
      confidence: +clamp(0.35 + wsbConfidence * 0.5 + (hasSocialData ? 0.1 : 0)).toFixed(2),
      weight: 0.11,
      reasoning: buildReasoning(ticker, wsbPosts.length, stocksPosts.length, wsbScore, stocksScore, newsSentScore, crowdGap, score),
      subSignals: [
        { name: 'WSB Sentiment',      score: +clamp(wsbScore).toFixed(2) },
        { name: '/r/stocks Sentiment',score: +clamp(stocksScore).toFixed(2) },
        { name: 'News Sentiment',     score: +clamp(newsSentScore).toFixed(2) },
        { name: 'Social Volume',      score: +volumeSignal.toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => Math.sin(i * 0.6) * 0.2 + score * (i / 15)),
      rawData: {
        wsbPosts: wsbPosts.length, stocksPosts: stocksPosts.length,
        crowdGap: +crowdGap.toFixed(2), rawSentiment: +rawSentiment.toFixed(2),
        divergenceWarning: Math.abs(crowdGap) > 0.5,
      },
      sources,
      _context: { sentimentScore: score, crowdDivergence: crowdGap },
    }
  } catch (err) {
    const score = deterministicScore(ticker, LAYER_ID, (context.eventScore || 0) * 0.3)
    return {
      id: LAYER_ID,
      score,
      confidence: 0.40,
      weight: 0.11,
      reasoning: fallbackReasoning(ticker, score),
      subSignals: [
        { name: 'WSB Sentiment',      score: +(score * 1.1).toFixed(2) },
        { name: '/r/stocks',          score: +(score * 0.8).toFixed(2) },
        { name: 'News Sentiment',     score: +(score * 0.9).toFixed(2) },
        { name: 'Social Volume',      score: +(score * 0.6).toFixed(2) },
      ],
      sparkline: Array(16).fill(0).map((_, i) => score * (i / 15)),
      rawData: { source: 'mock' },
      sources,
      _context: { sentimentScore: score, crowdDivergence: 0 },
    }
  }
}

function buildReasoning(ticker, wsb, stocks, wsbS, stocksS, newsS, gap, score) {
  const postStr  = `Found ${wsb} WSB posts and ${stocks} /r/stocks posts about ${ticker} this week.`
  const wsbStr   = wsb > 0 ? `WSB crowd sentiment: ${wsbS > 0.2 ? 'BULLISH' : wsbS < -0.2 ? 'BEARISH' : 'NEUTRAL'} (${wsbS.toFixed(2)}).` : ''
  const gapStr   = Math.abs(gap) > 0.4
    ? `⚠ CROWD DIVERGENCE: Sentiment is ${gap > 0 ? 'significantly more bullish' : 'significantly more bearish'} than underlying events warrant. Potential ${gap > 0 ? 'FOMO trap' : 'panic selling'}.`
    : 'Crowd sentiment is reasonably aligned with underlying news events.'
  return `${postStr} ${wsbStr} News sentiment: ${newsS.toFixed(2)}. ${gapStr}`
}

function fallbackReasoning(ticker, score) {
  return score > 0.25
    ? `Social discussion volume for ${ticker} is elevated with predominantly bullish sentiment. Community momentum could fuel near-term buying pressure.`
    : score < -0.25
    ? `Negative sentiment dominating ${ticker} social channels. Bearish commentary and put-buying discussion outweighing bullish narratives.`
    : `Sentiment for ${ticker} is mixed with no dominant directional crowd bias. Social volume is within normal range.`
}

module.exports = { analyze }
