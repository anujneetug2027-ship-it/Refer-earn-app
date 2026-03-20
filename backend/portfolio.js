// ═══════════════════════════════════════════════════════════════
//  portfolio.js  —  AmbikaShelf Portfolio Manager Backend
//  Mount this as:  app.use('/api/portfolio', require('./portfolio'));
// ═══════════════════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const fetch = require('node-fetch');
// ── ENV ──────────────────────────────────────────────────────────
const METAL_API_KEY = process.env.METAL_API_KEY || '54d0079d3085b015926ed9d17c67931e';

// ══════════════════════════════════════════════════════════════════
//  MONGOOSE SCHEMAS
// ══════════════════════════════════════════════════════════════════

// ── StockHolding ──────────────────────────────────────────────────
const stockHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  symbol:       { type: String, required: true },   // e.g. 'ITC.NS'
  name:         { type: String, required: true },   // e.g. 'ITC'
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});

// ── CryptoHolding ─────────────────────────────────────────────────
const cryptoHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  coinId:       { type: String, required: true },   // e.g. 'bitcoin'
  name:         { type: String, required: true },
  quantity:     { type: Number, required: true, min: 0 },  // supports decimals like 0.0000027
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  leverage:     { type: Number, default: 1, min: 1 },
  addedAt:      { type: Date,   default: Date.now },
});

// ── UtilityHolding ────────────────────────────────────────────────
const utilityHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  assetId:      { type: String, required: true, default: 'gold' },
  name:         { type: String, required: true, default: 'Digital Gold' },
  quantity:     { type: Number, required: true, min: 0 },  // grams
  buyPrice:     { type: Number, required: true, min: 0 },  // price per gram at purchase
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});

// Prevent re-registering models if hot-reloading
const StockHolding   = mongoose.models.StockHolding   || mongoose.model('StockHolding',   stockHoldingSchema);
const CryptoHolding  = mongoose.models.CryptoHolding  || mongoose.model('CryptoHolding',  cryptoHoldingSchema);
const UtilityHolding = mongoose.models.UtilityHolding || mongoose.model('UtilityHolding', utilityHoldingSchema);

// ══════════════════════════════════════════════════════════════════
//  PRICE CACHE  (simple in-memory, 60-second TTL)
// ══════════════════════════════════════════════════════════════════
const cache = {};
function getCache(key)     { const e=cache[key]; return (e&&Date.now()-e.ts<60000) ? e.val : null; }
function setCache(key,val) { cache[key]={val, ts:Date.now()}; }

// ══════════════════════════════════════════════════════════════════
//  PROXY ROUTES  (frontend calls these to avoid CORS)
// ══════════════════════════════════════════════════════════════════

// ── Live stock price ──────────────────────────────────────────────
router.get('/proxy/stock', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.json({ price: null });

  const cached = getCache('sp:'+sym);
  if (cached !== null) return res.json({ price: cached });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`;
    const r   = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
    const d   = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || meta?.previousClose || null;
    setCache('sp:'+sym, price);
    res.json({ price });
  } catch(e) {
    console.error('[proxy/stock]', e.message);
    res.json({ price: null });
  }
});

// ── Stock chart data ──────────────────────────────────────────────
const STOCK_RANGE_MAP = {
  '1H': { range:'1d',  interval:'2m'  },
  '1D': { range:'1d',  interval:'5m'  },
  '1W': { range:'5d',  interval:'30m' },
  '1M': { range:'1mo', interval:'1d'  },
  '3M': { range:'3mo', interval:'1d'  },
  '6M': { range:'6mo', interval:'1d'  },
  '1Y': { range:'1y',  interval:'1wk' },
  '2Y': { range:'2y',  interval:'1wk' },
};

router.get('/proxy/stock-chart', async (req, res) => {
  const { sym, range='1D' } = req.query;
  if (!sym) return res.json({ data:[] });

  const cacheKey = `sc:${sym}:${range}`;
  const cached   = getCache(cacheKey);
  if (cached)    return res.json({ data: cached });

  const { range:r, interval } = STOCK_RANGE_MAP[range] || STOCK_RANGE_MAP['1D'];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${r}&interval=${interval}`;
    const res2= await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
    const d   = await res2.json();
    const result = d?.chart?.result?.[0];
    if (!result) return res.json({ data:[] });

    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const data = timestamps
      .map((t,i) => ({ x: t*1000, y: closes[i] }))
      .filter(pt => pt.y != null && !isNaN(pt.y));

    setCache(cacheKey, data);
    res.json({ data });
  } catch(e) {
    console.error('[proxy/stock-chart]', e.message);
    res.json({ data:[] });
  }
});

