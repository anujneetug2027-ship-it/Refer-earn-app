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
const mutualFundHoldingSchema = new mongoose.Schema({
  userEmail: { type:String, required:true, index:true },
  schemeCode: { type:String, required:true },
  name: { type:String, required:true },
  mode: { type:String, enum:['one-time','sip'], required:true },
  investmentAmount: { type:Number, min:0 },
  purchaseDate: { type:Date },
  buyPrice: { type:Number, min:0 },
  sipStartDate: { type:String },
  sipAmount: { type:Number, min:0 },
  sipDay: { type:Number, min:1, max:31 },
  addedAt: { type:Date, default:Date.now }
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
const MutualFundHolding = mongoose.models.MutualFundHolding || mongoose.model('MutualFundHolding', mutualFundHoldingSchema);

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

// ── Yahoo Finance stock search/quotes/history ───────────────────────
// Yahoo is used as the server-side market-data fallback for Indian equities.
// It covers the full NSE universe instead of the small hard-coded symbol map.
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*'
};

async function getYahooChart(sym, range) {
  const periods = {
    '1D':  { range:'1d', interval:'5m' },
    '1W':  { range:'5d', interval:'30m' },
    '1M':  { range:'1mo', interval:'1d' },
    '3M':  { range:'3mo', interval:'1d' },
    '1Y':  { range:'1y', interval:'1d' },
    '2Y':  { range:'2y', interval:'1d' }
  };
  const cfg = periods[range] || periods['1D'];
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) +
      '?range=' + cfg.range + '&interval=' + cfg.interval + '&events=history&includeAdjustedClose=true';
    const r = await fetch(url, { headers: YAHOO_HEADERS });
    if (!r.ok) return [];
    const d = await r.json();
    const result = d && d.chart && d.chart.result && d.chart.result[0];
    if (!result || !result.timestamp || !result.indicators) return [];
    const q = (result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose) ||
              (result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
    return result.timestamp.map((ts, i) => ({ x: ts * 1000, y: Number(q[i]) }))
      .filter(p => Number.isFinite(p.y) && p.y > 0);
  } catch(e) { console.error('[yahoo chart]', sym, e.message); return []; }
}

async function getNSEPrice(sym) {
  const chart = await getYahooChart(sym, '1D');
  if (chart.length) return chart[chart.length - 1].y;
  return null;
}

async function searchStocks(q) {
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=25&newsCount=0&enableFuzzyQuery=true';
    const r = await fetch(url, { headers: YAHOO_HEADERS });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.quotes || []).filter(x => x.symbol && /\.NS$|\.BO$/.test(x.symbol) && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
      .map(x => ({ sym:x.symbol, name:x.longname || x.shortname || x.symbol.replace(/\.(NS|BO)$/,''), exchange:x.exchange || '' }))
      .slice(0, 20);
  } catch(e) { console.error('[stock search]', e.message); return []; }
}

// Actual historical stock chart — never simulated.
function buildStockChart(basePrice, sym, range) { return getYahooChart(sym, range); }

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
//  PRECIOUS METALS — MetalpriceAPI (Gold / Silver / Platinum)
// ══════════════════════════════════════════════════════════════════
const METALS = { gold:'XAU', silver:'XAG', platinum:'XPT' };
const TROY_OZ_GRAMS = 31.1034768;

async function getMetalPrices() {
  try {
    const url = 'https://api.metalpriceapi.com/v1/latest?api_key=' + METAL_API_KEY + '&base=INR&currencies=XAU,XAG,XPT';
    const r = await fetch(url);
    if (!r.ok) return {};
    const d = await r.json();
    const out = {};
    for (const [id, code] of Object.entries(METALS)) {
      if (d && d.rates && d.rates[code]) out[id] = (1 / Number(d.rates[code])) / TROY_OZ_GRAMS;
    }
    return out;
  } catch(e) { console.error('[metals]', e.message); return {}; }
}

async function getMetalPrice(assetId) {
  const all = await getMetalPrices();
  return all[assetId] || null;
}

async function getMetalHistory(assetId, days) {
  const code = METALS[assetId];
  if (!code) return [];
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 86400000);
    const fmt = d => d.toISOString().slice(0,10);
    const url = 'https://api.metalpriceapi.com/v1/timeframe?api_key=' + METAL_API_KEY +
      '&base=INR&currencies=' + code + '&start_date=' + fmt(start) + '&end_date=' + fmt(end);
    const r = await fetch(url);
    if (!r.ok) return [];
    const d = await r.json();
    const rates = d && d.rates ? d.rates : {};
    return Object.keys(rates).sort().map(date => {
      const rate = rates[date] && rates[date][code];
      return { x: new Date(date + 'T23:59:00Z').getTime(), y: rate ? (1 / Number(rate)) / TROY_OZ_GRAMS : NaN };
    }).filter(p => Number.isFinite(p.y));
  } catch(e) { console.error('[metal history]', assetId, e.message); return []; }
}

