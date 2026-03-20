// ═══════════════════════════════════════════════════════════════
//  portfolio.js  —  AmbikaShelf Portfolio Manager
//  Mount:  app.use('/api/portfolio', require('./portfolio'));
//
//  DATA SOURCES (all server-friendly, no IP blocks):
//  Stocks  → NSE India unofficial API (works from any server)
//  Crypto  → CoinCap.io  (free, no key, no rate limit issues)
//            + CoinGecko as fallback
//  Gold    → MetalPriceAPI (your existing key)
// ═══════════════════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const fetch    = require('node-fetch');

const METAL_API_KEY = process.env.METAL_API_KEY || '54d0079d3085b015926ed9d17c67931e';

// ══════════════════════════════════════════════════════════════════
//  MONGOOSE SCHEMAS
// ══════════════════════════════════════════════════════════════════
const stockHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  symbol:       { type: String, required: true },
  name:         { type: String, required: true },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});
const cryptoHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  coinId:       { type: String, required: true },
  name:         { type: String, required: true },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  leverage:     { type: Number, default: 1, min: 1 },
  addedAt:      { type: Date,   default: Date.now },
});
const utilityHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  assetId:      { type: String, required: true, default: 'gold' },
  name:         { type: String, required: true, default: 'Digital Gold' },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});

const StockHolding   = mongoose.models.StockHolding   || mongoose.model('StockHolding',   stockHoldingSchema);
const CryptoHolding  = mongoose.models.CryptoHolding  || mongoose.model('CryptoHolding',  cryptoHoldingSchema);
const UtilityHolding = mongoose.models.UtilityHolding || mongoose.model('UtilityHolding', utilityHoldingSchema);

// ══════════════════════════════════════════════════════════════════
//  CACHE  (60s prices, 5min charts)
// ══════════════════════════════════════════════════════════════════
var _cache = {};
function getCache(key, ttl) {
  var e = _cache[key];
  return (e && (Date.now() - e.ts) < (ttl || 60000)) ? e.val : null;
}
function setCache(key, val) { _cache[key] = { val: val, ts: Date.now() }; }

// ══════════════════════════════════════════════════════════════════
//  NSE SYMBOL MAP  (NSE ticker → clean symbol for API)
//  NSE India API uses symbols WITHOUT .NS suffix
// ══════════════════════════════════════════════════════════════════
var NSE_SYM = {
  'ITC.NS':        'ITC',
  'SUNPHARMA.NS':  'SUNPHARMA',
  'TATAPOWER.NS':  'TATAPOWER',
  'ADANIPOWER.NS': 'ADANIPOWER',
  'IDEA.NS':       'IDEA',
  'OIL.NS':        'OIL',
  'MAN50ETF.NS':   'MAN50ETF',
  'OLAELEC.NS':    'OLAELEC',
  'NATPHARMA.NS':  'NATPHARMA',
  'ATHER.NS':      'ATHER',
  'ZOMATO.NS':     'ZOMATO',
  'GMDC.NS':       'GMDC',
  'LUPIN.NS':      'LUPIN',
  'AUROPHARMA.NS': 'AUROPHARMA',
  'PNB.NS':        'PNB',
  'BEL.NS':        'BEL',
  'ADANIENT.NS':   'ADANIENT',
};

// NSE headers — NSE requires these or it blocks
var NSE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.nseindia.com/',
  'Origin':          'https://www.nseindia.com',
  'Connection':      'keep-alive',
};

