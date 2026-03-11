import { useState } from 'react'
import { sparklinePath } from '../../utils/convergenceLogic'

const LAYER_META = {
  macro:       { shortName: 'MACRO', color: '#ff55aa', label: 'Macroeconomic', icon: '🌐',
                 rawKeys: ['Interest Rates', 'CPI YoY', 'GDP Growth', 'PMI Index', 'Recession Prob'] },
  sector:      { shortName: 'SECT',  color: '#8855ff', label: 'Sector & Industry', icon: '🏭',
                 rawKeys: ['Sector ETF 1M', 'Peer Rel Strength', 'Industry Rotation', 'Breadth %'] },
  event:       { shortName: 'EVENT', color: '#ffcc00', label: 'Event Detection', icon: '⚠️',
                 rawKeys: ['Event Type', 'Event Magnitude', 'Days to Catalyst', 'Market Impact'] },
  sentiment:   { shortName: 'SENT',  color: '#ff6644', label: 'News Sentiment', icon: '📰',
                 rawKeys: ['News Score', 'Social Volume', 'Earnings Call Tone', 'Analyst Sentiment'] },
  fundamental: { shortName: 'FUND',  color: '#4466ff', label: 'Fundamentals', icon: '📊',
                 rawKeys: ['EPS Beat%', 'Revenue Beat%', 'Guidance Delta', 'FWD P/E', 'Analyst Upgrades'] },
  commodity:   { shortName: 'CMDTY', color: '#ffaa00', label: 'Supply Chain', icon: '⛽',
                 rawKeys: ['Input Cost Trend', 'Supply Chain Health', 'Commodity Correlation', 'Margin Impact'] },
  historical:  { shortName: 'HIST',  color: '#00ff88', label: 'Historical Analog', icon: '📈',
                 rawKeys: ['Best Analog Match', 'Analog Confidence', 'Avg 5D Return', 'Win Rate', 'Analog Count'] },
  momentum:    { shortName: 'MOMT',  color: '#00d4ff', label: 'Price Momentum', icon: '⚡',
                 rawKeys: ['RSI (14)', 'MACD Signal', 'Price vs 20d MA', 'Volume Trend', 'ATR%'] },
  options:     { shortName: 'OPTN',  color: '#55ffcc', label: 'Options Flow', icon: '🎯',
                 rawKeys: ['Put/Call Ratio', 'IV Rank', 'Unusual Activity', 'Skew (25δ)', 'GEX Level'] },
}

function Sparkline({ data, color, width = 100, height = 32 }) {
  if (!data || data.length < 2) return null
  const path = sparklinePath(data, width, height)
  const lastX = width
  const lastY = height - ((data[data.length - 1] + 1) / 2) * height
  return (
    <svg width={width} height={height}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} opacity={0.7} />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  )
}

function SubSignalRow({ sub }) {
  const c = sub.score > 0.1 ? '#00ff88' : sub.score < -0.1 ? '#ff3355' : '#ffcc00'
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#7070a0' }}>{sub.name}</span>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: c }}>{sub.score >= 0 ? '+' : ''}{sub.score.toFixed(2)}</span>
      </div>
      <div style={{ height: 3, background: '#1a1a2e', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', height: '100%', width: `${Math.abs(sub.score) * 50}%`, background: c, left: sub.score > 0 ? '50%' : `${50 - Math.abs(sub.score) * 50}%` }} />
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#2a2a4a' }} />
      </div>
    </div>
  )
}

function RawDataRow({ label, value, score }) {
  const c = score > 0 ? '#00ff88' : '#ff3355'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #0e0e1a' }}>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#7070a0' }}>{label}</span>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: c }}>{value}</span>
    </div>
  )
}

