// Mock stock data
export const STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', price: 875.43, change: 3.21, changeAmt: 27.18 },
  { symbol: 'XOM', name: 'Exxon Mobil Corp', sector: 'Energy', price: 112.67, change: 1.84, changeAmt: 2.04 },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', price: 189.35, change: -0.42, changeAmt: -0.80 },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', price: 248.91, change: -2.13, changeAmt: -5.41 },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', price: 198.24, change: 0.87, changeAmt: 1.71 },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', price: 512.77, change: 2.34, changeAmt: 11.71 },
  { symbol: 'CVX', name: 'Chevron Corp', sector: 'Energy', price: 163.42, change: 1.12, changeAmt: 1.82 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', price: 168.55, change: -1.23, changeAmt: -2.10 },
];

// Generate realistic price history
export function generatePriceHistory(basePrice, days = 90, volatility = 0.02) {
  const data = [];
  let price = basePrice * 0.85;
  const now = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    const change = (Math.random() - 0.48) * volatility * price;
    price = Math.max(price + change, price * 0.5);
    
    const open = price;
    const high = price * (1 + Math.random() * 0.015);
    const low = price * (1 - Math.random() * 0.015);
    const close = low + Math.random() * (high - low);
    const volume = Math.floor(Math.random() * 50000000) + 10000000;
    
    data.push({
      date: date.toISOString().split('T')[0],
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });
  }
  return data;
}

// Layer definitions
export const LAYERS = [
  {
    id: 'fundamental',
    name: 'Fundamental Earnings',
    shortName: 'FUND',
    icon: '📊',
    description: 'Evaluates earnings surprises, revenue beats, and forward guidance revisions',
    color: '#4466ff',
  },
  {
    id: 'momentum',
    name: 'Price Momentum',
    shortName: 'MOMT',
    icon: '⚡',
    description: 'Captures price acceleration, volume spikes, and trend strength',
    color: '#00d4ff',
  },
  {
    id: 'sector',
    name: 'Sector & Industry',
    shortName: 'SECT',
    icon: '🏭',
    description: 'Measures sector-wide forces and relative industry performance',
    color: '#8855ff',
  },
  {
    id: 'commodity',
    name: 'Commodity & Supply Chain',
    shortName: 'CMDTY',
    icon: '⛽',
    description: 'Analyzes commodity price impact on supply chain dynamics',
    color: '#ffaa00',
  },
  {
    id: 'sentiment',
    name: 'News Sentiment',
    shortName: 'SENT',
    icon: '📰',
    description: 'AI-extracted sentiment from news, media, and earnings calls',
    color: '#ff6644',
  },
  {
    id: 'historical',
    name: 'Historical Analog',
    shortName: 'HIST',
    icon: '📈',
    description: 'Pattern matching against historical events of similar nature',
    color: '#00ff88',
  },
  {
    id: 'macro',
    name: 'Macroeconomic',
    shortName: 'MACRO',
    icon: '🌐',
    description: 'Interest rates, inflation, global growth, and recession risk',
    color: '#ff55aa',
  },
  {
    id: 'options',
    name: 'Options Market',
    shortName: 'OPTN',
    icon: '🎯',
    description: 'Implied volatility, unusual activity, and put/call ratios',
    color: '#55ffcc',
  },
  {
    id: 'event',
    name: 'Event Detection',
    shortName: 'EVENT',
    icon: '⚠️',
    description: 'Detects earnings, policy changes, geopolitical events, and catalysts',
    color: '#ffcc00',
  },
];

// Generate layer signals for a stock
export function generateLayerSignals(symbol) {
  const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = (offset = 0) => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };
  
  const isEnergy = ['XOM', 'CVX'].includes(symbol);
  const isTech = ['NVDA', 'AAPL', 'META', 'AMD'].includes(symbol);
  const isGrowth = ['NVDA', 'TSLA', 'META', 'AMD'].includes(symbol);
  
  return LAYERS.map((layer, i) => {
    let base = (rng(i * 7) * 2 - 1) * 0.8;
    
    // Apply contextual biases
    if (layer.id === 'fundamental' && isTech) base += 0.2;
    if (layer.id === 'commodity' && isEnergy) base += 0.35;
    if (layer.id === 'commodity' && isTech) base -= 0.1;
    if (layer.id === 'macro' && isGrowth) base -= 0.2;
    if (layer.id === 'sector' && isTech) base += 0.15;
    if (layer.id === 'sector' && isEnergy) base += 0.1;
    
    const score = Math.max(-1, Math.min(1, base));
    const confidence = 0.5 + rng(i * 3 + 1) * 0.5;
    const weight = 0.08 + rng(i * 5 + 2) * 0.12;
    
    return {
      ...layer,
      score: +score.toFixed(3),
      confidence: +confidence.toFixed(2),
      weight: +weight.toFixed(3),
      reasoning: generateReasoning(layer.id, symbol, score),
      subSignals: generateSubSignals(layer.id, score),
    };
  });
}

