// ============================================
// SERVER.JS - COMPLETE FIXED VERSION FOR RENDER
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');

// ---------- IMPORT MODELS ----------
const User = require('./models/User');
const Referral = require('./models/Referral');

// ---------- IMPORT WELCOME MAIL ----------
let sendWelcomeMail;
try {
    sendWelcomeMail = require('./welcomeMail');
    console.log('📧 WelcomeMail module loaded: ✅ SUCCESS');
} catch (error) {
    console.error('❌ WelcomeMail module failed to load:', error.message);
    // Create fallback function
    sendWelcomeMail = async ({ email, username, name }) => {
        console.log('📧 FALLBACK: Welcome email would be sent to:', email);
        console.log('   To fix: Check welcomeMail.js file and EmailJS credentials');
        return false;
    };
}

const app = express();

// ---------- ENVIRONMENT VARIABLES CHECK ----------
console.log('\n' + '='.repeat(60));
console.log('🚀 AMBIKASHELF REFER & EARN - RENDER DEPLOYMENT');
console.log('='.repeat(60));
console.log('📋 ENVIRONMENT CHECK:');

// FIX: Handle MongoDB URI - MUST include database name
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log('📊 MongoDB URI:', MONGO_URI ? '✅ Present' : '❌ MISSING');

if (MONGO_URI) {
    // Check if database name is included
    if (!MONGO_URI.includes('.net/') || MONGO_URI.includes('.net/?') || MONGO_URI.includes('.net/?')) {
        console.warn('⚠️ WARNING: Your MongoDB URI might be missing a database name!');
        console.warn('   Should be: ...mongodb.net/DATABASE_NAME?parameters...');
    }
    // Mask password for logging
    const maskedUri = MONGO_URI.replace(/:([^:@]+)@/, ':***@');
    console.log('   Connection:', maskedUri);
}

console.log('🔐 COOKIE_SECRET:', process.env.COOKIE_SECRET ? '✅ Set' : '❌ MISSING');
console.log('📧 EMAILJS CONFIG:');
console.log('   SERVICE_ID2:', process.env.SERVICE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   TEMPLATE_ID2:', process.env.TEMPLATE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   PUBLIC_KEY2:', process.env.PUBLIC_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('   PRIVATE_KEY2:', process.env.PRIVATE_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('='.repeat(60) + '\n');

// ---------- MIDDLEWARE ----------
app.use(cors({ origin: '*', credentials: true }));

// Use cookie secret with fallback (but log warning)
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'ambikashelf-fallback-secret-2026';
if (!process.env.COOKIE_SECRET) {
    console.warn('⚠️ Warning: Using fallback COOKIE_SECRET. Set this in environment variables!');
}
app.use(cookieParser(COOKIE_SECRET));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// ---------- STATIC FILES ----------
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- MONGO CONNECTION - FIXED ----------
if (!MONGO_URI) {
    console.error('❌ CRITICAL: No MongoDB URI found!');
    console.error('   Set MONGO_URI in Render environment variables');
    process.exit(1);
}

// Check if database name is missing and show helpful error
if (MONGO_URI.includes('.net/?') || MONGO_URI.includes('.net/?')) {
    console.error('❌ CRITICAL: Your MongoDB URI is missing a database name!');
    console.error('\n🔧 FIX THIS NOW:');
    console.error('   1. Go to Render Dashboard → Environment Variables');
    console.error('   2. Update MONGO_URI to include a database name:');
    console.error('\n   CURRENT:');
    console.error(`   ${MONGO_URI.replace(/:([^:@]+)@/, ':***@')}`);
    console.error('\n   SHOULD BE:');
    console.error(`   mongodb+srv://ambikashelf:YOUR_PASSWORD@cluster0.pulil65.mongodb.net/ambikashelf?retryWrites=true&w=majority&appName=Cluster0`);
    console.error('\n   ⚠️ Replace YOUR_PASSWORD with your actual MongoDB password');
    process.exit(1);
}

// Connect to MongoDB
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB connected successfully');
        console.log(`   Database: ${mongoose.connection.name}`);
        console.log(`   Host: ${mongoose.connection.host}`);
    })
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
        console.error('\n🔍 TROUBLESHOOTING:');
        console.error('   1. Verify your password is correct in MONGO_URI');
        console.error('   2. Go to MongoDB Atlas → Network Access → Add 0.0.0.0/0');
        console.error('   3. Check if database user has read/write permissions');
        console.error('   4. Make sure database name exists in the connection string');
        console.error('   5. Try creating the database first in MongoDB Atlas');
        process.exit(1);
    });

