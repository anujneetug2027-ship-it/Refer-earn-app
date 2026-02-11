// welcomeMail.js
const emailjs = require('@emailjs/nodejs');

console.log('📧 WelcomeMail module loaded');
console.log('Environment check at module load:');
console.log('- SERVICE_ID2:', process.env.SERVICE_ID2 ? '✅ Present' : '❌ MISSING');
console.log('- TEMPLATE_ID2:', process.env.TEMPLATE_ID2 ? '✅ Present' : '❌ MISSING');
console.log('- PUBLIC_KEY2:', process.env.PUBLIC_KEY2 ? '✅ Present' : '❌ MISSING');
console.log('- PRIVATE_KEY2:', process.env.PRIVATE_KEY2 ? '✅ Present' : '❌ MISSING');

const service_id2 = process.env.SERVICE_ID2;
const template_id2 = process.env.TEMPLATE_ID2;
const public_key2 = process.env.PUBLIC_KEY2;
const private_key2 = process.env.PRIVATE_KEY2;

async function sendWelcomeMail({ email, username, name }) {
    console.log('📨 sendWelcomeMail FUNCTION CALLED!');
    console.log('Parameters received:', { email, username, name });
    
    try {
        // Validate environment variables
        if (!service_id2 || !template_id2 || !public_key2 || !private_key2) {
            console.error('❌ CRITICAL: Missing EmailJS credentials!');
            console.error('service_id2:', service_id2 || 'MISSING');
            console.error('template_id2:', template_id2 || 'MISSING');
            console.error('public_key2:', public_key2 || 'MISSING');
            console.error('private_key2:', private_key2 ? 'Present (hidden)' : 'MISSING');
            return false;
        }

        console.log('📤 Attempting to send email via EmailJS...');
        console.log('Using Service ID:', service_id2);
        console.log('Using Template ID:', template_id2);
        
        const templateParams = {
            to_email: email,
            to_name: name,
            from_name: 'AmbikaShelf',
            reply_to: 'support@ambikashelf.shop',
            username: username,
            name: name,
            email: email
        };
        
        console.log('Template params:', templateParams);
        
        const response = await emailjs.send(
            service_id2,
            template_id2,
            templateParams,
            {
                publicKey: public_key2,
                privateKey: private_key2,
            }
        );

        console.log('✅ EmailJS send successful!');
        console.log('Response status:', response.status);
        console.log('Response text:', response.text);
        return true;
        
    } catch (error) {
        console.error('❌ EmailJS send FAILED!');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Full error:', error);
        
        if (error.status) console.error('Error status:', error.status);
        if (error.text) console.error('Error text:', error.text);
        
        return false;
    }
}

module.exports = sendWelcomeMail;