// ── Live crypto price ─────────────────────────────────────────────
router.get('/proxy/crypto', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ price: null });

  const cached = getCache('cp:'+id);
  if (cached !== null) return res.json({ price: cached });

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=inr`;
    const r   = await fetch(url);
    const d   = await r.json();
    const price = d?.[id]?.inr || null;
    setCache('cp:'+id, price);
    res.json({ price });
  } catch(e) {
    console.error('[proxy/crypto]', e.message);
    res.json({ price: null });
  }
});

// ── Crypto chart ─────────────────────────────────────────────────
const CRYPTO_DAYS_MAP = {
  '1H': '1',
  '1D': '1',
  '1W': '7',
  '1M': '30',
  '3M': '90',
  '6M': '180',
  '1Y': '365',
  '2Y': '730',
};

router.get('/proxy/crypto-chart', async (req, res) => {
  const { id, range='1D' } = req.query;
  if (!id) return res.json({ data:[] });

  const cacheKey = `cc:${id}:${range}`;
  const cached   = getCache(cacheKey);
  if (cached)    return res.json({ data: cached });

  const days = CRYPTO_DAYS_MAP[range] || '1';
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=inr&days=${days}`;
    const r   = await fetch(url);
    const d   = await r.json();
    const data = (d?.prices||[]).map(([t,v]) => ({ x:t, y:v }));
    setCache(cacheKey, data);
    res.json({ data });
  } catch(e) {
    console.error('[proxy/crypto-chart]', e.message);
    res.json({ data:[] });
  }
});

// ── Live gold price (per gram in INR) ────────────────────────────
router.get('/proxy/gold', async (req, res) => {
  const cached = getCache('gold');
  if (cached !== null) return res.json({ price: cached });

  try {
    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${METAL_API_KEY}&base=INR&currencies=XAU`;
    const r   = await fetch(url);
    const d   = await r.json();
    // d.rates.XAU = how many troy ounces 1 INR buys
    // So 1 INR = d.rates.XAU oz  =>  1 oz = 1/d.rates.XAU INR
    // 1 gram = (1/d.rates.XAU) / 31.1035 INR
    const rateXAU    = d?.rates?.XAU;
    if (!rateXAU) return res.json({ price: null });
    const pricePerGram = (1 / rateXAU) / 31.1035;
    setCache('gold', pricePerGram);
    res.json({ price: pricePerGram });
  } catch(e) {
    console.error('[proxy/gold]', e.message);
    res.json({ price: null });
  }
});

// ── Gold chart (simulated from price + daily fluctuation) ────────
// MetalPriceAPI free tier doesn't support historical series,
// so we synthesise a realistic gold chart from the current price.
router.get('/proxy/gold-chart', async (req, res) => {
  const { range='1D' } = req.query;

  // get live price first
  let basePrice = null;
  try {
    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${METAL_API_KEY}&base=INR&currencies=XAU`;
    const r   = await fetch(url);
    const d   = await r.json();
    const rateXAU = d?.rates?.XAU;
    if (rateXAU) basePrice = (1/rateXAU)/31.1035;
  } catch {}

  if (!basePrice) {
    // fallback: ₹7200 per gram
    basePrice = 7200;
  }

  // Build simulated series: gold moves slowly ~0.2% daily
  const POINTS_MAP = {
    '1H':  { count:60,  stepMs:60*1000,          volatility:0.0003 },
    '1D':  { count:96,  stepMs:15*60*1000,        volatility:0.0008 },
    '1W':  { count:168, stepMs:60*60*1000,         volatility:0.002  },
    '1M':  { count:120, stepMs:6*60*60*1000,       volatility:0.004  },
    '3M':  { count:90,  stepMs:24*60*60*1000,      volatility:0.006  },
    '1Y':  { count:365, stepMs:24*60*60*1000,      volatility:0.008  },
    '2Y':  { count:730, stepMs:24*60*60*1000,      volatility:0.01   },
  };
  const { count, stepMs, volatility } = POINTS_MAP[range]||POINTS_MAP['1D'];
  const now  = Date.now();
  const data = [];
  let price  = basePrice * (1 - volatility * count * 0.5); // start slightly lower
  for (let i=count; i>=0; i--) {
    const t  = now - i*stepMs;
    const rnd = (Math.random()-0.48) * volatility;  // slight upward bias
    price    = Math.max(price*(1+rnd), basePrice*0.8);
    data.push({ x:t, y:parseFloat(price.toFixed(2)) });
  }
  // Ensure last point = live price
  if (data.length) data[data.length-1].y = basePrice;

  res.json({ data });
});

