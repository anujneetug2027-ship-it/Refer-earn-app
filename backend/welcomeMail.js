const emailjs = require('@emailjs/nodejs');

// EmailJS configuration
const service_id2 = "service_id2";      // replace with your service id
const template_id2 = "template_nkltb8n";
const public_key2 = "public_key2";      // your EmailJS public key
const private_key2 = "private_key2";    // your EmailJS private key

async function sendWelcomeMail({ email, username, name }) {
  try {
    const response = await emailjs.send(
      service_id2,
      template_id2,
      {
        email: email,
        username: username,
        name: name,
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
