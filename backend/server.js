require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');
const User = require('./models/User');
const Referral = require('./models/Referral');
const sendWelcomeMail = require('./welcomeMail');
const walletRoutes = require('./wallet');
const http = require("http");
const { Server } = require("socket.io");
const chatSocket = require("./chatSocket");

const app = express();

// ---------- MIDDLEWARE ----------
// ✅ Body parsers MUST come before ANY routes
app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: "10mb" }));        // ← MOVED UP ✅
app.use(bodyParser.json());                       // ← MOVED UP ✅
app.use(bodyParser.urlencoded({ extended: true })); // ← MOVED UP ✅
// ══════════════════════════════════════════════════════════════


// ────────────────────────────────────────────────────────────────────────


// ── PASTE THIS ROUTE BLOCK into server.js (after your middleware section) ──

app.post('/api/pdf/create', async (req, res) => {
  const os   = require('os');
  const fs   = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');
  const { PDFDocument } = require('pdf-lib');

  try {
    const {
      images = [], rotations = [], password = '',
      name = 'AmbikaShelf', pageSize = 'a4', orientation = 'p'
    } = req.body;

    if (!images.length) return res.status(400).json({ success:false, msg:'No images' });

    // ── Step 1: Build PDF with pdf-lib ──────────────────────
    const sizes = { a4:[595.28,841.89], letter:[612,792], a3:[841.89,1190.55] };
    let [W, H] = sizes[pageSize] || sizes.a4;
    if (orientation === 'l') [W, H] = [H, W];

    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < images.length; i++) {
      const dataUri = images[i];
      const b64     = dataUri.replace(/^data:image\/\w+;base64,/, '');
      const bytes   = Buffer.from(b64, 'base64');
      const img     = dataUri.startsWith('data:image/png')
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage([W, H]);
      const { width:iW, height:iH } = img.size();
      const rot = rotations[i] || 0;
      const scale = (rot===90||rot===270)
        ? Math.min(W/iH, H/iW)
        : Math.min(W/iW, H/iH);
      const dW = iW*scale, dH = iH*scale;
      page.drawImage(img, { x:(W-dW)/2, y:(H-dH)/2, width:dW, height:dH });
    }

    const pdfBytes = await pdfDoc.save();

    // ── Step 2: Encrypt with qpdf if password given ──────────
    const tmpDir  = os.tmpdir();
    const tmpIn   = path.join(tmpDir, `as_in_${Date.now()}.pdf`);
    const tmpOut  = path.join(tmpDir, `as_out_${Date.now()}.pdf`);
    fs.writeFileSync(tmpIn, Buffer.from(pdfBytes));

    let finalBytes;
    if (password && password.trim()) {
      const pwd = password.trim().replace(/'/g, ''); // sanitise
      execSync(`qpdf --encrypt '${pwd}' '${pwd}_owner' 256 -- '${tmpIn}' '${tmpOut}'`);
      finalBytes = fs.readFileSync(tmpOut);
    } else {
      finalBytes = Buffer.from(pdfBytes);
    }

    // ── Step 3: Cleanup & send ───────────────────────────────
    try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch(_){}

    const safeName = (name||'AmbikaShelf').replace(/[^\w\-]/g,'_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.setHeader('Content-Length', finalBytes.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(finalBytes);

  } catch (err) {
    console.error('PDF create error:', err.message);
    return res.status(500).json({ success:false, msg: err.message });
  }
});

app.use('/api/wallet', walletRoutes);             // ← MOVED DOWN ✅

// ---------- Sitemaps ----------
app.get("/sitemap.xml", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/sitemap.xml"));
});
app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/robots.txt"));
});

// ---------- FRONTEND ----------
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- MONGO CONNECTION ----------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB Error:', err));

// ---------- HELPERS ----------
function generateReferralCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const userMemory = {};

// ---------- ROUTES ----------
app.get('/signup', (req, res) => {
  const refCode = req.query.ref;
  if (refCode) res.cookie('ref', refCode, { maxAge: 7*24*60*60*1000 });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/worldchat', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/worldchat.html'));
});

// ---------- SEND OTP ----------
app.post('/send-otp', async (req, res) => {
  try {
    const { name, email, refCode, password } = req.body;
    if (!name || !email)
      return res.json({ success: false, msg: "Name and email required" });

    const existing = await User.findOne({ email });
    if (existing) return res.json({ success: false, msg: "Email already registered" });

    const otp          = generateOTP();
    const otpExpires   = new Date(Date.now() + 5 * 60 * 1000);
    const referralCode = generateReferralCode();

    let referredBy = null;
    const cookieRef = req.cookies.ref;
    const finalRef  = refCode || cookieRef;
    if (finalRef) {
      const referrer = await User.findOne({ referralCode: finalRef });
      if (referrer) referredBy = referrer._id;
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    await User.create({
      name, email, referralCode, referredBy,
      otp, otpExpires,
      password: hashedPassword
    });

    return res.json({ success: true, msg: "OTP generated", otp });
  } catch (err) {
    console.error('❌ /send-otp:', err.message);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- VERIFY OTP ----------
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "User not found" });

    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.json({ success: false, msg: "Invalid or expired OTP" });
    }

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    if (user.referredBy) {
      await User.findByIdAndUpdate(user.referredBy, { $inc: { rewardBalance: 50 } });
      await Referral.create({
        referrerId: user.referredBy,
        refereeId: user._id,
        status: 'completed',
        rewardGranted: true
      });
    }

    try {
      await sendWelcomeMail({ email: user.email, username: user.name, name: user.name });
    } catch (emailError) {
      console.error('💥 WELCOME EMAIL ERROR:', emailError.message);
    }

    res.json({
      success: true,
      msg: "Signup successful!",
      referralCode: user.referralCode,
      rewardBalance: user.rewardBalance || 0
    });

  } catch (err) {
    console.error('❌ /verify-otp:', err.message);
    res.status(500).json({ success: false, msg: "Internal server error" });
  }
});

