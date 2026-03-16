// backend/utils/llmClient.js
// Thin wrapper around the Google Gemini API for:
// - Structured JSON extraction from news articles
// - Text embeddings for news memory vector search

const { GoogleGenerativeAI } = require('@google/generative-ai')

// These names are treated as Gemini models.
const MODEL_NAME = process.env.LLM_MODEL_NAME || 'gemini-2.5-flash'
// Default to v1beta-compatible embedding model; env can override.
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL_NAME || 'textembedding-gecko'

let geminiClient = null

function getClient() {
  if (geminiClient) return geminiClient
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or LLM_API_KEY) is required for info_catalyst layer but is not set')
  }
  geminiClient = new GoogleGenerativeAI(apiKey)
  return geminiClient
}

async function callStructuredExtractor(payload) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: MODEL_NAME })

  const prompt =
    'You are a professional equity research analyst. ' +
    'Your only job is to extract structured, machine-readable catalyst features from news articles. ' +
    'You MUST output strictly valid JSON matching the provided schema. ' +
    'No comments, no explanations, no markdown.\n\n' +
    JSON.stringify(payload)

  const result = await model.generateContent(prompt)
  const text = result.response?.text()
  if (!text || typeof text !== 'string') {
    throw new Error('LLM extractor returned no text content')
  }

  // Gemini may wrap JSON in code fences; strip them if present.
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  return JSON.parse(cleaned)
}

async function createEmbedding(text) {
  const client = getClient()
  const trimmed = (text || '').trim()
  if (!trimmed) return []

  const embModel = client.getGenerativeModel({ model: EMBEDDING_MODEL_NAME })
  const result = await embModel.embedContent(trimmed)
  const vector = result.embedding?.values
  if (!Array.isArray(vector)) {
    throw new Error('Embedding API returned invalid vector')
  }
  return vector
}

// Rate limit: max reasoning calls per process (avoid runaway in one pipeline run)
const MAX_REASONING_CALLS_PER_RUN = 6
let _reasoningCallCount = 0

function resetReasoningCallCount() {
  _reasoningCallCount = 0
}

/**
 * Generate 2-4 sentence layer reasoning for the Layer Analysis UI.
 * @param {{ ticker: string, layerId: string, score: number, confidence?: number, subSignals: Array<{name,score}>, rawData: object }} opts
 * @returns {Promise<string|null>} Paragraph of plain text, or null on error (caller should use fallback).
 */
async function generateLayerReasoning(opts) {
  if (_reasoningCallCount >= MAX_REASONING_CALLS_PER_RUN) return null
  const { ticker, layerId, score, confidence = 0.5, subSignals = [], rawData = {} } = opts

  let client
  try {
    client = getClient()
  } catch {
    return null
  }

  _reasoningCallCount += 1

  const headlines = rawData.headlineList || rawData.topHeadlines || []
  const newsItems = rawData.newsItems || []
  const eventArticles = rawData.eventArticles || []
  const articles = rawData.articles || []
  const articleSummaries = rawData.articleSummaries || []
  const primaryEvent = rawData.primaryEvent || rawData.dominantCatalyst
  const recent24h = rawData.recent24h
  const newsCount = rawData.newsCount
  const avgSentiment = rawData.avgSentiment
  const highNoveltyCount = rawData.highNoveltyCount
  const aspectScores = rawData.aspectScores || {}
  const histPattern = rawData.historicalPattern

  const topTitles = headlines.length
    ? headlines.slice(0, 5)
    : [...newsItems, ...eventArticles, ...articles]
        .map(a => (a && (a.title || a.llm_summary || a.summary)) || '')
        .filter(Boolean)
        .slice(0, 5)

  const hasContent = Array.isArray(articleSummaries) && articleSummaries.length > 0
  const articlesBlock = hasContent
    ? articleSummaries
        .slice(0, 8)
        .map((a, i) => `[Article ${i + 1}] Title: ${(a.title || '').slice(0, 120)}\nSummary: ${(a.summary || '').slice(0, 260)}`)
        .join('\n\n')
    : ''

  const prompt = hasContent
    ? 'You are an equity research analyst. Below are recent news articles (title and summary) for this stock. ' +
      'Write one short paragraph (4-6 sentences) that summarizes the actual content: what happened, what the key details are, and what it means for the stock. ' +
      'Be specific and reference concrete facts from the articles. No generic phrases like "mixed or neutral tone." No markdown, no bullet points.\n\n' +
      `Ticker: ${ticker}\nLayer: ${layerId}\nScore: ${score}\n` +
      (primaryEvent ? `Primary event/catalyst: ${primaryEvent}\n` : '') +
      (typeof newsCount === 'number' ? `Number of articles: ${newsCount}\n` : '') +
      (typeof recent24h === 'number' ? `Articles in last 24h: ${recent24h}\n` : '') +
      (typeof avgSentiment === 'number' ? `Average sentiment score: ${avgSentiment.toFixed(2)}\n` : '') +
      (Object.keys(aspectScores).length ? `Aspect scores: ${JSON.stringify(aspectScores)}\n` : '') +
      (histPattern ? `Historical 3d prob up: ${(histPattern.probUp3d * 100).toFixed(0)}%\n` : '') +
      '\n--- Articles ---\n' +
      articlesBlock
    : 'You are a concise equity research analyst. In 2-4 short sentences, explain what this signal layer is seeing for this stock right now. ' +
      'Use only the data below. No markdown, no bullet points, plain prose. Be specific about headlines or catalysts when provided.\n\n' +
      `Ticker: ${ticker}\nLayer: ${layerId}\nScore: ${score}\nConfidence: ${confidence}\n` +
      (primaryEvent ? `Primary event/catalyst: ${primaryEvent}\n` : '') +
      (typeof newsCount === 'number' ? `News count: ${newsCount}\n` : '') +
      (typeof recent24h === 'number' ? `Articles in last 24h: ${recent24h}\n` : '') +
      (typeof avgSentiment === 'number' ? `Avg sentiment: ${avgSentiment.toFixed(2)}\n` : '') +
      (typeof highNoveltyCount === 'number' ? `High-novelty articles: ${highNoveltyCount}\n` : '') +
      (Object.keys(aspectScores).length ? `Aspect scores: ${JSON.stringify(aspectScores)}\n` : '') +
      (histPattern ? `Historical 3d prob up: ${(histPattern.probUp3d * 100).toFixed(0)}%\n` : '') +
      (topTitles.length ? `Top headlines: ${topTitles.map(t => (t || '').slice(0, 80)).join(' | ')}\n` : '')

  try {
    const model = client.getGenerativeModel({ model: MODEL_NAME })
    const result = await model.generateContent(prompt)
    const text = result.response?.text()
    if (!text || typeof text !== 'string') return null
    return text.trim().replace(/\n+/g, ' ').slice(0, 1200)
  } catch (err) {
    console.error('[llmClient] generateLayerReasoning failed:', err.message)
    return null
  }
}

module.exports = {
  callStructuredExtractor,
  createEmbedding,
  generateLayerReasoning,
  resetReasoningCallCount,
}


