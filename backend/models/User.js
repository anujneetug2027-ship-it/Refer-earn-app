const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  referralCode: { type: String, unique: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rewardBalance: { type: Number, default: 0 },
  password: { type: String, default: null },
  otp: String,
  otpExpires: Date,

  walletTransactions: [{
    paymentId: String,
    orderId: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    type: { type: String, default: 'credit' }
  }]
});

module.exports = mongoose.model('User', userSchema);
