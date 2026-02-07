const emailjs = require('@emailjs/nodejs');

const service_id2 = process.env.SERVICE_ID2;
const template_id2 = process.env.TEMPLATE_ID2;
const public_key2 = process.env.PUBLIC_KEY2;
const private_key2 = process.env.PRIVATE_KEY2;

async function sendWelcomeMail({ email, username, name }) {
  try {
    const response = await emailjs.send(
      service_id2,
      template_id2,
      {
        email,
        username,
        name,
      },
      {
        publicKey: public_key2,
        privateKey: private_key2,
      }
    );

    console.log("Welcome email sent:", response.status);
    return true;
  } catch (error) {
    console.error("Welcome email failed:", error);
    return false;
  }
}

module.exports = sendWelcomeMail;