// ══════════════════════════════════════════════════════════════════
//  PORTFOLIO CRUD  (auth via x-user-email header)
// ══════════════════════════════════════════════════════════════════

function requireUser(req, res, next) {
  const email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ success:false, msg:'Not authenticated' });
  req.userEmail = email.toLowerCase().trim();
  next();
}

// ── GET /api/portfolio/holdings ───────────────────────────────────
router.get('/holdings', requireUser, async (req, res) => {
  try {
    const [stocks, crypto, utility] = await Promise.all([
      StockHolding.find({ userEmail: req.userEmail }).lean(),
      CryptoHolding.find({ userEmail: req.userEmail }).lean(),
      UtilityHolding.find({ userEmail: req.userEmail }).lean(),
    ]);
    res.json({ success:true, portfolio:{ stocks, crypto, utility } });
  } catch(e) {
    console.error('[/holdings]', e.message);
    res.status(500).json({ success:false, msg:'Server error' });
  }
});

// ── POST /api/portfolio/add ───────────────────────────────────────
router.post('/add', requireUser, async (req, res) => {
  const { type, assetKey, name, quantity, buyPrice, purchaseDate, leverage } = req.body;

  if (!type || !name || !quantity || !buyPrice || !purchaseDate)
    return res.json({ success:false, msg:'Missing required fields' });

  if (quantity <= 0)  return res.json({ success:false, msg:'Quantity must be > 0' });
  if (buyPrice <= 0)  return res.json({ success:false, msg:'Buy price must be > 0' });

  try {
    let holding;
    if (type==='stocks') {
      holding = new StockHolding({
        userEmail:    req.userEmail,
        symbol:       assetKey,
        name,
        quantity:     parseFloat(quantity),
        buyPrice:     parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate),
      });
    } else if (type==='crypto') {
      holding = new CryptoHolding({
        userEmail:    req.userEmail,
        coinId:       assetKey,
        name,
        quantity:     parseFloat(quantity),
        buyPrice:     parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate),
        leverage:     parseInt(leverage)||1,
      });
    } else if (type==='utility') {
      holding = new UtilityHolding({
        userEmail:    req.userEmail,
        assetId:      assetKey||'gold',
        name:         name||'Digital Gold',
        quantity:     parseFloat(quantity),
        buyPrice:     parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate),
      });
    } else {
      return res.json({ success:false, msg:'Invalid asset type' });
    }

    await holding.save();
    res.json({ success:true, id: holding._id });
  } catch(e) {
    console.error('[/add]', e.message);
    res.status(500).json({ success:false, msg:'Server error' });
  }
});

// ── POST /api/portfolio/remove ────────────────────────────────────
router.post('/remove', requireUser, async (req, res) => {
  const { type, id } = req.body;
  if (!type || !id)
    return res.json({ success:false, msg:'Missing type or id' });

  try {
    const filter = { _id: id, userEmail: req.userEmail };
    if (type==='stock'||type==='stocks')
      await StockHolding.deleteOne(filter);
    else if (type==='crypto')
      await CryptoHolding.deleteOne(filter);
    else if (type==='utility')
      await UtilityHolding.deleteOne(filter);
    else
      return res.json({ success:false, msg:'Invalid type' });

    res.json({ success:true });
  } catch(e) {
    console.error('[/remove]', e.message);
    res.status(500).json({ success:false, msg:'Server error' });
  }
});

