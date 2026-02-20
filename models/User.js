const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
    email: { type: String, unique: true },
      referralCode: { type: String, unique: true },
        referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          rewardBalance: { type: Number, default: 0 },
            otp: String,
              otpExpires: Date
              });

              module.exports = mongoose.model('User', userSchema);