function generateReasoning(layerId, symbol, score) {
  const direction = score > 0.3 ? 'bullish' : score < -0.3 ? 'bearish' : 'neutral';
  const reasonings = {
    fundamental: {
      bullish: `${symbol} beat Q3 EPS estimates by 12.4%. Revenue guidance raised by management for next two quarters. Analyst consensus upgrades increasing.`,
      bearish: `${symbol} missed earnings expectations. Revenue growth decelerating. Forward guidance was cautious with increased cost pressures noted.`,
      neutral: `${symbol} met earnings expectations with slight beat. Mixed signals on forward guidance with modest analyst revisions.`,
    },
    momentum: {
      bullish: `Strong upward price trend over 20/50-day period. Volume 2.3x average on recent up days. RSI at 64 showing strength without overbought conditions.`,
      bearish: `Declining price action with 50-day MA acting as resistance. Volume increasing on down days. Negative momentum acceleration detected.`,
      neutral: `Consolidating near key moving averages. Mixed volume signals. Price momentum flat with no clear directional bias.`,
    },
    sector: {
      bullish: `Sector showing broad-based strength. Peers outperforming S&P 500 by 4.2% this month. Industry group rotation into this space detected.`,
      bearish: `Sector rotation out of this industry group. Multiple peers reporting headwinds. Sector ETF underperforming market by 3.1%.`,
      neutral: `Sector performance in line with market. No significant rotation signals detected. Industry dynamics stable.`,
    },
    commodity: {
      bullish: `Key commodity inputs declining, improving margin outlook. Supply chain conditions normalizing. Raw material costs trending favorable.`,
      bearish: `Commodity price surge impacting cost structure. Supply disruptions affecting key inputs. Margin compression likely in coming quarters.`,
      neutral: `Commodity prices stable. Supply chain conditions normal. No significant cost pressure or benefit expected.`,
    },
    sentiment: {
      bullish: `News sentiment score: +0.72. Media coverage broadly positive. Management tone on recent calls optimistic. Social discussion volume elevated.`,
      bearish: `News sentiment score: -0.61. Increasing negative media coverage. Management commentary cautious on recent calls. Analyst downgrades noted.`,
      neutral: `News sentiment score: +0.08. Mixed media coverage. No significant sentiment shift detected in recent 7-day window.`,
    },
    historical: {
      bullish: `Found 8 historical analogs with 74% accuracy. Similar conditions in 2019, 2021 resulted in avg +18% gain over 30 days. Pattern confidence: HIGH.`,
      bearish: `Found 6 historical analogs. Similar conditions preceded corrections in 73% of cases. Avg decline of -14% over 20 days. Pattern confidence: MEDIUM.`,
      neutral: `Historical analogs inconclusive. Mixed outcomes in 5 similar periods. No dominant directional pattern identified.`,
    },
    macro: {
      bullish: `Rate expectations shifting dovish. Inflation data cooling. Economic growth resilient. Fed commentary supporting risk-on environment.`,
      bearish: `Rising rate environment pressuring valuations. Inflation persistent above target. Recession probability models elevated at 34%.`,
      neutral: `Macro environment mixed. Rate trajectory uncertain. Growth indicators stable. No clear macro tailwind or headwind identified.`,
    },
    options: {
      bullish: `Unusual call buying detected: 3.2x average call volume. IV skew shifting bullish. Smart money positioning suggests upside expectation.`,
      bearish: `Put/call ratio spiking to 1.8. Elevated implied volatility. Large block put purchases suggest institutional hedging or bearish bets.`,
      neutral: `Options activity normal. Put/call ratio at 1.0. IV near 30-day average. No unusual positioning detected.`,
    },
    event: {
      bullish: `Upcoming earnings catalyst in 8 days. Product launch announced. Strategic partnership disclosed. Buyback program expanded.`,
      bearish: `Regulatory investigation disclosed. Key executive departure. Major customer loss reported. Upcoming lock-up expiration risk.`,
      neutral: `No major catalysts identified in near term. Routine earnings in 45 days. Operations proceeding normally.`,
    },
  };
  
  return reasonings[layerId]?.[direction] || 'Analyzing market conditions...';
}

