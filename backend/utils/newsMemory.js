// backend/utils/newsMemory.js
// Vectorised news memory for catalyst pattern lookup.

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/apex_memory.db')

const dataDir = path.dirname(DB_PATH)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS news_memory (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker         TEXT NOT NULL,
    published_at   INTEGER NOT NULL,
    primary_catalyst TEXT,
    llm_summary    TEXT,
    embedding_json TEXT NOT NULL,
    horizon_days   INTEGER NOT NULL DEFAULT 3,
    fwd_return     REAL NOT NULL,
    signed_move    INTEGER NOT NULL,
    source_url     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_news_mem_ticker_time
    ON news_memory(ticker, published_at);
`)

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const va = a[i] || 0
    const vb = b[i] || 0
    dot += va * vb
    magA += va * va
    magB += vb * vb
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

const stmtInsert = db.prepare(`
  INSERT INTO news_memory
    (ticker, published_at, primary_catalyst, llm_summary, embedding_json, horizon_days, fwd_return, signed_move, source_url)
  VALUES
    (@ticker, @published_at, @primary_catalyst, @llm_summary, @embedding_json, @horizon_days, @fwd_return, @signed_move, @source_url)
`)

const stmtAllForTicker = db.prepare(`
  SELECT * FROM news_memory
  WHERE ticker = @ticker
    AND published_at >= @min_ts
  ORDER BY published_at DESC
`)

function upsertNewsMemoryRow(row) {
  try {
    stmtInsert.run({
      ticker: (row.ticker || '').toUpperCase(),
      published_at: row.publishedAt,
      primary_catalyst: row.primaryCatalyst || null,
      llm_summary: row.llmSummary || null,
      embedding_json: JSON.stringify(row.embedding || []),
      horizon_days: row.horizonDays ?? 3,
      fwd_return: row.fwdReturn,
      signed_move: row.signedMove,
      source_url: row.url || null,
    })
    return { saved: true }
  } catch (err) {
    console.error('[newsMemory] upsert error:', err.message)
    return { saved: false, error: err.message }
  }
}

function querySimilarNews({ ticker, primaryCatalyst = null, embedding, limit = 20, maxAgeDays = 1825 }) {
  if (!Array.isArray(embedding) || embedding.length === 0) return []
  const nowSec = Math.floor(Date.now() / 1000)
  const minTs = nowSec - maxAgeDays * 86400

  const rows = stmtAllForTicker.all({
    ticker: (ticker || '').toUpperCase(),
    min_ts: minTs,
  })

  const results = []
  for (const row of rows) {
    if (primaryCatalyst && row.primary_catalyst && row.primary_catalyst !== primaryCatalyst) {
      continue
    }
    try {
      const vec = JSON.parse(row.embedding_json || '[]')
      const sim = cosineSimilarity(embedding, vec)
      results.push({ ...row, similarity: sim })
    } catch (_) {
      // ignore bad rows
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

module.exports = {
  upsertNewsMemoryRow,
  querySimilarNews,
}

