// ═══════════════════════════════════════════════════════════════
//  portfolio.js  —  AmbikaShelf Portfolio Manager Backend
//  Mount:  app.use('/api/portfolio', require('./portfolio'));
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
//  CACHE
// ══════════════════════════════════════════════════════════════════
const _cache = {};
function getCache(key, ttl) {
  var e = _cache[key];
  return (e && (Date.now() - e.ts) < (ttl || 60000)) ? e.val : null;
}
function setCache(key, val) { _cache[key] = { val: val, ts: Date.now() }; }

// ══════════════════════════════════════════════════════════════════
//  ROTATE USER-AGENTS
// ══════════════════════════════════════════════════════════════════
var UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36',
];
function randUA() { return UAS[Math.floor(Math.random() * UAS.length)]; }

// ══════════════════════════════════════════════════════════════════
//  STOCKS  — Yahoo Finance with 3 fallback URLs
// ══════════════════════════════════════════════════════════════════
async function fetchYahooPrice(sym) {
  var hdrs = {
    'User-Agent': randUA(),
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };
  var endpoints = [
    'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1m&range=1d',
    'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1m&range=1d',
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(sym),
  ];
  for (var i = 0; i < endpoints.length; i++) {
    try {
      var r = await fetch(endpoints[i], { headers: hdrs });
      if (!r.ok) continue;
      var d = await r.json();
      // v8 response
      if (d && d.chart && d.chart.result && d.chart.result[0]) {
        var meta = d.chart.result[0].meta;
        var p = meta && (meta.regularMarketPrice || meta.previousClose);
        if (p) return p;
      }
      // v7 response
      if (d && d.quoteResponse && d.quoteResponse.result && d.quoteResponse.result[0]) {
        var p2 = d.quoteResponse.result[0].regularMarketPrice;
        if (p2) return p2;
      }
    } catch(e) { console.error('[yahoo price]', sym, endpoints[i], e.message); }
  }
  return null;
}

var STOCK_RANGE_MAP = {
  '1H': { r:'1d',  iv:'2m'  },
  '1D': { r:'1d',  iv:'5m'  },
  '1W': { r:'5d',  iv:'30m' },
  '1M': { r:'1mo', iv:'1d'  },
  '3M': { r:'3mo', iv:'1d'  },
  '6M': { r:'6mo', iv:'1d'  },
  '1Y': { r:'1y',  iv:'1wk' },
  '2Y': { r:'2y',  iv:'1wk' },
};

async function fetchYahooChart(sym, range) {
  var m    = STOCK_RANGE_MAP[range] || STOCK_RANGE_MAP['1D'];
  var hdrs = { 'User-Agent': randUA(), 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' };
  var urls = [
    'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + m.r + '&interval=' + m.iv,
    'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + m.r + '&interval=' + m.iv,
  ];
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = await fetch(urls[i], { headers: hdrs });
      if (!r.ok) continue;
      var d = await r.json();
      if (!d || !d.chart || !d.chart.result || !d.chart.result[0]) continue;
      var res  = d.chart.result[0];
      var ts   = res.timestamp || [];
      var cls  = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      var data = [];
      for (var j = 0; j < ts.length; j++) {
        if (cls[j] != null && !isNaN(cls[j])) data.push({ x: ts[j] * 1000, y: cls[j] });
      }
      if (data.length > 1) return data;
    } catch(e) { console.error('[yahoo chart]', sym, e.message); }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════
//  CRYPTO  — CoinGecko primary, CoinCap fallback (free, no key needed)
// ══════════════════════════════════════════════════════════════════
var COINCAP_IDS = {
  'bitcoin':      'bitcoin',
  'ethereum':     'ethereum',
  'solana':       'solana',
  'dogecoin':     'dogecoin',
  'chainlink':    'chainlink',
  'bitget-token': 'bitget-token',
  'arena-z':      null,
};

async function getCryptoPrice(id) {
  // 1. CoinGecko
  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) + '&vs_currencies=inr';
    var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.ok) {
      var d = await r.json();
      if (d && d[id] && d[id].inr) return d[id].inr;
    }
  } catch(e) { console.error('[coingecko price]', id, e.message); }

  // 2. CoinCap USD → INR
  var capId = COINCAP_IDS[id];
  if (!capId) return null;
  try {
    var ra = await fetch('https://api.coincap.io/v2/assets/' + capId);
    var rf = await fetch('https://api.coincap.io/v2/rates/indian-rupee');
    if (!ra.ok || !rf.ok) return null;
    var da = await ra.json();
    var df = await rf.json();
    var usd    = parseFloat(da && da.data && da.data.priceUsd);
    var fxRate = parseFloat(df && df.data && df.data.rateUsd); // USD per 1 INR
    if (!usd || !fxRate) return null;
    return usd / fxRate;
  } catch(e) { console.error('[coincap price]', id, e.message); return null; }
}

