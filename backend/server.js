require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const User = require('./models/User');
const Referral = require('./models/Referral');

const app = express();

// Middleware
app.use(cors()); // ✅ FIXED
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve frontend (optional)
app.use(express.static(path.join(__dirname, '../frontend')));

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log('MongoDB connected'))
  .catch(err=>console.log(err));

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_PUBLIC_KEY,
    pass: process.env.EMAIL_PRIVATE_KEY
  }
});

// --- Helper Functions ---
function generateReferralCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- Routes ---
app.get('/signup', (req, res) => {
  const refCode = req.query.ref;
  if (refCode) res.cookie('ref', refCode, { maxAge: 7*24*60*60*1000 });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.post('/send-otp', async (req, res) => {
  try {
    const { name, email } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.json({ success: false, msg: "Email already exists" });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 5*60*1000);

    const referralCode = generateReferralCode();
    let referredBy = null;

    const refCode = req.cookies.ref;
    if (refCode) {
      const referrer = await User.findOne({ referralCode: refCode });
      if (referrer) referredBy = referrer._id;
    }

    const newUser = await User.create({ name, email, referralCode, referredBy, otp, otpExpires });

    await transporter.sendMail({
      from: process.env.EMAIL_PUBLIC_KEY,
      to: email,
      subject: 'Your OTP Code',
      html: `<p>Hi ${name},</p><p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`
    });

    res.json({ success: true, msg: "OTP sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Internal server error" });
  }
});

app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "User not found" });
    if (user.otp !== otp || user.otpExpires < new Date())
      return res.json({ success: false, msg: "Invalid or expired OTP" });

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    if (user.referredBy) {
      await User.findByIdAndUpdate(user.referredBy, { $inc: { rewardBalance: 50 } });
      await Referral.create({ referrerId: user.referredBy, refereeId: user._id, status: 'completed', rewardGranted: true });
    }

    res.json({ success: true, msg: "Signup complete", referralCode: user.referralCode, rewardBalance: user.rewardBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Internal server error" });
  }
});

app.listen(process.env.PORT || 5000, () => console.log(`✅ Server running on port ${process.env.PORT || 5000}`));
