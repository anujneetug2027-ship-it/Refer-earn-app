// ============================================
// welcomeMail.js - PERFECT MATCH FOR YOUR TEMPLATE
// ONLY USES name AND username AS SHOWN IN SCREENSHOT
// ============================================

const emailjs = require('@emailjs/nodejs');

// Get environment variables
const SERVICE_ID = process.env.SERVICE_ID2;
const TEMPLATE_ID = process.env.TEMPLATE_ID2;
const PUBLIC_KEY = process.env.PUBLIC_KEY2;
const PRIVATE_KEY = process.env.PRIVATE_KEY2;

// Log startup (optional - remove if you want cleaner logs)
console.log('📧 WelcomeMail module initialized');

/**
 * Send welcome email - EXACT MATCH for your template
 * ONLY sends name and username - NOTHING ELSE
 */
async function sendWelcomeMail({ email, username, name }) {
    try {
        // CRITICAL: Send ONLY what your template shows
        // Your screenshot shows: {{name}} and {{username}}
        const templateParams = {
            name: name,           // Exactly as shown in your template subject
            username: username    // Exactly as shown in your template content
        };

        // Send email - EmailJS automatically detects recipient from template
        const response = await emailjs.send(
            SERVICE_ID,
            TEMPLATE_ID,
            templateParams,
            {
                publicKey: PUBLIC_KEY,
                privateKey: PRIVATE_KEY,
            }
        );

        console.log(`✅ Welcome email sent to ${email}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Welcome email failed for ${email}:`, error.message);
        return false;
    }
}

module.exports = sendWelcomeMail;
