import { useState } from 'react'
import Layout from './components/Layout/Layout'
import Dashboard from './pages/Dashboard'
import Analysis from './pages/Analysis'
import Backtest from './pages/Backtest'
import Portfolio from './pages/Portfolio'
import Discovery from './pages/Discovery'
import Memory from './pages/Memory'

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [selectedStock, setSelectedStock] = useState('NVDA')

  const pages = {
    dashboard: <Dashboard selectedStock={selectedStock} setSelectedStock={setSelectedStock} />,
    analysis:  <Analysis selectedStock={selectedStock} setSelectedStock={setSelectedStock} />,
    backtest:  <Backtest />,
    portfolio: <Portfolio selectedStock={selectedStock} setSelectedStock={setSelectedStock} />,
    discovery: <Discovery setSelectedStock={setSelectedStock} setActivePage={setActivePage} />,
    memory:    <Memory selectedStock={selectedStock} />,
  }

  return (
    <div className="scanlines">
      <Layout activePage={activePage} setActivePage={setActivePage} selectedStock={selectedStock}>
        {pages[activePage]}
      </Layout>
    </div>
  )
}