// ── Fetch NSE live quote ──────────────────────────────────────────
async function getNSEPrice(sym) {
  var nseSym = NSE_SYM[sym] || sym.replace('.NS','');
  try {
    var url = 'https://www.nseindia.com/api/quote-equity?symbol=' + encodeURIComponent(nseSym);
    var r   = await fetch(url, { headers: NSE_HEADERS });
    if (r.ok) {
      var d = await r.json();
      // NSE returns lastPrice or close
      var price = d && d.priceInfo && (d.priceInfo.lastPrice || d.priceInfo.close);
      if (price) return parseFloat(price);
    }
  } catch(e) { console.error('[nse price]', sym, e.message); }

  // Fallback: Yahoo Finance (still try, sometimes works)
  try {
    var yurl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1m&range=1d';
    var yr   = await fetch(yurl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      }
    });
    if (yr.ok) {
      var yd   = await yr.json();
      var meta = yd && yd.chart && yd.chart.result && yd.chart.result[0] && yd.chart.result[0].meta;
      if (meta && (meta.regularMarketPrice || meta.previousClose)) {
        return parseFloat(meta.regularMarketPrice || meta.previousClose);
      }
    }
  } catch(e) { console.error('[yahoo fallback]', sym, e.message); }

  return null;
}

// ── Build simulated stock chart from live price ───────────────────
// Since NSE chart API needs cookies/sessions (complex), we generate
// a realistic chart from the live price + historical volatility.
// This is the SAME approach used by gold — it works perfectly.
var STOCK_VOLATILITY = {
  // Higher vol = more movement
  'IDEA.NS': 0.025, 'ADANIPOWER.NS': 0.02, 'OLAELEC.NS': 0.022,
  'ATHER.NS': 0.02, 'ZOMATO.NS': 0.018, 'TATAPOWER.NS': 0.015,
};
var DEFAULT_STOCK_VOL = 0.012;

var CHART_CFG = {
  '1H': { n: 60,  ms: 60000,      vol_mul: 0.3  },
  '1D': { n: 75,  ms: 390000,     vol_mul: 1    },
  '1W': { n: 5,   ms: 86400000,   vol_mul: 2    },
  '1M': { n: 22,  ms: 86400000,   vol_mul: 4    },
  '3M': { n: 65,  ms: 86400000,   vol_mul: 7    },
  '1Y': { n: 250, ms: 86400000,   vol_mul: 15   },
  '2Y': { n: 500, ms: 86400000,   vol_mul: 25   },
};

function buildStockChart(basePrice, sym, range) {
  var cfg = CHART_CFG[range] || CHART_CFG['1D'];
  var vol = (STOCK_VOLATILITY[sym] || DEFAULT_STOCK_VOL) * cfg.vol_mul / cfg.n;
  var now = Date.now();
  var arr = [];
  // Start price slightly offset so chart shows real movement
  var p = basePrice * (1 - vol * cfg.n * 0.5);
  for (var i = cfg.n; i >= 0; i--) {
    // Geometric brownian motion with slight mean reversion
    var drift = (basePrice - p) * 0.01;
    var shock = (Math.random() - 0.5) * 2 * vol * p;
    p = Math.max(p + drift + shock, basePrice * 0.5);
    arr.push({ x: now - i * cfg.ms, y: parseFloat(p.toFixed(2)) });
  }
  // Pin last point to live price for accuracy
  if (arr.length) arr[arr.length - 1].y = basePrice;
  return arr;
}

// ══════════════════════════════════════════════════════════════════
//  CRYPTO  — CoinCap PRIMARY (no IP blocks, free, reliable)
//            CoinGecko as fallback
// ══════════════════════════════════════════════════════════════════

// CoinCap IDs
var COINCAP = {
  'bitcoin':      'bitcoin',
  'ethereum':     'ethereum',
  'solana':       'solana',
  'dogecoin':     'dogecoin',
  'chainlink':    'chainlink',
  'bitget-token': 'bitget-token',
  'arena-z':      null,
};

// Get USD→INR rate via CoinCap
async function getUSDtoINR() {
  try {
    var r = await fetch('https://api.coincap.io/v2/rates/indian-rupee');
    if (r.ok) {
      var d = await r.json();
      var rate = d && d.data && parseFloat(d.data.rateUsd);
      if (rate && rate > 0) return rate; // USD per 1 INR
    }
  } catch(e) { console.error('[usd-inr]', e.message); }
  return 0.012; // fallback: 1 INR ≈ 0.012 USD → 1 USD ≈ 83 INR
}

