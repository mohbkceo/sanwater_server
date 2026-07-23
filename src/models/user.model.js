  const mongoose = require('mongoose');


    const userSchema = new mongoose.Schema({
      fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100},
      email: { type: String, unique: true, required: true, lowercase: true, match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'] },
      password:  { type: String, required: true,  select: false},
      role: { type: String, required: true, enum: ['super_admin', 'admin'], default: 'admin' },
      permissions: [{ type: String }],
      createdWith: {
        name: { type: String, default: null },
        at: { type: Date }
      },
      authKey: { type: String, default:null },
      phone: { type: String, default: null },
      profileImage: { type: String },
    }, { timestamps: true });

  


    module.exports = mongoose.model('User', userSchema);
