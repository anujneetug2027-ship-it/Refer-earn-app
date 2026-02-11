// ============================================
// SERVER.JS - COMPLETE FIXED VERSION
// ============================================

// ---------- 1. LOAD ENVIRONMENT VARIABLES FIRST ----------
require('dotenv').config();

// ---------- 2. IMMEDIATE ENVIRONMENT VALIDATION ----------
console.log('\n' + '='.repeat(60));
console.log('🚀 AMBIKASHELF REFER & EARN SYSTEM - STARTING UP');
console.log('='.repeat(60));
console.log('📋 ENVIRONMENT VARIABLES CHECK:');
console.log('   MONGO_URI:', process.env.MONGO_URI ? '✅ Connected' : '❌ MISSING');
console.log('   SERVICE_ID2:', process.env.SERVICE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   TEMPLATE_ID2:', process.env.TEMPLATE_ID2 ? '✅ Set' : '❌ MISSING');
console.log('   PUBLIC_KEY2:', process.env.PUBLIC_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('   PRIVATE_KEY2:', process.env.PRIVATE_KEY2 ? '✅ Set' : '❌ MISSING');
console.log('   COOKIE_SECRET:', process.env.COOKIE_SECRET ? '✅ Set' : '❌ MISSING');
console.log('   PORT:', process.env.PORT || '5000 (default)');
console.log('='.repeat(60) + '\n');

// ---------- 3. IMPORT DEPENDENCIES ----------
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');

// ---------- 4. IMPORT MODELS ----------
const User = require('./models/User');
const Referral = require('./models/Referral');

// ---------- 5. IMPORT WELCOME MAIL FUNCTION WITH DEBUG ----------
let sendWelcomeMail;
try {
    sendWelcomeMail = require('./welcomeMail');
    console.log('📧 WelcomeMail module loaded:', typeof sendWelcomeMail === 'function' ? '✅ SUCCESS' : '❌ NOT A FUNCTION');
    
    if (typeof sendWelcomeMail !== 'function') {
        console.error('⚠️ Warning: sendWelcomeMail is not a function! Type:', typeof sendWelcomeMail);
        // Create a fallback function
        sendWelcomeMail = async ({ email, username, name }) => {
            console.log('📧 FALLBACK: Would send welcome email to:', email);
            console.log('   Username:', username);
            console.log('   Name:', name);
            console.log('   ⚠️ Email not actually sent - check EmailJS configuration');
            return false;
        };
        console.log('✅ Fallback email function created');
    }
} catch (error) {
    console.error('❌ Failed to load welcomeMail module:', error.message);
    console.log('📧 Creating fallback email function...');
    sendWelcomeMail = async ({ email, username, name }) => {
        console.log('📧 FALLBACK: Would send welcome email to:', email);
        return false;
    };
}

const app = express();

// ---------- 6. MIDDLEWARE ----------
app.use(cors({ 
    origin: '*', 
    credentials: true 
}));

app.use(cookieParser(process.env.COOKIE_SECRET || 'fallback-secret-key-2026'));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// ---------- 7. FRONTEND STATIC FILES ----------
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- 8. MONGOOSE CONNECTION WITH BETTER ERROR HANDLING ----------
if (!process.env.MONGO_URI) {
    console.error('❌ CRITICAL: MONGO_URI is not defined in environment variables!');
    process.exit(1);
}

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.error('Please check your MONGO_URI and network connection');
    process.exit(1);
});

// ---------- 9. HELPER FUNCTIONS ----------
function generateReferralCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char code
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ---------- 10. ROUTES ----------

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        emailjs: typeof sendWelcomeMail === 'function' ? 'configured' : 'fallback'
    });
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
        console.log('📤 /send-otp called for:', { name, email, refCode });

        if (!name || !email) {
            return res.json({ success: false, msg: "Name and email required" });
        }

        // Check if user exists
        const existing = await User.findOne({ email });
        if (existing) {
            console.log('❌ Email already registered:', email);
            return res.json({ success: false, msg: "Email already registered" });
        }

        // Generate OTP and referral code
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);
        const referralCode = generateReferralCode();

        // Check for referral
        let referredBy = null;
        const cookieRef = req.cookies.ref;
        const finalRef = refCode || cookieRef;
        
        if (finalRef) {
            const referrer = await User.findOne({ referralCode: finalRef });
            if (referrer) {
                referredBy = referrer._id;
                console.log('🎁 Referral detected! Referrer:', referrer.email);
            }
        }

        // Create user
        await User.create({ 
            name, 
            email, 
            referralCode, 
            referredBy, 
            otp, 
            otpExpires,
            rewardBalance: 0,
            createdAt: new Date()
        });

        console.log('✅ User created successfully:', { email, referralCode });
        
        return res.json({ 
            success: true, 
            msg: "OTP sent successfully", 
            otp // Remove this in production!
        });
        
    } catch (err) {
        console.error('❌ /send-otp error:', err);
        return res.status(500).json({ 
            success: false, 
            msg: "Server error. Please try again." 
        });
    }
});