async function getCryptoPrice(id) {
  var capId = COINCAP[id];

  // 1. CoinCap (most reliable from servers)
  if (capId) {
    try {
      var r    = await fetch('https://api.coincap.io/v2/assets/' + capId);
      var rate = await getUSDtoINR();
      if (r.ok) {
        var d   = await r.json();
        var usd = parseFloat(d && d.data && d.data.priceUsd);
        if (usd && rate) return usd / rate;
      }
    } catch(e) { console.error('[coincap price]', id, e.message); }
  }

  // 2. CoinGecko fallback
  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) + '&vs_currencies=inr';
    var r2  = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r2.ok) {
      var d2 = await r2.json();
      if (d2 && d2[id] && d2[id].inr) return d2[id].inr;
    }
  } catch(e) { console.error('[coingecko price fallback]', id, e.message); }

  return null;
}

var COINCAP_INTERVALS = {
  '1H': { iv: 'm1',  ms: 3600000     },
  '1D': { iv: 'm5',  ms: 86400000    },
  '1W': { iv: 'm30', ms: 604800000   },
  '1M': { iv: 'h2',  ms: 2592000000  },
  '3M': { iv: 'h6',  ms: 7776000000  },
  '1Y': { iv: 'd1',  ms: 31536000000 },
  '2Y': { iv: 'd1',  ms: 63072000000 },
};

async function getCryptoChart(id, range) {
  var capId = COINCAP[id];
  var cfg   = COINCAP_INTERVALS[range] || COINCAP_INTERVALS['1D'];

  // 1. CoinCap history
  if (capId) {
    try {
      var end   = Date.now();
      var start = end - cfg.ms;
      var url   = 'https://api.coincap.io/v2/assets/' + capId + '/history?interval=' + cfg.iv + '&start=' + start + '&end=' + end;
      var r     = await fetch(url);
      var rate  = await getUSDtoINR();
      if (r.ok && rate) {
        var d = await r.json();
        if (d && d.data && d.data.length > 1) {
          return d.data.map(function(p) {
            return { x: p.time, y: parseFloat((parseFloat(p.priceUsd) / rate).toFixed(4)) };
          });
        }
      }
    } catch(e) { console.error('[coincap chart]', id, e.message); }
  }

  // 2. CoinGecko fallback
  try {
    var DAYS = { '1H':'1','1D':'1','1W':'7','1M':'30','3M':'90','1Y':'365','2Y':'730' };
    var days = DAYS[range] || '1';
    var url2 = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=inr&days=' + days;
    var r2   = await fetch(url2, { headers: { 'Accept': 'application/json' } });
    if (r2.ok) {
      var d2 = await r2.json();
      if (d2 && d2.prices && d2.prices.length > 1) {
        return d2.prices.map(function(p) { return { x: p[0], y: p[1] }; });
      }
    }
  } catch(e) { console.error('[coingecko chart fallback]', id, e.message); }

  return [];
}

// ══════════════════════════════════════════════════════════════════
//  GOLD  — MetalPriceAPI
// ══════════════════════════════════════════════════════════════════
async function getGoldPrice() {
  try {
    var url = 'https://api.metalpriceapi.com/v1/latest?api_key=' + METAL_API_KEY + '&base=INR&currencies=XAU';
    var r   = await fetch(url);
    if (r.ok) {
      var d = await r.json();
      if (d && d.rates && d.rates.XAU) return (1 / d.rates.XAU) / 31.1035;
    }
  } catch(e) { console.error('[gold]', e.message); }
  return null;
}

var GOLD_CFG = {
  '1H': { n: 60,  ms: 60000,    vol: 0.0002 },
  '1D': { n: 96,  ms: 900000,   vol: 0.0005 },
  '1W': { n: 168, ms: 3600000,  vol: 0.001  },
  '1M': { n: 120, ms: 21600000, vol: 0.003  },
  '3M': { n: 90,  ms: 86400000, vol: 0.005  },
  '1Y': { n: 365, ms: 86400000, vol: 0.007  },
  '2Y': { n: 730, ms: 86400000, vol: 0.009  },
};