// ── POST /api/portfolio/update ────────────────────────────────────
router.post('/update', requireUser, async (req, res) => {
  const { type, id, quantity, buyPrice, purchaseDate, leverage } = req.body;
  if (!type || !id)
    return res.json({ success:false, msg:'Missing type or id' });

  try {
    const filter = { _id:id, userEmail: req.userEmail };
    const update = {};
    if (quantity)     update.quantity     = parseFloat(quantity);
    if (buyPrice)     update.buyPrice     = parseFloat(buyPrice);
    if (purchaseDate) update.purchaseDate = new Date(purchaseDate);
    if (leverage)     update.leverage     = parseInt(leverage);

    if (type==='stock'||type==='stocks')
      await StockHolding.updateOne(filter, update);
    else if (type==='crypto')
      await CryptoHolding.updateOne(filter, update);
    else if (type==='utility')
      await UtilityHolding.updateOne(filter, update);

    res.json({ success:true });
  } catch(e) {
    console.error('[/update]', e.message);
    res.status(500).json({ success:false, msg:'Server error' });
  }
});

// ── GET /api/portfolio/summary ────────────────────────────────────
// Returns pre-computed summary from live prices (server side)
router.get('/summary', requireUser, async (req, res) => {
  try {
    const [stocks, crypto, utility] = await Promise.all([
      StockHolding.find({ userEmail: req.userEmail }).lean(),
      CryptoHolding.find({ userEmail: req.userEmail }).lean(),
      UtilityHolding.find({ userEmail: req.userEmail }).lean(),
    ]);

    // Fetch all prices in parallel
    const stockPrices = {};
    const cryptoPrices = {};

    await Promise.allSettled([
      ...stocks.map(async h => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${h.symbol}?interval=1m&range=1d`;
        const r   = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
        const d   = await r.json();
        stockPrices[h.symbol] = d?.chart?.result?.[0]?.meta?.regularMarketPrice||h.buyPrice;
      }),
      ...crypto.map(async h => {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${h.coinId}&vs_currencies=inr`;
        const r   = await fetch(url);
        const d   = await r.json();
        cryptoPrices[h.coinId] = d?.[h.coinId]?.inr||h.buyPrice;
      }),
    ]);

    // Gold
    let goldPrice = 0;
    if (utility.length) {
      const url = `https://api.metalpriceapi.com/v1/latest?api_key=${METAL_API_KEY}&base=INR&currencies=XAU`;
      const r   = await fetch(url);
      const d   = await r.json();
      goldPrice = d?.rates?.XAU ? (1/d.rates.XAU)/31.1035 : 7200;
    }

    let totalValue=0, totalInvested=0;

    for (const h of stocks) {
      const lp = stockPrices[h.symbol]||h.buyPrice;
      totalValue    += lp * h.quantity;
      totalInvested += h.buyPrice * h.quantity;
    }
    for (const h of crypto) {
      const lp = cryptoPrices[h.coinId]||h.buyPrice;
      totalValue    += lp * h.quantity * (h.leverage||1);
      totalInvested += h.buyPrice * h.quantity;
    }
    for (const h of utility) {
      totalValue    += goldPrice * h.quantity;
      totalInvested += h.buyPrice * h.quantity;
    }

    const pnl = totalValue - totalInvested;
    const pct = totalInvested>0 ? (pnl/totalInvested*100) : 0;

    res.json({
      success: true,
      summary: {
        totalValue:   +totalValue.toFixed(2),
        totalInvested:+totalInvested.toFixed(2),
        pnl:          +pnl.toFixed(2),
        pct:          +pct.toFixed(2),
        holdings: { stocks:stocks.length, crypto:crypto.length, utility:utility.length },
      }
    });
  } catch(e) {
    console.error('[/summary]', e.message);
    res.status(500).json({ success:false, msg:'Server error' });
  }
});

module.exports = router;
module.exports.models = { StockHolding, CryptoHolding, UtilityHolding };