async function getMetalChart(assetId, range) {
  const days = { '1D':2, '1W':8, '1M':35, '3M':100, '1Y':370, '2Y':740 }[range] || 35;
  const data = await getMetalHistory(assetId, days);
  if (data.length > 1) return data;
  const base = await getMetalPrice(assetId);
  return base ? [{x:Date.now()-86400000,y:base},{x:Date.now(),y:base}] : [];
}

// ══════════════════════════════════════════════════════════════════
//  MUTUAL FUNDS — AMFI-backed MFAPI (search + NAV history)
// ══════════════════════════════════════════════════════════════════
async function searchMutualFunds(q) {
  try {
    const r = await fetch('https://api.mfapi.in/mf/search?q=' + encodeURIComponent(q));
    if (!r.ok) return [];
    const d = await r.json();
    return (Array.isArray(d) ? d : []).slice(0, 30).map(x => ({ schemeCode:String(x.schemeCode), schemeName:x.schemeName }));
  } catch(e) { console.error('[mf search]', e.message); return []; }
}

async function getMFData(schemeCode) {
  try {
    const r = await fetch('https://api.mfapi.in/mf/' + encodeURIComponent(schemeCode));
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !Array.isArray(d.data) || !d.data.length) return null;
    d.data = d.data.map(x => ({ date:x.date, nav:Number(x.nav) })).filter(x => Number.isFinite(x.nav));
    return d;
  } catch(e) { console.error('[mf data]', schemeCode, e.message); return null; }
}

function mfDateToMs(date) {
  const p = String(date).split('-');
  return new Date(Number(p[2]), Number(p[1])-1, Number(p[0])).getTime();
}

function navOnOrBefore(data, targetMs) {
  for (const p of data) if (mfDateToMs(p.date) <= targetMs) return p.nav;
  return null;
}

function navOnOrAfter(data, targetMs) {
  let last = null;
  for (let i=data.length-1;i>=0;i--) {
    const ms = mfDateToMs(data[i].date);
    if (ms >= targetMs) last = data[i].nav;
  }
  return last ? last.nav : null;
}

function sipUnitsFromHistory(data, startDate, amount, sipDay) {
  const start = new Date(startDate + 'T00:00:00');
  const today = new Date();
  let units = 0, invested = 0, installments = 0;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate()+1)) {
    if (d.getDate() !== Number(sipDay)) continue;
    const nav = navOnOrAfter(data, d.getTime());
    if (nav && nav > 0) { units += Number(amount) / nav; invested += Number(amount); installments++; }
  }
  return { units, invested, installments };
}

async function calculateMFHolding(h) {
  const dataObj = await getMFData(h.schemeCode);
  if (!dataObj) return null;
  const data = dataObj.data;
  const latestNav = data[0].nav;
  let units = 0, invested = 0, contributions = [];
  if (h.mode === 'sip') {
    const r = sipUnitsFromHistory(data, h.sipStartDate, h.sipAmount, h.sipDay);
    units = r.units; invested = r.invested;
    // contributions are reconstructed below for period P&L.
    const start = new Date(h.sipStartDate + 'T00:00:00');
    const today = new Date();
    for (let d=new Date(start); d<=today; d.setDate(d.getDate()+1)) {
      if (d.getDate()===Number(h.sipDay)) contributions.push({ms:d.getTime(), amount:Number(h.sipAmount)});
    }
  } else {
    const nav = navOnOrAfter(data, new Date(h.purchaseDate).getTime()) || Number(h.buyPrice);
    units = Number(h.investmentAmount || 0) / nav;
    invested = Number(h.investmentAmount || 0);
    contributions.push({ms:new Date(h.purchaseDate).getTime(), amount:invested});
  }
  const currentValue = units * latestNav;
  const periodPnl = {};
  const periods = { day:1, week:7, month:30, year:365 };
  for (const [key,days] of Object.entries(periods)) {
    const startMs = Date.now() - days*86400000;
    const navStart = navOnOrBefore(data, startMs) || latestNav;
    let unitsAtStart = 0, contributed = 0;
    if (h.mode === 'sip') {
      for (const c of contributions) if (c.ms < startMs) {
        const nav = navOnOrAfter(data, c.ms) || latestNav;
        unitsAtStart += c.amount / nav;
      }
      contributed = contributions.filter(c => c.ms >= startMs).reduce((a,c)=>a+c.amount,0);
    } else {
      if (new Date(h.purchaseDate).getTime() < startMs) unitsAtStart = units;
      contributed = (new Date(h.purchaseDate).getTime() >= startMs) ? invested : 0;
    }
    const startValue = unitsAtStart * navStart;
    periodPnl[key] = currentValue - startValue - contributed;
  }
  return { latestNav, units, invested, currentValue, overallPnl:currentValue-invested, periodPnl, data };
}