// Generate mock "raw data" values deterministically
function generateRawValues(layerId, score) {
  const seed = layerId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const rng = (i) => { const x = Math.sin(seed + i * 7.3) * 10000; return x - Math.floor(x) }
  const rawKeyMap = {
    macro:       [['2.83%', 1], ['5.2% YoY', score], ['2.1%', score], ['51.4', score], [`${(15 + rng(0)*25).toFixed(0)}%`, -score]],
    sector:      [[`${(score*4).toFixed(1)}%`, score], [`${(score*1.5+rng(1)*10-5).toFixed(1)}%`, score], [score > 0 ? 'INTO' : 'OUT', score], [`${(45+score*25+rng(2)*15).toFixed(0)}%`, score]],
    event:       [['EARNINGS', score], [score > 0.3 ? 'HIGH' : 'MEDIUM', score], [`${(5+rng(3)*10).toFixed(0)}d`, 0], [score > 0 ? 'POSITIVE' : 'NEGATIVE', score]],
    sentiment:   [[`${(score*0.5+0.5).toFixed(2)}`, score], [`${(1+rng(4)*4).toFixed(1)}x avg`, score], [score > 0 ? 'POSITIVE' : 'CAUTIOUS', score], [score > 0.2 ? 'UPGRADE' : 'NEUTRAL', score]],
    fundamental: [[`${(score*15+rng(5)*5).toFixed(1)}%`, score], [`${(score*8+rng(6)*3).toFixed(1)}%`, score], [score > 0 ? 'RAISED' : 'LOWERED', score], [`${(18+score*5+rng(7)*3).toFixed(1)}x`, score], [`${Math.round(3+score*5+rng(8)*3)}`, score]],
    commodity:   [[score > 0 ? 'DECLINING' : 'RISING', score], [score > 0 ? 'STRONG' : 'DISRUPTED', score], [`${(score*0.7+rng(9)*0.3).toFixed(2)}`, score], [score > 0 ? 'EXPAND' : 'COMPRESS', score]],
    historical:  [['2021-04-12', score > 0], [`${(60+score*25+rng(10)*10).toFixed(0)}%`, score], [`${(score*8+rng(11)*3).toFixed(1)}%`, score], [`${Math.round(50+score*35)}%`, score], [`${3+Math.round(rng(12)*4)}`, score > 0]],
    momentum:    [[`${(50+score*20+rng(13)*10).toFixed(0)}`, score], [score > 0 ? 'BULLISH' : 'BEARISH', score], [`${(score*4+rng(14)*2).toFixed(1)}%`, score], [score > 0 ? 'INCREASING' : 'DECLINING', score], [`${(1.5+rng(15)*1.5).toFixed(2)}%`, 0]],
    options:     [[`${(0.8+rng(16)*0.8).toFixed(2)}`, -score], [`${Math.round(20+rng(17)*60)}%ile`, 0], [Math.abs(score) > 0.5 ? 'DETECTED' : 'NORMAL', score], [`${(score*0.3+rng(18)*0.2).toFixed(2)}`, score], [score > 0 ? 'LONG GAMMA' : 'SHORT GAMMA', score]],
  }
  return rawKeyMap[layerId] || []
}

