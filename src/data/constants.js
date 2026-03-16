// Static data — no mock generators. Use backend/API for live data.

export const STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'XOM', name: 'Exxon Mobil Corp', sector: 'Energy', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'CVX', name: 'Chevron Corp', sector: 'Energy', price: 0, change: 0, changeAmt: 0 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', price: 0, change: 0, changeAmt: 0 },
]

export const TICKER_DATA = [
  { symbol: 'NVDA', price: 0, change: 0 },
  { symbol: 'SPY', price: 0, change: 0 },
  { symbol: 'QQQ', price: 0, change: 0 },
  { symbol: 'XOM', price: 0, change: 0 },
  { symbol: 'AAPL', price: 0, change: 0 },
  { symbol: 'TSLA', price: 0, change: 0 },
  { symbol: 'META', price: 0, change: 0 },
  { symbol: 'AMD', price: 0, change: 0 },
  { symbol: 'JPM', price: 0, change: 0 },
  { symbol: 'CVX', price: 0, change: 0 },
  { symbol: 'DX-Y.NYB', price: 0, change: 0 },
  { symbol: 'BTC-USD', price: 0, change: 0 },
  { symbol: 'CL=F', price: 0, change: 0 },
  { symbol: 'GC=F', price: 0, change: 0 },
]

export const LAYERS = [
  { id: 'fundamental', name: 'Fundamental Earnings', shortName: 'FUND', icon: '📊', description: 'Evaluates earnings surprises, revenue beats, and forward guidance revisions', color: '#4466ff' },
  { id: 'momentum', name: 'Price Momentum', shortName: 'MOMT', icon: '⚡', description: 'Captures price acceleration, volume spikes, and trend strength', color: '#00d4ff' },
  { id: 'sector', name: 'Sector & Industry', shortName: 'SECT', icon: '🏭', description: 'Measures sector-wide forces and relative industry performance', color: '#8855ff' },
  { id: 'commodity', name: 'Commodity & Supply Chain', shortName: 'CMDTY', icon: '⛽', description: 'Analyzes commodity price impact on supply chain dynamics', color: '#ffaa00' },
  { id: 'sentiment', name: 'News Sentiment', shortName: 'SENT', icon: '📰', description: 'AI-extracted sentiment from news, media, and earnings calls', color: '#ff6644' },
  { id: 'historical', name: 'Historical Analog', shortName: 'HIST', icon: '📈', description: 'Pattern matching against historical events of similar nature', color: '#00ff88' },
  { id: 'macro', name: 'Macroeconomic', shortName: 'MACRO', icon: '🌐', description: 'Interest rates, inflation, global growth, and recession risk', color: '#ff55aa' },
  { id: 'options', name: 'Options Market', shortName: 'OPTN', icon: '🎯', description: 'Implied volatility, unusual activity, and put/call ratios', color: '#55ffcc' },
  { id: 'event', name: 'Event Detection', shortName: 'EVENT', icon: '⚠️', description: 'Detects earnings, policy changes, geopolitical events, and catalysts', color: '#ffcc00' },
  { id: 'info_catalyst', name: 'Information Catalyst', shortName: 'INFO', icon: '🧠', description: 'LLM-extracted catalysts, novelty-weighted decay, and historical news pattern lookup', color: '#00ffaa' },
]

// Placeholder so Layout has something to show; replace with API feed when available
export const MARKET_EVENTS = [
  { time: '--:--', symbol: '—', type: 'LIVE', severity: 'LOW', text: 'Connect backend for live market events.' },
]