// ══════════════════════════════════════════════════════════════════
//  PROXY / SEARCH ROUTES
// ══════════════════════════════════════════════════════════════════
router.get('/search/stocks', async function(req,res) {
  res.json({ success:true, results:await searchStocks(req.query.q || '') });
});
router.get('/search/mutual-funds', async function(req,res) {
  res.json({ success:true, results:await searchMutualFunds(req.query.q || '') });
});
router.get('/proxy/mutual-fund', async function(req,res) {
  const code = req.query.scheme;
  if (!code) return res.json({ price:null });
  const d = await getMFData(code);
  res.json({ price:d ? d.data[0].nav : null, meta:d ? d.meta : null });
});
router.get('/proxy/mutual-fund-chart', async function(req,res) {
  const code = req.query.scheme, range=req.query.range||'1Y';
  if (!code) return res.json({data:[]});
  const d = await getMFData(code);
  if (!d) return res.json({data:[]});
  const days = { '1D':2,'1W':8,'1M':35,'3M':100,'1Y':370,'2Y':740 }[range] || 370;
  const cutoff = Date.now()-days*86400000;
  res.json({data:d.data.filter(x=>mfDateToMs(x.date)>=cutoff).reverse().map(x=>({x:mfDateToMs(x.date),y:x.nav}))});
});
router.get('/proxy/metal', async function(req,res) {
  const id=req.query.id||'gold';
  res.json({price:await getMetalPrice(id)});
});
router.get('/proxy/metal-chart', async function(req,res) {
  res.json({data:await getMetalChart(req.query.id||'gold',req.query.range||'1D')});
});

// Compatibility aliases retained for the existing gold UI.
router.get('/proxy/gold', async function(req,res) { res.json({price:await getMetalPrice('gold')}); });
router.get('/proxy/gold-chart', async function(req,res) { res.json({data:await getMetalChart('gold',req.query.range||'1D')}); });

