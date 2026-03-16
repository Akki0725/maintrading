// Simple manual test harness for the Information Catalyst Layer
// Usage:
//   node backend/test-info-catalyst.js AAPL

const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const { analyze } = require('./layers/infoCatalyst')

async function main() {
  const ticker = (process.argv[2] || 'AAPL').toUpperCase()
  try {
    const result = await analyze(ticker, {})
    console.log(`info_catalyst result for ${ticker}:`)
    console.log(JSON.stringify({
      id: result.id,
      score: result.score,
      confidence: result.confidence,
      weight: result.weight,
      reasoning: result.reasoning,
      rawDataSummary: {
        newsCount: result.rawData?.newsCount,
        highNoveltyCount: result.rawData?.highNoveltyCount,
        dominantCatalyst: result.rawData?.dominantCatalyst,
        aspectScores: result.rawData?.aspectScores,
        historicalPattern: result.rawData?.historicalPattern,
      },
      sources: result.sources,
      context: result._context,
    }, null, 2))
  } catch (err) {
    console.error('info_catalyst analyze error:', err.message)
    process.exit(1)
  }
}

main()

