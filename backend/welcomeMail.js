// ============================================
// welcomeMail.js - USING YOUR IDs WITH 2 (WELCOME)
// ============================================

const emailjs = require('@emailjs/nodejs');

// These are your WELCOME email credentials (IDs with 2)
const SERVICE_ID = process.env.SERVICE_ID2;
const TEMPLATE_ID = process.env.TEMPLATE_ID2;
const PUBLIC_KEY = process.env.PUBLIC_KEY2;
const PRIVATE_KEY = process.env.PRIVATE_KEY2;

// Log at startup
console.log('\n📧 WELCOME EMAIL CONFIGURATION:');
console.log('  SERVICE_ID2:', SERVICE_ID ? '✅ Set' : '❌ MISSING');
console.log('  TEMPLATE_ID2:', TEMPLATE_ID ? '✅ Set' : '❌ MISSING');
console.log('  PUBLIC_KEY2:', PUBLIC_KEY ? '✅ Set' : '❌ MISSING');
console.log('  PRIVATE_KEY2:', PRIVATE_KEY ? '✅ Set' : '❌ MISSING');
console.log('');

async function sendWelcomeMail({ email, username, name }) {
    // Force log to confirm function is called
    console.log('\n📨 ========================================');
    console.log('📨 sendWelcomeMail() CALLED AT:', new Date().toISOString());
    console.log('📨 Email:', email);
    console.log('📨 Username:', username);
    console.log('📨 Name:', name);
    console.log('📨 Using TEMPLATE_ID2:', TEMPLATE_ID);
    console.log('📨 ========================================\n');

    // Validate
    if (!email) {
        console.error('❌ Email is required!');
        return false;
    }

    if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY || !PRIVATE_KEY) {
        console.error('❌ Missing welcome email credentials!');
        return false;
    }

    try {
        // ONLY send what your template shows - name and username
        const templateParams = {
            name: name,
            username: username
        };

        console.log('📤 Sending with params:', templateParams);

        const response = await emailjs.send(
            SERVICE_ID,
            TEMPLATE_ID,
            templateParams,
            {
                publicKey: PUBLIC_KEY,
                privateKey: PRIVATE_KEY,
            }
        );

        console.log('✅✅✅ WELCOME EMAIL SENT! Status:', response.status);
        return true;
        
    } catch (error) {
        console.error('❌❌❌ WELCOME EMAIL FAILED!');
        console.error('Error:', error.message);
        if (error.status) console.error('Status:', error.status);
        if (error.text) console.error('Text:', error.text);
        return false;
    }
}

module.exports = sendWelcomeMail;
