import { useState, useEffect } from 'react'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { STOCKS, LAYERS, generateLayerSignals, generatePrediction } from '../data/mockData'

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#111120', border: '1px solid #2a2a4a', borderRadius: '4px', padding: '8px 12px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: '#7070a0', marginBottom: '4px' }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: p.color }}>
            {p.name}: {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
          </div>
        ))}
      </div>
    )
  }
  return null
}

function LayerDetailPanel({ layer }) {
  const [expanded, setExpanded] = useState(false)
  const scoreColor = layer.score > 0.1 ? '#00ff88' : layer.score < -0.1 ? '#ff3355' : '#ffcc00'
  const direction = layer.score > 0.15 ? 'BULLISH' : layer.score < -0.15 ? 'BEARISH' : 'NEUTRAL'
  
  return (
    <div
      style={{
        background: '#0d0d16', border: `1px solid ${expanded ? '#2a2a4a' : '#1e1e35'}`,
        borderRadius: '4px', overflow: 'hidden', transition: 'border-color 0.2s',
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: layer.color, borderRadius: '2px', flexShrink: 0 }} />
        
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', display: 'block', marginBottom: '2px' }}>
                LAYER {LAYERS.findIndex(l => l.id === layer.id) + 1} — {layer.shortName}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '13px', color: '#e8e8f0' }}>{layer.name}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '20px', fontWeight: 600, color: scoreColor }}>
                {layer.score > 0 ? '+' : ''}{layer.score.toFixed(3)}
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '2px' }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', padding: '1px 6px', borderRadius: '2px', background: `${scoreColor}20`, color: scoreColor }}>{direction}</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060' }}>CONF {(layer.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
          
          {/* Sub-signal bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {layer.subSignals.map((sub, i) => {
              const sc = sub.score > 0.1 ? '#00ff88' : sub.score < -0.1 ? '#ff3355' : '#ffcc00'
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#7070a0' }}>{sub.name}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: sc }}>{sub.score > 0 ? '+' : ''}{sub.score.toFixed(2)}</span>
                  </div>
                  <div style={{ height: '3px', background: '#1e1e35', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', height: '100%', width: `${Math.abs(sub.score) * 50}%`, background: sc, left: sub.score > 0 ? '50%' : `${50 - Math.abs(sub.score) * 50}%` }} />
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#2a2a4a' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        
        <div style={{ color: '#404060', fontSize: '12px', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</div>
      </div>
      
      {/* Expanded reasoning */}
      {expanded && (
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #1e1e35', background: '#111120' }}>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', marginBottom: '8px' }}>AI REASONING</div>
          <p style={{ fontSize: '12px', color: '#a0a0c0', lineHeight: '1.7' }}>{layer.reasoning}</p>
          
          <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div style={{ background: '#0d0d16', padding: '10px', borderRadius: '3px', border: '1px solid #1e1e35' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', marginBottom: '4px' }}>RAW SCORE</div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '16px', color: scoreColor }}>{layer.score > 0 ? '+' : ''}{layer.score.toFixed(3)}</div>
            </div>
            <div style={{ background: '#0d0d16', padding: '10px', borderRadius: '3px', border: '1px solid #1e1e35' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', marginBottom: '4px' }}>WEIGHT</div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '16px', color: '#e8e8f0' }}>{(layer.weight * 100).toFixed(1)}%</div>
            </div>
            <div style={{ background: '#0d0d16', padding: '10px', borderRadius: '3px', border: '1px solid #1e1e35' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', marginBottom: '4px' }}>CONFIDENCE</div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '16px', color: '#e8e8f0' }}>{(layer.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
          
          <div style={{ marginTop: '10px', padding: '8px 10px', background: '#0d0d16', borderRadius: '3px', border: `1px solid ${layer.color}30` }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: layer.color }}>{layer.shortName} CONTRIBUTION: </span>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#7070a0' }}>
              {((layer.score * layer.weight) * 100).toFixed(2)} weighted signal points → {direction} pressure on final prediction
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Analysis({ selectedStock, setSelectedStock }) {
  const [signals, setSignals] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [compareStock, setCompareStock] = useState(null)
  const [compareSignals, setCompareSignals] = useState([])

  useEffect(() => {
    const s = generateLayerSignals(selectedStock)
    setSignals(s)
    setPrediction(generatePrediction(s))
  }, [selectedStock])

  useEffect(() => {
    if (compareStock) {
      setCompareSignals(generateLayerSignals(compareStock))
    } else {
      setCompareSignals([])
    }
  }, [compareStock])

  const radarData = signals.map(s => ({
    layer: s.shortName,
    score: Math.abs(s.score),
    value: (s.score + 1) / 2,
  }))

  const barData = signals.map((s, i) => ({
    name: s.shortName,
    score: s.score,
    color: s.color,
    compareScore: compareSignals[i]?.score,
  }))

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.15em', marginBottom: '4px' }}>LAYER ANALYSIS SYSTEM</div>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '20px', color: '#e8e8f0' }}>Multi-Factor Signal Breakdown</div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: '#404060' }}>SYMBOL:</span>
          <select
            value={selectedStock}
            onChange={e => setSelectedStock(e.target.value)}
            style={{ background: '#0d0d16', border: '1px solid #1e1e35', color: '#e8e8f0', fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '6px 10px', borderRadius: '3px', cursor: 'pointer' }}
          >
            {STOCKS.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
          </select>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: '#404060' }}>COMPARE:</span>
          <select
            value={compareStock || ''}
            onChange={e => setCompareStock(e.target.value || null)}
            style={{ background: '#0d0d16', border: '1px solid #1e1e35', color: compareStock ? '#e8e8f0' : '#404060', fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '6px 10px', borderRadius: '3px', cursor: 'pointer' }}
          >
            <option value="">None</option>
            {STOCKS.filter(s => s.symbol !== selectedStock).map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '16px' }}>
        {/* Left: layer list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {signals.map(layer => (
            <LayerDetailPanel key={layer.id} layer={layer} />
          ))}
        </div>

        {/* Right: charts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Summary box */}
          {prediction && (
            <div style={{ background: '#0d0d16', border: '1px solid #1e1e35', borderRadius: '4px', padding: '16px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', marginBottom: '12px' }}>PREDICTION SUMMARY — {selectedStock}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  { label: 'DIRECTION', value: prediction.direction, color: prediction.direction === 'BULLISH' ? '#00ff88' : prediction.direction === 'BEARISH' ? '#ff3355' : '#ffcc00' },
                  { label: 'PROBABILITY', value: `${(prediction.probability * 100).toFixed(1)}%`, color: '#e8e8f0' },
                  { label: 'TARGET MOVE', value: `${prediction.targetMove > 0 ? '+' : ''}${prediction.targetMove}%`, color: prediction.targetMove > 0 ? '#00ff88' : '#ff3355' },
                  { label: 'CONFIDENCE', value: `${(prediction.confidence * 100).toFixed(0)}%`, color: '#4466ff' },
                ].map(item => (
                  <div key={item.label} style={{ background: '#111120', padding: '10px', borderRadius: '3px', border: '1px solid #1e1e35' }}>
                    <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', marginBottom: '4px' }}>{item.label}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '18px', fontWeight: 600, color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signal comparison bar chart */}
          <div style={{ background: '#0d0d16', border: '1px solid #1e1e35', borderRadius: '4px', padding: '16px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', marginBottom: '12px' }}>
              LAYER SCORES {compareStock ? `— ${selectedStock} vs ${compareStock}` : `— ${selectedStock}`}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e35" horizontal={false} />
                <XAxis type="number" domain={[-1, 1]} tick={{ fill: '#404060', fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={{ stroke: '#1e1e35' }} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#7070a0', fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="score" name={selectedStock} radius={[0, 2, 2, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.score > 0 ? '#00ff88' : '#ff3355'} fillOpacity={0.8} />
                  ))}
                </Bar>
                {compareStock && (
                  <Bar dataKey="compareScore" name={compareStock} radius={[0, 2, 2, 0]} fillOpacity={0.4}>
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.compareScore > 0 ? '#00d4ff' : '#ff8855'} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Radar chart */}
          <div style={{ background: '#0d0d16', border: '1px solid #1e1e35', borderRadius: '4px', padding: '16px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', marginBottom: '12px' }}>SIGNAL STRENGTH RADAR</div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="#1e1e35" />
                <PolarAngleAxis dataKey="layer" tick={{ fill: '#7070a0', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />
                <Radar name={selectedStock} dataKey="value" stroke="#4466ff" fill="#4466ff" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Layer descriptions */}
          <div style={{ background: '#0d0d16', border: '1px solid #1e1e35', borderRadius: '4px', padding: '16px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: '#404060', letterSpacing: '0.1em', marginBottom: '12px' }}>LAYER METHODOLOGY</div>
            {LAYERS.map(layer => (
              <div key={layer.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: layer.color, marginTop: '5px', flexShrink: 0 }} />
                <div>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: layer.color }}>{layer.shortName} </span>
                  <span style={{ fontSize: '10px', color: '#7070a0' }}>{layer.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
