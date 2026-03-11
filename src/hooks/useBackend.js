// src/hooks/useBackend.js
// React hook for APEX backend with automatic mock fallback

import { useState, useCallback, useRef } from 'react'
import { generateLayerSignals } from '../data/mockData'

// With Vite proxy configured, '/api' calls are proxied to localhost:3001
// Fallback: direct connection if not using Vite dev server
const BASE_URL = ''

// Cached backend availability (checked once per session)
let _backendAvailable = null

// Reset the cache (useful if backend was started after app loaded)
export function resetBackendCache() {
  _backendAvailable = null
}

async function checkBackend() {
  if (_backendAvailable !== null) return _backendAvailable
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
    _backendAvailable = res.ok
  } catch {
    _backendAvailable = false
  }
  return _backendAvailable
}

// Map backend pipeline result signals to frontend format
function normaliseSignals(backendSignals) {
  return backendSignals.map(s => ({
    ...s,
    score:      s.score      ?? 0,
    confidence: s.confidence ?? 0.5,
    weight:     s.weight     ?? 0.11,
    subSignals: s.subSignals || [],
    sparkline:  s.sparkline  || Array(16).fill(0),
    reasoning:  s.reasoning  || '',
  }))
}

// ─────────────────────────────────────────────────────────────
// useAnalysis — run full 9-layer pipeline for a ticker
// ─────────────────────────────────────────────────────────────
export function useAnalysis() {
  const [state, setState] = useState({ signals: [], loading: false, error: null, source: null, metadata: null })
  const abortRef = useRef(null)

  const analyze = useCallback(async (ticker) => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState(s => ({ ...s, loading: true, error: null }))

    const isLive = await checkBackend()

    if (isLive) {
      try {
        const res = await fetch(`${BASE_URL}/api/analyze/${ticker}`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok) throw new Error(`Backend error ${res.status}`)
        const data = await res.json()
        setState({
          signals:  normaliseSignals(data.signals || []),
          loading:  false,
          error:    null,
          source:   'live',
          metadata: {
            ticker:       data.ticker,
            timestamp:    data.timestamp,
            elapsed:      data.elapsed,
            context:      data.context,
            dataSources:  data.dataSources,
            memoryAlerts: data.memoryAlerts || [],
            snapshotSaved: data.snapshotSaved,
          },
        })
        return data
      } catch (err) {
        if (err.name === 'AbortError') return
        console.warn('[useAnalysis] Live failed, falling back to mock:', err.message)
      }
    }

    // ── Mock fallback ─────────────────────────────────────────
    const signals = generateLayerSignals(ticker)
    setState({
      signals,
      loading: false,
      error: null,
      source: 'mock',
      metadata: { ticker, timestamp: new Date().toISOString(), elapsed: 0, dataSources: null, memoryAlerts: [] },
    })
  }, [])

  return { ...state, analyze }
}

// ─────────────────────────────────────────────────────────────
// useDiscovery — scan universe for top setups
// ─────────────────────────────────────────────────────────────
export function useDiscovery() {
  const [state, setState] = useState({ results: null, loading: false, error: null, source: null })

  const scan = useCallback(async (limit = 12) => {
    setState(s => ({ ...s, loading: true, error: null }))
    const isLive = await checkBackend()

    if (isLive) {
      try {
        const res = await fetch(`${BASE_URL}/api/discover?limit=${limit}`)
        if (!res.ok) throw new Error('Discovery failed')
        const data = await res.json()
        setState({ results: data, loading: false, error: null, source: 'live' })
        return data
      } catch (err) {
        console.warn('[useDiscovery] live failed:', err.message)
      }
    }

    // ── Mock discovery fallback ───────────────────────────────
    const STOCKS = ['NVDA', 'XOM', 'AAPL', 'TSLA', 'META', 'AMD', 'JPM', 'CVX', 'MSFT', 'GOOGL', 'NFLX', 'CRM']
    const mockResults = STOCKS.map(ticker => {
      const sigs = generateLayerSignals(ticker)
      const avgScore = sigs.reduce((a, s) => a + s.score, 0) / sigs.length
      const convergence = Math.abs(avgScore)
      const direction = avgScore > 0.05 ? 'BULLISH' : avgScore < -0.05 ? 'BEARISH' : 'NEUTRAL'
      let thesis = 'MONITOR'
      if (convergence > 0.45 && avgScore > 0) thesis = 'MOMENTUM_BREAKOUT'
      else if (convergence > 0.40 && avgScore < 0) thesis = 'HIGH_CONVICTION_SHORT'
      else if (convergence > 0.30) thesis = 'WATCH'
      const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
      const price = 50 + (seed % 900)
      return { ticker, sector: 'Technology', score: +avgScore.toFixed(3), convergence: +convergence.toFixed(3), direction, thesis, lastPrice: price, ret5d: +(avgScore * 8).toFixed(2), momentumScore: sigs.find(s => s.id === 'momentum')?.score || 0, sentimentScore: sigs.find(s => s.id === 'sentiment')?.score || 0, newsCount: 0, isLive: false, topHeadline: null }
    }).sort((a, b) => b.convergence - a.convergence).slice(0, limit)

    setState({
      results: { timestamp: new Date().toISOString(), elapsed: 0, scanned: STOCKS.length, results: mockResults, universe: STOCKS },
      loading: false, error: null, source: 'mock',
    })
  }, [])

  return { ...state, scan }
}

// ─────────────────────────────────────────────────────────────
// useMemory — fetch snapshots and pattern matches
// ─────────────────────────────────────────────────────────────
export function useMemory() {
  const [snapshots, setSnapshots]   = useState([])
  const [stats, setStats]           = useState(null)
  const [matches, setMatches]       = useState([])
  const [alerts, setAlerts]         = useState([])
  const [loading, setLoading]       = useState(false)
  const [source, setSource]         = useState(null)

  const fetchMemory = useCallback(async (ticker = null) => {
    setLoading(true)
    const isLive = await checkBackend()

    if (isLive) {
      try {
        const [snapshotsRes, statsRes] = await Promise.all([
          fetch(`${BASE_URL}/api/memory/snapshots${ticker ? `?ticker=${ticker}` : ''}`),
          fetch(`${BASE_URL}/api/memory/stats`),
        ])
        const snapshotsData = await snapshotsRes.json()
        const statsData     = await statsRes.json()

        let matchesData = [], alertsData = []
        if (ticker) {
          const matchRes = await fetch(`${BASE_URL}/api/memory/matches/${ticker}`)
          if (matchRes.ok) {
            const md = await matchRes.json()
            matchesData = md.matches || []
            alertsData  = md.alerts  || []
          }
        }

        setSnapshots(Array.isArray(snapshotsData) ? snapshotsData : [])
        setStats(statsData)
        setMatches(matchesData)
        setAlerts(alertsData)
        setSource('live')
        setLoading(false)
        return
      } catch (err) {
        console.warn('[useMemory] live failed:', err.message)
      }
    }

    // Mock fallback
    setSnapshots([])
    setStats({ totalSnapshots: 0, withOutcomes: 0, winnerSnapshots: 0, uniqueTickers: 0, winRate: null })
    setMatches([])
    setAlerts([])
    setSource('mock')
    setLoading(false)
  }, [])

  const recordOutcome = useCallback(async (id, outcomePct, days = 5) => {
    const isLive = await checkBackend()
    if (!isLive) return { updated: false }
    const res = await fetch(`${BASE_URL}/api/memory/outcome/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcomePct, days }),
    })
    return res.json()
  }, [])

  return { snapshots, stats, matches, alerts, loading, source, fetchMemory, recordOutcome }
}

export { checkBackend }