// ---------- HELPERS ----------
function generateReferralCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ---------- ROUTES ----------
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        database: mongoose.connection.name || 'unknown',
        time: new Date().toISOString()
    });
});

app.get('/signup', (req, res) => {
    const refCode = req.query.ref;
    if (refCode) {
        res.cookie('ref', refCode, {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        console.log('🍪 Referral cookie set:', refCode);
    }
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ---------- SEND OTP ----------
app.post('/send-otp', async (req, res) => {
    try {
        const { name, email, refCode } = req.body;
        console.log('📤 /send-otp:', { name, email, refCode });

        if (!name || !email) {
            return res.json({ success: false, msg: "Name and email required" });
        }

        const existing = await User.findOne({ email });
        if (existing) {
            return res.json({ success: false, msg: "Email already registered" });
        }

        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);
        const referralCode = generateReferralCode();

        let referredBy = null;
        const cookieRef = req.cookies.ref;
        const finalRef = refCode || cookieRef;
        
        if (finalRef) {
            const referrer = await User.findOne({ referralCode: finalRef });
            if (referrer) {
                referredBy = referrer._id;
                console.log('🎁 Referral detected:', referrer.email);
            }
        }

        await User.create({
            name,
            email,
            referralCode,
            referredBy,
            otp,
            otpExpires,
            rewardBalance: 0,
            verified: false,
            createdAt: new Date()
        });

        console.log('✅ User created:', { email, referralCode });
        
        return res.json({
            success: true,
            msg: "OTP sent successfully",
            // Only return OTP in development
            otp: process.env.NODE_ENV === 'development' ? otp : undefined
        });
        
    } catch (err) {
        console.error('❌ /send-otp error:', err);
        return res.status(500).json({ success: false, msg: "Server error" });
    }
});

// ---------- VERIFY OTP ----------
app.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        console.log('🔐 /verify-otp:', { email });

        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ success: false, msg: "User not found" });
        }

        if (user.otp !== otp || user.otpExpires < new Date()) {
            console.log('❌ Invalid OTP for:', email);
            return res.json({ success: false, msg: "Invalid or expired OTP" });
        }

        // Clear OTP
        user.otp = null;
        user.otpExpires = null;
        user.verified = true;
        await user.save();
        console.log('✅ OTP verified for:', email);

        // Process referral
        if (user.referredBy) {
            try {
                await User.findByIdAndUpdate(user.referredBy, { $inc: { rewardBalance: 50 } });
                await Referral.create({
                    referrerId: user.referredBy,
                    refereeId: user._id,
                    status: 'completed',
                    rewardGranted: true,
                    rewardAmount: 50
                });
                console.log('🎁 Referral reward granted');
            } catch (refError) {
                console.error('⚠️ Referral error:', refError);
            }
        }

        // Send welcome email (don't await - non-blocking)
        console.log('📧 Triggering welcome email for:', user.email);
        sendWelcomeMail({
            email: user.email,
            username: user.name,
            name: user.name
        }).catch(err => console.error('📧 Email error:', err));

        // Clear referral cookie
        res.clearCookie('ref');
        
        res.json({
            success: true,
            msg: "Signup successful!",
            referralCode: user.referralCode,
            rewardBalance: user.rewardBalance || 0
        });
        
    } catch (err) {
        console.error('❌ /verify-otp error:', err);
        res.status(500).json({ success: false, msg: "Internal server error" });
    }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log(`✅ SERVER RUNNING SUCCESSFULLY`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`📧 Email Service: ${typeof sendWelcomeMail === 'function' ? 'Configured' : 'Fallback'}`);
    console.log(`🔗 Health Check: https://refer-earn-app.onrender.com/health`);
    console.log('='.repeat(60) + '\n');
});

module.exports = app;