var CRYPTO_DAYS = { '1H':'1','1D':'1','1W':'7','1M':'30','3M':'90','6M':'180','1Y':'365','2Y':'730' };
var COINCAP_IV  = { '1H':'m1','1D':'m5','1W':'m30','1M':'h2','3M':'h6','6M':'h12','1Y':'d1','2Y':'d1' };
var RANGE_MS    = { '1H':3600000,'1D':86400000,'1W':604800000,'1M':2592000000,'3M':7776000000,'6M':15552000000,'1Y':31536000000,'2Y':63072000000 };

async function getCryptoChart(id, range) {
  // 1. CoinGecko
  try {
    var days = CRYPTO_DAYS[range] || '1';
    var url  = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=inr&days=' + days;
    var r    = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.ok) {
      var d = await r.json();
      if (d && d.prices && d.prices.length > 1) {
        return d.prices.map(function(p) { return { x: p[0], y: p[1] }; });
      }
    }
  } catch(e) { console.error('[coingecko chart]', id, e.message); }

  // 2. CoinCap fallback
  var capId = COINCAP_IDS[id];
  if (!capId) return [];
  try {
    var iv    = COINCAP_IV[range] || 'm5';
    var end   = Date.now();
    var start = end - (RANGE_MS[range] || 86400000);
    var ru    = await fetch('https://api.coincap.io/v2/assets/' + capId + '/history?interval=' + iv + '&start=' + start + '&end=' + end);
    var rf2   = await fetch('https://api.coincap.io/v2/rates/indian-rupee');
    if (!ru.ok || !rf2.ok) return [];
    var du   = await ru.json();
    var dfx  = await rf2.json();
    var rate = parseFloat(dfx && dfx.data && dfx.data.rateUsd) || 0.012;
    return (du.data || []).map(function(p) { return { x: p.time, y: parseFloat(p.priceUsd) / rate }; });
  } catch(e) { console.error('[coincap chart]', id, e.message); return []; }
}

// ══════════════════════════════════════════════════════════════════
//  GOLD
// ══════════════════════════════════════════════════════════════════
async function getGoldPrice() {
  try {
    var r = await fetch('https://api.metalpriceapi.com/v1/latest?api_key=' + METAL_API_KEY + '&base=INR&currencies=XAU');
    if (r.ok) {
      var d = await r.json();
      if (d && d.rates && d.rates.XAU) return (1 / d.rates.XAU) / 31.1035;
    }
  } catch(e) { console.error('[gold]', e.message); }
  return null;
}

function buildGoldChart(base, range) {
  var CFG = {
    '1H':{ n:60,  ms:60000,    v:0.0003 },
    '1D':{ n:96,  ms:900000,   v:0.0008 },
    '1W':{ n:168, ms:3600000,  v:0.002  },
    '1M':{ n:120, ms:21600000, v:0.004  },
    '3M':{ n:90,  ms:86400000, v:0.006  },
    '1Y':{ n:365, ms:86400000, v:0.008  },
    '2Y':{ n:730, ms:86400000, v:0.01   },
  };
  var c   = CFG[range] || CFG['1D'];
  var now = Date.now();
  var arr = [];
  var p   = base * (1 - c.v * c.n * 0.5);
  for (var i = c.n; i >= 0; i--) {
    p = Math.max(p * (1 + (Math.random() - 0.48) * c.v), base * 0.75);
    arr.push({ x: now - i * c.ms, y: parseFloat(p.toFixed(2)) });
  }
  if (arr.length) arr[arr.length - 1].y = base;
  return arr;
}

// ══════════════════════════════════════════════════════════════════
//  PROXY ENDPOINTS
// ══════════════════════════════════════════════════════════════════

