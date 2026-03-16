// backend/layers/infoCatalyst.js
// Unified Information Catalyst Layer:
// - Uses LLM to extract structured catalysts from Alpha Vantage news
// - Applies exponential half-life decay and novelty weighting
// - Queries vectorised news_memory for historical reaction probabilities

const fs = require('fs')
const path = require('path')

const { clamp, buildSubSignals } = require('../utils/scorer')
const { callStructuredExtractor, createEmbedding, generateLayerReasoning } = require('../utils/llmClient')
const { querySimilarNews } = require('../utils/newsMemory')

const LAYER_ID = 'info_catalyst'

const CATALYST_HALFLIFE_HOURS = {
  EARNINGS_BEAT: 24,
  EARNINGS_MISS: 24,
  EARNINGS_GUIDANCE_UPGRADE: 48,
  EARNINGS_GUIDANCE_DOWNGRADE: 48,
  MACRO_PRINT_INFLATION: 6,
  MACRO_PRINT_JOBS: 6,
  REGULATORY_ACTION: 72,
  MANAGEMENT_CHANGE: 36,
  PRODUCT_LAUNCH: 24,
  OTHER: 24,
}

const DEFAULT_HALFLIFE_HOURS = 24
const MIN_NOVELTY = 0.4

function parseTimePublished(str, fallbackTs) {
  if (!str) return fallbackTs
  try {
    const year = Number(str.slice(0, 4))
    const month = Number(str.slice(4, 6)) - 1
    const day = Number(str.slice(6, 8))
    const hour = Number(str.slice(9, 11) || '0')
    const min = Number(str.slice(11, 13) || '0')
    const sec = Number(str.slice(13, 15) || '0')
    const ms = Date.UTC(year, month, day, hour, min, sec)
    return Number.isNaN(ms) ? fallbackTs : ms / 1000
  } catch {
    return fallbackTs
  }
}

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

  const chosen = filtered.length > 0 ? filtered : feed
  const now = Date.now() / 1000
  return chosen.map(item => ({
    title: item.title,
    summary: item.summary || '',
    time_published: item.time_published,
    providerPublishTime: parseTimePublished(item.time_published, now),
    url: item.url,
  }))
}

function buildExtractorPayload(ticker, articles) {
  return {
    ticker: String(ticker || '').toUpperCase(),
    schema: {
      articles: [
        {
          primary_catalyst: 'EARNINGS_GUIDANCE_DOWNGRADE',
          primary_catalyst_magnitude: 0.8,
          novelty_score: 0.85,
          aspect_sentiment: {
            headline_overall: -0.6,
            revenue_growth: -0.4,
            margins: -0.7,
            management: -0.1,
            regulatory_risk: 0.0,
            macro_backdrop: -0.2,
          },
          implied_volatility_impact: 'HIGH',
          affected_ticker: 'NVDA',
          affected_competitors: ['AMD', 'INTC'],
          llm_summary: 'Short summary of the key catalyst and its implications.',
          half_life_hours: 36,
        },
      ],
      batch_meta: {
        dominant_catalyst: 'EARNINGS_GUIDANCE_DOWNGRADE',
        dominant_direction: -1,
        news_cluster_novelty: 0.82,
      },
    },
    articles: articles.map(a => ({
      title: a.title,
      summary: a.summary,
      time_published: a.time_published,
    })),
    instructions:
      'For each article, fill the fields according to the schema. ' +
      'Use novelty_score near 0 for duplicate or low-information pieces. ' +
      'Use aspect_sentiment values in [-1, 1]. Use null where you are uncertain.',
  }
}

function pickHalfLifeHours(article) {
  const fromModel = Number(article.half_life_hours)
  if (!Number.isNaN(fromModel) && fromModel >= 1 && fromModel <= 168) {
    return fromModel
  }
  const mapped = CATALYST_HALFLIFE_HOURS[article.primary_catalyst]
  if (mapped) return mapped
  return DEFAULT_HALFLIFE_HOURS
}

function computeDecayedScore(nowSec, enrichedArticles) {
  let num = 0
  let den = 0

  for (const art of enrichedArticles) {
    const hoursSince = Math.max(0, (nowSec - art.providerPublishTime) / 3600)
    const halfLife = pickHalfLifeHours(art)
    const decayFactor = Math.pow(0.5, hoursSince / halfLife)

    const novelty = Math.max(0, Math.min(1, art.novelty_score || 0))
    const baseMag = Math.max(0, Math.min(1, art.primary_catalyst_magnitude || 0))
    const headline = typeof art.aspect_sentiment?.headline_overall === 'number'
      ? art.aspect_sentiment.headline_overall
      : 0

    const direction = Math.sign(headline || 0)
    const articleSignal = direction * baseMag * novelty * decayFactor

    num += articleSignal
    den += Math.abs(baseMag * novelty)

    art._decayFactor = decayFactor
    art._hoursSince = hoursSince
  }

  if (den === 0) return 0
  return clamp(num / den)
}

