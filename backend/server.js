// ============================================
// SERVER.JS - COMPLETE FIXED VERSION WITH EMAIL DEBUGGING
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

// ---------- IMPORT WELCOME MAIL WITH DEBUG ----------
let sendWelcomeMail;
try {
    sendWelcomeMail = require('./welcomeMail');
    console.log('📧 WelcomeMail module loaded:', typeof sendWelcomeMail === 'function' ? '✅ SUCCESS' : '❌ NOT A FUNCTION');
} catch (error) {
    console.error('❌ Failed to load welcomeMail:', error.message);
    // Create fallback that logs but doesn't crash
    sendWelcomeMail = async ({ email, username, name }) => {
        console.log('📧 FALLBACK: Welcome email would be sent to:', email);
        console.log('   Username:', username);
        console.log('   Name:', name);
        return false;
    };
}

const app = express();

// ---------- ENVIRONMENT VALIDATION ----------
console.log('\n' + '='.repeat(60));
console.log('🚀 AMBIKASHELF REFER & EARN - RENDER DEPLOYMENT');
console.log('='.repeat(60));

// Handle MongoDB URI
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log('📊 MongoDB URI:', MONGO_URI ? '✅ Present' : '❌ MISSING');
if (MONGO_URI) {
    const maskedUri = MONGO_URI.replace(/:([^:@]+)@/, ':***@');
    console.log('   Connection:', maskedUri);
}

// Cookie Secret
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'ambikashelf-fallback-secret-2026';
console.log('🔐 Cookie Secret:', process.env.COOKIE_SECRET ? '✅ Set' : '⚠️ Using fallback');

// EmailJS Configuration
console.log('📧 EmailJS Config:');
console.log('   SERVICE_ID2:', process.env.SERVICE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   TEMPLATE_ID2:', process.env.TEMPLATE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   PUBLIC_KEY2:', process.env.PUBLIC_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('   PRIVATE_KEY2:', process.env.PRIVATE_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('='.repeat(60) + '\n');

// ---------- MIDDLEWARE ----------
app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser(COOKIE_SECRET));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- REQUEST LOGGING MIDDLEWARE ----------
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// ---------- STATIC FILES ----------
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- MONGO CONNECTION ----------
if (!MONGO_URI) {
    console.error('❌ CRITICAL: No MongoDB URI found!');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB connected successfully');
        console.log(`   Database: ${mongoose.connection.name}`);
        console.log(`   Host: ${mongoose.connection.host}`);
    })
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        database: mongoose.connection.name || 'unknown',
        time: new Date().toISOString()
    });
});