export default function DrilldownSidebar({
  node, signals, onClose, onSimulate, simulatedOverrides
}) {
  const [rawExpanded, setRawExpanded] = useState(false)
  const [simMode, setSimMode] = useState(false)

  if (!node) return null

  const layerId = node.data?.signal?.id || node.id
  const meta = LAYER_META[layerId]
  if (!meta) return null  // Stage or thesis nodes use a simpler view

  const signal = signals.find(s => s.id === layerId)
  const score  = node.data?.score ?? signal?.score ?? 0
  const isSimulated = simulatedOverrides?.[layerId] !== undefined
  const simValue = simulatedOverrides?.[layerId] ?? score
  const scoreColor = score > 0.12 ? '#00ff88' : score < -0.12 ? '#ff3355' : '#ffcc00'
  const rawValues = generateRawValues(layerId, score)

  const handleSimChange = (val) => {
    onSimulate(layerId, +val)
  }
  const clearSim = () => {
    onSimulate(layerId, undefined)
  }

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: 320,
      background: '#09090f',
      borderLeft: `1px solid ${meta.color}30`,
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
      animation: 'slideInRight 0.22s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #1e1e35',
        background: 'linear-gradient(135deg, #0d0d1a, #0a0a14)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: meta.color, letterSpacing: '0.12em', marginBottom: 3 }}>
              {meta.icon} {meta.shortName} — LAYER ANALYSIS
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 14, fontWeight: 600, color: '#e8e8f0' }}>{meta.label}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid #1e1e35', color: '#7070a0', cursor: 'pointer', fontSize: 14, width: 26, height: 26, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Score + sparkline */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 28, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
              {score >= 0 ? '+' : ''}{score.toFixed(3)}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#404060', marginTop: 2 }}>
              {isSimulated ? '⚙ SIMULATED VALUE' : 'CURRENT SCORE'}
            </div>
          </div>
          <Sparkline data={node.data?.sparkline} color={meta.color} />
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ── REASONING (always visible) ────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#404060', letterSpacing: '0.1em', marginBottom: 8 }}>
            LAYER REASONING
          </div>
          <div style={{ background: '#0c0c18', border: '1px solid #1e1e35', borderRadius: 4, padding: '10px 12px' }}>
            <p style={{ fontSize: 11, color: '#a0a0c0', lineHeight: 1.7, margin: 0 }}>
              {signal?.reasoning || 'No reasoning data available.'}
            </p>
          </div>
        </div>

        {/* ── Sub-signals ──────────────────────────────────────── */}
        {signal?.subSignals && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#404060', letterSpacing: '0.1em', marginBottom: 8 }}>
              SUB-SIGNALS
            </div>
            {signal.subSignals.map((sub, i) => <SubSignalRow key={i} sub={sub} />)}
          </div>
        )}

        {/* ── RAW DATA (expandable) ────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setRawExpanded(!rawExpanded)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#0c0c18', border: '1px solid #1e1e35', borderRadius: 4, padding: '8px 12px',
              cursor: 'pointer', marginBottom: rawExpanded ? 0 : 0,
            }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#7070a0', letterSpacing: '0.1em' }}>
              RAW DATA
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: meta.color }}>
              {rawExpanded ? '▲ COLLAPSE' : '▼ EXPAND'}
            </span>
          </button>

          {rawExpanded && (
            <div style={{ background: '#0c0c18', border: '1px solid #1e1e35', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '4px 12px 8px' }}>
              {rawValues.map(([val, s], i) => (
                <RawDataRow key={i} label={meta.rawKeys?.[i] || `Value ${i+1}`} value={val} score={s} />
              ))}
            </div>
          )}
        </div>

        {/* ── SIMULATION MODE ──────────────────────────────────── */}
        <div style={{ border: '1px solid #1e1e35', borderRadius: 4, overflow: 'hidden' }}>
          <button
            onClick={() => setSimMode(!simMode)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: simMode ? 'rgba(68,102,255,0.12)' : '#0c0c18',
              border: 'none', padding: '8px 12px', cursor: 'pointer',
              borderBottom: simMode ? '1px solid #1e1e35' : 'none',
            }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#4466ff', letterSpacing: '0.1em' }}>
              ⚙ SIMULATION MODE
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: isSimulated ? '#ffcc00' : '#404060' }}>
              {isSimulated ? '● ACTIVE' : simMode ? '▲' : '▼'}
            </span>
          </button>

          {simMode && (
            <div style={{ background: '#0a0a14', padding: '12px 12px 14px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#7070a0', marginBottom: 8 }}>
                Drag to override this layer's score and watch downstream nodes update in real-time.
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#ff3355' }}>-1.00</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, fontWeight: 700, color: '#4466ff' }}>
                  {(+simValue).toFixed(2)}
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: '#00ff88' }}>+1.00</span>
              </div>
              <input
                type="range" min={-100} max={100} step={1}
                value={Math.round((+simValue) * 100)}
                onChange={e => handleSimChange((+e.target.value) / 100)}
                style={{ width: '100%', accentColor: '#4466ff', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                {[-1, -0.5, 0, 0.5, 1].map(v => (
                  <button key={v} onClick={() => handleSimChange(v)} style={{
                    flex: 1, padding: '4px 0', fontFamily: 'IBM Plex Mono', fontSize: 8,
                    background: '#111120', border: '1px solid #1e1e35', color: '#7070a0', cursor: 'pointer', borderRadius: 2,
                  }}>{v > 0 ? '+' : ''}{v.toFixed(1)}</button>
                ))}
              </div>
              {isSimulated && (
                <button onClick={clearSim} style={{
                  width: '100%', marginTop: 8, padding: '5px', fontFamily: 'IBM Plex Mono', fontSize: 9,
                  background: 'rgba(255,51,85,0.1)', border: '1px solid rgba(255,51,85,0.3)',
                  color: '#ff3355', cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em',
                }}>✕ CLEAR SIMULATION</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: confidence + weight */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #1e1e35', display: 'flex', gap: 12 }}>
        {[
          { label: 'CONFIDENCE', value: `${((signal?.confidence || 0.5) * 100).toFixed(0)}%`, color: meta.color },
          { label: 'WEIGHT', value: `${((signal?.weight || 0.1) * 100).toFixed(1)}%`, color: '#7070a0' },
        ].map(item => (
          <div key={item.label} style={{ flex: 1, background: '#0c0c18', borderRadius: 3, padding: '6px 8px', border: '1px solid #1e1e35' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: '#404060', marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 14, fontWeight: 600, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
