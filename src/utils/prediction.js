/**
 * Aggregate signals into a single prediction (used when signals come from API).
 */
export function generatePrediction(signals) {
  if (!signals || signals.length === 0) {
    return {
      score: 0,
      probability: 0.5,
      confidence: 0,
      direction: 'NEUTRAL',
      targetMove: 0,
      horizon: '5 days',
      topDrivers: [],
    }
  }
  const totalWeight = signals.reduce((s, l) => s + (l.weight ?? 0.11), 0)
  const weightedScore = totalWeight > 0
    ? signals.reduce((s, l) => s + (l.score ?? 0) * (l.weight ?? 0.11), 0) / totalWeight
    : 0
  const confidence = totalWeight > 0
    ? signals.reduce((s, l) => s + (l.confidence ?? 0.5) * (l.weight ?? 0.11), 0) / totalWeight
    : 0
  const probability = 0.5 + weightedScore * 0.45
  return {
    score: +weightedScore.toFixed(3),
    probability: +probability.toFixed(3),
    confidence: +confidence.toFixed(2),
    direction: weightedScore > 0.05 ? 'BULLISH' : weightedScore < -0.05 ? 'BEARISH' : 'NEUTRAL',
    targetMove: +(weightedScore * 8).toFixed(1),
    horizon: '5 days',
    topDrivers: signals
      .sort((a, b) => Math.abs((b.score ?? 0) * (b.weight ?? 0.11)) - Math.abs((a.score ?? 0) * (a.weight ?? 0.11)))
      .slice(0, 3)
      .map(l => ({ name: l.name, score: l.score ?? 0, weight: l.weight ?? 0.11 })),
  }
}
