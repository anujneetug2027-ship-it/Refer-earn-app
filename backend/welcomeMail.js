// ============================================
// welcomeMail.js - WITH FULL DEBUG LOGGING
// ============================================

const emailjs = require('@emailjs/nodejs');

// Get environment variables
const SERVICE_ID = process.env.SERVICE_ID2;
const TEMPLATE_ID = process.env.TEMPLATE_ID2;
const PUBLIC_KEY = process.env.PUBLIC_KEY2;
const PRIVATE_KEY = process.env.PRIVATE_KEY2;

// Log configuration at startup
console.log('\n📧 EmailJS Configuration:');
console.log('  - SERVICE_ID:', SERVICE_ID ? '✅ Set' : '❌ MISSING');
console.log('  - TEMPLATE_ID:', TEMPLATE_ID ? '✅ Set' : '❌ MISSING');
console.log('  - PUBLIC_KEY:', PUBLIC_KEY ? '✅ Set' : '❌ MISSING');
console.log('  - PRIVATE_KEY:', PRIVATE_KEY ? '✅ Set' : '❌ MISSING');
console.log('');

async function sendWelcomeMail({ email, username, name }) {
    // ALWAYS log when function is called
    console.log('\n📨 ========================================');
    console.log('📨 sendWelcomeMail() CALLED AT:', new Date().toISOString());
    console.log('📨 Recipient:', email);
    console.log('📨 Username:', username);
    console.log('📨 Name:', name);
    console.log('📨 ========================================\n');

    // Validate inputs
    if (!email) {
        console.error('❌ ERROR: Email is required but was not provided!');
        return false;
    }

    // Validate environment variables
    if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY || !PRIVATE_KEY) {
        console.error('❌ ERROR: EmailJS environment variables missing!');
        console.error('   SERVICE_ID:', SERVICE_ID ? '✅' : '❌');
        console.error('   TEMPLATE_ID:', TEMPLATE_ID ? '✅' : '❌');
        console.error('   PUBLIC_KEY:', PUBLIC_KEY ? '✅' : '❌');
        console.error('   PRIVATE_KEY:', PRIVATE_KEY ? '✅' : '❌');
        return false;
    }

    try {
        // Template params - ONLY what your template shows
        const templateParams = {
            name: name,
            username: username
        };

        console.log('📤 Sending email via EmailJS...');
        console.log('   Service ID:', SERVICE_ID);
        console.log('   Template ID:', TEMPLATE_ID);
        console.log('   Template Params:', templateParams);
        console.log('   Timestamp:', new Date().toISOString());

        // Send email
        const response = await emailjs.send(
            SERVICE_ID,
            TEMPLATE_ID,
            templateParams,
            {
                publicKey: PUBLIC_KEY,
                privateKey: PRIVATE_KEY,
            }
        );

        console.log('\n✅✅✅ EMAIL SENT SUCCESSFULLY! ✅✅✅');
        console.log('   Status:', response.status);
        console.log('   Response:', response.text);
        console.log('   To:', email);
        console.log('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅\n');
        
        return true;
        
    } catch (error) {
        console.error('\n❌❌❌ EMAIL FAILED! ❌❌❌');
        console.error('   Error name:', error.name);
        console.error('   Error message:', error.message);
        
        if (error.status) {
            console.error('   HTTP Status:', error.status);
        }
        
        if (error.text) {
            console.error('   Response text:', error.text);
        }
        
        // Log full error details
        try {
            console.error('   Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        } catch (e) {
            console.error('   Could not stringify error:', error);
        }
        
        console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
        return false;
    }
}

module.exports = sendWelcomeMail;