function generateSubSignals(layerId, parentScore) {
  const configs = {
    fundamental: ['EPS Surprise', 'Revenue Beat', 'Guidance Delta', 'Analyst Revisions'],
    momentum: ['Price Return 20d', 'Volume Trend', 'RSI Signal', 'MACD Crossover'],
    sector: ['Sector ETF Momentum', 'Peer Relative Strength', 'Industry Rotation', 'Sector Breadth'],
    commodity: ['Input Cost Trend', 'Supply Chain Health', 'Commodity Correlation', 'Margin Impact'],
    sentiment: ['News Score', 'Social Sentiment', 'Earnings Call Tone', 'Analyst Sentiment'],
    historical: ['Analog Match Quality', 'Historical Win Rate', 'Avg Return', 'Time to Resolution'],
    macro: ['Rate Environment', 'Inflation Signal', 'Growth Outlook', 'Risk Appetite'],
    options: ['Put/Call Ratio', 'IV Rank', 'Unusual Activity', 'Skew Signal'],
    event: ['Catalyst Count', 'Event Magnitude', 'Timeline Risk', 'Market Reaction'],
  };
  
  const names = configs[layerId] || ['Signal A', 'Signal B', 'Signal C', 'Signal D'];
  return names.map((name, i) => {
    const variance = (Math.random() - 0.5) * 0.4;
    const score = Math.max(-1, Math.min(1, parentScore + variance));
    return { name, score: +score.toFixed(2) };
  });
}

// Generate final aggregated prediction
export function generatePrediction(signals) {
  const totalWeight = signals.reduce((s, l) => s + l.weight, 0);
  const weightedScore = signals.reduce((s, l) => s + l.score * l.weight, 0) / totalWeight;
  const confidence = signals.reduce((s, l) => s + l.confidence * l.weight, 0) / totalWeight;
  
  const probability = 0.5 + weightedScore * 0.45;
  
  return {
    score: +weightedScore.toFixed(3),
    probability: +probability.toFixed(3),
    confidence: +confidence.toFixed(2),
    direction: weightedScore > 0.05 ? 'BULLISH' : weightedScore < -0.05 ? 'BEARISH' : 'NEUTRAL',
    targetMove: +(weightedScore * 8).toFixed(1),
    horizon: '5 days',
    topDrivers: signals
      .sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight))
      .slice(0, 3)
      .map(l => ({ name: l.name, score: l.score, weight: l.weight })),
  };
}

// Generate portfolio positions
export function generatePortfolio() {
  return [
    { symbol: 'NVDA', shares: 10, entryPrice: 812.50, currentPrice: 875.43, side: 'LONG', openDate: '2024-01-15' },
    { symbol: 'XOM', shares: 25, entryPrice: 108.20, currentPrice: 112.67, side: 'LONG', openDate: '2024-01-22' },
    { symbol: 'TSLA', shares: 8, entryPrice: 265.10, currentPrice: 248.91, side: 'SHORT', openDate: '2024-02-01' },
    { symbol: 'META', shares: 5, entryPrice: 489.00, currentPrice: 512.77, side: 'LONG', openDate: '2024-02-10' },
  ];
}

// Generate portfolio equity curve
export function generateEquityCurve(days = 60) {
  const data = [];
  let equity = 100000;
  const now = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const change = (Math.random() - 0.46) * 0.012 * equity;
    equity = Math.max(equity + change, 80000);
    data.push({
      date: date.toISOString().split('T')[0],
      equity: +equity.toFixed(2),
      benchmark: +(100000 * (1 + (days - i) * 0.0008 + (Math.random() - 0.5) * 0.005)).toFixed(2),
    });
  }
  return data;
}