// Test email endpoint - REMOVE AFTER TESTING
app.get('/test-email/:email', async (req, res) => {
    const email = req.params.email;
    console.log('🧪 TEST EMAIL ENDPOINT CALLED FOR:', email);
    
    try {
        const result = await sendWelcomeMail({
            email: email,
            username: 'TestUser',
            name: 'Test User'
        });
        
        console.log('🧪 Test email result:', result ? '✅ SUCCESS' : '❌ FAILED');
        
        res.json({
            success: result,
            message: result ? '✅ Test email sent successfully!' : '❌ Test email failed!',
            email: email,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('🧪 Test email error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Signup page with referral cookie
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
        console.log('📤 /send-otp called:', { name, email, refCode: refCode || 'none' });

        if (!name || !email) {
            return res.json({ success: false, msg: "Name and email required" });
        }

        const existing = await User.findOne({ email });
        if (existing) {
            console.log('❌ Email already registered:', email);
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
                console.log('🎁 Referral detected - Referrer:', referrer.email);
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
            otp: process.env.NODE_ENV === 'development' ? otp : undefined
        });
        
    } catch (err) {
        console.error('❌ /send-otp error:', err);
        return res.status(500).json({ success: false, msg: "Server error" });
    }
});

// ---------- VERIFY OTP - FIXED WITH PROPER AWAIT AND LOGGING ----------
app.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        console.log('\n🔐 ========================================');
        console.log('🔐 /verify-otp CALLED AT:', new Date().toISOString());
        console.log('🔐 Email:', email);
        console.log('🔐 ========================================\n');

        if (!email || !otp) {
            return res.json({ success: false, msg: "Email and OTP required" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.log('❌ User not found:', email);
            return res.json({ success: false, msg: "User not found" });
        }

        console.log('✅ User found:', { name: user.name, email: user.email });

        if (user.otp !== otp) {
            console.log('❌ Invalid OTP for:', email);
            return res.json({ success: false, msg: "Invalid OTP" });
        }

        if (user.otpExpires < new Date()) {
            console.log('❌ OTP expired for:', email);
            return res.json({ success: false, msg: "OTP expired" });
        }

        // Clear OTP
        user.otp = null;
        user.otpExpires = null;
        user.verified = true;
        await user.save();
        console.log('✅ OTP verified and cleared for:', email);

        // Process referral
        if (user.referredBy) {
            try {
                await User.findByIdAndUpdate(user.referredBy, { $inc: { rewardBalance: 50 } });
                await Referral.create({
                    referrerId: user.referredBy,
                    refereeId: user._id,
                    status: 'completed',
                    rewardGranted: true,
                    rewardAmount: 50,
                    createdAt: new Date()
                });
                console.log('🎁 Referral reward granted to:', user.referredBy);
            } catch (refError) {
                console.error('⚠️ Referral error:', refError);
            }
        }

        // ---------- CRITICAL: AWAIT AND LOG EMAIL SENDING ----------
        console.log('\n📧 ========================================');
        console.log('📧 ATTEMPTING TO SEND WELCOME EMAIL');
        console.log('📧 To:', user.email);
        console.log('📧 Username:', user.name);
        console.log('📧 Name:', user.name);
        console.log('📧 ========================================\n');

        let emailSent = false;
        try {
            emailSent = await sendWelcomeMail({
                email: user.email,
                username: user.name,
                name: user.name
            });
            
            if (emailSent) {
                console.log('\n✅✅✅ WELCOME EMAIL SENT SUCCESSFULLY! ✅✅✅\n');
            } else {
                console.error('\n❌❌❌ WELCOME EMAIL FAILED TO SEND! ❌❌❌\n');
            }
        } catch (emailError) {
            console.error('\n💥💥💥 EXCEPTION WHILE SENDING EMAIL: 💥💥💥');
            console.error('Error:', emailError.message);
            console.error('Stack:', emailError.stack);
            console.error('💥💥💥💥💥💥💥💥💥💥💥💥💥💥💥💥💥💥\n');
            emailSent = false;
        }

        // Clear referral cookie
        res.clearCookie('ref');
        
        // Send success response
        res.json({
            success: true,
            msg: "Signup successful!",
            referralCode: user.referralCode,
            rewardBalance: user.rewardBalance || 0,
            emailSent: emailSent
        });
        
        console.log('✅ Signup completed for:', user.email);
        console.log('✅ Response sent to client\n');
        
    } catch (err) {
        console.error('❌❌❌ /verify-otp CRITICAL ERROR: ❌❌❌');
        console.error('Error:', err);
        console.error('Stack:', err.stack);
        console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
        
        res.status(500).json({ 
            success: false, 
            msg: "Internal server error" 
        });
    }
});

// Get user details
app.post('/get-user', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email }).select('-otp -otpExpires');
        
        if (!user) {
            return res.json({ success: false, msg: "User not found" });
        }
        
        res.json({
            success: true,
            user: {
                name: user.name,
                email: user.email,
                referralCode: user.referralCode,
                rewardBalance: user.rewardBalance || 0,
                verified: user.verified || false
            }
        });
        
    } catch (err) {
        console.error('❌ /get-user error:', err);
        res.status(500).json({ success: false, msg: "Server error" });
    }
});

// Get referral stats
app.post('/referral-stats', async (req, res) => {
    try {
        const { referralCode } = req.body;
        
        const user = await User.findOne({ referralCode });
        if (!user) {
            return res.json({ success: false, msg: "Invalid referral code" });
        }
        
        const totalReferrals = await Referral.countDocuments({ referrerId: user._id });
        const successfulReferrals = await Referral.countDocuments({ 
            referrerId: user._id, 
            status: 'completed' 
        });
        
        res.json({
            success: true,
            stats: {
                totalReferrals,
                successfulReferrals,
                rewardBalance: user.rewardBalance || 0,
                referralCode: user.referralCode
            }
        });
        
    } catch (err) {
        console.error('❌ /referral-stats error:', err);
        res.status(500).json({ success: false, msg: "Server error" });
    }
});

// ---------- 404 HANDLER ----------
app.use((req, res) => {
    res.status(404).json({ success: false, msg: "Endpoint not found" });
});

// ---------- ERROR HANDLING MIDDLEWARE ----------
app.use((err, req, res, next) => {
    console.error('🔥 Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        msg: "Something went wrong" 
    });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('✅✅✅ SERVER RUNNING SUCCESSFULLY ✅✅✅');
    console.log('📍 Port:', PORT);
    console.log('🌐 Environment:', process.env.NODE_ENV || 'production');
    console.log('📧 Email Service:', typeof sendWelcomeMail === 'function' ? '✅ Configured' : '⚠️ Fallback');
    console.log('🔗 Health Check: https://refer-earn-app.onrender.com/health');
    console.log('🧪 Test Email: https://refer-earn-app.onrender.com/test-email/your-email@gmail.com');
    console.log('='.repeat(60) + '\n');
});

module.exports = app;
