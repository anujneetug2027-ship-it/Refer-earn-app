// walletRoutes.js — place this file next to your server.js
const express  = require('express');
const router   = express.Router();
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const User     = require('./models/User');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ── 1. Create Order ──────────────────────────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount || amount < 100)
      return res.status(400).json({ success: false, msg: 'Invalid amount' });

    const order = await razorpay.orders.create({
      amount:   Math.round(amount),
      currency: 'INR',
      receipt:  `wallet_${email}_${Date.now()}`,
      notes:    { email, purpose: 'wallet_topup' }
    });

    res.json({ success: true, orderId: order.id, amount: order.amount });

  } catch (err) {
    console.error('❌ /create-order:', err.message);
    res.status(500).json({ success: false, msg: 'Order creation failed' });
  }
});

// ── 2. Verify Payment + Credit Wallet ────────────────────
router.post('/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      email,
      amount
    } = req.body;

    // ✅ Verify Razorpay signature
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature)
      return res.status(400).json({ success: false, msg: 'Invalid signature' });

    // ✅ Credit wallet in MongoDB
    const user = await User.findOneAndUpdate(
      { email },
      {
        $inc: { rewardBalance: parseFloat(amount) },
        $push: {
          walletTransactions: {
            $each: [{
              paymentId: razorpay_payment_id,
              orderId:   razorpay_order_id,
              amount:    parseFloat(amount),
              date:      new Date(),
              type:      'credit'
            }],
            $slice: -100
          }
        }
      },
      { new: true }
    );

    if (!user)
      return res.status(404).json({ success: false, msg: 'User not found' });

    console.log(`✅ Wallet credited: ₹${amount} for ${email} | ${razorpay_payment_id}`);

    res.json({
      success:    true,
      newBalance: user.rewardBalance,
      paymentId:  razorpay_payment_id
    });

  } catch (err) {
    console.error('❌ /verify:', err.message);
    res.status(500).json({ success: false, msg: 'Verification failed' });
  }
});

// ── 3. Get Wallet Balance ─────────────────────────────────
router.get('/balance', async (req, res) => {
  try {
    const { email } = req.query;
    const user = await User.findOne({ email }, 'rewardBalance walletTransactions');
    if (!user) return res.status(404).json({ success: false });

    res.json({
      success:      true,
      balance:      user.rewardBalance || 0,
      transactions: user.walletTransactions || []
    });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── 4. Webhook (optional but recommended) ────────────────
router.post('/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const sig      = req.headers['x-razorpay-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');

      if (sig !== expected)
        return res.status(400).send('Invalid webhook signature');

      const event = JSON.parse(req.body);

      if (event.event === 'payment.captured') {
        const payment = event.payload.payment.entity;
        const email   = payment.notes?.email;
        const amount  = payment.amount / 100;

        if (email) {
          await User.findOneAndUpdate(
            { email },
            { $inc: { rewardBalance: amount } }
          );
          console.log(`✅ Webhook: ₹${amount} credited to ${email}`);
        }
      }

      res.json({ status: 'ok' });

    } catch (err) {
      console.error('❌ Webhook error:', err.message);
      res.status(500).send('Webhook error');
    }
  }
);

module.exports = router;