// Generate backtest results
export function generateBacktestResults() {
  const trades = [];
  const symbols = ['NVDA', 'XOM', 'AAPL', 'TSLA', 'META', 'AMD', 'JPM', 'CVX'];
  let equity = 100000;
  const results = [{ date: '2023-07-01', equity: 100000 }];
  
  for (let i = 0; i < 48; i++) {
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const returnPct = (Math.random() - 0.44) * 0.12;
    const pnl = equity * 0.08 * returnPct;
    equity += pnl;
    
    const entryDate = new Date('2023-07-01');
    entryDate.setDate(entryDate.getDate() + i * 5);
    
    trades.push({
      id: i + 1,
      symbol,
      side: returnPct > 0 ? 'LONG' : 'SHORT',
      returnPct: +returnPct.toFixed(4),
      pnl: +pnl.toFixed(2),
      date: entryDate.toISOString().split('T')[0],
      duration: Math.floor(Math.random() * 10) + 1,
      won: pnl > 0,
    });
    
    results.push({
      date: entryDate.toISOString().split('T')[0],
      equity: +equity.toFixed(2),
    });
  }
  
  const wins = trades.filter(t => t.won);
  const losses = trades.filter(t => !t.won);
  const totalReturn = ((equity - 100000) / 100000) * 100;
  const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
  const avgLoss = losses.reduce((s, t) => s + t.pnl, 0) / losses.length;
  
  return {
    trades,
    equityCurve: results,
    stats: {
      totalReturn: +totalReturn.toFixed(2),
      winRate: +((wins.length / trades.length) * 100).toFixed(1),
      totalTrades: trades.length,
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      profitFactor: +(Math.abs(wins.reduce((s,t) => s+t.pnl,0) / losses.reduce((s,t) => s+t.pnl,0))).toFixed(2),
      sharpe: +(1.2 + Math.random() * 0.8).toFixed(2),
      maxDrawdown: -((8 + Math.random() * 10).toFixed(1)),
      finalEquity: +equity.toFixed(2),
    },
  };
}

// Market events feed
export const MARKET_EVENTS = [
  { time: '09:32', symbol: 'NVDA', type: 'EARNINGS', severity: 'HIGH', text: 'Q4 EPS beat by 18.3% — revenue guidance raised for next quarter' },
  { time: '09:45', symbol: 'XOM', type: 'COMMODITY', severity: 'MEDIUM', text: 'WTI crude +2.1% after OPEC+ production cut announcement' },
  { time: '10:15', symbol: 'TSLA', type: 'NEWS', severity: 'LOW', text: 'Analyst downgrade from Buy to Hold — price target cut to $240' },
  { time: '10:58', symbol: 'JPM', type: 'MACRO', severity: 'HIGH', text: 'Fed minutes: 2 members dissented on rate hold decision' },
  { time: '11:30', symbol: 'META', type: 'OPTIONS', severity: 'MEDIUM', text: 'Unusual call buying: 12,500 $530 calls expiring Friday' },
  { time: '12:05', symbol: 'AMD', type: 'SECTOR', severity: 'LOW', text: 'SOX index breaking resistance at 4,800 — semiconductor momentum building' },
  { time: '13:22', symbol: 'CVX', type: 'GEO', severity: 'HIGH', text: 'Middle East tensions escalating — oil supply risk premium increasing' },
  { time: '14:10', symbol: 'AAPL', type: 'NEWS', severity: 'MEDIUM', text: 'Supply chain normalization — Taiwan production running at full capacity' },
];

// Ticker data
export const TICKER_DATA = [
  { symbol: 'NVDA', price: 875.43, change: 3.21 },
  { symbol: 'SPY', price: 512.77, change: 0.34 },
  { symbol: 'QQQ', price: 441.22, change: 0.56 },
  { symbol: 'XOM', price: 112.67, change: 1.84 },
  { symbol: 'AAPL', price: 189.35, change: -0.42 },
  { symbol: 'TSLA', price: 248.91, change: -2.13 },
  { symbol: 'META', price: 512.77, change: 2.34 },
  { symbol: 'AMD', price: 168.55, change: -1.23 },
  { symbol: 'JPM', price: 198.24, change: 0.87 },
  { symbol: 'CVX', price: 163.42, change: 1.12 },
  { symbol: 'DXY', price: 104.23, change: -0.21 },
  { symbol: 'BTC', price: 67450, change: 1.87 },
  { symbol: 'WTI', price: 79.45, change: 2.10 },
  { symbol: 'GOLD', price: 2041.30, change: 0.45 },
];
