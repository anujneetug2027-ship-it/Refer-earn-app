const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    refereeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      status: { type: String, default: 'pending' },
        rewardGranted: { type: Boolean, default: false },
          createdAt: { type: Date, default: Date.now }
          });

          module.exports = mongoose.model('Referral', referralSchema);
