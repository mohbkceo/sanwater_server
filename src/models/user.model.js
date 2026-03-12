  const mongoose = require('mongoose');


    const userSchema = new mongoose.Schema({
      fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100},
      email: { type: String, unique: true, required: true, lowercase: true, match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'] },
      password:  { type: String, required: true,  select: false},
      role: {type: String, default: 'admin'},
      phone: phoneSchema,  
      profileImage: { type: String },
    }, { timestamps: true });

  


    module.exports = mongoose.model('User', userSchema);
