// Fetch the latest AAPL bar from Alpaca using the official JS SDK.

require('dotenv').config()
const Alpaca = require('@alpacahq/alpaca-trade-api')

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_API_SECRET_KEY,
  paper: true, // set to false if you are using live keys
})

async function main() {
  try {
    const latest = await alpaca.getLatestBar('AAPL')
    console.log('Latest AAPL bar from Alpaca:')
    console.log(latest)
    const price = latest.ClosePrice ?? latest.c ?? latest.close
    console.log('Price field:', price)
  } catch (err) {
    console.error('Error fetching latest AAPL bar:')
    console.error(err?.message || err)
    if (err?.response?.status) console.error('Status:', err.response.status)
    if (err?.response?.data) console.error('Body:', err.response.data)
  }
}

main()