router.get('/proxy/stock', async function(req, res) {
  var sym = req.query.sym;
  if (!sym) return res.json({ price: null });
  var cached = getCache('sp:' + sym);
  if (cached !== null) return res.json({ price: cached });
  var price = await fetchYahooPrice(sym);
  if (price) setCache('sp:' + sym, price);
  res.json({ price: price });
});

router.get('/proxy/stock-chart', async function(req, res) {
  var sym   = req.query.sym;
  var range = req.query.range || '1D';
  if (!sym) return res.json({ data: [] });
  var ck = 'sc:' + sym + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await fetchYahooChart(sym, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

router.get('/proxy/crypto', async function(req, res) {
  var id = req.query.id;
  if (!id) return res.json({ price: null });
  var cached = getCache('cp:' + id);
  if (cached !== null) return res.json({ price: cached });
  var price = await getCryptoPrice(id);
  if (price) setCache('cp:' + id, price);
  res.json({ price: price });
});

router.get('/proxy/crypto-chart', async function(req, res) {
  var id    = req.query.id;
  var range = req.query.range || '1D';
  if (!id) return res.json({ data: [] });
  var ck = 'cc:' + id + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getCryptoChart(id, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

router.get('/proxy/gold', async function(req, res) {
  var cached = getCache('gold');
  if (cached !== null) return res.json({ price: cached });
  var price = await getGoldPrice();
  var final = price || 7400;
  if (price) setCache('gold', price);
  res.json({ price: final });
});

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
    console.error('[/holdings]', e.message);
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
  if (parseFloat(buyPrice) <= 0) return res.json({ success: false, msg: 'Buy price must be > 0' });

  try {
    var holding;
    if (type === 'stocks') {
      holding = new StockHolding({
        userEmail: req.userEmail, symbol: assetKey, name: name,
        quantity: parseFloat(quantity), buyPrice: parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate),
      });
    } else if (type === 'crypto') {
      holding = new CryptoHolding({
        userEmail: req.userEmail, coinId: assetKey, name: name,
        quantity: parseFloat(quantity), buyPrice: parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate), leverage: parseInt(leverage) || 1,
      });
    } else if (type === 'utility') {
      holding = new UtilityHolding({
        userEmail: req.userEmail, assetId: assetKey || 'gold', name: name || 'Digital Gold',
        quantity: parseFloat(quantity), buyPrice: parseFloat(buyPrice),
        purchaseDate: new Date(purchaseDate),
      });
    } else {
      return res.json({ success: false, msg: 'Invalid asset type' });
    }
    await holding.save();
    res.json({ success: true, id: holding._id });
  } catch(e) {
    console.error('[/add]', e.message);
    res.status(500).json({ success: false, msg: e.message });
  }
});

router.post('/remove', requireUser, async function(req, res) {
  var type = req.body.type;
  var id   = req.body.id;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var filter = { _id: id, userEmail: req.userEmail };
    if      (type === 'stock' || type === 'stocks') await StockHolding.deleteOne(filter);
    else if (type === 'crypto')                      await CryptoHolding.deleteOne(filter);
    else if (type === 'utility')                     await UtilityHolding.deleteOne(filter);
    else return res.json({ success: false, msg: 'Invalid type' });
    res.json({ success: true });
  } catch(e) {
    console.error('[/remove]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/update', requireUser, async function(req, res) {
  var type         = req.body.type;
  var id           = req.body.id;
  var quantity     = req.body.quantity;
  var buyPrice     = req.body.buyPrice;
  var purchaseDate = req.body.purchaseDate;
  var leverage     = req.body.leverage;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var filter = { _id: id, userEmail: req.userEmail };
    var update = {};
    if (quantity)     update.quantity     = parseFloat(quantity);
    if (buyPrice)     update.buyPrice     = parseFloat(buyPrice);
    if (purchaseDate) update.purchaseDate = new Date(purchaseDate);
    if (leverage)     update.leverage     = parseInt(leverage);
    if      (type === 'stock' || type === 'stocks') await StockHolding.updateOne(filter, update);
    else if (type === 'crypto')                      await CryptoHolding.updateOne(filter, update);
    else if (type === 'utility')                     await UtilityHolding.updateOne(filter, update);
    res.json({ success: true });
  } catch(e) {
    console.error('[/update]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

module.exports = router;
module.exports.models = { StockHolding, CryptoHolding, UtilityHolding };