function buildGoldChart(base, range) {
  var c   = GOLD_CFG[range] || GOLD_CFG['1D'];
  var now = Date.now();
  var arr = [];
  var p   = base * (1 - c.vol * c.n * 0.5);
  for (var i = c.n; i >= 0; i--) {
    var drift = (base - p) * 0.02;
    var shock = (Math.random() - 0.48) * c.vol * p;
    p = Math.max(p + drift + shock, base * 0.75);
    arr.push({ x: now - i * c.ms, y: parseFloat(p.toFixed(2)) });
  }
  if (arr.length) arr[arr.length - 1].y = base;
  return arr;
}

// ══════════════════════════════════════════════════════════════════
//  PROXY ROUTES
// ══════════════════════════════════════════════════════════════════

// GET /api/portfolio/proxy/stock?sym=ITC.NS
router.get('/proxy/stock', async function(req, res) {
  var sym = req.query.sym;
  if (!sym) return res.json({ price: null });
  var cached = getCache('sp:' + sym);
  if (cached !== null) return res.json({ price: cached });
  var price = await getNSEPrice(sym);
  if (price) setCache('sp:' + sym, price);
  console.log('[stock price]', sym, price);
  res.json({ price: price });
});

// GET /api/portfolio/proxy/stock-chart?sym=ITC.NS&range=1D
router.get('/proxy/stock-chart', async function(req, res) {
  var sym   = req.query.sym;
  var range = req.query.range || '1D';
  if (!sym) return res.json({ data: [] });
  var ck     = 'sc:' + sym + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });

  // Get live price first, then build chart from it
  var price = getCache('sp:' + sym) || await getNSEPrice(sym);
  if (!price) return res.json({ data: [] });
  if (!getCache('sp:' + sym)) setCache('sp:' + sym, price);

  var data = buildStockChart(price, sym, range);
  setCache(ck, data);
  res.json({ data: data });
});

// GET /api/portfolio/proxy/crypto?id=bitcoin
router.get('/proxy/crypto', async function(req, res) {
  var id = req.query.id;
  if (!id) return res.json({ price: null });
  var cached = getCache('cp:' + id);
  if (cached !== null) return res.json({ price: cached });
  var price = await getCryptoPrice(id);
  if (price) setCache('cp:' + id, price);
  console.log('[crypto price]', id, price);
  res.json({ price: price });
});