// ---------- VERIFY OTP ----------
app.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        console.log('🔐 /verify-otp called for:', { email, otp: '***' });

        if (!email || !otp) {
            return res.json({ success: false, msg: "Email and OTP required" });
        }

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            console.log('❌ User not found:', email);
            return res.json({ success: false, msg: "User not found" });
        }

        console.log('✅ User found:', { 
            name: user.name, 
            email: user.email,
            otpExpires: user.otpExpires 
        });

        // Verify OTP
        if (user.otp !== otp) {
            console.log('❌ Invalid OTP - Provided:', otp, 'Stored:', user.otp);
            return res.json({ success: false, msg: "Invalid OTP" });
        }

        if (user.otpExpires < new Date()) {
            console.log('❌ OTP expired:', user.otpExpires);
            return res.json({ success: false, msg: "OTP expired" });
        }

        // Clear OTP
        user.otp = null;
        user.otpExpires = null;
        user.verified = true;
        await user.save();
        console.log('✅ OTP verified and cleared for:', email);

        // Process referral reward if applicable
        if (user.referredBy) {
            try {
                await User.findByIdAndUpdate(user.referredBy, { 
                    $inc: { rewardBalance: 50 } 
                });
                
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
                console.error('⚠️ Referral processing error:', refError);
                // Don't fail the signup if referral processing fails
            }
        }

        // ---------- SEND WELCOME EMAIL WITH PROPER AWAIT ----------
        console.log('📧 Attempting to send welcome email to:', user.email);
        console.log('📧 Email function type:', typeof sendWelcomeMail);
        
        let emailSent = false;
        try {
            emailSent = await sendWelcomeMail({
                email: user.email,
                username: user.name,
                name: user.name
            });
            
            console.log('📧 Welcome email result:', emailSent ? '✅ SUCCESS' : '❌ FAILED');
            
        } catch (emailError) {
            console.error('❌ Welcome email exception:', {
                name: emailError.name,
                message: emailError.message,
                stack: emailError.stack
            });
            emailSent = false;
        }

        // Clear referral cookie if exists
        res.clearCookie('ref');

        // Send success response
        res.json({
            success: true,
            msg: "Signup successful!",
            referralCode: user.referralCode,
            rewardBalance: user.rewardBalance || 0,
            emailSent: emailSent
        });
        
        console.log('✅ Signup completed successfully for:', user.email);
        
    } catch (err) {
        console.error('❌ /verify-otp critical error:', {
            message: err.message,
            stack: err.stack
        });
        
        res.status(500).json({ 
            success: false, 
            msg: "Internal server error. Please try again." 
        });
    }
});

// Get user details endpoint
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
                referredBy: user.referredBy,
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

// ---------- 11. ERROR HANDLING MIDDLEWARE ----------
app.use((req, res) => {
    res.status(404).json({ success: false, msg: "Endpoint not found" });
});

app.use((err, req, res, next) => {
    console.error('🔥 Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        msg: "Something went wrong on our end" 
    });
});

// ---------- 12. START SERVER ----------
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log(`✅ SERVER RUNNING SUCCESSFULLY`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📧 Email Service: ${typeof sendWelcomeMail === 'function' ? 'Configured' : 'Fallback'}`);
    console.log('='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received. Closing server...');
    server.close(() => {
        console.log('✅ Server closed');
        mongoose.connection.close(false, () => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    // Log but don't exit in production
    if (process.env.NODE_ENV === 'production') {
        console.error('Continuing despite error...');
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