// ---------- LOGIN ----------
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found with this email" });

    if (!user.password)
      return res.json({ success: false, msg: "This account was created with Google. Please use Google login." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, msg: "Incorrect password" });

    res.json({
      success:       true,
      name:          user.name,
      referralCode:  user.referralCode,
      rewardBalance: user.rewardBalance || 0
    });

  } catch (err) {
    console.error('❌ /login:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- GOOGLE AUTH ----------
app.post('/google-auth', async (req, res) => {
  try {
    const { name, email, googleId, password, refCode } = req.body;

    let user = await User.findOne({ email });

    if (user) {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
      return res.json({
        success:       true,
        isNew:         false,
        name:          user.name,
        referralCode:  user.referralCode,
        rewardBalance: user.rewardBalance || 0
      });
    }

    if (!password) {
      return res.json({ success: true, isNew: true });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode   = generateReferralCode();

    let referredBy = null;
    if (refCode) {
      const referrer = await User.findOne({ referralCode: refCode });
      if (referrer) {
        referredBy = referrer._id;
        referrer.rewardBalance = (referrer.rewardBalance || 0) + 50;
        await referrer.save();
      }
    }

    user = await User.create({
      name, email, googleId, referralCode, referredBy,
      password: hashedPassword,
      rewardBalance: 0,
      otp: null, otpExpires: null
    });

    try {
      await sendWelcomeMail({ email: user.email, username: user.name, name: user.name });
    } catch (e) {
      console.error('💥 Welcome email error:', e.message);
    }

    return res.json({
      success:       true,
      isNew:         false,
      name:          user.name,
      referralCode:  user.referralCode,
      rewardBalance: 0
    });

  } catch (err) {
    console.error('❌ /google-auth:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- FORGOT PASSWORD ----------
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found with this email" });

    const otp = generateOTP();
    user.otp        = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    res.json({ success: true, otp });
  } catch (err) {
    console.error('❌ /forgot-password:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- RESET PASSWORD ----------
app.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user)                        return res.json({ success: false, msg: "User not found" });
    if (user.otp !== otp)             return res.json({ success: false, msg: "Invalid OTP" });
    if (user.otpExpires < new Date()) return res.json({ success: false, msg: "OTP expired" });

    user.password   = await bcrypt.hash(newPassword, 10);
    user.otp        = null;
    user.otpExpires = null;
    await user.save();

    res.json({ success: true, msg: "Password reset successfully" });
  } catch (err) {
    console.error('❌ /reset-password:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- ASK AI ----------
console.log("Loaded Gemini Key:", process.env.GEMINI_API_KEY);

app.post("/ask-ai", async (req, res) => {
  const { text, image, username } = req.body;

  if (!userMemory[username]) userMemory[username] = [];

  try {
    let parts = [{ text: text || "Describe this image" }];

    if (image) {
      const match = image.match(/^data:(.*);base64/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: image.split(",")[1] } });
      }
    }

    userMemory[username].push({ role: "user", parts });
    if (userMemory[username].length > 5) userMemory[username].shift();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{
                text: `
You are AmbikaShelf AI.
User name is ${username}.
You are friendly, smart, slightly witty, and helpful.
You represent AmbikaShelf.shop — an online platform.

Rules:
- Always respond as AmbikaShelf.
- Keep answers short and clean.
- If user greets, greet warmly.
- If unsure, say politely you don't know.
- Use simple language.

Founder and CEO of AmbikaShelf is Anuj Chauhan.

Features of AmbikaShelf:
- Users can scan and create QR through: ambikashelf.shop/qr.html
- A world chatting platform including image and text input
- An AmbikaShelf AI chatbot (you)

More About Us:
AmbikaShelf Enterprises is a technology-driven organization founded and operated by Anuj Chauhan.
Customer Support: support@ambikashelf.shop
Business Partnerships: business@ambikashelf.shop
WhatsApp: +91 9125573750
`
              }]
            },
            ...userMemory[username]
          ]
        })
      }
    );

    const data = await response.json();
    console.log("Gemini Raw Response:", JSON.stringify(data, null, 2));

    if (data.error) return res.json({ reply: "Gemini API Error: " + data.error.message });

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini returned empty response.";

    userMemory[username].push({ role: "model", parts: [{ text: reply }] });
    if (userMemory[username].length > 5) userMemory[username].shift();

    res.json({ reply });

  } catch (err) {
    console.error("AI Server Error:", err);
    res.json({ reply: "Server error while calling AI." });
  }
});

// ---------- CREATE HTTP SERVER ----------
const server = http.createServer(app);

// ---------- SOCKET.IO ----------
const io = new Server(server);
chatSocket(io);

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