// ══════════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE
// ══════════════════════════════════════════════════════════════════

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
      MutualFundHolding.find({ userEmail: req.userEmail }).lean(),
    ]);
    const mutualFunds = [];
    for (const h of results[3]) {
      const calc = await calculateMFHolding(h);
      mutualFunds.push({ ...h, ...(calc || {}) });
    }
    res.json({ success: true, portfolio: { stocks: results[0], crypto: results[1], utility: results[2], mutualFunds } });
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
  var mode         = req.body.mode;
  var investmentAmount = req.body.investmentAmount;
  var sipStartDate = req.body.sipStartDate;
  var sipAmount    = req.body.sipAmount;
  var sipDay       = req.body.sipDay;

  if (!type || !name) return res.json({ success:false, msg:'Missing required fields' });
  if (type === 'mutualFunds') {
    if (!assetKey || !mode) return res.json({success:false,msg:'Missing mutual fund details'});
    if (mode === 'one-time' && (!(Number(investmentAmount)>0) || !purchaseDate)) return res.json({success:false,msg:'Enter investment amount and purchase date'});
    if (mode === 'sip' && (!(Number(sipAmount)>0) || !sipStartDate || !(Number(sipDay)>=1 && Number(sipDay)<=31))) return res.json({success:false,msg:'Enter SIP amount, start date and SIP date'});
  } else {
    if (!quantity || !buyPrice || !purchaseDate) return res.json({ success:false, msg:'Missing required fields' });
    if (parseFloat(quantity) <= 0) return res.json({ success:false, msg:'Quantity must be > 0' });
    if (parseFloat(buyPrice) <= 0) return res.json({ success:false, msg:'Buy price must be > 0' });
  }
  try {
    var h;
    if (type === 'mutualFunds') {
      h = new MutualFundHolding({ userEmail:req.userEmail, schemeCode:assetKey, name:name, mode, investmentAmount:Number(investmentAmount)||0, purchaseDate:purchaseDate?new Date(purchaseDate):undefined, buyPrice:Number(buyPrice)||0, sipStartDate, sipAmount:Number(sipAmount)||0, sipDay:Number(sipDay)||0 });
    } else if (type === 'stocks') {
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

// Exact portfolio P&L snapshots for Day / Week / Month / Year.
// P&L is mark-to-market change from the beginning of the period, adjusted for
// contributions made during the period (SIP installments included).
router.get('/performance', requireUser, async function(req,res) {
  try {
    const [stocks, crypto, utility, mfs] = await Promise.all([
      StockHolding.find({userEmail:req.userEmail}).lean(),
      CryptoHolding.find({userEmail:req.userEmail}).lean(),
      UtilityHolding.find({userEmail:req.userEmail}).lean(),
      MutualFundHolding.find({userEmail:req.userEmail}).lean()
    ]);
    const out = { day:0, week:0, month:0, year:0, stocks:[], mutualFunds:[], utility:[] };
    const periodDays = {day:1,week:7,month:30,year:365};
    for (const h of stocks) {
      const chart = await getYahooChart(h.symbol,'1Y');
      const now = chart.length ? chart[chart.length-1].y : await getNSEPrice(h.symbol);
      const item={name:h.name,symbol:h.symbol,day:0,week:0,month:0,year:0};
      for (const [k,days] of Object.entries(periodDays)) {
        const cutoff=Date.now()-days*86400000;
        const old=chart.filter(p=>p.x<=cutoff).pop();
        item[k]=now && old ? (now-old.y)*h.quantity : 0;
      }
      out.stocks.push(item);
    }
    // Keep existing crypto behavior intact while adding exact period snapshots where history is available.
    for (const h of crypto) {
      const chart = await getCryptoChart(h.coinId,'1Y');
      const now = chart.length ? chart[chart.length-1].y : await getCryptoPrice(h.coinId);
      const item={name:h.name,coinId:h.coinId,day:0,week:0,month:0,year:0};
      for (const [k,days] of Object.entries(periodDays)) {
        const cutoff=Date.now()-days*86400000;
        const old=chart.filter(p=>p.x<=cutoff).pop();
        item[k]=now && old ? (now-old.y)*h.quantity*(h.leverage||1) : 0;
      }
      out.crypto = out.crypto || []; out.crypto.push(item);
    }
    for (const h of utility) {
      const item={name:h.name,assetId:h.assetId,day:0,week:0,month:0,year:0};
      const chart=await getMetalHistory(h.assetId||'gold',365);
      const now=chart.length?chart[chart.length-1].y:await getMetalPrice(h.assetId||'gold');
      for (const [k,days] of Object.entries(periodDays)) {
        const cutoff=Date.now()-days*86400000;
        const old=chart.filter(p=>p.x<=cutoff).pop();
        item[k]=now&&old?(now-old.y)*h.quantity:0;
      }
      out.utility.push(item);
    }
    for (const h of mfs) {
      const calc=await calculateMFHolding(h);
      const item={name:h.name,schemeCode:h.schemeCode,mode:h.mode,day:calc?.periodPnl?.day||0,week:calc?.periodPnl?.week||0,month:calc?.periodPnl?.month||0,year:calc?.periodPnl?.year||0};
      out.mutualFunds.push(item);
    }
    for (const key of Object.keys(periodDays)) {
      out[key] = [...out.stocks,...(out.crypto||[]),...out.utility,...out.mutualFunds].reduce((sum,x)=>sum+Number(x[key]||0),0);
    }
    res.json({success:true,performance:out});
  } catch(e) { console.error('[performance]',e.message); res.status(500).json({success:false,msg:'Performance calculation failed'}); }
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
    else if (type === 'mutualFunds' || type === 'mutualFund') await MutualFundHolding.deleteOne(f);
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
    if (req.body.investmentAmount) u.investmentAmount = parseFloat(req.body.investmentAmount);
    if (req.body.sipAmount) u.sipAmount = parseFloat(req.body.sipAmount);
    if (req.body.sipDay) u.sipDay = parseInt(req.body.sipDay);
    if (req.body.sipStartDate) u.sipStartDate = req.body.sipStartDate;
    if      (type === 'stock' || type === 'stocks') await StockHolding.updateOne(f, u);
    else if (type === 'crypto')                      await CryptoHolding.updateOne(f, u);
    else if (type === 'utility')                     await UtilityHolding.updateOne(f, u);
    else if (type === 'mutualFunds' || type === 'mutualFund') await MutualFundHolding.updateOne(f, u);
    res.json({ success: true });
  } catch(e) {
    console.error('[update]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

module.exports = router;
module.exports.models = { StockHolding, CryptoHolding, UtilityHolding, MutualFundHolding };