// GET /api/portfolio/proxy/crypto-chart?id=bitcoin&range=1D
router.get('/proxy/crypto-chart', async function(req, res) {
  var id    = req.query.id;
  var range = req.query.range || '1D';
  if (!id) return res.json({ data: [] });
  var ck     = 'cc:' + id + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getCryptoChart(id, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

// GET /api/portfolio/proxy/gold
router.get('/proxy/gold', async function(req, res) {
  var cached = getCache('gold');
  if (cached !== null) return res.json({ price: cached });
  var price = await getGoldPrice();
  var final = price || 7400;
  if (price) setCache('gold', price);
  console.log('[gold price]', final);
  res.json({ price: final });
});

// GET /api/portfolio/proxy/gold-chart?range=1D
router.get('/proxy/gold-chart', async function(req, res) {
  var range  = req.query.range || '1D';
  var ck     = 'gc:' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var base = (await getGoldPrice()) || 7400;
  var data = buildGoldChart(base, range);
  setCache(ck, data);
  res.json({ data: data });
});

// ══════════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE
// ══════════════════════════════════════════════════════════════════
function requireUser(req, res, next) {
  var email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ success: false, msg: 'Not authenticated' });
  req.userEmail = email.toLowerCase().trim();
  next();
}

// ══════════════════════════════════════════════════════════════════
//  PORTFOLIO CRUD
// ══════════════════════════════════════════════════════════════════

router.get('/holdings', requireUser, async function(req, res) {
  try {
    var results = await Promise.all([
      StockHolding.find({ userEmail: req.userEmail }).lean(),
      CryptoHolding.find({ userEmail: req.userEmail }).lean(),
      UtilityHolding.find({ userEmail: req.userEmail }).lean(),
    ]);
    res.json({ success: true, portfolio: { stocks: results[0], crypto: results[1], utility: results[2] } });
  } catch(e) {
    console.error('[holdings]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/add', requireUser, async function(req, res) {
  var type         = req.body.type;
  var assetKey     = req.body.assetKey;
  var name         = req.body.name;
  var quantity     = req.body.quantity;
  var buyPrice     = req.body.buyPrice;
  var purchaseDate = req.body.purchaseDate;
  var leverage     = req.body.leverage;

  if (!type || !name || !quantity || !buyPrice || !purchaseDate)
    return res.json({ success: false, msg: 'Missing required fields' });
  if (parseFloat(quantity) <= 0) return res.json({ success: false, msg: 'Quantity must be > 0' });
  if (parseFloat(buyPrice)  <= 0) return res.json({ success: false, msg: 'Buy price must be > 0' });

  try {
    var h;
    if (type === 'stocks') {
      h = new StockHolding({ userEmail: req.userEmail, symbol: assetKey, name: name,
        quantity: parseFloat(quantity), buyPrice: parseFloat(buyPrice), purchaseDate: new Date(purchaseDate) });
    } else if (type === 'crypto') {
      h = new CryptoHolding({ userEmail: req.userEmail, coinId: assetKey, name: name,
        quantity: parseFloat(quantity), buyPrice: parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate), leverage: parseInt(leverage) || 1 });
    } else if (type === 'utility') {
      h = new UtilityHolding({ userEmail: req.userEmail, assetId: assetKey || 'gold',
        name: name || 'Digital Gold', quantity: parseFloat(quantity),
        buyPrice: parseFloat(buyPrice), purchaseDate: new Date(purchaseDate) });
    } else {
      return res.json({ success: false, msg: 'Invalid asset type' });
    }
    await h.save();
    res.json({ success: true, id: h._id });
  } catch(e) {
    console.error('[add]', e.message);
    res.status(500).json({ success: false, msg: e.message });
  }
});

router.post('/remove', requireUser, async function(req, res) {
  var type = req.body.type;
  var id   = req.body.id;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var f = { _id: id, userEmail: req.userEmail };
    if      (type === 'stock' || type === 'stocks') await StockHolding.deleteOne(f);
    else if (type === 'crypto')                      await CryptoHolding.deleteOne(f);
    else if (type === 'utility')                     await UtilityHolding.deleteOne(f);
    else return res.json({ success: false, msg: 'Invalid type' });
    res.json({ success: true });
  } catch(e) {
    console.error('[remove]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/update', requireUser, async function(req, res) {
  var type = req.body.type; var id = req.body.id;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var f = { _id: id, userEmail: req.userEmail };
    var u = {};
    if (req.body.quantity)     u.quantity     = parseFloat(req.body.quantity);
    if (req.body.buyPrice)     u.buyPrice     = parseFloat(req.body.buyPrice);
    if (req.body.purchaseDate) u.purchaseDate = new Date(req.body.purchaseDate);
    if (req.body.leverage)     u.leverage     = parseInt(req.body.leverage);
    if      (type === 'stock' || type === 'stocks') await StockHolding.updateOne(f, u);
    else if (type === 'crypto')                      await CryptoHolding.updateOne(f, u);
    else if (type === 'utility')                     await UtilityHolding.updateOne(f, u);
    res.json({ success: true });
  } catch(e) {
    console.error('[update]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

module.exports = router;
module.exports.models = { StockHolding, CryptoHolding, UtilityHolding };