function computeAspectSignals(nowSec, enrichedArticles) {
  const aspects = ['headline_overall', 'revenue_growth', 'margins', 'management', 'regulatory_risk', 'macro_backdrop']
  const scores = {}

  for (const aspect of aspects) {
    let num = 0
    let den = 0
    for (const art of enrichedArticles) {
      const val = typeof art.aspect_sentiment?.[aspect] === 'number'
        ? art.aspect_sentiment[aspect]
        : 0
      if (!val) continue
      const hoursSince = Math.max(0, (nowSec - art.providerPublishTime) / 3600)
      const halfLife = pickHalfLifeHours(art)
      const decayFactor = Math.pow(0.5, hoursSince / halfLife)
      const novelty = Math.max(0, Math.min(1, art.novelty_score || 0))
      const baseMag = Math.max(0, Math.min(1, art.primary_catalyst_magnitude || 0))

      const articleSignal = val * baseMag * novelty * decayFactor
      num += articleSignal
      den += Math.abs(baseMag * novelty)
    }
    if (den === 0) {
      scores[aspect] = 0
    } else {
      scores[aspect] = clamp(num / den)
    }
  }

  return scores
}

async function analyze(ticker, context = {}) {
  const sources = { live: false, llm: false }

  const infoEnabled = process.env.INFO_CATALYST_ENABLED !== 'false'
  if (!infoEnabled) {
    throw new Error('info_catalyst layer disabled via INFO_CATALYST_ENABLED env')
  }

  const news = loadNewsSnapshot(ticker)
  if (!news || news.length === 0) {
    throw new Error('No news data for info_catalyst layer')
  }
  sources.live = true

  const sorted = [...news].sort((a, b) => b.providerPublishTime - a.providerPublishTime)
  const topArticles = sorted.slice(0, 10)

  let llmResult
  try {
    const payload = buildExtractorPayload(ticker, topArticles)
    llmResult = await callStructuredExtractor(payload)
    sources.llm = true
  } catch (err) {
    throw err
  }

  const articlesOut = Array.isArray(llmResult.articles) ? llmResult.articles : []
  const enriched = articlesOut.map((art, idx) => {
    const src = topArticles[idx] || topArticles[0]
    return {
      ...art,
      title: src?.title,
      summary: src?.summary,
      time_published: src?.time_published,
      providerPublishTime: src?.providerPublishTime,
      url: src?.url,
      novelty_score: typeof art.novelty_score === 'number' ? art.novelty_score : 0,
      primary_catalyst_magnitude: typeof art.primary_catalyst_magnitude === 'number'
        ? art.primary_catalyst_magnitude
        : 0,
      aspect_sentiment: art.aspect_sentiment || {},
    }
  })

  const highNovelty = enriched.filter(a => (a.novelty_score || 0) >= MIN_NOVELTY)
  const nowSec = Math.floor(Date.now() / 1000)

  if (highNovelty.length === 0) {
    return {
      id: LAYER_ID,
      score: 0,
      confidence: 0.25,
      weight: 0.2,
      reasoning: `News flow for ${ticker} contains no high-novelty catalysts in the latest batch.`,
      subSignals: [],
      sparkline: Array(16).fill(0),
      rawData: {
        newsCount: news.length,
        highNoveltyCount: 0,
        articles: enriched,
      },
      sources,
      _context: {
        dominantCatalyst: 'NONE',
        catalystStrength: 0,
      },
    }
  }

  const score = computeDecayedScore(nowSec, highNovelty)
  const aspectScores = computeAspectSignals(nowSec, highNovelty)

  const batchMeta = llmResult.batch_meta || {}
  const dominantCatalyst = batchMeta.dominant_catalyst || highNovelty[0]?.primary_catalyst || 'OTHER'

  let histPattern = null
  let histContext = {}
  try {
    if (process.env.NEWS_MEMORY_ENABLED !== 'false') {
      const summaryText =
        batchMeta.llm_summary ||
        highNovelty
          .map(a => a.llm_summary || a.summary || a.title)
          .filter(Boolean)
          .slice(0, 3)
          .join(' ')

      const embedding = await createEmbedding(summaryText)
      const neighbors = querySimilarNews({
        ticker,
        primaryCatalyst: dominantCatalyst,
        embedding,
        limit: 32,
        maxAgeDays: 365 * 5,
      })

      if (neighbors.length > 0) {
        const up = neighbors.filter(n => n.signed_move === 1)
        const down = neighbors.filter(n => n.signed_move === -1)
        const fwd = neighbors.map(n => n.fwd_return)
        const probUp3d = up.length / neighbors.length
        const probDown3d = down.length / neighbors.length
        const expectedReturn3d =
          fwd.reduce((s, v) => s + (v || 0), 0) / neighbors.length

        histPattern = {
          neighbors: neighbors.length,
          probUp3d,
          probDown3d,
          expectedReturn3d,
        }

        histContext = {
          catalystProbUp3d: probUp3d,
          catalystProbDown3d: probDown3d,
          catalystExpectedReturn3d: expectedReturn3d,
        }
      }
    }
  } catch (err) {
    console.error('[info_catalyst] news_memory lookup failed:', err.message)
  }

  const subSignals = buildSubSignals([
    ['Headline Catalyst', score],
    ['Revenue Growth Aspect', aspectScores.revenue_growth || 0],
    ['Margins Aspect', aspectScores.margins || 0],
    ['Management Aspect', aspectScores.management || 0],
    ['Regulatory Risk Aspect', aspectScores.regulatory_risk || 0],
    ['Macro Backdrop Aspect', aspectScores.macro_backdrop || 0],
  ])

  const confidenceBase = Math.min(0.9, 0.5 + Math.abs(score) * 0.4)
  const confidenceBoost = Math.min(0.2, (highNovelty.length - 1) * 0.05)
  const confidence = +(confidenceBase + confidenceBoost).toFixed(2)

  const fallbackReasoning = [
    `${highNovelty.length} high-novelty article(s) identified for ${ticker}, dominant catalyst ${dominantCatalyst}.`,
    score > 0.2 ? 'Decayed catalyst score is positive — news flow skews bullish.'
      : score < -0.2 ? 'Decayed catalyst score is negative — news flow skews bearish.'
      : 'Decayed catalyst score is near neutral — mixed or balanced catalysts.',
    histPattern ? `Historical analogs suggest a ${(histPattern.probUp3d * 100).toFixed(0)}% chance of a positive 3-day move.` : '',
  ].filter(Boolean).join(' ')

  const rawDataPayload = {
    newsCount: news.length,
    highNoveltyCount: highNovelty.length,
    dominantCatalyst,
    headlineList: highNovelty.map(a => a.title || a.llm_summary).filter(Boolean).slice(0, 5),
    articleSummaries: highNovelty.slice(0, 8).map(a => ({
      title: a.title || a.llm_summary || '',
      summary: (a.llm_summary || a.summary || '').slice(0, 280),
      url: a.url,
    })),
    batchMeta,
    articles: enriched,
    aspectScores,
    historicalPattern: histPattern,
    metrics: {
      newsCount: news.length,
      highNoveltyCount: highNovelty.length,
      dominantCatalyst,
      headlineOverall: aspectScores.headline_overall,
      marginsAspect: aspectScores.margins,
      revenueAspect: aspectScores.revenue_growth,
      ...(histPattern
        ? { probUp3d: histPattern.probUp3d, probDown3d: histPattern.probDown3d, expectedReturn3d: histPattern.expectedReturn3d }
        : {}),
    },
  }

  let reasoning = fallbackReasoning
  try {
    const geminiReasoning = await generateLayerReasoning({
      ticker,
      layerId: LAYER_ID,
      score,
      confidence,
      subSignals,
      rawData: rawDataPayload,
    })
    if (geminiReasoning) {
      reasoning = geminiReasoning
      sources.llm = true
    }
  } catch (err) {
    console.error('[info_catalyst] generateLayerReasoning fallback:', err.message)
  }

  return {
    id: LAYER_ID,
    score: +score.toFixed(3),
    confidence,
    weight: 0.2,
    reasoning,
    subSignals,
    sparkline: Array(16)
      .fill(0)
      .map((_, i) => Math.sin(i * 0.4) * 0.3 + score * (i / 15)),
    rawData: rawDataPayload,
    sources,
    _context: {
      dominantCatalyst,
      isEarningsLike: dominantCatalyst.startsWith('EARNINGS'),
      isMacroLike: dominantCatalyst.startsWith('MACRO'),
      isRegulatoryLike: dominantCatalyst.startsWith('REGULATORY'),
      catalystStrength: Math.abs(score),
      ...histContext,
    },
  }
}

module.exports = { analyze }

