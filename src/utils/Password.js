const bcrypt = require('bcryptjs')

async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

async function comparePassword(currentPassword, password){
  return await bcrypt.compare(currentPassword, password)
}

  module.exports=  {hashPassword, comparePassword}